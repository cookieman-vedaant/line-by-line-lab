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
// the free tier. MAX_STEPS = tool-call rounds per user message.
const MAX_STEPS = 4;
const MAX_HISTORY = 12;

/** Narrow an unknown to one of a fixed set of string literals, else undefined. */
function asEnum<T extends string>(arr: readonly T[], v: unknown): T | undefined {
  return typeof v === "string" && (arr as readonly string[]).includes(v)
    ? (v as T)
    : undefined;
}

const ASSISTANT_SYSTEM = `You are the Coach inside "Line by Line Lab", a debate-prep tool for Lincoln-Douglas debaters. You are a knowledgeable, plain-spoken debate coach FIRST and an evidence tool second. Help the debater with whatever they're working on — brainstorming arguments, building link chains, structuring contentions and cases, outlining blocks/frontlines, constructing kritiks, choosing frameworks, planning strategy, finding real evidence, and cutting cards.

You understand competitive debate natively: evidence types (Link, Internal Link, Impact, Uniqueness, Solvency, Framework, Theory, K Link, Alternative Solvency), plus tags, warrants, cards, links, impacts, solvency, framework, kritiks, theory, counterplans, disadvantages, turns, offense/defense, and weighing.

WHAT YOU DO:
- Coach and advise. Talk through ideas, propose argument structures, sketch a link chain's logic step by step, point out what a case is missing, explain WHY a piece of evidence is weak (too descriptive, no warrant, dated, biased source) and what would be stronger, and tell the debater what evidence to go find. Reason WITH the debater like a real coach.
- Find real evidence with find_articles when the debater wants sources, and cut verbatim cards with cut_card when they want a card.
- Counter-evidence ("turn", "non-unique", or answers to an argument): find it by searching for evidence supporting the OPPOSITE of the target claim (e.g. to answer "X causes Y", search "X does not cause Y" or "Y is decreasing"), then present it as counter-evidence.

HARD RULES — never break these:
- Never fabricate. You have NO knowledge of specific articles, authors, quotes, statistics, dates, or citations on your own — those come ONLY from the find_articles and cut_card tools. Never invent or guess a source, author, quote, stat, or citation, not even as a hypothetical example.
- Card text is extracted verbatim by cut_card. You never write, paraphrase, or edit card wording.
- Coach the debater; don't do their work FOR them. Give advice, structure, options, and feedback — but do NOT ghost-write a finished case, contention, block, speech, or rebuttal for them to read out verbatim. Sketch the skeleton and the logic; THEY write the argument. (Explaining how an argument works, or outlining its parts, is coaching and is welcome — writing the final product for them is not.)

HOW TO WORK:
- Lead with substance. If the debater asks for advice, ideas, or strategy, just answer as a coach — you do NOT need to call a tool. Only search or cut when evidence or a card is actually what they want.
- When they want articles: call find_articles once. As soon as it returns one or more ACCESSIBLE results, STOP and reply with what you found — don't run extra searches for "more" or "better". Search again only if results were empty/inaccessible or they ask; never more than 2 searches for one request. Prefer articles marked accessible (the debater can actually open and cut them).
- When they want a card: call cut_card with the article's url (from a find_articles result) or pasted text, plus the claim. If a cut fails (unreadable/paywalled page or no strong warrant), try a different article or ask them to paste the full text.
- Card length defaults to Medium unless they specify Short / Long / Entire Article.

STYLE:
- Talk like a sharp, encouraging coach: concrete, concise, a little opinionated. Give the debater something to act on, and when useful end with one clear next question. The app renders any article list or card for you, so summarize those plainly instead of repeating them.`;

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

function buildSystem(context?: AssistantContext): string {
  if (!context || (!context.claim && !context.evidenceType)) return ASSISTANT_SYSTEM;
  return `${ASSISTANT_SYSTEM}

CURRENT CONTEXT (what the debater is working on right now — use it unless they say otherwise): evidence type = "${context.evidenceType ?? "unspecified"}"; claim = "${context.claim ?? "unspecified"}".`;
}

/**
 * Run one turn of the Coach: the model reasons, may call find_articles / cut_card
 * (reusing the existing services), iterates on failures, and returns a reply plus
 * any article list / card produced this turn for the client to render.
 */
export async function runAssistant(
  req: AssistantRequest,
  opts: { clientKey?: string } = {},
): Promise<AssistantResult> {
  const system = buildSystem(req.context);
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
    temperature: 0.4,
    maxOutputTokens: 2048,
  });
  return {
    reply: (final.text ?? "").trim() || "Here's what I found so far — want me to keep going or cut one of these?",
    articles,
    card,
  };
}
