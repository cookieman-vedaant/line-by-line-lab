/**
 * Citation facts, worked out deterministically before any AI sees the page.
 *
 * A cite has to survive a judge calling for the card, so every part of it is a
 * claim about the world that can be wrong in a specific way:
 *
 *   - the AUTHOR must be the person who wrote it, never the outlet. Citing a
 *     McKinsey report as "McKinsey 24" when Ty et al. wrote it is the failure
 *     this file exists to stop.
 *   - MULTIPLE authors collapse to "First et al.", never silently to one.
 *   - the YEAR is the most recent date the PAGE STATES about itself — published
 *     or updated — and never a year merely mentioned in the prose. An article
 *     projecting to 2035 does not cite as "Author 35".
 *   - QUALIFICATIONS are copied from the page or omitted. Never inferred.
 *
 * The model used to be asked to work all of this out from a slice of raw text.
 * It is far more reliable to resolve it here, where it can be tested, and hand
 * the model finished fields it is told not to override.
 */

/**
 * Tokens that mean the "author" is really an organisation. Kept explicit rather
 * than clever: a heuristic that guesses will eventually erase a real person's
 * byline, which is worse than leaving an org in for a human to notice.
 */
const ORG_WORDS = [
  "inc", "inc.", "llc", "l.l.c.", "ltd", "ltd.", "llp", "plc", "corp", "corp.",
  "corporation", "company", "co.", "group", "holdings", "partners",
  "institute", "institution", "foundation", "association", "society",
  "council", "committee", "commission", "bureau", "agency", "department",
  "ministry", "administration", "organization", "organisation", "coalition",
  "network", "alliance", "initiative", "project", "program", "programme",
  "news", "newsroom", "press", "media", "wire", "service", "desk", "bureau",
  "staff", "team", "editors", "editorial", "board", "correspondent",
  "contributor", "reporters", "guest", "admin", "author", "authors",
];

/** Publisher names that are their own byline on syndicated copy. */
const WIRES = ["reuters", "associated press", "ap", "afp", "bloomberg", "pa media", "xinhua"];

/**
 * Is this "author" an organisation rather than a person?
 *
 * Two signals, both conservative. An org word anywhere in the name, or the
 * lowercase connectives that appear in institution names ("Center FOR American
 * Progress", "Union OF Concerned Scientists") and essentially never in a byline.
 */
export function looksLikeOrganization(name: string): boolean {
  const clean = name.trim().toLowerCase();
  if (!clean) return false;
  if (WIRES.includes(clean)) return true;
  if (/\bthe\s/.test(clean) && clean.split(/\s+/).length > 2) return true;
  if (/\s(of|for)\s/.test(clean)) return true;
  const words = clean.replace(/[.,]/g, " ").split(/\s+/).filter(Boolean);
  if (words.some((w) => ORG_WORDS.includes(w))) return true;
  // "McKinsey & Company" is a firm; "Jane Doe & John Roe" is two bylines. The
  // firm always has a side that is not a person's name.
  if (clean.includes("&")) {
    return clean
      .split("&")
      .map((s) => s.trim())
      .filter(Boolean)
      .some((s) => s.split(/\s+/).filter(Boolean).length < 2);
  }
  return false;
}

/** Junk that rides along on a byline and is not part of the name. */
function stripByline(raw: string): string {
  return raw
    .replace(/^\s*(?:by|written by|authors?|reported by)\s*:?\s*/i, "")
    .replace(/\s*\|.*$/, "")
    .replace(/\s*[–—-]\s*(?:staff|correspondent|reporter|editor).*$/i, "")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Split a byline into individual people. Handles "A, B and C", "A & B",
 * "A; B", and the trailing "and" forms, then drops anything that reads as an
 * organisation so a mixed credit ("Jane Doe, McKinsey & Company") keeps only
 * the person.
 */
export function splitAuthors(raw: string): string[] {
  if (!raw) return [];
  const cleaned = stripByline(raw);
  if (!cleaned) return [];

  const out: string[] = [];
  for (const segment of cleaned.split(/\s*[,;]\s*/)) {
    const seg = segment.trim();
    if (!seg) continue;
    // Judge the WHOLE segment before splitting it further. Splitting
    // "McKinsey & Company" on "&" first leaves "McKinsey" looking exactly like
    // a surname, which is how the outlet ends up cited as the author.
    if (looksLikeOrganization(seg)) continue;
    for (const part of seg.split(/\s*(?:\band\b|&)\s*/i)) {
      const name = part.trim();
      if (name.length <= 1 || !/[A-Za-z]/.test(name)) continue;
      if (looksLikeOrganization(name)) continue;
      // a real byline is 1–4 name tokens; anything longer is a sentence
      if (name.split(/\s+/).length > 4) continue;
      out.push(name);
    }
  }
  return out;
}

/** The surname a cite is built on — the last token, keeping particles. */
export function surnameOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  const prev = parts[parts.length - 2];
  // "van der Berg", "de Sousa" — keep the particle attached to the surname.
  if (/^(van|von|de|del|della|di|da|du|la|le|el|al|bin|ibn|mac|mc|st\.?)$/i.test(prev)) {
    return `${prev} ${last}`;
  }
  return last;
}

/**
 * The short cite name: one surname, or the first surname + "et al." when more
 * than one person is credited. Never the outlet — callers pass an empty list
 * when only an organisation wrote the piece, and decide separately.
 */
export function citeName(authors: string[]): string {
  if (authors.length === 0) return "";
  const first = surnameOf(authors[0]);
  if (!first) return "";
  return authors.length > 1 ? `${first} et al.` : first;
}

/** A date is usable if it parses and isn't implausibly far in the future. */
function usable(date: string, now: Date): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const t = Date.parse(date);
  if (Number.isNaN(t)) return false;
  const year = Number(date.slice(0, 4));
  if (year < 1400) return false;
  // A page may legitimately be dated a few days ahead (timezones, embargoes);
  // a year ahead means the field is junk, not a scoop.
  return t <= now.getTime() + 366 * 24 * 3600 * 1000;
}

/**
 * The most recent date the page states about ITSELF. Published and updated
 * dates both count — a debater cites the version they can actually read, and
 * the freshest date is the honest one. Years found in the prose are never
 * passed in here; that is the point of resolving it from metadata only.
 */
export function mostRecentDate(dates: Array<string | undefined | null>, now = new Date()): string {
  const good = dates
    .map((d) => (d ?? "").trim())
    .filter((d) => usable(d, now))
    .sort();
  return good.length > 0 ? good[good.length - 1] : "";
}

/** The two-digit year a cite prints, e.g. "2024-06-01" -> "24". */
export function citeYear(date: string): string {
  return /^\d{4}-/.test(date) ? date.slice(2, 4) : "";
}
