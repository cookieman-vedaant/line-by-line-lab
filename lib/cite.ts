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
  "office", "university", "college", "school", "academy", "faculty", "division",
  "center", "centre", "laboratory", "laboratories", "labs", "observatory",
  "authority", "secretariat", "consortium", "collaboration", "taskforce",
  "federation", "fund", "union", "trust",
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

/**
 * Honorifics and post-nominals. These are not part of the cite name, and when
 * they arrive as their own comma segment ("Jane Smith, Ph.D.") they used to be
 * counted as a SECOND AUTHOR — printing "Smith et al." for a solo piece.
 */
const TITLES = /^(?:dr|prof|professor|mr|mrs|ms|miss|sir|dame|rev|hon|lord|lady|st)\.?$/i;
const SUFFIXES =
  /^(?:jr|sr|ii|iii|iv|v|phd|ph\.?d|md|m\.?d|ma|msc|m\.?s|mba|jd|j\.?d|llm|esq|dds|dvm|rn|cfa|cpa|emeritus)\.?$/i;

/**
 * Words that mean a segment is a JOB DESCRIPTION, not a name. Same failure as
 * the suffixes above: "Jane Smith, Senior Fellow" parsed as two people.
 * (The role itself is still useful — it is picked up separately as the author's
 * qualification. It is only wrong as a byline.)
 */
const JOB_WORDS = [
  "fellow", "professor", "lecturer", "researcher", "scientist", "economist",
  "analyst", "director", "president", "chair", "chairman", "dean", "head",
  "officer", "manager", "founder", "partner", "associate", "assistant",
  "senior", "junior", "adjunct", "visiting", "distinguished", "chief",
  "editor", "reporter", "correspondent", "columnist", "secretary", "minister",
  "counsel", "attorney", "lawyer", "advisor", "adviser", "consultant",
  "specialist", "coordinator", "candidate", "student", "intern",
];

function looksLikeRole(segment: string): boolean {
  const words = segment.toLowerCase().replace(/[.,]/g, " ").split(/\s+/).filter(Boolean);
  return words.some((w) => JOB_WORDS.includes(w));
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
 * "Jane Smith for Reuters" → "Jane Smith". Freelance and syndicated bylines
 * carry the outlet inline; the whole string used to be judged as an
 * organisation ("… for …") and dropped, leaving nobody and a cite that named
 * the outlet.
 *
 * Requires a plausible PERSON before the "for" — two or more name-shaped
 * tokens — so institution names built around "for" ("Center for American
 * Progress") are untouched and still read as organisations.
 */
function stripOutletCredit(segment: string): string {
  const m = segment.match(/^(.+?)\s+for\s+\S.*$/i);
  if (!m) return segment;
  const before = m[1].trim();
  const tokens = before.split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 4) return segment;
  if (looksLikeOrganization(before)) return segment;
  return before;
}

/** Drop honorifics and post-nominals from one person's name. */
function stripTitles(name: string): string {
  const tokens = name.split(/\s+/).filter(Boolean);
  while (tokens.length > 1 && TITLES.test(tokens[0])) tokens.shift();
  while (tokens.length > 1 && SUFFIXES.test(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join(" ");
}

/** A given name or an initial — what follows the comma in "Smith, J.". */
function isGivenNamePart(token: string): boolean {
  return /^(?:[A-Z]\.?|[A-Z][a-z’'\-]+)$/.test(token);
}

/**
 * Rebuild a surname-first byline as a normal name: "Fawzi, Alhussein" →
 * "Alhussein Fawzi", "Smith, J." → "J. Smith".
 *
 * This is the standard shape of `citation_author` meta tags and of most
 * scholarly metadata, and splitting it on the comma produced two "authors" —
 * which is why single-author papers were citing as "Fawzi et al."
 *
 * Deliberately narrow: the part before the comma must be a bare surname (one
 * token, or a particle + surname), and the part after must be given names or
 * initials. "Ty Bishop, Rachel Chen" keeps its two real people.
 */
function joinSurnameFirst(surname: string, given: string): string | null {
  const sTokens = surname.split(/\s+/).filter(Boolean);
  const gTokens = given.split(/\s+/).filter(Boolean);
  if (gTokens.length === 0 || gTokens.length > 2) return null;
  if (!gTokens.every(isGivenNamePart)) return null;
  if (sTokens.length === 1) return `${given} ${surname}`;
  if (sTokens.length === 2 && PARTICLE.test(sTokens[0])) return `${given} ${surname}`;
  return null;
}

/**
 * Split a byline into individual people. Handles "A, B and C", "A & B",
 * "A; B", and the trailing "and" forms, then drops anything that reads as an
 * organisation so a mixed credit ("Jane Doe, McKinsey & Company") keeps only
 * the person.
 */
export function splitAuthors(raw: string): string[] {
  return parseByline(raw).authors;
}

/**
 * A byline, resolved into the people it credits and whether it was truncated
 * with "et al."
 *
 * `etAl` has to be carried separately because the truncation is not recoverable
 * from the names: a search result arrives already collapsed to "Alhussein Fawzi
 * et al.", and treating "al." as a surname produced the cite "al. 23".
 */
export function parseByline(raw: string): { authors: string[]; etAl: boolean } {
  if (!raw) return { authors: [], etAl: false };

  // "et al." is a marker of MORE authors, never a name. Record it, remove it.
  const etAl = /\bet\.?\s+al\.?/i.test(raw);
  const cleaned = stripByline(raw.replace(/\s*,?\s*\bet\.?\s+al\.?\s*/gi, " "));
  if (!cleaned) return { authors: [], etAl };

  // Semicolons separate people even when commas are separating surname-first
  // names inside them ("Fawzi, Alhussein; Balog, Matej").
  const groups = cleaned.includes(";")
    ? cleaned.split(/\s*;\s*/)
    : [cleaned];

  const out: string[] = [];
  for (const group of groups) {
    const segments = group.split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean);

    // "Surname, Given" — one person written backwards, not two people.
    if (segments.length === 2) {
      const joined = joinSurnameFirst(segments[0], segments[1]);
      if (joined && !looksLikeOrganization(segments[0])) {
        out.push(stripTitles(joined));
        continue;
      }
    }

    for (const segment of segments) {
      // Post-nominals and job titles arrive as their own segment and are not
      // people. Dropping them is what stops the false "et al."
      if (SUFFIXES.test(segment.replace(/\s+/g, ""))) continue;
      if (looksLikeRole(segment)) continue;
      const seg = stripOutletCredit(segment);
      // Judge the WHOLE segment before splitting it further. Splitting
      // "McKinsey & Company" on "&" first leaves "McKinsey" looking exactly like
      // a surname, which is how the outlet ends up cited as the author.
      if (looksLikeOrganization(seg)) continue;
      for (const part of seg.split(/\s*(?:\band\b|&)\s*/i)) {
        const name = stripTitles(part.trim());
        if (name.length <= 1 || !/[A-Za-z]/.test(name)) continue;
        if (looksLikeOrganization(name)) continue;
        // a real byline is 1–4 name tokens; anything longer is a sentence
        const tokens = name.split(/\s+/).filter(Boolean);
        if (tokens.length > 4) continue;
        // A lone token is an outlet far more often than a person ("Nature",
        // "Reuters"). A real byline carries a given name or an initial too.
        if (tokens.length < 2) continue;
        out.push(name);
      }
    }
  }
  return { authors: out, etAl };
}

/** Nobiliary particles that belong to the surname they precede. */
const PARTICLE = /^(?:van|von|de|del|della|di|da|dos|das|du|la|le|el|al|bin|ibn|mac|mc|st\.?|ter|ten|op|af|av)$/i;

/**
 * A bare initials token: one to three capital letters, each optionally with a
 * period — "D", "D.", "DA", "J.A.". Never a real surname, which carries
 * lowercase letters ("He", "Ng", "Wu" all fail this and stay surnames).
 */
function isInitialToken(token: string): boolean {
  return /^(?:[A-Z]\.?){1,3}$/.test(token);
}

/**
 * The surname a cite is built on.
 *
 * Two byline shapes reach here, and they put the surname at OPPOSITE ends:
 *
 *   "Given Surname"      — "Daron Acemoglu"     → surname is LAST  ("Acemoglu")
 *   "Surname Initials"   — "Acemoglu D", "He K" → surname is FIRST ("Acemoglu")
 *
 * The second is the dominant format in journals, PubMed and wire bylines, and
 * taking the last token there was the bug that cited a paper as "D" or "S" —
 * the trailing initial instead of the author. The tell is unambiguous: a real
 * "Given Surname" never ends in a bare initial.
 *
 * Particles stay attached to the surname on both paths ("Maria de la Cruz" →
 * "de la Cruz"; "van der Berg M" → "van der Berg").
 */
export function surnameOf(name: string): string {
  const parts = stripTitles(name.trim()).split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];

  // "Surname Initials": strip the trailing initials; what's left is the surname.
  let end = parts.length;
  while (end > 1 && isInitialToken(parts[end - 1])) end--;
  if (end < parts.length) return parts.slice(0, end).join(" ");

  // "Given Surname": the surname is the last token, absorbing leading particles.
  let start = parts.length - 1;
  while (start > 1 && PARTICLE.test(parts[start - 1])) start--;
  return parts.slice(start).join(" ");
}

/**
 * The short cite name: one surname, or the first surname + "et al." when more
 * than one person is credited. Never the outlet — callers pass an empty list
 * when only an organisation wrote the piece, and decide separately.
 */
export function citeName(authors: string[], etAl = false): string {
  if (authors.length === 0) return "";
  const first = surnameOf(authors[0]);
  if (!first) return "";
  return authors.length > 1 || etAl ? `${first} et al.` : first;
}

/** The cite name straight from a raw byline, preserving a truncated "et al." */
export function citeNameFromByline(raw: string): string {
  const { authors, etAl } = parseByline(raw);
  return citeName(authors, etAl);
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
