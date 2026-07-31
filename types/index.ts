// Shared domain types for Line by Line Lab.
// See agent_docs/product_requirements.md for the source definitions.

/** The 9 evidence functions the app natively understands (affects article ranking). */
export const EVIDENCE_TYPES = [
  "Link",
  "Internal Link",
  "Impact",
  "Uniqueness",
  "Solvency",
  "Framework",
  "Theory",
  "K Link",
  "Alternative Solvency",
] as const;

export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

/** Card length options — see "Card Length Rules" in the PRD. */
export const CARD_LENGTHS = ["Short", "Medium", "Long", "Entire Article"] as const;

export type CardLength = (typeof CARD_LENGTHS)[number];

/** Optional preferred source filter, ordered by the PRD's source-quality tiers. */
export const SOURCE_TYPES = [
  "Any",
  "Peer-reviewed journal",
  "University publication",
  "News organization",
  "Research organization",
  "Government report",
  "Think tank",
  "Book",
] as const;

export type SourceType = (typeof SOURCE_TYPES)[number];

/** Optional recency filter. PRD: prefer the last year unless older literature is canonical. */
export const PUBLICATION_AGES = [
  "Any",
  "6 months",
  "1 year",
  "2 years",
  "5 years",
] as const;

export type PublicationAge = (typeof PUBLICATION_AGES)[number];

/** What the Search screen submits. Evidence Type + Claim are required; the rest optional. */
export interface SearchParams {
  evidenceType: EvidenceType;
  claim: string;
  sourceType?: SourceType;
  publicationAge?: PublicationAge;
  cardLength?: CardLength;
}

/** A ranked article returned by the Article Finder. Shape from the Tech Design. */
export interface Article {
  title: string;
  author: string;
  url: string;
  publication: string;
  date: string;
  explanation: string;
  credibilityScore: number;
  /**
   * The database abstract — real, verbatim author wording. Carried through so
   * the Card Cutter can fall back to it when the article URL (often a paywalled
   * DOI/publisher page) can't be fetched. Not shown in the UI.
   */
  abstract?: string;
  /**
   * True when the Article Finder fetched this URL and confirmed it yields real,
   * readable full text a debater can open and cut from (not paywalled/blocked).
   */
  accessible?: boolean;
}

/**
 * A debate-ready card produced by the Card Cutter.
 * Formatting replicates the user's sample card (Rodrigues 16).
 *
 * `tag` and `body` carry emphasis as INTERNAL private-use delimiters
 * (see lib/cardMarkup.ts) — never `==`/`__`, so literal `==`/`__` in the
 * article render as ordinary text:
 *   U+E000…U+E001  highlighted key warrant — cyan highlight + bold + underline
 *   U+E002…U+E003  underlined read-aloud text
 *   plain          kept-but-unread context — small, de-emphasized
 * `body` is verbatim article text with emphasis applied on top.
 */
export interface Card {
  /** Tag stating what the evidence proves; bold overall, delimiters mark key phrases. */
  tag: string;
  /** Short cite read in-round, sample-card style without apostrophe: `Rodrigues 16`. */
  cite: string;
  /** Bracketed full cite content: author (+ quals), "Title," publication, date, URL. */
  citeDetails: string;
  /** Verbatim extracted evidence with emphasis + omission markers. */
  body: string;
}

/** Where the article to cut comes from — a URL to fetch, or pasted text. */
export interface CutSource {
  /** Fetch + extract this URL server-side. */
  url?: string;
  /** Pasted article text, used as-is. */
  text?: string;
  /** Optional metadata (known from search results, or user-supplied for pasted text). */
  title?: string;
  author?: string;
  publication?: string;
  date?: string;
}

/** What `/api/cut` accepts. Exactly one of source.url / source.text is required. */
export interface CutRequest {
  source: CutSource;
  claim: string;
  cardLength: CardLength;
}

/** One turn in the Coach conversation (the assistant feature). */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Optional context so the Coach knows what the debater is working on. */
export interface AssistantContext {
  evidenceType?: EvidenceType;
  claim?: string;
  /**
   * Text extracted from a PDF the debater uploaded (their own case/block/card).
   * The Coach critiques THIS as the debater's own work — never as a source to
   * quote. Extracted in the browser; the server only ever sees the text.
   */
  document?: string;
  /**
   * A compact summary of the debater's own profile (skill tier + recurring
   * weaknesses), built locally from their Round Log so the Coach pitches feedback
   * at the right level. Personal + per-device — sent only as context for the
   * debater's own coaching, never stored server-side.
   */
  profile?: string;
  /**
   * A compact summary of the debater's actual logged rounds (record + recent
   * rounds with their reports) from the Record tab, so the Coach can ground its
   * help in specific rounds. Personal + per-device — same isolation as `profile`.
   */
  record?: string;
}

/** What `/api/assistant` accepts: the running conversation + optional context. */
export interface AssistantRequest {
  messages: ChatMessage[];
  context?: AssistantContext;
}

/**
 * What `/api/assistant` returns: the Coach's reply, plus any artifacts produced
 * this turn (articles it found / a card it cut) for the client to render richly.
 */
export interface AssistantResult {
  reply: string;
  articles?: Article[];
  card?: Card;
}

// ---- Theme agent ---------------------------------------------------------

/** Curated font pairs the theme agent can choose from (see app/globals.css). */
export type FontId = "zine" | "space" | "editorial" | "terminal" | "rounded" | "impact";

/** Background atmosphere styles a generated theme can use. */
export type BackgroundStyle = "dots" | "grid" | "glow" | "gradient" | "solid";

/** Visual language: hard-offset shadows (bold) vs soft glow (sleek). */
export type ThemeMood = "bold" | "sleek";

/**
 * A validated theme token set produced by the theme agent or a built-in preset.
 * Applied over the existing token system (see lib/themeTokens.ts) — so restyling
 * the whole app is just swapping these values. Colors are #rrggbb hex.
 */
export interface ThemeSpec {
  name: string;
  paper: string;
  paper2: string;
  ink: string;
  stroke: string;
  accent: string;
  accent2: string;
  warn: string;
  highlight: string;
  borderWidth: number; // px, 1..4
  radius: number; // px, 0..20
  mood: ThemeMood;
  background: BackgroundStyle;
  font: FontId;
}

/**
 * Precomputed application payload: what gets persisted and replayed by the
 * pre-paint script (no theme-mapping logic is duplicated — the script just
 * replays `vars` + `dataset`).
 */
export interface AppliedTheme {
  name: string;
  dataset: { bg: BackgroundStyle; mood: ThemeMood; font: FontId };
  vars: Record<string, string>;
}

// ---- Round Log (personal performance tracker) ----------------------------

/** Which side the debater was on in a round. */
export const ROUND_SIDES = ["Aff", "Neg"] as const;
export type RoundSide = (typeof ROUND_SIDES)[number];

/** Round outcome. */
export const ROUND_RESULTS = ["W", "L"] as const;
export type RoundResult = (typeof ROUND_RESULTS)[number];

/**
 * One logged debate round. Stored LOCALLY in the browser (no account); a future
 * login layer syncs this same shape to a per-user table. `report` is the
 * debater's own note on why the round went the way it did — the raw material the
 * AI profile (Phase 2) reads to surface recurring weaknesses. `opponent` is
 * optional, private, and local-only (never used to build a profile of others).
 */
export interface Round {
  id: string;
  tournament: string;
  roundLabel: string; // e.g. "R1", "Quarters", "Round 4"
  side: RoundSide;
  result: RoundResult;
  opponent?: string;
  report: string;
  createdAt: string; // ISO timestamp
}

/** Derived record summary — computed purely from a Round[] (see lib/roundStats). */
export interface RoundSummary {
  total: number;
  wins: number;
  losses: number;
  winRate: number; // 0..1; 0 when there are no rounds
  aff: { wins: number; losses: number };
  neg: { wins: number; losses: number };
}

/** Estimated skill tier inferred from a debater's logged rounds. */
export const SKILL_TIERS = ["Novice", "Developing", "Varsity", "Circuit"] as const;
export type SkillTier = (typeof SKILL_TIERS)[number];

/**
 * AI-synthesized read on the debater, derived from their OWN logged rounds and
 * reports. Personal data: cached LOCALLY per device (never stored server-side —
 * `/api/profile` is stateless). Feeds the Coach so its feedback targets this
 * debater's weaknesses at their level.
 */
export interface DebaterProfile {
  skillTier: SkillTier;
  summary: string; // 1–2 sentence read on the debater
  strengths: string[]; // recurring strengths
  weaknesses: string[]; // recurring weaknesses to work on
  focusAreas: string[]; // concrete things to prep/drill next
}
