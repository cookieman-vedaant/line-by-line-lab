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
}

/**
 * A debate-ready card produced by the Card Cutter.
 * `body` is verbatim author text; `**...**` spans mark the emphasized warrants
 * (rendered bold + underlined) and `[...]` marks omitted text. Formatting
 * conventions follow standard Verbatim style until a sample card is provided.
 */
export interface Card {
  /** One-line tag stating what the evidence proves (based on the user's claim). */
  tag: string;
  /** Short cite read in-round, e.g. `Rodríguez '24`. */
  cite: string;
  /** Full citation: author + qualifications, publication, date, URL. */
  citeDetails: string;
  /** Verbatim extracted evidence with emphasis + omission markers. */
  body: string;
}

/** What `/api/cut` accepts. */
export interface CutRequest {
  article: Article;
  claim: string;
  cardLength: CardLength;
}
