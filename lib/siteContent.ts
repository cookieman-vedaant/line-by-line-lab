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
  // Monitored inbox: TDPSA privacy requests (privacy page) and in-app feedback
  // (the "Report a problem" link in the Lab header) both point here.
  contactEmail: "thelinebylinelab@gmail.com",
  privacyUpdated: "August 4, 2026",
  // TODO(annually): bump this each January. Held as a constant rather than
  // read from the clock because reading the current time during a render
  // pulls the whole landing page out of its prerendered static shell.
  copyrightYear: "2026",
  mission:
    "Debate shouldn't be a competition of who has the better prep and goes to the larger school. The Line by Line Lab exists to close the gap and balance the scales for all debaters.",
};

/**
 * TRUE, verifiable capability stats — safe to show on day one.
 * - 250M+ : OpenAlex indexes ~250M scholarly works (plus Semantic Scholar + open web).
 * - 100%  : every card body is programmatically verified verbatim against its source.
 * - 7     : Find Articles · Wiki · Cut a Card · Re-Highlight · Coach · Record · Theme Studio.
 * - $0    : free to start, no account payment, no credit card.
 */
export const CAPABILITY_STATS: Stat[] = [
  { value: "250M+", label: "scholarly sources searchable" },
  { value: "100%", label: "verbatim-verified cards" },
  { value: "7", label: "tools, one workspace" },
  { value: "$0", label: "to start, no card" },
];

/** The stat that gives way when the live index count is available. */
const TOOLS_STAT_LABEL = "tools, one workspace";

/**
 * Capability stats, with the live wiki-index count folded in when we have one.
 *
 * The count is a REAL figure read from the database and rounded down (see
 * services/wikiStats.ts) — never a rounded-up marketing number. When it isn't
 * available the row falls back to the four static stats, so the page never
 * shows a placeholder or a zero.
 *
 * It sits second, right after the sources stat, because the two together say
 * the whole pitch: everything published, plus everything already cut. The row
 * is capped at four across, so the tools count steps aside — it is the one
 * stat the ToolStrip directly above already shows.
 */
export function capabilityStats(indexedCards: number | null): Stat[] {
  if (indexedCards == null) return CAPABILITY_STATS;

  const rest = CAPABILITY_STATS.filter((s) => s.label !== TOOLS_STAT_LABEL);
  return [
    rest[0],
    { value: `${indexedCards.toLocaleString()}+`, label: "pre-cut cards to search" },
    ...rest.slice(1),
  ];
}

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
    name: "Wiki",
    tagline: "Every school's disclosed prep, one search away.",
    blurb:
      "opencaselist holds the disclosed cases and cards of programs across the country — but you can only click through it one school and one round at a time, which is useless when you need an answer mid-round. The Lab pre-cuts and indexes all of it into a single searchable library, so you just describe the argument you're hitting and pull a stack of ready-to-read cards in seconds — at the click of a button, even between speeches. No account to connect, no caselist to pick.",
    points: [
      "Search every school's disclosed cards by argument, not by clicking page after page",
      "Describe a claim and pull a stack of on-point cards in seconds — even mid-round",
      "Draws from every school, division, and year at once, all pre-cut",
      "Shows the school, team, and caselist behind each card, linked to opencaselist",
    ],
    featured: true,
  },
  {
    index: "03",
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
    index: "04",
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
    index: "05",
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
    index: "06",
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
    index: "07",
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
  // APPENDED, never inserted mid-list: TheRound renders `TOOLS.slice(0, 6)`
  // against hardcoded RAIL_LABELS and HANDOFF arrays, so putting a tool anywhere
  // in the first six would silently pair every stage with the wrong label.
  {
    index: "08",
    name: "My Cards",
    tagline: "Every card you've cut, on every device.",
    blurb:
      "Cards save themselves. Anything the Card Cutter produces — from a search result or from your own article — lands in your account the moment it's made, so a card cut on a school laptop is on your phone that evening. Filter by tag, cite, or the claim you cut it for, then open any card to edit and export it exactly like a fresh one.",
    points: [
      "Saves every cut automatically — no Save button to forget",
      "Tied to your account, not one device or browser",
      "Filter by tag, cite, claim, or article title",
      "Private to you, and deletable card by card",
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
      "Search disclosed prep on opencaselist",
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
