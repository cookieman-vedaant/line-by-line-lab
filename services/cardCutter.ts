import { z } from "zod";
import { stripDelimiters, tagMarkupToDelimiters } from "@/lib/cardMarkup";
import { citeName, citeYear, mostRecentDate, parseByline } from "@/lib/cite";
import { applyEmphasisSpans, createLocator } from "@/lib/emphasis";
import { GEMINI_MARKER_MODEL, GEMINI_MODEL, RateLimitedError, generateJson } from "@/lib/gemini";
import { createSharedCache } from "@/lib/sharedCache";
import {
  articleFromFields,
  ArticleUnreadableError,
  classifyText,
  extractArticleCached,
  isMostlyAbstract,
  normalizeDate,
  type ExtractedArticle,
} from "@/services/articleExtract";
import { recallSourceMeta, type SourceMeta } from "@/services/sourceMeta";
import type { Card, CardLength, CardSourceKind, CutRequest } from "@/types";

export { ArticleUnreadableError };

/**
 * Honest failure — the article doesn't support the claim, so no card is cut.
 * The message says why, in terms the debater can act on (see gateDecision).
 */
export class NoWarrantFoundError extends Error {
  constructor(message = "Unable to identify a sufficiently strong argumentative passage.") {
    super(message);
    this.name = "NoWarrantFoundError";
  }
}

/**
 * The relevance gate's answer about whether the text supports the claim.
 * "unknown" means the gate couldn't say — rate-limited, unreadable output, or a
 * supporting sentence that isn't actually in the text.
 */
export type Verdict = "direct" | "partial" | "none" | "unknown";

export interface GateResult {
  verdict: Verdict;
  /** What the text establishes about the claim, at its own scope. AI-written; internal only. */
  supports: string;
  /** The part of the claim the text does NOT establish. AI-written; internal only. */
  missing: string;
  /**
   * The words of the gate's quote that were actually FOUND in the text — never
   * the model's own wording — or "". This is what the marker is shown.
   */
  keyQuote: string;
  /** True when the model's whole quote was found, not just half of it. */
  quoteExact: boolean;
  /** Paragraph holding keyQuote; null when there is none. */
  keyIndex: number | null;
  /** Paragraph range the gate selected (inclusive), or null for the mechanical default. */
  range: [number, number] | null;
  /**
   * Why the verdict is "unknown": the gate didn't answer (rate limit, unreadable
   * output), or it claimed support it couldn't quote from the text.
   */
  unknownReason?: "unavailable" | "unquoted";
}

const UNKNOWN_GATE: GateResult = {
  verdict: "unknown",
  supports: "",
  missing: "",
  keyQuote: "",
  quoteExact: false,
  keyIndex: null,
  range: null,
  unknownReason: "unavailable",
};

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
 * 1. Extract the article (URL via Readability/PDF, or pasted text), and judge
 *    from the text itself whether it is the article or only its abstract.
 * 2. GATE + SELECT: the AI says whether the text supports the claim (direct /
 *    partial / none), quotes the sentence that carries it — checked verbatim —
 *    and picks a contiguous paragraph range. No support, or less than direct
 *    support in an abstract, means no card (see gateDecision). The range is
 *    clamped mechanically to the length's word budget, and the body is
 *    assembled from the REAL article paragraphs.
 * 3. MARK: the passage goes to the AI as NUMBERED SENTENCES, with the gate's
 *    findings as a ceiling on the tag. It returns the numbers to underline,
 *    plus exact substrings to highlight/bold and the tag and cite. Numbers are
 *    resolved back to the real sentences; substrings are located in the real
 *    text. Neither path can invent wording.
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
  /**
   * A paragraph that must stay inside the range — the one holding the gate's
   * key quote. Without it, shrinking from the end could cut the very paragraph
   * the tag is anchored to.
   */
  keep?: number,
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
  // Too large → shrink from the end (keep the selected opening) — unless that
  // would drop `keep`, in which case trim whichever end is farther from it.
  while (fraction() > budget.max && e > s) {
    if (keep === undefined || (e > keep && e - keep >= keep - s)) e--;
    else if (s < keep) s++;
    else break;
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

/**
 * THE RELEVANCE GATE — the root-cause fix for power-tagged cards.
 *
 * Cards were power-tagged because nothing ever asked whether the article
 * supports the claim before the marker — whose job is to write a confident tag —
 * saw it. The old selector could answer "no_warrant", but it was skipped
 * entirely for "Entire Article" and for single-paragraph text, which is exactly
 * what an abstract is. So an off-topic abstract always became a card, and the
 * tag was written from the claim instead of the evidence.
 *
 * Now the gate runs on EVERY cut. It states what the text establishes BEFORE it
 * labels it (field order is reasoning order on a model with thinking off),
 * quotes the words that carry the support — which are then checked
 * against the text, verbatim, the same way the card body is — and only then
 * picks the passage.
 */
const GATE_SYSTEM = `You are the relevance gate and passage selector inside a debate card-cutting tool (Lincoln-Douglas). You receive a claim and an article (sometimes only its abstract) split into numbered paragraphs. Do three things, in order.

════ STEP 1 — WHAT DOES THE TEXT ACTUALLY ESTABLISH? ════
Ask: "Where does THIS author assert, argue, or show evidence for the claim?" Only these count as support:
  • the author's own findings, conclusions or arguments;
  • data or results the author reports;
  • a faithful exposition of a thinker's argument WITH its reasoning (an article explaining why Kant holds X supports a framework claim that X).
These do NOT count:
  • what the paper sets out to study ("This paper examines whether X", "We ask how…") — an aim is not a finding;
  • a view the author presents in order to reject or complicate it ("Proponents claim X. This is mistaken.") — cutting it would misrepresent the author;
  • a passing mention of other scholars' positions with no reasoning;
  • speculation flagged as an open question or future research;
  • the claim's topic words appearing without anything being said about them.

"keyQuote": 8-20 CONSECUTIVE words copied EXACTLY, character for character, from the sentence that carries the most support — no ellipses, no paraphrase. "" if the verdict is "none".
"supports": 1-2 plain sentences (max 280 characters) stating what the text establishes that is relevant to the claim, at the text's OWN scope and strength. Keep the author's qualifiers (place, population, period, "may", "in the short run"). Never state it more strongly than the author does. If nothing is relevant, say what the text is actually about.
"missing": the part of the claim the text does NOT establish (max 160 characters), or "" if nothing.

════ STEP 2 — VERDICT ════
"direct" — the text argues or evidences the claim's core proposition: same subject, same direction. Also direct:
  • a NARROWER version (claim: automation eliminates jobs; text: it eliminated manufacturing jobs in the Midwest);
  • a MORE GENERAL proposition the claim is plainly an instance of (claim: steel tariffs hurt automakers; text: tariffs on intermediate inputs raise costs for downstream manufacturers);
  • hedged support for the same proposition — "likely" and "may" lower strength, not relevance.
"partial" — a real piece of the claim, not its core proposition:
  • one step of a multi-step claim;
  • the same direction at a smaller magnitude or lower certainty than the claim asserts (claim: extinction; text: mass casualties);
  • the same effect in a neighbouring case the claim is not an instance of (a different country, policy or population);
  • the mechanism without the outcome the claim asserts.
"none":
  • a different subject that shares keywords (claim about nuclear WAR, text about nuclear POWER);
  • the same goal or outcome reached by a DIFFERENT cause, policy or actor than the claim names — the claim's subject is what it says does the work (claim: nuclear power cuts emissions; text: insulating homes cuts emissions);
  • the topic appears only in passing, as background, or as an aim;
  • the only matching text is a view the author rejects;
  • the text argues AGAINST the claim or finds no effect.
If you are unsure between "partial" and "none", answer "partial". Answer "none" only when one of the reasons above clearly applies, and name it in "supports".

The evidence function changes what "core proposition" means. Link / Internal Link: a causal connection. Impact: the harm INCLUDING its size. Uniqueness: a present state or trend. Solvency: that a mechanism works. Framework: a normative principle and its justification. K Link: that an assumption, rhetoric or approach embodies what the critique criticises — critical theory attacking that assumption in general is direct even if it never names the specific policy.
Do NOT judge recency, source prestige or whether the claim is persuasive. The cite carries the date; the debater decides strategy. Judge only what the text says.

════ STEP 3 — SELECT ════
Pick the CONTIGUOUS run of paragraphs that carries the support from Step 1, together with the reasoning around it — the mechanism, key premises, evidence and implications — so it is a self-contained argument, not the single sentence that echoes the claim. For "partial", select the part that IS supported. Optimize for the strongest WARRANT, not the first or longest paragraph.
Card length targets (share of the article's total words):
- Short: the single strongest passage — roughly 5-30%.
- Medium: the contiguous half that best supports it (35-65%).
- Long: the complete chain of reasoning (60-95%).
- Entire Article, or a single-paragraph text: return startIndex 0 and endIndex = the last paragraph. The verdict still matters.

════ CALIBRATION ════
Claim: "Morality must be universalizable." Text explains, with reasoning, why Kant holds that a maxim one cannot will as universal law is impermissible.
→ {"keyQuote":"...","supports":"Kant: a maxim is permissible only if the agent can will it as universal law; exceptions for oneself are self-contradictory.","missing":"","verdict":"direct",...}

Claim: "Climate change causes human extinction." Text: "Warming beyond 3°C could expose up to a billion people to extreme heat and drive mass displacement."
→ {"keyQuote":"could expose up to a billion people to extreme heat and drive mass displacement","supports":"Warming past 3°C could expose up to a billion people to extreme heat and mass displacement.","missing":"Extinction — the text describes mass harm, not the end of humanity.","verdict":"partial",...}

Claim: "Nuclear deterrence prevents great-power war." Text: "Deterrence optimists claim nuclear weapons kept the peace since 1945. This confuses correlation with causation…"
→ {"keyQuote":"","supports":"The author rejects the claim that nuclear weapons kept the peace, calling it correlation mistaken for causation.","missing":"All of it — the author argues against the claim.","verdict":"none"}

Return ONLY JSON, fields in this order:
{"keyQuote":"...","supports":"...","missing":"...","verdict":"direct"|"partial"|"none","startIndex":N,"endIndex":M}
Omit startIndex and endIndex when the verdict is "none".`;

// The two ways the gate is asked again. An EMPTY answer is most likely Gemini's
// recitation filter blocking a long verbatim quote of well-known text, so both
// ask for less of it.
const GATE_REASK_UNREADABLE =
  "Your previous answer could not be read. Answer again in exactly the same JSON shape, but keep keyQuote SHORT: 5-8 consecutive words copied exactly from the text.";
const GATE_REASK_UNQUOTED =
  'Your previous keyQuote was not found in the text. Answer again in exactly the same JSON shape, copying keyQuote EXACTLY — 5-8 consecutive words from one sentence of the text, character for character. If no sentence carries support, the verdict is "none".';

// Longest one relevance-check attempt may take before the next model answers.
const GATE_ATTEMPT_MS = 15000;

/** Clamp a proposed [start, end] to real paragraph indices, or null if absent. */
function validRange(start: unknown, end: unknown, count: number): [number, number] | null {
  if (typeof start !== "number" || typeof end !== "number") return null;
  if (!Number.isFinite(start) || !Number.isFinite(end) || count === 0) return null;
  const clamp = (n: number) => Math.max(0, Math.min(count - 1, Math.trunc(n)));
  const s = clamp(start);
  return [s, Math.max(s, clamp(end))];
}

// Shorter than this, a "quote" is too generic to show where support lives.
const MIN_QUOTE_CHARS = 25;

/**
 * Where `quote` is, found VERBATIM (whitespace/quote-normalized, like the body
 * check): its paragraph, the text actually found there, and whether that was
 * the whole quote. A quote the model slipped on at one end still resolves
 * through either overlapping half — but then only that half counts, never the
 * unmatched remainder. One it invented does not resolve at all.
 */
function locateQuote(
  quote: string,
  paragraphs: string[],
): { index: number; found: string; exact: boolean } | null {
  const words = quote.split(/\s+/).filter(Boolean);
  const probes = [quote];
  if (words.length >= 10) {
    const half = Math.ceil(words.length / 2) + 2;
    probes.push(words.slice(0, half).join(" "), words.slice(-half).join(" "));
  }
  for (const [n, probe] of probes.entries()) {
    if (probe.length < MIN_QUOTE_CHARS) continue;
    for (let i = 0; i < paragraphs.length; i++) {
      const [span] = createLocator(paragraphs[i])(probe);
      if (span) return { index: i, found: paragraphs[i].slice(span[0], span[1]), exact: n === 0 };
    }
  }
  return null;
}

/**
 * Read the gate's JSON into a GateResult. Pure, so every edge is testable.
 *
 * A "direct"/"partial" verdict whose key quote can't be found in the text is
 * downgraded to "unknown" ("unquoted"): a lenient model that invents a
 * supporting quote has not shown support, and "unknown" is refused on an
 * abstract.
 */
export function interpretGate(raw: unknown, paragraphs: string[]): GateResult {
  const r = normalizeGateOutput(raw);
  if (!r) return UNKNOWN_GATE;
  if (r.error === "no_warrant") return { ...UNKNOWN_GATE, verdict: "none" };

  const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const supports = text(r.supports, 280);
  const missing = text(r.missing, 160);
  const range = validRange(r.startIndex, r.endIndex, paragraphs.length);
  const verdict: Verdict =
    r.verdict === "direct" || r.verdict === "partial" || r.verdict === "none" ? r.verdict : "unknown";

  if (verdict === "none") {
    return { ...UNKNOWN_GATE, verdict, supports, missing, unknownReason: undefined };
  }
  if (verdict === "unknown") return { ...UNKNOWN_GATE, supports, missing, range };

  // Older prompt wording asked for a whole "keySentence"; accept either name.
  const quote = text(r.keyQuote ?? r.keySentence, 1200);
  const located = quote ? locateQuote(quote, paragraphs) : null;
  if (!located) return { ...UNKNOWN_GATE, supports, missing, range, unknownReason: "unquoted" };
  return {
    verdict,
    supports,
    missing,
    keyQuote: located.found,
    quoteExact: located.exact,
    keyIndex: located.index,
    range,
  };
}

/**
 * The gate's JSON as an object, tolerating the two shapes a lite model in JSON
 * mode produces besides the one asked for: the object wrapped in an array, and
 * a capitalized verdict ("Direct"). Null when there is no object at all.
 */
function normalizeGateOutput(raw: unknown): Record<string, unknown> | null {
  const obj = Array.isArray(raw) ? raw[0] : raw;
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const r = { ...(obj as Record<string, unknown>) };
  if (typeof r.verdict === "string") r.verdict = r.verdict.trim().toLowerCase();
  return r;
}

/** True when the gate's raw output is a real answer (as opposed to unreadable). */
function gateAnswered(raw: unknown): boolean {
  const r = normalizeGateOutput(raw);
  return !!r && (r.error === "no_warrant" || ["direct", "partial", "none"].includes(String(r.verdict)));
}

/** What came back, for the log line when the gate's answer can't be read. */
function describeUnreadable(raw: unknown): string {
  if (raw === null || raw === undefined) return "empty or non-JSON response";
  return `unexpected shape ${JSON.stringify(raw).slice(0, 160)}`;
}

const REFUSALS = {
  none: "This article doesn't support that claim — it covers a different subject, mentions it only in passing, or argues against it. No card was cut.",
  unverified:
    "The relevance check couldn't finish, so no card was cut rather than cutting one that might not support your claim. Try again in a moment.",
} as const;

/**
 * For text too short to be sure it's the article: what it is, and what the
 * debater can do instead. The refusal names the real reason (see gateDecision).
 */
const SHORT_TEXT = {
  abstract_only: {
    what: "Only this article's abstract could be read",
    instead: "open the article and paste its full text into Cut a Card",
  },
  short_text: {
    what: "Only a short text could be read from this page (it may be just the abstract)",
    instead: "open the article and paste its full text into Cut a Card",
  },
  pasted_short: {
    what: "This text is short",
    instead: "paste more of the article, or narrow the claim to what the text shows",
  },
} as const;

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Cut or refuse, from the gate's answer and what the text is.
 *
 * A whole article with partial support is still a real card — one link in a
 * chain, cut honestly and tagged for what it shows. An abstract or other short
 * text is held to "direct", with the supporting words found EXACTLY in it:
 * three sentences, one of them tangential, is exactly where a confident tag
 * outruns the evidence.
 */
export function gateDecision(
  gate: Pick<GateResult, "verdict"> & Partial<Pick<GateResult, "quoteExact" | "unknownReason">>,
  kind: CardSourceKind,
): { allow: true } | { allow: false; message: string } {
  if (gate.verdict === "none") return { allow: false, message: REFUSALS.none };
  const short = kind === "abstract_only" || kind === "short_text" || kind === "pasted_short";
  if (!short) return { allow: true };
  if (gate.verdict === "direct" && gate.quoteExact !== false) return { allow: true };

  const { what, instead } = SHORT_TEXT[kind];
  const why =
    gate.verdict === "partial"
      ? "it doesn't directly support the claim, so it wasn't cut"
      : gate.verdict === "unknown" && gate.unknownReason !== "unquoted"
        ? "the relevance check couldn't finish, so it wasn't cut. Try again in a moment, or"
        : "nothing in it could be matched word for word to your claim, so it wasn't cut";
  return {
    allow: false,
    message: why.endsWith(" or") ? `${what}, and ${why} ${instead}.` : `${what}, and ${why}. ${capitalize(instead)}.`,
  };
}

/**
 * The paragraph range to cut, from the gate's answer. "Entire Article" is always
 * the whole text. Otherwise the gate's range, widened to include the key
 * paragraph if it left it out, then clamped to the length's word budget. With
 * no range at all, seed at the key paragraph rather than the article's opening.
 */
export function passageRange(
  gate: GateResult,
  cardLength: CardLength,
  wordCounts: number[],
): [number, number] {
  const last = wordCounts.length - 1;
  if (cardLength === "Entire Article" || wordCounts.length <= 1) return [0, Math.max(0, last)];
  const key = gate.keyIndex;
  let [start, end] = gate.range ?? (key !== null ? [key, key] : [0, 0]);
  if (key !== null) {
    start = Math.min(start, key);
    end = Math.max(end, key);
  }
  return fitRangeToBudget(wordCounts, start, end, LENGTH_BUDGETS[cardLength], key ?? undefined);
}

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
  /**
   * The marker's own relevance verdict — asked for ONLY when the gate couldn't
   * answer (see relevanceBlock), so a busy or glitching gate never waves an
   * off-topic article through. A bad value is dropped, not fatal.
   */
  support: z.enum(["direct", "partial", "none"]).optional().catch(undefined),
});

const MARKER_SYSTEM = `You are the emphasis marker inside a debate card-cutting tool (Lincoln-Douglas). You receive a claim and a passage extracted VERBATIM from an article. You do NOT rewrite anything — you return metadata that the app applies to the original text.

The passage arrives as NUMBERED SENTENCES. For each sentence worth marking, you return the exact FRAGMENTS of it to underline, highlight and bold.

Return ONLY JSON — the marks FIRST, then the tag you write from them:
{"marks": [{"s": 0, "u": ["...", "..."], "h": ["..."], "b": ["..."]}, ...], "tag": "...", "cite": "...", "citeDetails": "..."}

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
  • a view the author states in order to reject it — underlining it as the author's position is a miscut;
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

════════ THE TAG — WHAT THIS PASSAGE PROVES, NOTHING MORE ════════
- tag: YOUR wording, in debate-tag style: one sentence (two at most, under ~25 words), declarative, present tense, no "the author argues" / "this article discusses". Mark 1-3 key phrases with __underline__ markers. Write it AFTER you have marked the passage, from your "u" fragments.
  The tag may never claim more than your underlined text and the RELEVANCE CHECK support:
  • SCOPE — keep the limit the evidence has (a country, sector, population or period). Compress it ("In the OECD, …", "Teen employment …"), but never drop it to make the claim universal.
  • MAGNITUDE — use the passage's size words and numbers only. Never upgrade "thousands" to "millions", "harm" to "extinction", "some" to "all". Any number in the tag must appear in the passage.
  • CAUSATION — a correlation is "linked to" or "predicts", not "causes".
  • CERTAINTY — turn hedges into assertive but accurate verbs: "may cause" → "risks" / "can cause" / "increases the risk of"; "likely" → "likely" or "makes X more likely". Never "guarantees", "proves", "inevitably" unless the author says so.
  • PARTIAL — if the relevance check says partial, tag ONLY the established part. Don't gesture at the rest ("…which leads to war"); the debater's next card does that.
  The debater's claim tells you which established point to lead with. It is not the tag.
  Be assertive where the evidence is. Mushy tags are also wrong.
    Claim: "Climate change causes extinction." Passage: "warming beyond 3°C could expose up to a billion people to extreme heat and drive mass displacement"
      BAD (power tag): "Climate change __causes extinction__ — warming __guarantees__ the end of humanity."
      BAD (mush):      "The article suggests climate change might possibly affect some people."
      GOOD:            "Warming past 3°C risks exposing __a billion people__ to __extreme heat__ and __mass displacement__."
    Claim: "Minimum wage hikes kill jobs." Passage: "in the 12 states studied, the increases reduced teen employment by roughly 4 percent"
      BAD:  "Minimum wage hikes __destroy jobs__ across the economy."
      GOOD: "Minimum wage hikes __cut teen employment__ — a __4 percent__ drop across 12 states."

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

Final check before you answer: read your "u" fragments straight through as one passage, then your "h" fragments. Both must sound like someone making an argument out loud. That, not how much you marked, is what makes the card good. Then read your tag against your "u" text and the RELEVANCE CHECK. If the tag claims a wider scope, a bigger magnitude, more certainty or more causation than they do, rewrite it.`;

/**
 * The gate's findings, handed to the marker as the tag's CEILING. Without it the
 * marker only had the claim to go on — and was told the card "must support" it —
 * so a thin passage still got a tag written from the claim. Every section gets
 * it, because the gate read the whole passage and each marker sees only a slice.
 */
function relevanceBlock(gate: GateResult): string {
  const ceiling =
    "This is a CEILING, not a draft. Build the tag from your underlined words in tag register and check it against this. Do not copy this sentence.";
  if (gate.verdict !== "direct" && gate.verdict !== "partial") {
    return [
      "--- RELEVANCE CHECK ---",
      "Verdict: unverified — the relevance check could not run. Tag only what your underlined text states.",
      ceiling,
      'You are also the relevance check this time, and no card is cut without your answer. Your JSON MUST include "support": {"marks": [...], "tag": "...", "cite": "...", "citeDetails": "...", "support": "direct"|"partial"|"none"}. "direct" if this passage argues or evidences the claim\'s core proposition (including a narrower version, or a more general one the claim is an instance of); "partial" if it establishes a real piece of it (one step, the mechanism, a smaller magnitude, a neighbouring case); "none" if it is about a different subject, only mentions the topic, presents a view the author rejects, or argues against the claim.',
    ].join("\n");
  }
  return [
    "--- RELEVANCE CHECK — what this passage actually establishes (the tag may not claim more) ---",
    `Verdict: ${gate.verdict}`,
    `Key quote (verbatim from the article): ${gate.keyQuote}`,
    `Established: ${gate.supports || "—"}`,
    `NOT established — do not claim: ${gate.missing || "—"}`,
    ceiling,
  ].join("\n");
}

function buildMarkerPrompt(
  claim: string,
  article: ExtractedArticle,
  sentences: string[],
  gate: GateResult,
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
    `Debater's claim (context for what to emphasize — NOT the tag; the tag states only what this passage proves): ${claim}`,
    `Article title: ${article.title || "unknown"}`,
    "--- RESOLVED CITE FACTS (already verified from the page — USE THESE, do not re-derive them) ---",
    resolved,
    "--- CITE CONTEXT (article start/end — for the author's credentials only, do NOT quote from here) ---",
    citeContext,
    relevanceBlock(gate),
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
  gate: GateResult,
): Promise<MarkedSection> {
  const sentences = splitSentences(section);
  const prompt = buildMarkerPrompt(claim, article, sentences, gate);
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

/**
 * Fill whatever the cut request lacks from what the Article Finder recorded
 * about this URL (see services/sourceMeta). The request's own fields win.
 */
export function withSourceMeta(
  source: CutRequest["source"],
  meta: SourceMeta | null,
): CutRequest["source"] {
  if (!meta) return source;
  return {
    ...source,
    title: source.title || meta.title,
    author: source.author || meta.author,
    authors: source.authors?.length ? source.authors : meta.authors,
    authorInstitutions: source.authorInstitutions?.length
      ? source.authorInstitutions
      : meta.authorInstitutions,
    publication: source.publication || meta.publication,
    date: source.date || meta.date,
  };
}

// Total time a cut may spend downloading (the URL plus its fallback copies)
// before it settles for the abstract. The cut route allows 120s, and the AI
// steps need most of that.
const CUT_FETCH_BUDGET_MS = 25000;
const CUT_FETCH_TIMEOUT_MS = 15000;
const MAX_CUT_URLS = 3;
// Shortest caller-provided text accepted as an abstract to cut from. A search
// snippet is not an abstract.
const MIN_ABSTRACT_FALLBACK_CHARS = 400;

interface ResolvedSource {
  article: ExtractedArticle;
  kind: CardSourceKind;
}

/**
 * Resolve the cut source into clean article text + metadata, and say WHAT that
 * text is — judged from the text itself (classifyText), because a landing page
 * that shows only the abstract reads without error and used to be treated as
 * the article.
 */
async function resolveSource(req: CutRequest): Promise<ResolvedSource> {
  const meta = await recallSourceMeta(req.source.url);
  const source = withSourceMeta(req.source, meta);
  const fromProvidedText = (): ExtractedArticle =>
    mergeCiteFacts(
      articleFromFields({
        title: source.title,
        author: source.author,
        publication: source.publication,
        date: source.date,
        text: (source.text ?? "").trim(),
        url: source.url,
      }),
      source,
    );

  if (!source.url) {
    const pasted = fromProvidedText();
    return {
      article: pasted,
      kind: classifyText(pasted.text) === "full_text" ? "pasted" : "pasted_short",
    };
  }

  // The URL first, then the other copies the finder knew about: a host that
  // served the finder's check can still refuse this download.
  const urls = [...new Set([source.url, ...(meta?.fallbackUrls ?? [])])].slice(0, MAX_CUT_URLS);
  const started = Date.now();
  let shortPage: ExtractedArticle | null = null;
  let lastError: unknown = null;
  for (const url of urls) {
    const remaining = CUT_FETCH_BUDGET_MS - (Date.now() - started);
    if (remaining < 3000) break;
    try {
      const article = mergeCiteFacts(
        await extractArticleCached(url, Math.min(CUT_FETCH_TIMEOUT_MS, remaining)),
        source,
      );
      if (classifyText(article.text, source.text) === "full_text") {
        return { article, kind: "full_text" };
      }
      // It read, but too little to be sure it's the article — keep looking.
      shortPage ??= article;
    } catch (err) {
      if (!(err instanceof ArticleUnreadableError)) throw err;
      lastError = err;
    }
  }
  if (shortPage) {
    // Only call it "the abstract" when it is: a short news brief is the whole
    // page, and telling the debater "only the abstract could be read" would be
    // false. Both are held to the same stricter bar.
    const kind = isMostlyAbstract(shortPage.text, source.text) ? "abstract_only" : "short_text";
    return { article: shortPage, kind };
  }

  // Nothing readable. Search results ship the real abstract — still verbatim
  // author wording, just shorter, and held to a stricter bar by the gate.
  const fallback = fromProvidedText();
  if (fallback.text.length >= MIN_ABSTRACT_FALLBACK_CHARS) {
    console.warn("cardCutter: URL unreadable; cutting from provided abstract text");
    return { article: fallback, kind: "abstract_only" };
  }
  throw lastError ?? new ArticleUnreadableError();
}

/**
 * Ask the relevance gate about this text. Runs for EVERY cut — including
 * "Entire Article" and single-paragraph text, which the old selector skipped.
 *
 * Returns "unknown" rather than failing the cut when the AI is rate-limited or
 * its answer stays unreadable: gateDecision then refuses an abstract but lets a
 * whole article through, with the marker told relevance wasn't verified.
 */
export async function runGate(
  claim: string,
  cardLength: CardLength,
  paragraphs: string[],
): Promise<GateResult> {
  // The gate reads everything the cut may use (runCut caps it at
  // MAX_ARTICLE_CHARS) — "Entire Article" included, or a long report whose
  // support comes late would be judged on its opening alone.
  const prompt = [
    `Claim: ${claim}`,
    `Card length: ${cardLength}`,
    `Paragraph count: ${paragraphs.length}`,
    "--- PARAGRAPHS ---",
    paragraphs.map((p, i) => `[${i}] ${p}`).join("\n\n"),
  ].join("\n");

  // One re-ask, and only when the answer was unreadable or claimed support it
  // couldn't quote — never to fish for a different verdict.
  let reask = "";
  let last: GateResult = UNKNOWN_GATE;
  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: unknown;
    try {
      // The normal retry ladder: a per-minute rate limit clears in seconds, and
      // an unanswered gate means the card rests on the marker's own verdict
      // (see markerVeto).
      raw = await generateJson({
        system: GATE_SYSTEM,
        prompt: reask ? `${prompt}\n\n${reask}` : prompt,
        maxOutputTokens: 1024,
        // A verdict takes a few seconds; past this the model is stalled and the
        // next one in the chain should answer instead.
        attemptTimeoutMs: GATE_ATTEMPT_MS,
      });
    } catch (err) {
      if (err instanceof RateLimitedError) {
        console.warn("cardCutter: relevance gate rate-limited; verdict unknown");
        return last;
      }
      throw err;
    }
    if (!gateAnswered(raw)) {
      console.warn(`cardCutter: unreadable gate output (attempt ${attempt + 1}): ${describeUnreadable(raw)}`);
      reask = GATE_REASK_UNREADABLE;
      continue;
    }
    last = interpretGate(raw, paragraphs);
    if (last.unknownReason !== "unquoted") return last;
    console.warn(`cardCutter: gate's quote not found in the text (attempt ${attempt + 1})`);
    reask = GATE_REASK_UNQUOTED;
  }
  return last;
}

/**
 * Which marked section writes the tag: the one holding the key paragraph, so the
 * tag is written by a marker that actually read the sentence carrying the
 * support. Section 0 is only the article's opening — on a long cut, often an
 * introduction that proves nothing. Falls back to section 0.
 */
export function tagOwnerSection(
  keyIndex: number | null,
  passageStart: number,
  sectionSizes: number[],
): number {
  if (keyIndex === null) return 0;
  let offset = keyIndex - passageStart;
  if (offset < 0) return 0;
  for (let i = 0; i < sectionSizes.length; i++) {
    if (offset < sectionSizes[i]) return i;
    offset -= sectionSizes[i];
  }
  return 0;
}

/**
 * With the gate unavailable, the markers' own verdicts decide — and a card is
 * only cut when at least one of them found support:
 *   "none"       — every section that answered said the passage is off-claim
 *                  (an off-topic article reads as off-topic throughout, while a
 *                  single section of an on-topic one may not carry it alone);
 *   "unverified" — no section answered at all, so nothing checked relevance;
 *   null         — cut.
 * Failing closed on "unverified" is deliberate: an unchecked cut is exactly how
 * off-topic articles became power-tagged cards.
 */
export function markerVeto(
  votes: ReadonlyArray<"direct" | "partial" | "none" | undefined>,
): "none" | "unverified" | null {
  const answered = votes.filter((v) => v !== undefined);
  if (answered.length === 0) return "unverified";
  return answered.every((v) => v === "none") ? "none" : null;
}

/**
 * Numbers the tag states that appear nowhere in the card's body — the most
 * checkable form of a power tag ("a billion" becoming "5 billion"). Logged, not
 * enforced: it is a measurement of whether the tag rules hold.
 */
export function tagNumbersMissingFromBody(tag: string, body: string): string[] {
  const dropThousandsCommas = (s: string) => s.replace(/(\d),(?=\d{3}\b)/g, "$1");
  const bodyText = dropThousandsCommas(stripDelimiters(body));
  const numbers = dropThousandsCommas(stripDelimiters(tag)).match(/\d+(?:\.\d+)?/g) ?? [];
  return [...new Set(numbers)].filter((n) => {
    const exact = new RegExp(`(^|[^\\d.])${n.replace(".", "\\.")}(?!\\d)`);
    return !exact.test(bodyText);
  });
}

// Re-cutting the same source at the same length/claim (common while iterating)
// reuses the card for 30 min — zero AI cost. Shared across instances/users via
// Redis when configured (in-memory otherwise). Bumped whenever cached cards go
// wrong: "cut2" for the relevance gate, "cut3" for one-word authors cited as
// the outlet ("Medium 25").
const cutCache = createSharedCache<Card>({ ttlMs: 30 * 60 * 1000, namespace: "cut3", maxLocal: 30 });

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
  // The cache is shared by everyone, so only a card the gate actually checked
  // goes in: one cut while the gate was unavailable would otherwise be served,
  // unchecked, to every debater asking for it for 30 minutes. A card cut from
  // an abstract isn't cached either — the article may be readable next time.
  // Refusals are never cached (a rejected compute isn't stored).
  let cacheable = false;
  return cutCache.wrap(
    cutCacheKey(req),
    async () => {
      const { card, verified } = await runCut(req);
      cacheable = verified && card.sourceKind !== "abstract_only";
      return card;
    },
    () => cacheable,
  );
}

/** A cut card, and whether the relevance gate (not just the marker) vouched for it. */
async function runCut(req: CutRequest): Promise<{ card: Card; verified: boolean }> {
  const { article, kind } = await resolveSource(req);
  if (article.text.length < 200) {
    throw new ArticleUnreadableError(
      "That article text is too short to cut a card from. Paste the full article body.",
    );
  }
  if (article.text.length > MAX_ARTICLE_CHARS) {
    article.text = article.text.slice(0, MAX_ARTICLE_CHARS);
  }

  const paragraphs = splitParagraphs(article.text);

  // The gate decides whether there is a card here at all, BEFORE the marker —
  // whose job is to write a confident tag — ever sees the text.
  const gate = await runGate(req.claim, req.cardLength, paragraphs);
  const decision = gateDecision(gate, kind);
  if (!decision.allow) {
    console.info(`cardCutter: no card — verdict ${gate.verdict} on ${kind} text`);
    throw new NoWarrantFoundError(decision.message);
  }

  const [start, end] = passageRange(gate, req.cardLength, paragraphs.map(countWords));
  const passageParagraphs = paragraphs.slice(start, end + 1);
  const passage = passageParagraphs.join("\n\n");

  // Mark the passage in sections so emphasis reaches the WHOLE card, not just its
  // opening. A normal-length passage is a single section → one marker call,
  // identical to before. A long passage (big article) is split so every part is
  // marked densely — the fix for "huge article, only a couple highlighted lines".
  const sections = splitIntoSections(passageParagraphs, SECTION_TARGET_WORDS, MAX_MARKER_SECTIONS);

  /*
   * Each section is marked AND rendered independently, then the rendered
   * sections are rejoined. That works because splitIntoSections cuts only on
   * paragraph boundaries, so the sections rejoin with "\n\n" to exactly the
   * original passage (see its tests) — and it is what lets marking be
   * sub-sentence at all: a fragment's offsets are only meaningful inside the
   * section its sentence numbers refer to.
   */
  const parts = sections.length > 0 ? sections : [passage];
  const owner = tagOwnerSection(
    gate.keyIndex,
    start,
    parts.map((p) => splitParagraphs(p).length),
  );
  let citeData: MarkerData;
  let tagData: MarkerData;
  let bodies: string[];
  let supportVotes: Array<MarkerData["support"]>;

  if (parts.length === 1) {
    const only = await markPassageSection(req.claim, article, parts[0], gate);
    citeData = tagData = only.data;
    bodies = [only.body];
    supportVotes = [only.data.support];
  } else {
    // Section 0 owns the cite (it holds the article's opening) and MUST
    // succeed. The rest are best-effort in parallel: one busy/failed section
    // shouldn't sink the whole card — it just stays plain instead of throwing.
    const marked = await Promise.all(
      parts.map((sec, i) =>
        markPassageSection(req.claim, article, sec, gate).catch((err: unknown) => {
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
    citeData = first.data;
    // The tag comes from the section that read the key quote (see
    // tagOwnerSection), falling back to the opening if that section failed.
    tagData = marked[owner]?.data ?? first.data;
    // A failed section contributes its ORIGINAL text, so the card still holds
    // the whole passage — just unmarked through that stretch.
    bodies = marked.map((m, i) => m?.body ?? parts[i]);
    supportVotes = marked.map((m) => m?.data.support);
  }

  const veto = gate.verdict === "unknown" ? markerVeto(supportVotes) : null;
  if (veto) {
    console.info(`cardCutter: no card — gate unavailable, marker verdict ${veto}`);
    throw new NoWarrantFoundError(veto === "none" ? REFUSALS.none : REFUSALS.unverified);
  }

  const body = bodies.join("\n\n");
  // The tag is the one place the AI supplies markup (`__key phrase__`);
  // convert it to internal delimiters. The body already carries them.
  const tag = tagMarkupToDelimiters(tagData.tag);
  const unsupported = tagNumbersMissingFromBody(tag, body);
  if (unsupported.length > 0) {
    console.warn(`cardCutter: tag states numbers the evidence doesn't: ${unsupported.join(", ")}`);
  }

  return {
    card: {
      tag,
      cite: citeData.cite,
      // Add the real link ourselves — never from the AI, so it can't be invented.
      // The RESOLVED link — canonical when the page declares one — so a share
      // link, tracking URL or redirect never ends up in the cite.
      citeDetails: appendSourceUrl(citeData.citeDetails, article.canonicalUrl || req.source.url),
      body,
      sourceKind: kind,
    },
    verified: gate.verdict !== "unknown",
  };
}
