/**
 * Marketing copy + stats for the landing page, in ONE place so it's easy to keep
 * honest and up to date. Nothing here is fabricated: the capability stats are
 * verifiable facts about what the app can do; the usage counters are left for you
 * to fill with REAL numbers (see USAGE_STATS).
 */

export interface Stat {
  value: string;
  label: string;
}

export interface Tool {
  index: string;
  name: string;
  tagline: string;
  blurb: string;
  points: string[];
  /** Render larger, with its capability list in a grid — the headline tools. */
  featured?: boolean;
}

export interface PricingTier {
  name: string;
  price: string;
  cadence?: string;
  blurb: string;
  features: string[];
  status: "active" | "coming-soon";
  featured?: boolean;
}

export const SITE = {
  name: "Line by Line Lab",
  // TODO(before launch): point this at a monitored inbox on your own domain
  // (or your email). It's the TDPSA privacy-request contact shown in the policy.
  contactEmail: "thelinebylinelab@gmail.com",
  privacyUpdated: "August 2, 2026",
  mission:
    "Debate shouldn't be a competition of who has the better prep and goes to the larger school. The Line by Line Lab exists to close the gap and balance the scales for all debaters.",
};

/**
 * TRUE, verifiable capability stats — safe to show on day one.
 * - 250M+ : OpenAlex indexes ~250M scholarly works (plus Semantic Scholar + open web).
 * - 100%  : every card body is programmatically verified verbatim against its source.
 * - 6     : Find Articles · Cut a Card · Re-Highlight · Coach · Record · Theme Studio.
 * - $0    : free to start, no account payment, no credit card.
 */
export const CAPABILITY_STATS: Stat[] = [
  { value: "250M+", label: "scholarly sources searchable" },
  { value: "100%", label: "verbatim-verified cards" },
  { value: "6", label: "tools, one workspace" },
  { value: "$0", label: "to start — no card" },
];

/**
 * REAL usage counters. Leave `null` and only the capability stats above show —
 * so we never ship a number we can't stand behind. To turn these on, drop in the
 * real figures reverse-tracked from your Google AI Studio (Gemini) usage:
 *
 *   cards cut        ≈ (tokens spent by /api/cut)         / ~14,000
 *   cards highlighted≈ (tokens spent by /api/rehighlight) / ~6,000
 *   searches run     ≈ (tokens spent by /api/search)      / ~13,000
 *
 * (Per-action token averages measured from the prompts + output caps in the
 * services. If the dashboard only shows a single combined total, split it by the
 * share of calls each endpoint makes, or just set the counts you know are real.)
 */
export const USAGE_STATS: {
  cardsCut: number | null;
  cardsHighlighted: number | null;
  searchesRun: number | null;
} = {
  cardsCut: null,
  cardsHighlighted: null,
  searchesRun: null,
};

export const TOOLS: Tool[] = [
  {
    index: "01",
    name: "Find Articles",
    tagline: "The evidence that wins the round, in seconds.",
    blurb:
      "Describe the claim you need to prove — not just keywords. Debate-aware search reads 250M+ scholarly works plus the open web, understands what a Link, Impact, or Solvency card actually needs, and ranks results by how useful they are in-round. It even fetch-checks each source so you never open a dead paywall.",
    points: [
      "OpenAlex + Semantic Scholar + reputable web — not a random Google dump",
      "Ranked by real debate usefulness for your claim and evidence type",
      "Every hit verified as readable full text, not a paywalled abstract",
      "One click from a result straight into the Card Cutter",
    ],
    featured: true,
  },
  {
    index: "02",
    name: "Cut a Card",
    tagline: "A debate-ready card in one click.",
    blurb:
      "Turn any article — a search result, a URL, or pasted text — into a formatted card. The body is the author's real words, with the tag, cite, underlines, and highlights done for you.",
    points: [
      "Body is 100% verbatim — programmatically verified against the source",
      "Three-layer emphasis: tag, read-aloud underline, stressed highlight",
      "Short, Medium, Long, or Entire Article — emphasis spread across the whole card",
    ],
  },
  {
    index: "03",
    name: "Re-Highlight",
    tagline: "Turn their card against them.",
    blurb:
      "Paste an opponent's card or its source link. The Lab pulls the full original article and surfaces the author's own verbatim words that undercut how the card was highlighted — with a contradiction report.",
    points: [
      "Finds the author's wording the other team left out",
      "Verbatim-verified — never paraphrased or invented",
      "Honest 'this card holds up' when there's nothing to find",
    ],
  },
  {
    index: "04",
    name: "Coach",
    tagline: "One coach for your whole case — and it does almost everything.",
    blurb:
      "The most versatile tool in the Lab, and the reason debaters stay. Drop in an opponent's case as a PDF and build a block of real cut cards against it. Workshop a brand-new argument from scratch and iterate it line by line. Sharpen a card or hunt a stronger source without leaving the chat. It runs live web + scholarly search, cuts verbatim evidence, and reads your Record to coach the weaknesses that keep costing you rounds — all in one conversation.",
    points: [
      "Upload an opponent's case (PDF) → a block of responses backed by real cut cards",
      "Build arguments from scratch and iterate them with you — guided, never ghost-written",
      "Refine a cut card or find a better article mid-conversation",
      "Live web + 250M-source scholarly search built in",
      "Reads your Record to target your recurring weaknesses",
      "Fluent in LD, PF & Policy: links, impacts, framework, Ks, theory, CPs, DAs",
    ],
    featured: true,
  },
  {
    index: "05",
    name: "Record",
    tagline: "Your rounds, remembered.",
    blurb:
      "Log every tournament, side, result, and note in one place. The Lab turns it into an honest read of your game, so the Coach's advice gets sharper and more personal the more you debate.",
    points: [
      "A private Round Log that syncs across your devices",
      "Becomes a personal debater profile the Coach actually uses",
      "Makes every piece of coaching specific to you",
    ],
  },
  {
    index: "06",
    name: "Theme Studio",
    tagline: "Make the Lab yours.",
    blurb:
      "Tell the built-in theme agent a vibe — \"newsprint noir\", \"sunrise terminal\", \"varsity blue\" — and it generates a complete color-and-type theme on the spot. The whole app re-skins instantly. Prep you actually enjoy opening is prep you keep doing.",
    points: [
      "AI-generated themes from a one-line prompt",
      "Contrast-checked, so your text always stays readable",
      "Reskins colors, fonts, mood, and background together",
    ],
  },
];

export const PRICING: PricingTier[] = [
  {
    name: "Free",
    price: "$0",
    cadence: "forever, to start",
    blurb: "Everything you need to prep a real round — no account payment, no credit card.",
    features: [
      "Debate-aware article search",
      "Cut verbatim, formatted cards",
      "Re-Highlight opponents' cards",
      "AI Coach on your own case",
      "Round Log + debater profile",
    ],
    status: "active",
  },
  {
    name: "Pro",
    price: "Coming soon",
    blurb:
      "For debaters who live in the Lab all season. Everything in Free, uncapped and prioritized.",
    features: [
      "No daily limits on search, cuts, or Coach",
      "Priority AI — skip the busy-hour waits",
      "Longer cards + batch cutting for whole case files",
      "Deeper Coach memory across your season",
      "First access to every new tool",
    ],
    status: "coming-soon",
    featured: true,
  },
];
