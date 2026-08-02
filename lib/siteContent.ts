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
  { value: "$0", label: "to start, no card" },
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
    tagline: "Reputable, readable evidence for any claim.",
    blurb:
      "Describe the claim you need to prove. The search reads 250M scholarly works plus reputable news, think tanks, and government reports, then ranks them by how well they support that claim and evidence type. It fetch-checks every result, so each one opens to real full text you can cut.",
    points: [
      "Searches OpenAlex, Semantic Scholar, and the reputable open web",
      "Ranks results by debate usefulness for your claim and evidence type",
      "Verifies every result as readable full text before showing it",
      "Sends any result into the Card Cutter in one click",
    ],
    featured: true,
  },
  {
    index: "02",
    name: "Cut a Card",
    tagline: "A formatted, verbatim card in one click.",
    blurb:
      "Paste a URL, drop in text, or cut a search result. The Lab pulls the article, writes the tag and cite, and applies the underlines and highlights. Every word in the body comes from the author.",
    points: [
      "Keeps the body 100% verbatim and verifies it against the source",
      "Writes the tag and cite and marks the read-aloud underline and highlight",
      "Cuts to Short, Medium, Long, or the entire article",
    ],
  },
  {
    index: "03",
    name: "Re-Highlight",
    tagline: "Find the author's words that undercut their card.",
    blurb:
      "Paste an opponent's card or its source link. The Lab pulls the full original article and surfaces the author's own verbatim lines that weaken how the card was highlighted, then hands you a contradiction report you can read in-round.",
    points: [
      "Surfaces the wording the other team left out",
      "Quotes the author verbatim and verifies it against the source",
      "Says the card holds up when nothing contradicts it",
    ],
  },
  {
    index: "04",
    name: "Coach",
    tagline: "One coach for research, cards, blocks, and drills.",
    blurb:
      "Upload an opponent's case as a PDF and build a block of responses backed by real cut cards. Draft a new argument and iterate it line by line. Improve a card or find a stronger source inside the same chat. The Coach runs live web and scholarly search, cuts verbatim evidence, and reads your Record to target the weaknesses that keep costing you rounds.",
    points: [
      "Turns an opponent's case PDF into a block of cut-card responses",
      "Builds arguments with you and iterates them line by line",
      "Refines a cut card or finds a better source mid-conversation",
      "Runs live web and 250M-source scholarly search",
      "Reads your Record to target your recurring weaknesses",
      "Coaches LD, PF, and Policy: links, impacts, framework, Ks, theory, CPs, DAs",
    ],
    featured: true,
  },
  {
    index: "05",
    name: "Record",
    tagline: "Every round, logged and working for you.",
    blurb:
      "Log each tournament, side, result, and note. The Lab turns your history into a debater profile the Coach reads, so its advice gets sharper the more you compete.",
    points: [
      "Keeps a private Round Log that syncs across your devices",
      "Builds a debater profile the Coach reads",
      "Makes every piece of coaching specific to you",
    ],
  },
  {
    index: "06",
    name: "Theme Studio",
    tagline: "Style the whole app from one prompt.",
    blurb:
      "Tell the theme agent a vibe like \"newsprint noir\" or \"varsity blue\" and it generates a full color and type theme. The app reskins instantly, and the agent checks contrast so your text stays readable.",
    points: [
      "Generates complete themes from a one-line prompt",
      "Checks contrast so your text stays readable",
      "Reskins color, fonts, mood, and background together",
    ],
  },
];

export const PRICING: PricingTier[] = [
  {
    name: "Free",
    price: "$0",
    cadence: "forever, to start",
    blurb: "Everything you need to prep a real round. No account payment, no credit card.",
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
      "Priority AI during busy hours",
      "Longer cards and batch cutting for whole case files",
      "Deeper Coach memory across your season",
      "First access to every new tool",
    ],
    status: "coming-soon",
    featured: true,
  },
];
