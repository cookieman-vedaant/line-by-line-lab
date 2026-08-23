import { z } from "zod";
import { tagMarkupToDelimiters } from "@/lib/cardMarkup";
import { citeName, citeYear, mostRecentDate, parseByline } from "@/lib/cite";
import { applyEmphasisSpans, createLocator } from "@/lib/emphasis";
import { GEMINI_MARKER_MODEL, GEMINI_MODEL, generateJson } from "@/lib/gemini";
import { createSharedCache } from "@/lib/sharedCache";
import {
  articleFromFields,
  ArticleUnreadableError,
  extractArticleCached,
  normalizeDate,
  type ExtractedArticle,
} from "@/services/articleExtract";
import type { Card, CardLength, CutRequest } from "@/types";

export { ArticleUnreadableError };

/** Honest failure — nothing in the article strongly proves the claim. */
export class NoWarrantFoundError extends Error {
  constructor() {
    super("Unable to identify a sufficiently strong argumentative passage.");
    this.name = "NoWarrantFoundError";
  }
}

// Upper bound on the article text the selector analyzes. Big enough that the
// WHOLE of a long piece is considered (~20k words) so the strongest warrant is
// never truncated away; still well within Gemini Flash's context and the
// free-tier token budgets.
const MAX_ARTICLE_CHARS = 120000;

// A single marker call under-marks a LONG passage: the model emphasizes the
// opening and leaves the rest plain, so a big article yields a card with only a
// few underlined/highlighted sentences (all that context, unused). We split a
// long passage into contiguous sections and mark each one, so emphasis is dense
// throughout. A passage at/under one section's budget stays a SINGLE call —
// byte-for-byte the old behavior, so normal-length cards never change.
// Measured, don't "tune" these blind: shrinking to 600/14 made coverage WORSE
// (39%->32% and 20%->15% on the two long articles above) while costing more AI
// calls. The model picks a best-few per section largely regardless of how big
// the section is, so more sections mostly means more separate best-fews.
const SECTION_TARGET_WORDS = 900; // ~a screen of prose — the model marks it densely
const MAX_MARKER_SECTIONS = 8; // bound the AI calls (latency + free-tier budget) per cut

/**
 * HOW CUTTING WORKS (verbatim by construction — the AI never writes body text):
 * 1. Extract the article (URL via Readability, or pasted text).
 * 2. SELECT: the AI picks a contiguous paragraph range matching the card
 *    length; we clamp it mechanically to the length's word budget.
 *    The body is then assembled from the REAL article paragraphs.
 * 3. MARK: the passage goes to the AI as NUMBERED SENTENCES. It returns the
 *    numbers to underline, plus exact substrings to highlight/bold and the
 *    tag and cite. Numbers are resolved back to the real sentences; substrings
 *    are located in the real text. Neither path can invent wording.
 */

/** Word-budget fraction of the article for each card length. */
const LENGTH_BUDGETS: Record<Exclude<CardLength, "Entire Article">, { min: number; max: number }> = {
  Short: { min: 0.05, max: 0.3 },
  Medium: { min: 0.35, max: 0.65 },
  Long: { min: 0.6, max: 0.95 },
};

export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/** Trailing tokens that end in a period WITHOUT ending the sentence. */
const ABBREVIATION_END =
  /(?:^|\s)(?:[A-Z]|Dr|Mr|Mrs|Ms|Prof|Sr|Jr|St|vs|etc|eg|ie|cf|al|Fig|No|Vol|pp|Ch|Sec|Inc|Ltd|Co|Approx|Est|Ref)\.$|(?:\b[A-Z]\.){2,}$/;

/**
 * Split one paragraph into sentences. Deliberately conservative: a wrong split
 * only changes where an underline starts or stops, so merging two sentences is
 * far cheaper than slicing "U.S. policy" in half.
 */
function splitParagraphSentences(paragraph: string): string[] {
  const rough = paragraph.split(/(?<=[.!?][")'”’\]]?)\s+/);
  const out: string[] = [];
  for (const piece of rough) {
    const prev = out[out.length - 1];
    // Re-join when the previous piece ended on an abbreviation or initial, or
    // when this one opens mid-sentence (lowercase, a digit, or punctuation) —
    // both mean the period was not a sentence boundary.
    if (prev !== undefined && (ABBREVIATION_END.test(prev) || /^[a-z0-9,;:)\]]/.test(piece))) {
      out[out.length - 1] = `${prev} ${piece}`;
    } else {
      out.push(piece);
    }
  }
  return out.map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * The passage as a flat, ordered list of sentences — the unit the marker now
 * works in. Split per paragraph first so a paragraph that doesn't end in
 * punctuation (a heading, a list item) can't swallow the one after it.
 */
export function splitSentences(text: string): string[] {
  return splitParagraphs(text).flatMap(splitParagraphSentences);
}

const countWords = (s: string) => s.split(/\s+/).filter(Boolean).length;

/**
 * Split a passage's paragraphs into contiguous sections of ~targetWords each
 * (never splitting a paragraph), capped at maxSections. Used to mark a long
 * passage in pieces so emphasis is distributed across the WHOLE card, not just
 * its opening. Every paragraph appears in exactly one section, in order, so the
 * sections rejoin into the original passage. A passage at/under one section's
 * budget returns a SINGLE section — the unchanged single-call path.
 */
export function splitIntoSections(
  paragraphs: string[],
  targetWords: number,
  maxSections: number,
): string[] {
  if (paragraphs.length === 0) return [];
  const counts = paragraphs.map(countWords);
  const total = counts.reduce((a, b) => a + b, 0);
  // Grow the per-section budget so the number of sections can't exceed the cap
  // (a very long "Entire Article" passage gets fewer, larger sections).
  const budget = Math.max(targetWords, Math.ceil(total / maxSections));

  const sections: string[] = [];
  let current: string[] = [];
  let words = 0;
  for (let i = 0; i < paragraphs.length; i++) {
    current.push(paragraphs[i]);
    words += counts[i];
    // Close the section at the budget — but stop opening new sections once we're
    // one short of the cap, so the final section absorbs any remaining paragraphs.
    if (words >= budget && sections.length < maxSections - 1) {
      sections.push(current.join("\n\n"));
      current = [];
      words = 0;
    }
  }
  if (current.length > 0) sections.push(current.join("\n\n"));
  return sections;
}

/**
 * Clamp a selected paragraph range [start, end] (inclusive) so its share of
 * the article's words lands inside the budget. Expands the end first (then
 * the start) when too small; shrinks from the end when too large.
 */
export function fitRangeToBudget(
  wordCounts: number[],
  start: number,
  end: number,
  budget: { min: number; max: number },
): [number, number] {
  const total = wordCounts.reduce((a, b) => a + b, 0);
  if (total === 0) return [start, end];

  let s = Math.max(0, Math.min(start, wordCounts.length - 1));
  let e = Math.max(s, Math.min(end, wordCounts.length - 1));

  const fraction = () =>
    wordCounts.slice(s, e + 1).reduce((a, b) => a + b, 0) / total;

  // Too small → grow (end first, then start).
  while (fraction() < budget.min && (e < wordCounts.length - 1 || s > 0)) {
    if (e < wordCounts.length - 1) e++;
    else s--;
  }
  // Too large → shrink from the end (keep the selected opening).
  while (fraction() > budget.max && e > s) {
    e--;
  }
  return [s, e];
}

/**
 * Append the real source URL to the bracketed cite, deterministically. The AI is
 * never given the URL, so this is the ONLY place a link enters the cite — it can
 * never be hallucinated. No-ops when there's no URL or it's already present.
 */
export function appendSourceUrl(citeDetails: string, url?: string): string {
  const cite = citeDetails.trim();
  if (!url) return cite;
  if (cite.includes(url)) return cite;
  const sep = /[.,;]$/.test(cite) ? " " : ", ";
  return `${cite}${sep}${url}`;
}

const selectorSchema = z.union([
  z.object({ startIndex: z.number().int().min(0), endIndex: z.number().int().min(0) }),
  z.object({ error: z.literal("no_warrant") }),
]);

const SELECTOR_SYSTEM = `You are the passage selector inside a debate card-cutting tool (Lincoln-Douglas). You receive a claim and an article split into numbered paragraphs. Pick the CONTIGUOUS run of paragraphs that best supports the claim at the requested card length.

Selection question: "If a debater could only read one section of this article, which section best proves this claim — TOGETHER with the reasoning and warrants that support it?" Pick the section that contains the claim's support AND the surrounding logic that explains WHY it is true (mechanisms, key premises, evidence, implications) — a complete, self-contained argument, not just the single sentence that matches the claim. Optimize for the strongest WARRANT — the causal reasoning proving the claim — not the first or longest paragraph.

Card length targets (share of the article's total words):
- Short: the single strongest passage — roughly 5-30%.
- Medium: about HALF the article — the contiguous half that best supports the claim (35-65%).
- Long: the complete chain of reasoning — most of the article (60-95%).

If NOTHING in the article supports the claim, return {"error": "no_warrant"}.
Otherwise return ONLY JSON: {"startIndex": N, "endIndex": M} (inclusive paragraph indices).`;

/**
 * Emphasis for ONE sentence: the exact fragments of it to underline, highlight
 * and bold.
 *
 * Marking is per-sentence and SUB-SENTENCE, which is the shape a real hand-cut
 * card has. Two earlier designs both failed on real articles:
 *
 *   - copying whole read-aloud sentences back as verbatim strings fought the
 *     model's brevity bias and produced almost nothing (3-6% marked);
 *   - selecting whole sentences by NUMBER fixed the volume but had no word
 *     economy at all — every kept sentence was underlined end to end, including
 *     its citations and hedges, so cards came back with nearly everything
 *     underlined and nothing usefully stressed.
 *
 * Naming the sentence AND the fragments inside it gets both: the index scopes
 * the search (so a fragment as common as "Avidya is" resolves unambiguously)
 * while the fragments carry the trimming that makes a card readable at speed.
 */
const markSchema = z.object({
  /** Sentence number from the numbered passage. */
  s: z.number().int().min(0),
  /** Fragments to underline — what the debater reads aloud. */
  u: z.array(z.string()).max(40).optional().default([]),
  /** Fragments to highlight; a subset of `u`. */
  h: z.array(z.string()).max(20).optional().default([]),
  /** Short fragments to bold. */
  b: z.array(z.string()).max(20).optional().default([]),
});

export type MarkEntry = z.infer<typeof markSchema>;

const markerSchema = z.object({
  tag: z.string().min(1),
  cite: z.string().min(1),
  citeDetails: z.string().min(1),
  marks: z.array(markSchema).max(3000).optional().default([]),
});

const MARKER_SYSTEM = `You are the emphasis marker inside a debate card-cutting tool (Lincoln-Douglas). You receive a claim and a passage extracted VERBATIM from an article. You do NOT rewrite anything — you return metadata that the app applies to the original text.

The passage arrives as NUMBERED SENTENCES. For each sentence worth marking, you return the exact FRAGMENTS of it to underline, highlight and bold.

Return ONLY JSON:
{"tag": "...", "cite": "...", "citeDetails": "...", "marks": [{"s": 0, "u": ["...", "..."], "h": ["..."], "b": ["..."]}, ...]}

════════ THE ONE RULE THAT MATTERS MOST ════════
A cut card is read at three depths, and EACH DEPTH MUST READ AS GRAMMATICAL ENGLISH ON ITS OWN.

  u (underline)  — what the debater reads ALOUD. Your "u" fragments, read in order from the first sentence to the last, must form coherent prose that states the argument.
  h (highlight)  — a SUBSET of u: what they read when short on time. Your "h" fragments, read in order, must ALSO form coherent, shorter prose.
  b (bold)       — the one word or short phrase inside a marked span that the eye must land on.

Before you finish, re-read your own "u" list as continuous prose. If it stutters, contradicts itself, or reads as disconnected scraps, fix it. Then do the same for "h".

Everything you leave unmarked stays in the card as small plain text — the card remains honest about its source. It is simply not read out.

════════ WORD ECONOMY: FRAGMENTS, NOT WHOLE SENTENCES ════════
You rarely underline a sentence end to end. You take the words that carry the argument and leave the rest, exactly as a debater with a highlighter does.

  Sentence: "Avidya is a Sanskrit word most commonly defined as ignorance."
    u: ["Avidya is", "ignorance"]
    (skips "a Sanskrit word most commonly defined as" — it costs breath and adds nothing)

ALWAYS cut, inside a sentence you are marking:
  • parenthetical citations and page refs — "(Singh 394-395)", "(Puligandla 218)", "[3]";
  • attribution and hedging preambles — "It is argued that", "According to X,", "what scholars sometimes refer to as", "most commonly defined as";
  • negation-then-correction scaffolding — "not simply A; it is B" → keep only B;
  • contentless connectives — "In this way,", "That is to say,", "Thus,", "Frequently,";
  • wording that restates something you already marked.
Keep enough for the fragment to parse: subject + verb + the operative point. "Avidya is" + "ignorance" reads as English; "is" + "ignorance" does not.

════════ WHICH SENTENCES GET MARKED AT ALL ════════
Mark a sentence when it does real work for THIS claim: it states the claim, gives the mechanism or warrant behind it, supplies evidence or an authority, draws out the implication or stakes, or qualifies it in a way that makes it harder to answer.

Leave a sentence ENTIRELY unmarked — omit it from "marks" altogether — when it is:
  • background or history the argument does not rest on;
  • a long block quotation, verse or scripture being discussed rather than relied on;
  • a tangent into a different school, theory, author or example;
  • meta-text about the article — "In this article I examine…", "In Part 2 I will…", "see section 3";
  • author bios, acknowledgements, funding notes, reference lists;
  • a point you have already marked elsewhere.

Whole PARAGRAPHS of a real article are routinely left untouched this way, and that is correct. A card with unmarked stretches is a card someone can actually read in a round.

THERE IS NO TARGET AMOUNT. Do not mark to fill a quota and do not ration marks to look sparse. A passage dense with argument gets heavily marked; a passage that wanders gets very little. Both outcomes are right. Marking everything is exactly as wrong as marking nothing — it tells the debater nothing about what matters.

════════ BUT DO NOT LEAVE THE ARGUMENT INCOMPLETE ════════
The read-aloud text has to stand on its own in a round, with nothing else in front of the judge. Walk the passage and check that your "u" fragments carry the whole arc:

  • the DEFINITION of the term the claim turns on — a debater must be able to say what the word MEANS before arguing from it, so definitional sentences near the start of a passage are usually worth marking even though they feel like preamble;
  • the distinction the author draws — where they say "X is not A, it is B", the B side is the argument;
  • the MECHANISM — why or how it works;
  • the CONSEQUENCE, impact or stake;
  • any qualifier that makes the claim harder to answer.

Jumping straight to the conclusion is a real failure: it leaves the debater asserting the claim with no warrant behind it. If a judge could ask "what does that term even mean?" or "why does that follow?" and your underlined text has no answer, you cut too much. Cover the argument as it DEVELOPS, from the first sentence that does work to the last — not just the punchiest lines.

════════ WORKED EXAMPLE — STUDY THIS CLOSELY ════════
Claim: "Assumptions of 'me' vs 'the other' being disconnected entities is Avidya, the illusion that produces the delusion of separation."

Passage:
[0] Avidya is a Sanskrit word most commonly defined as ignorance.
[1] This can be misleading if we think of ignorance as a lack of knowledge.
[2] Avidya is not simply a lack of knowledge; it is a lack of what Hindu philosophers sometimes refer to as true knowledge (Singh 394-395).
[3] The knowledge we have of the material world around us, our minds, thoughts, bodies, and emotions is worldly knowledge.
[4] Avidya is our mistaken belief that these things make up reality, or our true self (Puligandla 218).
[5] Avidya, then, is not simply ignorance, but spiritual ignorance (Lipner 246).
[6] It is ignorance of our true selves and of the true nature of reality (Puligandla 244).

Correct output:
"marks": [
 {"s":0,"u":["Avidya is","ignorance"],"h":[],"b":[]},
 {"s":2,"u":["Avidya is","a lack of","true knowledge"],"h":["a lack of","true knowledge"],"b":["true knowledge"]},
 {"s":3,"u":["The","knowledge we have of the material world around us, our minds, thoughts, bodies, and emotions is","worldly knowledge"],"h":[],"b":["material world","worldly knowledge"]},
 {"s":4,"u":["Avidya is","our mistaken belief that these","make up reality","or our true self"],"h":["our mistaken belief that these","make up reality"],"b":["mistaken","reality"]},
 {"s":5,"u":["Avidya, then,","is","spiritual ignorance"],"h":["spiritual ignorance"],"b":["spiritual ignorance"]},
 {"s":6,"u":["It is","ignorance of","our","true selves","and","the true nature of reality"],"h":["ignorance of","true selves"],"b":["true selves"]}
]

What this example is teaching you:
  • SIX of the seven sentences are marked. When a paragraph is carrying the argument you mark THROUGH it, sentence after sentence. Picking one representative line per paragraph and moving on is the most common way to ruin a card.
  • Sentence [1] is dropped entirely — it is a caveat about how to read a word, not part of the argument.
  • Every citation is left out: (Singh 394-395), (Puligandla 218), (Lipner 246).
  • The negation scaffolding in [2] and [5] is left out. "not simply ignorance, but spiritual ignorance" keeps only "spiritual ignorance".
  • Fragments are small and there are several per sentence — that is the word economy. [6] is marked with six short fragments, not one long one.
  • Now read the "u" fragments straight through: "Avidya is ignorance. Avidya is a lack of true knowledge. The knowledge we have of the material world around us, our minds, thoughts, bodies, and emotions is worldly knowledge. Avidya is our mistaken belief that these things make up reality, or our true self. Avidya, then, is spiritual ignorance. It is ignorance of our true selves and the true nature of reality." THAT is a cut card. Aim for output that reads like this.

Work through the passage from the first sentence to the last so emphasis is spread across the argument, not clustered at the top.

════════ h — THE COMPRESSED VERSION ════════
Copy each "h" fragment from inside your own "u" fragments for that same sentence. Highlight the reasoning that PROVES the claim — the mechanism, the key evidence, the impact — not merely the words that echo the claim.

  • Not every marked sentence needs a highlight. A sentence that is pure setup usually has none.
  • NEVER highlight a bare topic word alone ("reality", "emissions", "nationalism", "truth"). Extend it to include what is being SAID about that term: "is the single strongest predictor of support", not "predictor".
  • Highlight each idea ONCE. If a term recurs ten times, highlight the one place it lands hardest.
  • Read your highlights back in order. If they sound like a list of nouns rather than an argument, you highlighted keywords — go back and extend each into a claim.

════════ b — WHAT THE EYE LANDS ON ════════
Bold the load-bearing term inside text you already marked: the key noun phrase, the number, the qualifier, the scope condition.
  • 1 to 4 words. Bold a term, never a clause and never a sentence.
  • Usually the crucial term inside a highlight ("true knowledge", "worldly knowledge", "spiritual ignorance"), or a decisive figure in underlined text ("fewer than one in three", "the world's largest emitter", "declined by 40% since 2010").
  • Bold that lands in unmarked text is discarded, so only bold what you marked.

════════ COPY FRAGMENTS EXACTLY ════════
Every fragment in "u", "h" and "b" must be copied CHARACTER-FOR-CHARACTER from the sentence numbered "s" — same words, punctuation and capitalization. A fragment that cannot be found in that sentence is silently dropped, which quietly costs the debater emphasis they needed. Do not stitch together words from across a gap into one fragment: use several fragments instead, which is why "u" is a list.

- tag: a punchy 1-2 sentence statement of what the evidence proves, phrased from the user's claim (this is YOUR wording). Mark 1-3 key phrases with __underline__ markers.
- cite: the cite name from RESOLVED CITE FACTS + the two-digit year, no apostrophe (e.g. "Rodrigues 16", "Bishop et al. 24").
- citeDetails: full cite content WITHOUT brackets: author (+ qualifications), "Article Title." Publication, date. Do NOT include a URL — the app appends the real link itself.

════════ THE CITE IS CHECKED, NOT COMPOSED ════════
Author, year and link are RESOLVED FOR YOU in the RESOLVED CITE FACTS block. That block is the product of reading the page's structured data. It outranks your reading of the article text, and it outranks your prior knowledge of the author or the outlet.

- USE the given cite name verbatim. If it says "Bishop et al.", write "Bishop et al." — never shorten it to one author and never swap in a different name.
- If it says NO HUMAN BYLINE, cite the publication. That is the ONLY case where an outlet is allowed to be the author. Never print the outlet as the author when authors are listed — a report published by a firm is cited by the PEOPLE who wrote it, not the firm.
- USE the given two-digit year. If it says NONE, write the cite with no year rather than inventing one, and put "no date" in citeDetails. A year mentioned inside the article's prose is NOT the publication year — an article discussing 2035 is not cited "35".
- NEVER write a URL, DOI or "available at" into citeDetails. The app appends the real, resolved link itself. A link you write will be wrong.

════════ QUALIFICATIONS ════════
A cite is worth more when it says who the author is, and worth nothing if that part is invented.
- When "author's stated role" is given, use it, trimmed to the load-bearing part (e.g. "Professor of Economics, MIT" or "Senior Partner"). You may shorten it; you may not embellish it.
- When it is NONE STATED, look in the CITE CONTEXT for an explicit bio sentence about that same author ("Jane Smith is a professor of..."). Use it only if it names the author you are citing.
- When there is no human author, use "what the publisher is" to qualify the ORGANISATION instead (e.g. "McKinsey & Company, a management consulting firm"). This is what gives an unbylined institutional report its weight.
- If neither exists, give NO qualification. Never infer credentials from the topic, the outlet's reputation, or the author's name. "Expert on foreign policy" invented for a byline is a fabricated qualification and is treated as fabricated evidence.

Final check before you answer: read your "u" fragments straight through as one passage, then your "h" fragments. Both must sound like someone making an argument out loud. That, not how much you marked, is what makes the card good.`;

function buildMarkerPrompt(
  claim: string,
  article: ExtractedArticle,
  sentences: string[],
): string {
  // Bylines live at the very top or the very bottom — a report often credits its
  // authors only in a closing block — and the selected passage may exclude both.
  // The window is generous because a byline missed here is a cite that names the
  // outlet instead of the person.
  const head = article.text.slice(0, 1600);
  const tail = article.text.length > 2600 ? article.text.slice(-1000) : "";
  const citeContext = [head, tail].filter(Boolean).join("\n…\n");

  // Author, date and link are RESOLVED before the model sees anything (see
  // lib/cite.ts). They are handed over as settled facts rather than as hints,
  // because every one of them is a thing the model used to get wrong by
  // re-deriving it from raw text.
  const resolved = [
    `- authors: ${article.authors.length > 0 ? article.authors.join(", ") : "NONE FOUND — no human byline on this page"}`,
    `- cite name to use: ${citeName(article.authors, article.etAl) || `(no human author — use the publication: ${article.publication || "unknown"})`}`,
    `- most recent date the page states: ${article.date || "NONE STATED"}`,
    `- two-digit year for the cite: ${citeYear(article.date) || "NONE — omit the year rather than guessing"}`,
    `- publication: ${article.publication || "unknown"}`,
    `- author's stated role: ${article.authorQualification || "NONE STATED — omit qualifications"}`,
    `- what the publisher is: ${article.publisherQualification || "NONE STATED"}`,
  ].join("\n");

  return [
    `Claim the card must support: ${claim}`,
    `Article title: ${article.title || "unknown"}`,
    "--- RESOLVED CITE FACTS (already verified from the page — USE THESE, do not re-derive them) ---",
    resolved,
    "--- CITE CONTEXT (article start/end — for the author's credentials only, do NOT quote from here) ---",
    citeContext,
    `--- PASSAGE (${sentences.length} numbered sentences, verbatim from the article — underline by NUMBER; highlight/bold ONLY from here) ---`,
    sentences.map((s, i) => `[${i}] ${s}`).join("\n"),
  ].join("\n");
}

type MarkerData = z.infer<typeof markerSchema>;

/** A marked section: the model's metadata plus the section's text with markers applied. */
interface MarkedSection {
  data: MarkerData;
  /** This section's text, already carrying emphasis delimiters. */
  body: string;
}

/** Resolved character offsets within one section, ready for applyEmphasisSpans. */
export interface ResolvedSpans {
  underline: Array<[number, number]>;
  highlight: Array<[number, number]>;
  bold: Array<[number, number]>;
  /** Fragments that couldn't be located and were dropped. */
  missed: number;
}

/**
 * Locate each sentence within the section it came from.
 *
 * The sentences were produced BY splitting this section, so each is an exact
 * substring; scanning forward with a cursor keeps repeated sentences in order
 * instead of collapsing them onto the first occurrence.
 */
function sentenceRanges(section: string, sentences: string[]): Array<[number, number] | null> {
  const ranges: Array<[number, number] | null> = [];
  let cursor = 0;
  for (const s of sentences) {
    const at = section.indexOf(s, cursor);
    if (at === -1) {
      ranges.push(null);
      continue;
    }
    ranges.push([at, at + s.length]);
    cursor = at + s.length;
  }
  return ranges;
}

/**
 * A fragment long enough to be unique on its own. Below this it MUST be found
 * inside the sentence the model named — "Avidya is" appears a dozen times in a
 * passage, and marking the wrong one puts emphasis on text nobody chose.
 */
const GLOBALLY_UNIQUE_CHARS = 25;

/**
 * Turn the model's per-sentence fragments into character spans in `section`.
 *
 * Scoping each search to one sentence is what makes sub-sentence marking
 * possible at all. A bare substring search over the whole passage cannot tell
 * which "make up reality" was meant; the sentence number disambiguates it, and
 * a fragment that doesn't appear in its own sentence is dropped rather than
 * guessed at — the same rule the rest of the cutter follows about never
 * inventing what the source didn't say.
 */
export function resolveMarks(
  section: string,
  sentences: string[],
  marks: MarkEntry[],
): ResolvedSpans {
  const ranges = sentenceRanges(section, sentences);
  const locate = createLocator(section);
  const out: ResolvedSpans = { underline: [], highlight: [], bold: [], missed: 0 };

  const resolve = (fragment: string, range: [number, number]): [number, number] | null => {
    const spans = locate(fragment);
    if (spans.length === 0) return null;
    const inside = spans.find(([start, end]: [number, number]) => start >= range[0] && end <= range[1]);
    if (inside) return inside;
    // Long fragments are effectively unique, so an off-by-one sentence number
    // shouldn't cost the debater the mark. Short ones stay strictly scoped.
    return fragment.length >= GLOBALLY_UNIQUE_CHARS ? spans[0] : null;
  };

  for (const mark of marks) {
    const range = ranges[mark.s];
    if (!range) continue;
    for (const [fragments, bucket] of [
      [mark.u, out.underline],
      [mark.h, out.highlight],
      [mark.b, out.bold],
    ] as const) {
      for (const fragment of fragments) {
        const span = resolve(fragment, range);
        if (span) bucket.push(span);
        else out.missed++;
      }
    }
  }
  return out;
}

/**
 * One marker call over a passage (or one section of it): the quality-critical
 * step. A stronger model picks coherent in-context warrant phrases instead of
 * disconnected buzzwords. It fails FAST on the premium model (retries: 0) — that
 * model gets "high demand" 503s — and `fallbackModel` drops straight to the
 * reliable default model rather than burning ~15s retrying. maxOutputTokens is
 * large because dense emphasis means many substrings (avoid truncation). Throws
 * on total failure or unparseable output.
 *
 * The failover lives in lib/gemini rather than here because a cut fans these
 * calls out CONCURRENTLY (see Promise.all below). Hand-rolling it at this level
 * meant all eight sections independently discovered the premium model was dead,
 * on every cut — and those failures opened a circuit breaker shared with the
 * cheap model, so the fallback this function depends on was itself blocked.
 * lib/modelAvailability now parks a spent model, so later cuts skip it entirely
 * instead of rediscovering the same thing eight times each.
 */
async function markPassageSection(
  claim: string,
  article: ExtractedArticle,
  section: string,
): Promise<MarkedSection> {
  const sentences = splitSentences(section);
  const prompt = buildMarkerPrompt(claim, article, sentences);
  const raw = await generateJson({
    system: MARKER_SYSTEM,
    prompt,
    model: GEMINI_MARKER_MODEL,
    maxOutputTokens: 40000,
    retries: GEMINI_MARKER_MODEL !== GEMINI_MODEL ? 0 : undefined,
    fallbackModel: GEMINI_MARKER_MODEL !== GEMINI_MODEL ? GEMINI_MODEL : undefined,
  });
  const parsed = markerSchema.safeParse(raw);
  if (!parsed.success) {
    console.error("cardCutter: unparseable marker output");
    throw new Error("Card cutting finished but returned an unreadable result. Please try again.");
  }
  const spans = resolveMarks(section, sentences, parsed.data.marks);
  if (spans.missed > 0) {
    console.warn(`cardCutter: ${spans.missed} fragments didn't match their sentence and were skipped`);
  }
  return {
    data: parsed.data,
    body: applyEmphasisSpans(section, spans.underline, spans.highlight, spans.bold),
  };
}

/**
 * The people credited by the CALLER, resolved to real names.
 *
 * Prefers the structured `authors` list a search result carries. Splitting the
 * display string instead is lossy in a way that shows up on the card: "Fawzi et
 * al." parses back to a person surnamed "al.", and a web result whose only
 * "author" was its hostname parses to a byline of "nbcnews.com".
 */
export function callerAuthors(source: CutRequest["source"]): { authors: string[]; etAl: boolean } {
  const structured = (source.authors ?? []).flatMap((a) => parseByline(a).authors);
  if (structured.length > 0) return { authors: structured, etAl: false };
  return parseByline(source.author ?? "");
}

/**
 * Merge what the CALLER knows about a source with what the PAGE says, field by
 * field.
 *
 * This used to be `req.source.X || extracted.X` throughout, which reads as "the
 * caller knows best". For a search result the caller often knows worst: a web
 * hit arrives with its hostname in the author field and no date at all, and
 * those beat the byline and publication date read off the page itself. That is
 * the mechanism behind cites that name the outlet and cites that carry the
 * wrong year.
 *
 * So each field goes to whichever side actually holds the better fact:
 *   - authors: the page's own byline wins — it is the primary source. The
 *     caller's list fills in only when the page states nobody.
 *   - date: the most RECENT date either side can verify, so an updated article
 *     cites as updated and a junk value can't win merely by being first.
 *   - title/publication: caller first, since a search result's are clean and a
 *     scraper's often carry site furniture.
 *   - qualifications: the page's own words first, then the database's
 *     affiliations. Never inferred on either side.
 */
export function mergeCiteFacts(
  extracted: ExtractedArticle,
  source: CutRequest["source"],
): ExtractedArticle {
  const caller = callerAuthors(source);
  const institutions = (source.authorInstitutions ?? []).filter(Boolean).join(", ");
  const usePage = extracted.authors.length > 0;
  const authors = usePage ? extracted.authors : caller.authors;
  return {
    ...extracted,
    title: source.title || extracted.title,
    publication: source.publication || extracted.publication,
    authors,
    etAl: usePage ? extracted.etAl : caller.etAl,
    author: authors.join(", ") || extracted.author || "",
    date: mostRecentDate([extracted.date, normalizeDate(source.date ?? "")]),
    authorQualification: extracted.authorQualification || institutions,
  };
}

/** Resolve the cut source into clean article text + metadata. */
async function resolveSource(req: CutRequest): Promise<ExtractedArticle> {
  const fromProvidedText = (): ExtractedArticle =>
    mergeCiteFacts(
      articleFromFields({
        title: req.source.title,
        author: req.source.author,
        publication: req.source.publication,
        date: req.source.date,
        text: (req.source.text ?? "").trim(),
        url: req.source.url,
      }),
      req.source,
    );

  if (req.source.url) {
    try {
      return mergeCiteFacts(await extractArticleCached(req.source.url), req.source);
    } catch (err) {
      // The URL couldn't be read (paywalled DOI/publisher page, JS-only, PDF).
      // Search results ship the real abstract as a fallback — cut from that
      // rather than failing. It's still verbatim author wording, just shorter.
      const fallback = fromProvidedText();
      if (err instanceof ArticleUnreadableError && fallback.text.length >= 200) {
        console.warn("cardCutter: URL unreadable; cutting from provided abstract text");
        return fallback;
      }
      throw err;
    }
  }
  return fromProvidedText();
}

async function selectPassage(
  claim: string,
  cardLength: CardLength,
  paragraphs: string[],
): Promise<string> {
  // Entire Article: no selection — the whole text, formatting only.
  if (cardLength === "Entire Article" || paragraphs.length === 1) {
    return paragraphs.join("\n\n");
  }

  const budget = LENGTH_BUDGETS[cardLength];
  const wordCounts = paragraphs.map(countWords);

  const numbered = paragraphs.map((p, i) => `[${i}] ${p}`).join("\n\n");
  const raw = await generateJson({
    system: SELECTOR_SYSTEM,
    prompt: [
      `Claim: ${claim}`,
      `Card length: ${cardLength}`,
      `Paragraph count: ${paragraphs.length}`,
      "--- PARAGRAPHS ---",
      numbered,
    ].join("\n"),
    maxOutputTokens: 2048,
  });

  const parsed = selectorSchema.safeParse(raw);

  // Pick the seed range: the AI's choice if valid, else a mechanical default
  // (the strongest-density middle). Either way fitRangeToBudget enforces the
  // length — the specifier must work even when the selector glitches.
  let seedStart: number;
  let seedEnd: number;
  if (parsed.success && !("error" in parsed.data)) {
    seedStart = Math.min(parsed.data.startIndex, paragraphs.length - 1);
    seedEnd = Math.min(parsed.data.endIndex, paragraphs.length - 1);
  } else if (parsed.success) {
    // {error: "no_warrant"} — the article genuinely doesn't support the claim.
    throw new NoWarrantFoundError();
  } else {
    console.warn("cardCutter: unparseable selector output; using length-clamped default");
    // Seed at the article's start; the budget will size it correctly.
    seedStart = 0;
    seedEnd = 0;
  }

  const [start, end] = fitRangeToBudget(wordCounts, seedStart, seedEnd, budget);
  return paragraphs.slice(start, end + 1).join("\n\n");
}

// Re-cutting the same source at the same length/claim (common while iterating)
// reuses the card for 30 min — zero AI cost. Shared across instances/users via
// Redis when configured (in-memory otherwise).
const cutCache = createSharedCache<Card>({ ttlMs: 30 * 60 * 1000, namespace: "cut", maxLocal: 30 });

/** Stable, compact key for a cut request (hashes long pasted text). */
function cutCacheKey(req: CutRequest): string {
  const sourceKey = req.source.url ?? `text:${djb2(req.source.text ?? "")}`;
  return `${sourceKey}|${req.cardLength}|${req.claim.trim().toLowerCase()}`;
}

/** Tiny non-crypto string hash — just to key the cache on pasted text. */
function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Cut a debate-ready card from a URL or pasted text.
 * The body is real article text with emphasis applied on top — the AI cannot
 * alter the wording because it never produces the wording.
 */
export async function cutCard(req: CutRequest): Promise<Card> {
  return cutCache.wrap(cutCacheKey(req), () => runCut(req));
}

async function runCut(req: CutRequest): Promise<Card> {
  const article = await resolveSource(req);
  if (article.text.length < 200) {
    throw new ArticleUnreadableError(
      "That article text is too short to cut a card from. Paste the full article body.",
    );
  }
  if (article.text.length > MAX_ARTICLE_CHARS) {
    article.text = article.text.slice(0, MAX_ARTICLE_CHARS);
  }

  const paragraphs = splitParagraphs(article.text);
  const passage = await selectPassage(req.claim, req.cardLength, paragraphs);

  // Mark the passage in sections so emphasis reaches the WHOLE card, not just its
  // opening. A normal-length passage is a single section → one marker call,
  // identical to before. A long passage (big article) is split so every part is
  // marked densely — the fix for "huge article, only a couple highlighted lines".
  const sections = splitIntoSections(
    splitParagraphs(passage),
    SECTION_TARGET_WORDS,
    MAX_MARKER_SECTIONS,
  );

  /*
   * Each section is marked AND rendered independently, then the rendered
   * sections are rejoined. That works because splitIntoSections cuts only on
   * paragraph boundaries, so the sections rejoin with "\n\n" to exactly the
   * original passage (see its tests) — and it is what lets marking be
   * sub-sentence at all: a fragment's offsets are only meaningful inside the
   * section its sentence numbers refer to.
   */
  const parts = sections.length > 0 ? sections : [passage];
  let head: MarkerData;
  let bodies: string[];

  if (parts.length === 1) {
    const only = await markPassageSection(req.claim, article, parts[0]);
    head = only.data;
    bodies = [only.body];
  } else {
    // Section 0 owns the tag/cite (it holds the article's opening) and MUST
    // succeed. The rest are best-effort in parallel: one busy/failed section
    // shouldn't sink the whole card — it just stays plain instead of throwing.
    const marked = await Promise.all(
      parts.map((sec, i) =>
        markPassageSection(req.claim, article, sec).catch((err: unknown) => {
          if (i === 0) throw err;
          console.warn(`cardCutter: section ${i} marking failed; leaving it plain`, String(err));
          return null;
        }),
      ),
    );
    const first = marked[0];
    if (!first) {
      throw new Error("Card cutting couldn't mark the opening section. Please try again.");
    }
    head = first.data;
    // A failed section contributes its ORIGINAL text, so the card still holds
    // the whole passage — just unmarked through that stretch.
    bodies = marked.map((m, i) => m?.body ?? parts[i]);
  }

  const body = bodies.join("\n\n");

  return {
    // The tag is the one place the AI supplies markup (`__key phrase__`);
    // convert it to internal delimiters. The body already carries them.
    tag: tagMarkupToDelimiters(head.tag),
    cite: head.cite,
    // Add the real link ourselves — never from the AI, so it can't be invented.
    // The RESOLVED link — canonical when the page declares one — so a share
    // link, tracking URL or redirect never ends up in the cite.
    citeDetails: appendSourceUrl(head.citeDetails, article.canonicalUrl || req.source.url),
    body,
  };
}
