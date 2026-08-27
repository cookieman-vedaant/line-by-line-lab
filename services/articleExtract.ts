import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { mostRecentDate, parseByline } from "@/lib/cite";
import { hasPaywallPhrase, hasStructuredPaywallSignal } from "@/lib/paywall";
import { createSharedCache } from "@/lib/sharedCache";
import { BlockedUrlError, safeFetch } from "@/lib/ssrfGuard";

/**
 * Build an article from loose fields — pasted text, or a card the
 * re-highlighter is working from without a fetchable source.
 *
 * Everything that isn't a fetch still goes through the same citation
 * resolution, so a byline the debater pasted gets the same treatment as one
 * scraped off a page. Doing this per call site is how "McKinsey" survives in
 * one path and not another.
 */
export function articleFromFields(fields: {
  title?: string;
  author?: string;
  publication?: string;
  date?: string;
  text: string;
  url?: string;
}): ExtractedArticle {
  const { authors, etAl } = parseByline(fields.author ?? "");
  return {
    title: fields.title ?? "",
    author: authors.join(", ") || (fields.author ?? ""),
    etAl,
    publication: fields.publication ?? "",
    date: mostRecentDate([normalizeDate(fields.date ?? "")]),
    text: fields.text,
    authors,
    authorQualification: findAuthorBioInText(fields.text, authors),
    publisherQualification: "",
    canonicalUrl: fields.url ?? "",
  };
}

/** Honest failure — the article couldn't be fetched or parsed. */
export class ArticleUnreadableError extends Error {
  constructor(detail?: string) {
    super(
      detail ??
        "This article couldn't be read (it may be paywalled or blocked). Try pasting the article text instead.",
    );
    this.name = "ArticleUnreadableError";
  }
}

export interface ExtractedArticle {
  title: string;
  author: string;
  publication: string;
  /** The most recent date the PAGE states about itself — published or updated. */
  date: string;
  text: string;
  /**
   * Every human author found, in order. Empty when only an organisation was
   * credited, which is a different thing from "we couldn't find anyone" and is
   * what stops the outlet being printed as the author.
   */
  authors: string[];
  /** The author's stated role or bio, copied from the page. Never inferred. */
  authorQualification: string;
  /** What the publisher IS, copied from the page — used when nobody is bylined. */
  publisherQualification: string;
  /**
   * The byline was truncated with "et al.", so more people are credited than
   * `authors` lists. Carried separately because it cannot be recovered from the
   * names: "al." is not a surname.
   */
  etAl?: boolean;
  /** Where the article actually lives after redirects and canonicalisation. */
  canonicalUrl: string;
}

const FETCH_TIMEOUT_MS = 15000;
const MIN_ARTICLE_CHARS = 400;
// A page with a hard paywall marker but LESS than this much extracted text is a
// locked teaser/abstract, not a readable article — reject it.
const PAYWALL_TEASER_CHARS = 1500;
// Bar for `verifyAccessible` to call a page "cuttable full text". Well above a
// typical abstract (~1,000–1,800 chars) so abstract-only landing pages — the
// Article Finder's old blind spot — stop being marked accessible.
const MIN_ACCESSIBLE_CHARS = 2200;

/**
 * Fetch a URL and extract clean article text with Mozilla Readability —
 * the same engine behind Firefox Reader Mode. Free, runs on our server.
 */
/** Largest PDF we'll pull fully into memory to extract. Beyond this, reject. */
const MAX_PDF_BYTES = 25 * 1024 * 1024;

/**
 * Is this response a PDF? Checks the declared type, the URL, and — because
 * servers mislabel PDFs as octet-stream or even text/html — the `%PDF-` magic
 * bytes. Any one is enough.
 */
export function isPdfResponse(contentType: string, url: string, buffer: ArrayBuffer): boolean {
  if (contentType.includes("application/pdf")) return true;
  if (/\.pdf(\?|#|$)/i.test(url)) return true;
  const b = new Uint8Array(buffer, 0, Math.min(5, buffer.byteLength));
  return b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d;
}

/**
 * Decode page bytes to text, honouring the HTTP charset when it's stated and
 * defaulting to UTF-8 — the same rule `res.text()` follows, but reached from
 * the raw bytes so the PDF check above can run first on the same body (a
 * Response body can only be read once).
 */
export function decodeHtml(buffer: ArrayBuffer, contentType: string): string {
  const m = /charset=["']?([\w-]+)/i.exec(contentType);
  const enc = (m?.[1] ?? "utf-8").toLowerCase();
  try {
    return new TextDecoder(enc).decode(buffer);
  } catch {
    return new TextDecoder("utf-8").decode(buffer);
  }
}

/**
 * Reflow PDF-extracted text into paragraphs. PDF extraction yields hard-wrapped
 * LINES, not paragraphs; feeding those straight to the cutter makes every line
 * its own "paragraph" and fragments the marking. Join a line to the next unless
 * the current one ends a sentence, and stitch hyphenated word-wraps back
 * together. Blank lines stay paragraph breaks.
 */
export function pdfToParagraphs(raw: string): string {
  const paragraphs: string[] = [];
  let current = "";
  for (const line of raw.replace(/\r/g, "").split("\n")) {
    const t = line.trim();
    if (!t) {
      if (current) paragraphs.push(current);
      current = "";
      continue;
    }
    if (!current) current = t;
    else if (/[.!?:;”")]\s*$/.test(current)) {
      paragraphs.push(current);
      current = t;
    } else if (current.endsWith("-")) current = current.slice(0, -1) + t;
    else current = `${current} ${t}`;
  }
  if (current) paragraphs.push(current);
  return paragraphs.filter(Boolean).join("\n\n");
}

/**
 * Build an article from a fetched PDF using unpdf (the same serverless-safe
 * pdf.js build the upload route uses). Text only — a PDF rarely carries a
 * trustworthy machine-readable author or date, so those are left empty and
 * resolved from the search result's metadata by mergeCiteFacts. A scanned,
 * image-only PDF yields no text and is rejected rather than cut empty.
 */
async function articleFromPdf(bytes: Uint8Array, url: string): Promise<ExtractedArticle> {
  if (bytes.byteLength > MAX_PDF_BYTES) {
    throw new ArticleUnreadableError(
      "That PDF is too large to read here. Download it and paste the text instead.",
    );
  }
  const { extractText, getDocumentProxy } = await import("unpdf");
  let raw: string;
  try {
    const pdf = await getDocumentProxy(bytes);
    const result = await extractText(pdf, { mergePages: true });
    raw = Array.isArray(result.text) ? result.text.join("\n\n") : result.text;
  } catch {
    throw new ArticleUnreadableError(
      "That PDF couldn't be read — it may be scanned images or corrupted. Paste the text instead.",
    );
  }
  const text = pdfToParagraphs(raw ?? "");
  if (text.trim().length < MIN_ARTICLE_CHARS) {
    throw new ArticleUnreadableError(
      "That PDF had no extractable text (it may be scanned images). Paste the text instead.",
    );
  }
  return {
    title: "",
    author: "",
    publication: new URL(url).hostname.replace(/^www\./, ""),
    date: "",
    text,
    authors: [],
    etAl: false,
    authorQualification: "",
    publisherQualification: "",
    canonicalUrl: url,
  };
}

export async function extractArticleFromUrl(
  url: string,
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<ExtractedArticle> {
  let html = "";
  try {
    // safeFetch validates the URL (and every redirect hop) against the SSRF guard
    // before making the request — a user-supplied link can't reach an internal or
    // cloud-metadata address. It also handles the browser-like UA target + timeout.
    const res = await safeFetch(url, {
      // A full, Chrome-like header set. Many publishers serve a thin/blocked page
      // to requests that only send a UA; matching a real browser's headers gets
      // the full article from servers that sniff for them. (It does NOT defeat a
      // JS challenge like Cloudflare's "Just a moment" — those need a real browser,
      // so those sites still fall back to the abstract.)
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
      },
      timeoutMs,
    });
    if (!res.ok) {
      throw new ArticleUnreadableError(
        `The site responded with error ${res.status}. It may be paywalled or blocking readers — try pasting the article text instead.`,
      );
    }
    // Read the raw bytes ONCE, then decide what they are. A URL that serves a
    // PDF (arXiv, NBER, gov reports — prime debate evidence) was being decoded
    // as text, which put the PDF's binary streams straight into the card body.
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    const buffer = await res.arrayBuffer();
    if (isPdfResponse(contentType, url, buffer)) {
      return await articleFromPdf(new Uint8Array(buffer), url);
    }
    html = decodeHtml(buffer, contentType);
  } catch (err) {
    if (err instanceof ArticleUnreadableError) throw err;
    if (err instanceof BlockedUrlError) {
      throw new ArticleUnreadableError(
        "That URL can't be fetched (it points to a private or blocked address). Paste the article text instead.",
      );
    }
    throw new ArticleUnreadableError(
      "The article couldn't be fetched (timeout or network error). Try pasting the article text instead.",
    );
  }

  // linkedom parses HTML without a heavy browser emulation — it works in
  // serverless/edge where jsdom crashes. Its Document is runtime-compatible
  // with Readability + our metadata reader; the TS type differs, so we cast.
  const { document } = parseHTML(html);
  const doc = document as unknown as Document;

  // Pull structured metadata BEFORE Readability mutates the DOM.
  const meta = extractPageMetadata(doc);

  const parsed = new Readability(doc).parse();

  if (!parsed || !parsed.textContent || parsed.textContent.trim().length < MIN_ARTICLE_CHARS) {
    throw new ArticleUnreadableError(
      "No readable article text was found on that page. Try pasting the article text instead.",
    );
  }

  // Paywall / abstract-only gate: a structured "locked/metered" signal is
  // reliable on its own; a fuzzy paywall phrase only counts when the extracted
  // body is short (a teaser behind a wall, not a full article that merely links
  // "subscribe" somewhere). Either way, only a teaser is free — reject it so we
  // never cut a thin, warrant-less card from it.
  const bodyChars = parsed.textContent.trim().length;
  if (
    hasStructuredPaywallSignal(html) ||
    (bodyChars < PAYWALL_TEASER_CHARS && hasPaywallPhrase(html))
  ) {
    throw new ArticleUnreadableError(
      "This article is behind a paywall — only a teaser or abstract is free to read. Try pasting the full text instead.",
    );
  }

  const text = htmlToParagraphText(parsed.content ?? "", parsed.textContent);

  const publication =
    meta.publication || parsed.siteName || new URL(url).hostname.replace(/^www\./, "");
  // Prefer structured metadata over Readability's byline (often null); fall back
  // to a visible byline in the article text. Then drop a "byline" that is really
  // the site/publisher name, so the cite never prints the website as the author.
  const rawAuthor = cleanAuthor(
    meta.author || parsed.byline || findBylineInText(text) || "",
    publication,
  );
  // Resolve the byline into actual people. An organisation resolves to nobody,
  // which is the signal the cite needs — "no human wrote this" is not the same
  // as "the outlet is the author".
  const { authors, etAl } = parseByline(rawAuthor);

  return {
    title: meta.title || parsed.title || "",
    author: authors.join(", ") || rawAuthor,
    etAl,
    publication,
    // Published OR updated, whichever is later: a debater cites the version
    // they can actually read.
    date: mostRecentDate([meta.date, meta.modified, parsed.publishedTime?.slice(0, 10)]),
    text,
    authors,
    authorQualification: meta.authorQualification || findAuthorBioInText(text, authors),
    publisherQualification: meta.publisherQualification,
    canonicalUrl: meta.canonicalUrl || url,
  };
}

/**
 * Extracted-article cache. An article's readable text is public and stable, so a
 * recent extraction is reused across the whole app instead of downloading and
 * re-parsing the same URL. This is what removes the "double fetch": the Article
 * Finder's accessibility check (verifyAccessible) WARMS this cache, so the
 * follow-up Cut / Re-Highlight of that result skips the fetch + parse entirely
 * and goes straight to the AI step. Shared across users + instances when Redis is
 * configured, in-memory otherwise.
 *
 * Only SUCCESSFUL extractions are cached: createSharedCache.wrap never stores a
 * rejection, so a paywalled/timed-out URL is not negatively cached and a later
 * attempt (with the longer cut timeout) still runs. The cache key is the URL
 * only — a hit returns the same text regardless of the caller's timeout, because
 * a completed extraction is identical whichever timeout allowed the fetch.
 */
const articleCache = createSharedCache<ExtractedArticle>({
  ttlMs: 30 * 60 * 1000, // 30 min — matches the search-result cache window
  namespace: "article",
  /*
   * LOCAL ONLY — never written to Redis. This is by far the largest value the
   * app caches: full article body text, routinely 100-300 KB serialized. Upstash
   * charges per request AND per byte, and this payload was the main driver of
   * hitting the free-tier limit.
   *
   * The trade is small: an article's cache key is one exact URL, so a cross-user
   * hit needs two people to open the SAME source inside 30 minutes — rare. The
   * case that actually matters (search → cut → re-highlight the same article, by
   * the same user, within one session) is served entirely by the in-process
   * cache, which is free and faster than a network round trip.
   */
  shareAcrossInstances: false,
  // A little more local headroom, since this is now the only tier it has.
  maxLocal: 40,
});

/**
 * Cache-backed article extraction — same result as extractArticleFromUrl, but a
 * repeat request for the same URL within the TTL reuses the earlier extraction
 * instead of fetching + parsing again. Use this everywhere an article is fetched
 * for user-facing work (verify / cut / re-highlight). The `timeoutMs` applies
 * only on a cache MISS. `extractor` is an injection seam for tests; production
 * callers never pass it.
 */
export async function extractArticleCached(
  url: string,
  timeoutMs: number = FETCH_TIMEOUT_MS,
  extractor: (u: string, t: number) => Promise<ExtractedArticle> = extractArticleFromUrl,
): Promise<ExtractedArticle> {
  return articleCache.wrap(url.trim(), () => extractor(url, timeoutMs));
}

/**
 * Quick, quiet check that a URL is actually readable full text a debater could
 * cut from — used by the Article Finder to only show accessible sources. Uses a
 * shorter timeout than a real cut and never throws (a failure just means "not
 * accessible"). Goes through the shared cache so the extraction it pays for is
 * reused by a follow-up cut of the same result (no second download).
 */
export async function verifyAccessible(
  url: string,
  timeoutMs = 6500,
): Promise<{ ok: boolean; chars: number }> {
  try {
    const article = await extractArticleCached(url, timeoutMs);
    const chars = article.text.trim().length;
    // "Accessible" means genuinely cuttable full text — not just an abstract.
    // extractArticleFromUrl already rejected paywalled/teaser pages by throwing.
    return { ok: chars >= MIN_ACCESSIBLE_CHARS, chars };
  } catch {
    return { ok: false, chars: 0 };
  }
}

interface PageMetadata {
  title: string;
  author: string;
  publication: string;
  date: string;
  /** Updated/modified date, kept separate so the caller can take the later one. */
  modified: string;
  authorQualification: string;
  publisherQualification: string;
  canonicalUrl: string;
}

/**
 * Extract author/date/publication from a page's <meta> tags and JSON-LD.
 * Fully defensive — never throws; a missing field just stays empty.
 */
export function extractPageMetadata(doc: Document): PageMetadata {
  const meta: PageMetadata = {
    title: "",
    author: "",
    publication: "",
    date: "",
    modified: "",
    authorQualification: "",
    publisherQualification: "",
    canonicalUrl: "",
  };

  const attr = (selector: string, attribute = "content"): string => {
    try {
      return doc.querySelector(selector)?.getAttribute(attribute)?.trim() ?? "";
    } catch {
      return "";
    }
  };

  meta.title =
    attr('meta[property="og:title"]') || attr('meta[name="twitter:title"]') || "";
  meta.author =
    attr('meta[name="author"]') ||
    attr('meta[property="article:author"]') ||
    attr('meta[property="og:article:author"]') ||
    attr('meta[name="parsely-author"]') ||
    attr('meta[name="sailthru.author"]') ||
    "";
  meta.publication =
    attr('meta[property="og:site_name"]') || attr('meta[name="application-name"]') || "";
  meta.date = normalizeDate(
    attr('meta[property="article:published_time"]') ||
      attr('meta[name="parsely-pub-date"]') ||
      attr('meta[itemprop="datePublished"]') ||
      attr("time[datetime]", "datetime"),
  );
  // Updated dates are read SEPARATELY, not as a fallback: a page usually states
  // both, and the cite wants the later one. Reading them as a fallback would
  // mean an updated article always cited as its original year.
  meta.modified = normalizeDate(
    attr('meta[property="article:modified_time"]') ||
      attr('meta[property="og:updated_time"]') ||
      attr('meta[itemprop="dateModified"]') ||
      attr('meta[name="last-modified"]'),
  );
  // The scholarly standard for an author's affiliation, and the one most
  // journal and repository pages actually emit.
  meta.authorQualification =
    attr('meta[name="citation_author_institution"]') ||
    attr('meta[property="article:author_institution"]') ||
    "";

  // Where the article really lives — a share link or tracking URL in the address
  // bar must never end up in the cite.
  meta.canonicalUrl =
    attr('link[rel="canonical"]', "href") || attr('meta[property="og:url"]') || "";

  // JSON-LD fills any gaps (author, dates, publisher, credentials).
  try {
    const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      const jsonLd = parseJsonLd(script.textContent ?? "");
      for (const node of jsonLd) {
        if (!meta.author) meta.author = jsonLdAuthor(node);
        if (!meta.date) meta.date = normalizeDate(stringField(node, "datePublished"));
        if (!meta.modified) meta.modified = normalizeDate(stringField(node, "dateModified"));
        if (!meta.publication) meta.publication = jsonLdPublisher(node);
        if (!meta.authorQualification) meta.authorQualification = jsonLdAuthorQualification(node);
        if (!meta.publisherQualification) {
          meta.publisherQualification = jsonLdPublisherQualification(node);
        }
      }
    }
  } catch {
    // ignore malformed JSON-LD
  }

  return meta;
}

/**
 * The author's stated role, straight from the page's own structured data.
 *
 * A cite is stronger when it says WHO the author is, and a debater should never
 * have to take the app's word for it — so this only ever copies what the page
 * publishes about them. Nothing is inferred from the topic, the outlet or the
 * name; when a page says nothing, the cite says nothing.
 */
function jsonLdAuthorQualification(node: Record<string, unknown>): string {
  const author = node.author;
  if (!author) return "";
  const list = Array.isArray(author) ? author : [author];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;
    const type = obj["@type"];
    if (typeof type === "string" && /organization/i.test(type)) continue;
    // affiliation / worksFor are how most scholarly and think-tank pages state
    // an author's institution; reading only jobTitle+description left the vast
    // majority of pages with no qualification at all.
    const parts = [
      stringField(obj, "jobTitle"),
      stringField(obj, "description"),
      namedField(obj, "affiliation"),
      namedField(obj, "worksFor"),
    ]
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length > 0) return [...new Set(parts)].join(", ").slice(0, 300);
  }
  return "";
}

/**
 * A JSON-LD field that may be a string, an object with a `name`, or an array of
 * either — the three shapes `affiliation` and `worksFor` actually appear in.
 */
function namedField(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (!value) return "";
  const one = (v: unknown): string => {
    if (typeof v === "string") return v;
    if (v && typeof v === "object" && "name" in v) {
      const name = (v as Record<string, unknown>).name;
      return typeof name === "string" ? name : "";
    }
    return "";
  };
  return (Array.isArray(value) ? value : [value]).map(one).filter(Boolean).join(", ");
}

/**
 * What the publisher is, for the case the user asked about: nobody is bylined,
 * so the card has to stand on the institution instead. Same rule — copied, not
 * inferred.
 */
function jsonLdPublisherQualification(node: Record<string, unknown>): string {
  const pub = node.publisher;
  if (!pub || typeof pub !== "object") return "";
  const obj = pub as Record<string, unknown>;
  return stringField(obj, "description").trim().slice(0, 300);
}

/**
 * Human author name(s) from a JSON-LD node's `author` field. Skips authors
 * explicitly typed as an Organization (sites that name THEMSELVES as author), so
 * the cite gets the person who wrote the piece — not the publisher.
 */
function jsonLdAuthor(node: Record<string, unknown>): string {
  const author = node.author;
  if (!author) return "";
  const names = (Array.isArray(author) ? author : [author])
    .map((a) => {
      if (typeof a === "string") return a;
      if (a && typeof a === "object" && "name" in a) {
        const obj = a as Record<string, unknown>;
        const type = obj["@type"];
        // A person (or untyped) byline is what we want; drop Organization.
        if (typeof type === "string" && /organization/i.test(type)) return "";
        return typeof obj.name === "string" ? obj.name : "";
      }
      return "";
    })
    .filter(Boolean);
  return names.join(", ");
}

/**
 * Strip the OUTLET out of a byline, keeping the human.
 *
 * News bylines routinely carry the publication inline — "Jane Smith, The
 * Guardian", "Jane Smith | Vox", "Maria Lopez - Politico". The old rule blanked
 * the WHOLE byline whenever it merely CONTAINED the publication name (for any
 * outlet of four characters or more), so the cite printed the website instead
 * of the reporter — the exact "it takes the website name instead of the author"
 * bug. That is a big share of major outlets: Guardian, Bloomberg, Politico,
 * Washington Post, Associated Press.
 *
 * Now only the delimited SEGMENT that is the outlet is removed, and a byline
 * that is nothing but the outlet ("Reuters") still resolves to empty so the
 * cite can fall back to the publication. A real name that happens to share a
 * word with the outlet ("Bill Hill" on The Hill) is untouched — the whole
 * string is only dropped on an exact match.
 */
export function cleanAuthor(author: string, publication: string): string {
  const a = author.trim();
  if (!a) return "";
  const pub = publication.trim().toLowerCase();
  if (!pub) return a;
  if (a.toLowerCase() === pub) return "";

  // Split into delimited credits. A comma is included because "Jane Smith, Vox"
  // is an author-then-outlet, and dropping only the outlet segment leaves the
  // real author (and other real authors) intact.
  const parts = a
    .split(/\s*(?:\||\/|•|·|,| [-–—] )\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length <= 1) return a;

  const isOutlet = (segment: string): boolean => {
    const low = segment.toLowerCase();
    // The segment IS the outlet, or is the outlet plus a small amount ("The
    // Guardian" for "Guardian"). A generous length gap would start eating real
    // multi-word names, so keep it tight.
    return low === pub || (pub.length >= 3 && low.includes(pub) && low.length <= pub.length + 6);
  };
  const kept = parts.filter((s) => !isOutlet(s));
  // Nothing matched the outlet → the substring overlap was coincidental; leave
  // the byline exactly as it was for the name parser.
  if (kept.length === parts.length) return a;
  return kept.join(", ");
}

function jsonLdPublisher(node: Record<string, unknown>): string {
  const pub = node.publisher;
  if (pub && typeof pub === "object" && "name" in pub) {
    const name = (pub as Record<string, unknown>).name;
    return typeof name === "string" ? name : "";
  }
  return typeof pub === "string" ? pub : "";
}

function stringField(node: Record<string, unknown>, key: string): string {
  const v = node[key];
  return typeof v === "string" ? v : "";
}

/** Flatten JSON-LD (which may be a single object, an array, or a @graph). */
function parseJsonLd(raw: string): Record<string, unknown>[] {
  if (!raw.trim()) return [];
  const parsed: unknown = JSON.parse(raw);
  const roots = Array.isArray(parsed) ? parsed : [parsed];
  const out: Record<string, unknown>[] = [];
  for (const root of roots) {
    if (root && typeof root === "object") {
      const obj = root as Record<string, unknown>;
      if (Array.isArray(obj["@graph"])) {
        for (const g of obj["@graph"]) {
          if (g && typeof g === "object") out.push(g as Record<string, unknown>);
        }
      } else {
        out.push(obj);
      }
    }
  }
  return out;
}

/** Reduce a date string to YYYY-MM-DD when possible. */
export function normalizeDate(raw: string): string {
  if (!raw) return "";
  const iso = raw.match(/\d{4}-\d{2}-\d{2}/);
  if (iso) return iso[0];
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

// A name token is a capitalized word or an initial ("Jane", "Q."). Tokens are
// separated by spaces/tabs only (not newlines), so a byline can't run past its
// line or grab the next sentence's first word.
const NAME_TOKEN = "(?:[A-Z]\\.|[A-Z][a-z’'\\-]+)";
const NAME_PATTERN = `${NAME_TOKEN}(?:[ \\t]+${NAME_TOKEN}){1,3}`;

/**
 * Last-resort author: scan the start of the article for a visible byline like
 * "By Jane Smith" or "Article written by: Jane Smith".
 */
export function findBylineInText(text: string): string {
  // Bylines sit at the top, but plenty of reports credit their authors in a
  // block at the END ("This article is a collaborative effort by…"), which the
  // old head-only scan could never see — that is how a McKinsey piece ends up
  // with no author and gets cited as the outlet.
  const head = text.slice(0, 1200);
  const tail = text.length > 2000 ? text.slice(-1200) : "";
  const LIST = `${NAME_PATTERN}(?:\\s*(?:,|and|&)\\s*${NAME_PATTERN}){0,5}`;
  const patterns = [
    new RegExp(`collaborative effort by\\s+(${LIST})`, "i"),
    new RegExp(`(?:this (?:article|report|paper) was )?(?:written|prepared|authored) by[:\\s]+(${LIST})`, "i"),
    new RegExp(`(?:^|\\n)\\s*authors?[:\\s]+(${LIST})`, "i"),
    new RegExp(`(?:^|\\n)\\s*[Bb]y[:\\s]+(${LIST})`),
  ];
  for (const source of [head, tail]) {
    if (!source) continue;
    for (const re of patterns) {
      const m = source.match(re);
      // Ignore a "byline" that resolved to nothing but an organisation.
      if (m?.[1] && parseByline(m[1]).authors.length > 0) return m[1].trim();
    }
  }
  return "";
}

/**
 * A visible "Jane Doe is a professor of…" line, when the page publishes no
 * structured bio. Scoped to a sentence that starts with an author we already
 * found, so it can't attach a stranger's credentials to the cite.
 */
export function findAuthorBioInText(text: string, authors: string[]): string {
  if (authors.length === 0) return "";
  const first = authors[0];
  const escaped = first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Two shapes carry essentially every stated credential:
  //   predicative — "Jane Smith is a professor of economics at Yale."
  //   appositive  — "Jane Smith, a senior fellow at Brookings, argues that ..."
  // Only the first was scanned, which is most of why cards came back with no
  // qualification at all: the appositive is the form journalism actually uses.
  const patterns = [
    new RegExp(`${escaped}\\s+(?:is|was|serves as|works as|teaches)\\s+([^.\\n]{10,220})`, "i"),
    new RegExp(
      `${escaped}\\s*,\\s*((?:an?|the)?\\s*[^,.\\n]{10,160}?(?:\\bat\\b|\\bof\\b|\\bfor\\b)[^,.\\n]{2,120})\\s*,`,
      "i",
    ),
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m?.[1]) continue;
    const found = m[1].trim().replace(/\s+/g, " ");
    // A credential names a ROLE. Without one this is just the next clause of a
    // sentence that happens to begin with the author's name — "Jane Smith, at
    // the height of the crisis, said ..." is not a qualification.
    if (
      /\b(professor|fellow|director|researcher|scientist|economist|analyst|lecturer|chair|dean|president|editor|expert|specialist|adviser|advisor|counsel|historian|philosopher|physician|engineer|author of)\b/i.test(
        found,
      )
    ) {
      return found;
    }
  }
  return "";
}

/**
 * Build paragraph-structured text from Readability's cleaned article HTML.
 * textContent alone loses paragraph breaks, which breaks card-length
 * selection — real <p>/<h*>/<li> boundaries become blank-line separators.
 */
function htmlToParagraphText(contentHtml: string, fallbackText: string): string {
  try {
    const { document } = parseHTML(contentHtml);
    const blocks = document.querySelectorAll(
      "p, h1, h2, h3, h4, h5, h6, li, blockquote, figcaption",
    );
    const paragraphs = [...blocks]
      .map((el) => el.textContent?.replace(/\s+/g, " ").trim() ?? "")
      .filter((p) => p.length > 0);
    if (paragraphs.join("").length >= fallbackText.trim().length * 0.5) {
      return paragraphs.join("\n\n");
    }
  } catch {
    // fall through to textContent
  }
  return fallbackText.replace(/\n{3,}/g, "\n\n").trim();
}
