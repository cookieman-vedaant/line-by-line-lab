import {
  Type,
  createPartFromFunctionResponse,
  createUserContent,
  type Content,
  type FunctionDeclaration,
  type Part,
} from "@google/genai";
import { stripDelimiters } from "@/lib/cardMarkup";
import { generateContentRaw } from "@/lib/gemini";
import { modelFor } from "@/lib/models";
import type { Tier } from "@/lib/tier";
import { NoSourcesFoundError, findArticles } from "@/services/articleFinder";
import {
  ArticleUnreadableError,
  NoWarrantFoundError,
  cutCard,
} from "@/services/cardCutter";
import {
  CARD_LENGTHS,
  EVIDENCE_TYPES,
  PUBLICATION_AGES,
  SOURCE_TYPES,
  type Article,
  type AssistantContext,
  type AssistantRequest,
  type AssistantResult,
  type Card,
} from "@/types";

// Bounds on the agent loop — each round is Gemini calls, so cap them to protect
// the shared free tier. MAX_STEPS = tool-call rounds per user message (3 is
// enough for find→cut→reply; the prompt tells the Coach to be decisive).
const MAX_STEPS = 3;
const MAX_HISTORY = 12;
// Cap the uploaded-document text fed to the model. Must be large enough that a
// WHOLE debate file (1NC shell + 2NR blocks + cards, tens of thousands of chars)
// reaches the Coach — otherwise the 2NR near the end is silently dropped and the
// Coach misattributes. ~200k chars ≈ a 60–80 page file; matches the /api/pdf
// extract cap. Bigger files are trimmed and the Coach is told so it can say so.
const MAX_DOCUMENT_CHARS = 200000;

/** Narrow an unknown to one of a fixed set of string literals, else undefined. */
function asEnum<T extends string>(arr: readonly T[], v: unknown): T | undefined {
  return typeof v === "string" && (arr as readonly string[]).includes(v)
    ? (v as T)
    : undefined;
}

const ASSISTANT_SYSTEM = `You are the Coach inside "Line by Line Lab", a debate-prep tool for Lincoln-Douglas debaters. You are a real debate coach — pedagogical, Socratic, encouraging but demanding. Your job is to make the debater BETTER, not to do their work for them.

You know competitive debate cold: evidence types (Link, Internal Link, Impact, Uniqueness, Solvency, Framework, Theory, K Link, Alternative Solvency), and the machinery of links, internal links, impacts, solvency, framework, kritiks, theory, counterplans, disadvantages, turns, offense/defense, weighing, and line-by-line.

HOW YOU COACH — this is the heart of the job:
- Teach, don't just tell. When the debater asks a question, ANSWER it clearly and concretely first — then ask ONE sharp follow-up question that pushes them to think further or fix a weakness. Almost every reply should end by putting a question back to them. You are training a thinker, not vending answers.
- Diagnose against a rubric. Judge any argument on five layers and name which is weakest: (1) CLAIM — is it precise? (2) WARRANT — real mechanism/reasoning, or bare assertion? (3) EVIDENCE — qualified, current, from a credible source? (4) IMPACT — magnitude, probability, timeframe? (5) WEIGHING — why it comes first. Tell them exactly which layer is weak and what "stronger" looks like.
- Push for improvement. Don't accept vague. If a link skips a step, name the missing step and ask them to fill it. If an impact is asserted, ask for the warrant. Make them do the thinking; you point the way.
- Be honest and specific. If an argument is weak, say so kindly but plainly, then show the path to stronger. Praise what's genuinely good so they know what to keep.

WHEN THE DEBATER UPLOADS THEIR OWN WORK (it appears below as UPLOADED DOCUMENT — could be one card/block or a WHOLE debate file with many labeled sections and full speeches: 1AC, 1NC, 2NR, overviews, frontlines, blocks, cards from various authors):
- Read the ENTIRE document first — don't judge from the opening pages. The 2NR and later blocks are often near the end.
- Give targeted, rubric-based feedback on THEIR arguments: the strongest parts, the weakest links, missing warrants/impacts/weighing, and the two or three highest-leverage fixes. Quote short phrases (and name the section they're from) so they know exactly where you mean.
- Respect the document's own labels. If they say "look at the 2NR," find the section actually labeled 2NR — never mistake a 1NC tag for the 2NR, and never rename or reassign a section. If a section they reference isn't in the text, say you can't find it and ask them to point you to it; do NOT guess or substitute.
- Then ask which piece they want to strengthen first.

TOOLS:
- find_articles — real reputable, accessible sources for a claim (scholarly databases + open web).
- cut_card — a verbatim debate card from an article url or pasted text.
- Counter-evidence ("turn" / "non-unique" / answers to an argument): search the OPPOSITE of the target claim, then present it as an answer.

HARD RULES — never break these:
- Never fabricate. You have NO knowledge of specific articles, authors, quotes, statistics, dates, or citations on your own — those come ONLY from the tools. Never invent or guess a source, author, quote, stat, or citation, not even as a hypothetical example. If you don't have a real source, say so and offer to search.
- Card text is extracted VERBATIM by cut_card. You never write, paraphrase, or edit card wording.
- Coach, don't ghost-write. Give feedback, structure, options, and the logic — but do NOT write a finished case, contention, block, speech, or rebuttal for them to read out verbatim. Outlining the parts and explaining how an argument works is coaching and is welcome; writing the final product for them is not. When tempted to write it for them, hand back the skeleton and a question instead.

USING TOOLS EFFICIENTLY (a shared free AI budget — be economical):
- Most coaching needs NO tool — just answer and ask your follow-up question. Only search or cut when the debater actually wants evidence or a card.
- Be decisive: when you do use a tool, plan it and make the fewest calls possible. Call find_articles ONCE; as soon as it returns accessible results, STOP and reply. Never more than 2 searches for one request. Don't call tools you don't need.
- Card length defaults to Medium unless they say Short / Long / Entire Article.

STYLE: Sharp, concrete, a little demanding, always constructive. Short paragraphs. End most replies with the single question that most helps them improve. The app renders any article list or card for you, so summarize those briefly instead of repeating them.`;

const TOOLS: FunctionDeclaration[] = [
  {
    name: "find_articles",
    description:
      "Search scholarly databases AND the open web (reputable news, think tanks, government/organization reports) for articles that support a debate claim. Non-citable sites (reddit, wikipedia, social media) are excluded, and results are verified as readable, non-paywalled full text where possible. Call again with different phrasing if results are thin.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        claim: {
          type: Type.STRING,
          description: "The claim the evidence must support, in plain language.",
        },
        evidenceType: {
          type: Type.STRING,
          enum: [...EVIDENCE_TYPES],
          description: "The debate function the evidence must serve.",
        },
        sourceType: {
          type: Type.STRING,
          enum: [...SOURCE_TYPES],
          description: "Optional preferred source type.",
        },
        publicationAge: {
          type: Type.STRING,
          enum: [...PUBLICATION_AGES],
          description: "Optional maximum age of the source.",
        },
      },
      required: ["claim", "evidenceType"],
    },
  },
  {
    name: "cut_card",
    description:
      "Cut a debate-ready card from an article. Provide the article's url (from a find_articles result) OR pasted full article text, plus the claim and a card length. Returns the card, or an error if the page can't be read or has no strong warrant.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        url: {
          type: Type.STRING,
          description: "Article URL to fetch (from a find_articles result). Omit if using text.",
        },
        text: {
          type: Type.STRING,
          description: "Pasted full article text. Omit if using url.",
        },
        claim: { type: Type.STRING, description: "The claim the card must support." },
        cardLength: {
          type: Type.STRING,
          enum: [...CARD_LENGTHS],
          description: "How much of the article to cut.",
        },
      },
      required: ["claim", "cardLength"],
    },
  },
];

interface ToolOutcome {
  /** Compact result fed back to the model. */
  modelResult: Record<string, unknown>;
  /** Rich artifacts surfaced to the client for rendering. */
  articles?: Article[];
  card?: Card;
}

async function runFindArticles(
  args: Record<string, unknown>,
  clientKey?: string,
): Promise<ToolOutcome> {
  const claim = String(args.claim ?? "").trim();
  const evidenceType = asEnum(EVIDENCE_TYPES, args.evidenceType);
  if (!claim || !evidenceType) {
    return { modelResult: { error: "find_articles needs a claim and a valid evidenceType." } };
  }
  try {
    const articles = await findArticles(
      {
        claim,
        evidenceType,
        sourceType: asEnum(SOURCE_TYPES, args.sourceType),
        publicationAge: asEnum(PUBLICATION_AGES, args.publicationAge),
      },
      clientKey,
    );
    // Feed the model a compact view (incl. url so it can cut) — not full abstracts.
    const compact = articles.map((a, i) => ({
      index: i,
      title: a.title,
      author: a.author,
      url: a.url,
      publication: a.publication,
      date: a.date,
      accessible: a.accessible ?? false,
      credibility: a.credibilityScore,
      abstract: (a.abstract ?? "").slice(0, 280),
    }));
    return { modelResult: { count: articles.length, articles: compact }, articles };
  } catch (err) {
    if (err instanceof NoSourcesFoundError) {
      return {
        modelResult: { count: 0, note: "No reputable sources found — try different phrasing or a broader query." },
      };
    }
    throw err; // RateLimitedError / MissingApiKeyError bubble up to the route.
  }
}

async function runCutCard(args: Record<string, unknown>): Promise<ToolOutcome> {
  const claim = String(args.claim ?? "").trim();
  const cardLength = asEnum(CARD_LENGTHS, args.cardLength) ?? "Medium";
  const url = typeof args.url === "string" && args.url.trim().startsWith("http") ? args.url.trim() : undefined;
  const text = typeof args.text === "string" && args.text.trim().length >= 200 ? args.text : undefined;
  if (!claim) return { modelResult: { error: "cut_card needs a claim." } };
  if (!url && !text) {
    return { modelResult: { error: "cut_card needs a url (from find_articles) or pasted article text." } };
  }
  try {
    const card = await cutCard({
      source: url ? { url } : { text },
      claim,
      cardLength,
    });
    return {
      modelResult: {
        ok: true,
        cite: card.cite,
        tag: stripDelimiters(card.tag),
        preview: stripDelimiters(card.body).slice(0, 220),
        cardLength,
      },
      card,
    };
  } catch (err) {
    if (err instanceof ArticleUnreadableError) {
      return { modelResult: { error: "unreadable", detail: err.message } };
    }
    if (err instanceof NoWarrantFoundError) {
      return { modelResult: { error: "no_warrant", detail: err.message } };
    }
    throw err;
  }
}

async function dispatch(
  name: string,
  args: Record<string, unknown>,
  clientKey?: string,
): Promise<ToolOutcome> {
  if (name === "find_articles") return runFindArticles(args, clientKey);
  if (name === "cut_card") return runCutCard(args);
  return { modelResult: { error: `unknown tool: ${name}` } };
}

export function buildSystem(context?: AssistantContext): string {
  if (!context) return ASSISTANT_SYSTEM;
  const sections: string[] = [];

  if (context.claim || context.evidenceType) {
    sections.push(
      `CURRENT CONTEXT (what the debater is working on right now — use it unless they say otherwise): evidence type = "${context.evidenceType ?? "unspecified"}"; claim = "${context.claim ?? "unspecified"}".`,
    );
  }

  if (context.profile && context.profile.trim().length > 0) {
    sections.push(
      `DEBATER PROFILE — an AI read of this debater's game, built from their own Record tab. Use it to pitch your coaching at their level and to target their recurring weaknesses. When they ask how to improve something (often one of these weaknesses), ground your help in this profile and their rounds below. Don't recite it robotically or raise it out of nowhere — but you DO have it, so let it make your coaching specific and personal: ${context.profile.trim()}`,
    );
  }

  if (context.record && context.record.trim().length > 0) {
    sections.push(
      `DEBATER'S LOGGED ROUNDS — their own results and notes from the Record tab. This is real context about how their tournaments are going. Use it to make your help concrete: when they ask about a weakness or a loss, point to the actual round(s) and give specific, actionable fixes and drills. Treat it as private context for helping them, not something to read back verbatim:\n${context.record.trim()}`,
    );
  }

  if (context.foundArticles && context.foundArticles.trim().length > 0) {
    sections.push(
      `ARTICLES THE DEBATER FOUND IN THE ARTICLE FINDER — real sources they just pulled up, each with a URL. When they refer to "the article(s) I found" or ask you to cut or discuss them, use THESE: you can cut from one of these URLs directly with cut_card — do NOT run a new find_articles search unless they explicitly want different evidence. Reference them by title so they know which you mean:\n${context.foundArticles.trim()}`,
    );
  }

  if (context.lastCard && context.lastCard.trim().length > 0) {
    sections.push(
      `A CARD THE DEBATER ALREADY CUT IN THE APP — their most recent cut (tag, cite, and a verbatim body excerpt). Treat it as THEIR work to strengthen: judge whether the tag matches what the evidence proves, whether the warrant actually supports the claim, and whether they should recut it longer/shorter or find a better card. Do NOT treat its body as a source to quote for a different claim, and never rewrite or paraphrase the card's wording:\n${context.lastCard.trim()}`,
    );
  }

  if (context.document && context.document.trim().length > 0) {
    const full = context.document.trim();
    const doc = full.slice(0, MAX_DOCUMENT_CHARS);
    // If we had to clip, tell the Coach explicitly so it discloses the gap
    // instead of guessing about text it never received.
    const truncationNote =
      full.length > MAX_DOCUMENT_CHARS
        ? `\n\n[NOTE: this document was too large to include in full — it was truncated, so roughly the last ${Math.round((full.length - MAX_DOCUMENT_CHARS) / 1000)}k characters are MISSING. If the debater asks about a section you cannot find, tell them it may be in the trimmed portion and ask them to paste that part directly — do NOT guess.]`
        : "";
    sections.push(
      `UPLOADED DOCUMENT — the debater's OWN work. This may be a SINGLE argument (one card/block) or a WHOLE debate file containing multiple labeled sections and full speeches/scripts (e.g. 1AC, 1NC, 2NR, overviews, frontlines, blocks, and cards from various authors). Read the ENTIRE document before you respond.

Rules for working with it:
- Treat it as THEIR argument to improve, NOT as a source to quote as evidence, and never as a real citation.
- Respect the labels in the text. When the debater points to a specific part ("the 2NR", "contention 2", "the overview"), find that exact section by ITS label in the document. Never rename, reassign, or confuse one section for another — a 1NC tag is not the 2NR.
- If you cannot find a section they reference, say so plainly and ask them to point you to it. Do NOT substitute a different section or invent what it says.
- Ground every observation in the actual text — quote the short phrase (and its section/label) you're reacting to. No generic summaries.${truncationNote}
"""
${doc}
"""`,
    );
  }

  return sections.length > 0 ? `${ASSISTANT_SYSTEM}\n\n${sections.join("\n\n")}` : ASSISTANT_SYSTEM;
}

/**
 * Run one turn of the Coach: the model reasons, may call find_articles / cut_card
 * (reusing the existing services), iterates on failures, and returns a reply plus
 * any article list / card produced this turn for the client to render.
 */
export async function runAssistant(
  req: AssistantRequest,
  opts: { clientKey?: string; tier?: Tier } = {},
): Promise<AssistantResult> {
  const system = buildSystem(req.context);
  // The Coach is the most reasoning-heavy task in the app and the headline Pro
  // feature, yet it ran on the CHEAPEST model with thinking disabled — the
  // single largest quality gap in the product. Pro now gets the strong model
  // plus a thinking budget (safe here: the output is prose, not fragile JSON).
  const { model, thinkingBudget } = modelFor("coach", opts.tier ?? "free");
  const contents: Content[] = req.messages
    .slice(-MAX_HISTORY)
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  let articles: Article[] | undefined;
  let card: Card | undefined;

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await generateContentRaw({
      system,
      contents,
      tools: [{ functionDeclarations: TOOLS }],
      model,
      thinkingBudget,
      temperature: 0.4,
      maxOutputTokens: 2048,
    });

    const calls = response.functionCalls ?? [];
    if (calls.length === 0) {
      const reply = (response.text ?? "").trim();
      return {
        reply: reply || "Tell me the claim you're building and what kind of evidence you need, and I'll find you something to cut.",
        articles,
        card,
      };
    }

    // Record the model's tool-call turn, then run each tool.
    const modelContent = response.candidates?.[0]?.content;
    if (modelContent) contents.push(modelContent);

    const responseParts: Part[] = [];
    for (const call of calls) {
      const name = call.name ?? "";
      const outcome = await dispatch(name, call.args ?? {}, opts.clientKey);
      if (outcome.articles) articles = outcome.articles;
      if (outcome.card) card = outcome.card;
      responseParts.push(createPartFromFunctionResponse(call.id ?? name, name, outcome.modelResult));
    }
    contents.push(createUserContent(responseParts));
  }

  // Ran out of tool rounds — one final call WITHOUT tools forces a text summary.
  const final = await generateContentRaw({
    system,
    contents,
    model,
    thinkingBudget,
    temperature: 0.4,
    maxOutputTokens: 2048,
  });
  return {
    reply: (final.text ?? "").trim() || "Here's what I found so far — want me to keep going or cut one of these?",
    articles,
    card,
  };
}
