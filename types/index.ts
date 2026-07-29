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
