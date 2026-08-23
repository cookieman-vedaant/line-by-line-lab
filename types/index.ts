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

/**
 * The real, observable phases of a search — see `runSearch` in
 * `services/articleFinder.ts`. Each is emitted as it BEGINS, so the UI reports
 * what the server is actually doing rather than animating a guess.
 *
 * Query building deliberately isn't a stage: `heuristicQueries` is synchronous
 * string work that finishes in well under a millisecond, so showing it would be
 * theatre. A cached search emits nothing at all and returns immediately.
 */
export const SEARCH_STAGES = ["retrieve", "rank", "verify"] as const;
export type SearchStage = (typeof SEARCH_STAGES)[number];

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
  /**
   * The individual people credited, unmangled. `author` above is a DISPLAY
   * string ("Fawzi et al."); collapsing it and then re-splitting it downstream
   * is how one author became "et al." and how an outlet became a byline. The
   * Card Cutter builds the cite from this, never from the display string.
   */
  authors?: string[];
  /**
   * First author's affiliations, when the source database states them. Copied
   * into the cite as qualifications — never inferred.
   */
  authorInstitutions?: string[];
}

/**
 * One newline-delimited JSON line from `POST /api/search`.
 *
 * The route streams so the browser can report progress while the pipeline is
 * still running. That commits the response to HTTP 200 the moment the first
 * byte is sent, so failures *during* the search arrive as an `error` event
 * rather than a status code. Failures *before* it (auth, rate limit, malformed
 * body) still use ordinary status codes — nothing has been streamed yet.
 *
 * `result` is terminal and always last: zero articles plus a `notice` is the
 * honest "nothing found" outcome, not an error.
 */
export type SearchStreamEvent =
  | { type: "stage"; stage: SearchStage }
  | { type: "result"; articles: Article[]; notice?: string }
  | { type: "error"; error: string };

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
  /**
   * The credited people as separate names, when the caller has them (search
   * results do). Preferred over re-splitting the `author` display string, which
   * is lossy: "Fawzi et al." cannot be split back into who wrote the paper.
   */
  authors?: string[];
  /** First author's affiliations, from the source database. Used as quals. */
  authorInstitutions?: string[];
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
  /**
   * The articles the debater just found in the Article Finder (numbered, with
   * URLs). Lets the Coach pick up the same results and cut/iterate on them
   * without re-searching. Built client-side from the current search results.
   */
  foundArticles?: string;
  /**
   * The most recent card the debater cut anywhere in the app (tag + cite + a
   * verbatim body excerpt), so the Coach can help strengthen or recut it.
   * Built client-side; treated as the debater's own work, never a new source.
   */
  lastCard?: string;
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

/** Which tool asked for a cut. Both funnel through /api/cut. */
export const CUT_ORIGINS = ["finder", "cutter"] as const;
export type CutOrigin = (typeof CUT_ORIGINS)[number];

/**
 * One row in the card library: everything needed to FIND a card, and nothing
 * needed to read one.
 *
 * The body and the full citation details are deliberately absent. A measured cut
 * card body averages ~20KB while this summary is ~200 bytes, so including them
 * made a 50-row page a ~1MB download to render text the row never shows. The
 * body is fetched only when a card is actually opened.
 */
export interface SavedCardSummary {
  id: string;
  /** Tag, still carrying its emphasis markers. */
  tag: string;
  cite: string;
  claim: string;
  cardLength: string;
  origin: CutOrigin;
  sourceUrl?: string;
  sourceTitle?: string;
  sourcePublication?: string;
  createdAt: string; // ISO timestamp
}

/**
 * A saved card with its text — the summary plus the two heavy fields. This is
 * what one card detail request returns, and what the card view renders.
 */
export interface SavedCard extends SavedCardSummary, Card {}

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

// ---- Card Re-Highlighter (indict an opponent's card from its own source) ----

/** How a passage in the source undercuts the opponent's card. */
export type ContradictionKind =
  | "contradiction" // the article states/implies the opposite
  | "omitted_context" // context the card cut that changes the meaning
  | "author_hedge" // the author qualifies or limits the claim
  | "miscut"; // the highlighted span misrepresents the sentence

/** One verbatim way the source works against the opponent's card. */
export interface Contradiction {
  quote: string; // VERBATIM from the article (programmatically verified)
  kind: ContradictionKind;
  explanation: string; // analysis of the real text (allowed; never new evidence)
  howToUse: string; // how to deploy it in-round
}

/** Where the Re-Highlighter gets the source article. At least one of card/url/text. */
export interface RehighlightSource {
  card?: string; // pasted opponent card (tag + cite + body)
  url?: string; // source article URL
  text?: string; // raw pasted article text (fallback)
  title?: string; // optional metadata for the cite (pasted-text path)
  author?: string;
  publication?: string;
  date?: string;
}

/** What `/api/rehighlight` accepts. */
export interface RehighlightRequest {
  source: RehighlightSource;
  opponentClaim?: string; // auto-derived from the card's tag when omitted
}

/**
 * What `/api/rehighlight` returns. `card` is the re-highlighted SOURCE article
 * (verbatim body with emphasis on the counter-warrant passages), rendered by the
 * existing CardView. `contradictions` is verbatim-verified — an empty array is a
 * valid, honest "this card holds up" result. `notice` flags a degraded run
 * (e.g. the full article couldn't be fetched, so only the pasted card was read).
 */
export interface RehighlightResult {
  card: Card;
  contradictions: Contradiction[];
  articleTitle: string;
  sourceUrl?: string;
  notice?: string;
}

/* ------------------------------------------------------------------------- */
/* Wiki mining (opencaselist) — search our own index of disclosed cards       */
/* ------------------------------------------------------------------------- */

/**
 * What `/api/wiki/search` accepts.
 *
 * Just a claim — no caselist and no year. opencaselist has no whole-wiki search
 * (its own site searches one caselist at a time), so we ingest the whole wiki
 * into our own index and search that. The debater describes the argument they
 * want; we return matching cards from everywhere at once.
 */
export interface WikiSearchRequest {
  claim: string;
  /**
   * Restrict the search to these opencaselist caselists (e.g. ["hsld25"]).
   * Omitted or empty means search everything.
   *
   * This is how a debater reaches prep the result cap would otherwise bury: the
   * index spans 13 caselists, and on a broad claim the cap gets spent on
   * whichever division ranked highest overall rather than the one they compete
   * in. Narrowing also makes the query markedly faster, since the caselist index
   * shrinks the corpus before ranking.
   */
  caselists?: string[];
}

/** One caselist a debater can filter by, with how much prep it holds. */
export interface WikiCaselist {
  caselist: string;
  cards: number;
}

/**
 * One search result: a ready-to-use card plus where it came from.
 *
 * `card` is an ordinary `Card` — the same shape the Card Cutter produces — read
 * from the disclosed Word file with the debater's own emphasis intact, so it
 * renders, edits and exports through the machinery that already exists. Nothing
 * in it is generated.
 */
export interface WikiCardResult {
  card: Card;
  caselist: string | null;
  year: number | null;
  school: string | null;
  team: string | null;
  /** Link back to the disclosure on opencaselist. Attribution is never optional. */
  sourceUrl: string | null;
}

/**
 * What `/api/wiki/search` returns. `query` is the normalized string we actually
 * searched for — shown to the user because it can differ from what they typed.
 */
export interface WikiSearchResult {
  query: string;
  cards: WikiCardResult[];
  notice?: string;
}
