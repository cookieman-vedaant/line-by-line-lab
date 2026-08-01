import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { hasPaywallPhrase, hasStructuredPaywallSignal } from "@/lib/paywall";
import { createSharedCache } from "@/lib/sharedCache";
import { BlockedUrlError, safeFetch } from "@/lib/ssrfGuard";

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
  date: string;
  text: string;
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
export async function extractArticleFromUrl(
  url: string,
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<ExtractedArticle> {
  let html: string;
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
    html = await res.text();
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
  const author = cleanAuthor(
    meta.author || parsed.byline || findBylineInText(text) || "",
    publication,
  );

  return {
    title: meta.title || parsed.title || "",
    author,
    publication,
    date: meta.date || parsed.publishedTime?.slice(0, 10) || "",
    text,
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
}

/**
 * Extract author/date/publication from a page's <meta> tags and JSON-LD.
 * Fully defensive — never throws; a missing field just stays empty.
 */
export function extractPageMetadata(doc: Document): PageMetadata {
  const meta: PageMetadata = { title: "", author: "", publication: "", date: "" };

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

  // JSON-LD fills any gaps (author, date, publisher).
  try {
    const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      const jsonLd = parseJsonLd(script.textContent ?? "");
      for (const node of jsonLd) {
        if (!meta.author) meta.author = jsonLdAuthor(node);
        if (!meta.date) meta.date = normalizeDate(stringField(node, "datePublished"));
        if (!meta.publication) meta.publication = jsonLdPublisher(node);
      }
    }
  } catch {
    // ignore malformed JSON-LD
  }

  return meta;
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
 * Drop an "author" that is really the website/publisher rather than a person, so
 * the cite falls back to a real byline or the publication instead of printing the
 * site name as the author (e.g. author "Reuters" on a Reuters page). Blanks the
 * author when it equals, or clearly contains, the publication name.
 */
export function cleanAuthor(author: string, publication: string): string {
  const a = author.trim();
  if (!a) return "";
  const pub = publication.trim().toLowerCase();
  const low = a.toLowerCase();
  if (pub && (low === pub || (pub.length >= 4 && low.includes(pub)))) return "";
  return a;
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
  const head = text.slice(0, 600);
  const patterns = [
    new RegExp(`(?:article\\s+)?[Ww]ritten [Bb]y[:\\s]+(${NAME_PATTERN})`),
    new RegExp(`(?:^|\\n)\\s*[Bb]y[:\\s]+(${NAME_PATTERN})`),
  ];
  for (const re of patterns) {
    const m = head.match(re);
    if (m?.[1]) return m[1].trim();
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
