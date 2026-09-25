import { Readability } from "@mozilla/readability";
import { DOMParser, parseHTML } from "linkedom";
import { mostRecentDate, parseByline, soleName } from "@/lib/cite";
import { createLimiter } from "@/lib/concurrency";
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
  const parsed = parseByline(fields.author ?? "");
  // A name the debater typed is a person even when it is one word.
  const sole = parsed.authors.length === 0 ? soleName(fields.author ?? "", [fields.publication ?? ""]) : "";
  const { authors, etAl } = sole ? { authors: [sole], etAl: parsed.etAl } : parsed;
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

/**
 * WHY a page couldn't be read. The Article Finder uses it to stop hammering a
 * host that is refusing us (a 403 from one ScienceDirect link means the next one
 * will 403 too) without giving up on hosts that merely had one bad page.
 */
export type UnreadableReason =
  | "blocked" // 401/403/429/451 — the host refuses automated readers
  | "paywall" // readable, but only a teaser or abstract is free
  | "not_found" // 404/410
  | "http_error" // any other non-2xx
  | "blocked_url" // SSRF guard: private/internal address
  | "timeout" // timeout or network failure
  | "too_large"
  | "no_text"; // nothing extractable (JS-only page, scanned PDF)

/** Honest failure — the article couldn't be fetched or parsed. */
export class ArticleUnreadableError extends Error {
  readonly reason?: UnreadableReason;
  constructor(detail?: string, reason?: UnreadableReason) {
    super(
      detail ??
        "This article couldn't be read (it may be paywalled or blocked). Try pasting the article text instead.",
    );
    this.name = "ArticleUnreadableError";
    this.reason = reason;
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

/**
 * Prose a text must carry — NOT counting the abstract, a reference list or page
 * furniture — to count as full text. Well above a typical abstract (~1,000–1,800
 * chars), so an abstract-only landing page is never treated as the article.
 */
export const MIN_FULL_TEXT_CHARS = 2200;

/** What a piece of article text actually is, judged from its content. */
export type TextKind = "full_text" | "abstract_only";

// A paragraph shorter than this is a heading, nav item, caption or button.
const MIN_PROSE_WORDS = 12;
// A citation entry is short. Real prose paragraphs that cite heavily are longer.
const REFERENCE_MAX_WORDS = 60;
const REFERENCE_SIGNALS: readonly RegExp[] = [
  /\b(1[89]|20)\d{2}[a-z]?\b/, // a year
  /\bet al\b/i,
  /\bdoi\b|https?:\/\//i,
  /\b\d+\s*\(\d+\)/, // volume(issue)
  /\b\d+\s*[-–]\s*\d+\b/, // page range
  /\b(?:pp?|vol|no)\.\s*\d/i,
];
// Word n-gram size and share of a paragraph's n-grams found in the abstract for
// the paragraph to count as "the abstract again".
const SHINGLE_WORDS = 6;
const ABSTRACT_OVERLAP = 0.5;

function normalizeWords(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
}

function shingles(s: string): Set<string> {
  const words = normalizeWords(s);
  const out = new Set<string>();
  for (let i = 0; i + SHINGLE_WORDS <= words.length; i++) {
    out.add(words.slice(i, i + SHINGLE_WORDS).join(" "));
  }
  return out;
}

// Citation marks, counted: years, "et al", DOIs/links, volume(issue), page ranges.
const CITATION_MARKS =
  /\b(?:1[89]|20)\d{2}[a-z]?\b|\bet al\b|\bdoi\b|https?:\/\/|\b\d+\s*\(\d+\)|\b\d+\s*[-–]\s*\d+\b/gi;
// Citation marks per 100 characters above which a long block is a reference
// list run together rather than prose. Prose that cites heavily — "(Smith et
// al., 2019; Jones, 2021, pp. 44-46)" every few sentences — stays well under.
const REFERENCE_MARK_DENSITY = 1;

function looksLikeReference(paragraph: string, words: number): boolean {
  if (words < REFERENCE_MAX_WORDS) {
    return REFERENCE_SIGNALS.filter((re) => re.test(paragraph)).length >= 3;
  }
  // A page without paragraph markup can arrive as ONE block: the abstract and
  // the entire reference list run together. Judge a long block by density.
  const marks = paragraph.match(CITATION_MARKS)?.length ?? 0;
  return marks / (paragraph.length / 100) >= REFERENCE_MARK_DENSITY;
}

/**
 * The text as paragraphs, whatever its line breaks. Blank-line-separated blocks
 * (what HTML and PDF extraction produce) are paragraphs. Text with only single
 * line breaks may be hard-wrapped — pasted from a PDF — so it is reflowed the
 * way PDF text is, or every wrapped line would count as a too-short
 * "paragraph" and a whole pasted article would read as a snippet.
 */
function proseBlocks(text: string): string[] {
  const body = text.replace(/\r/g, "").trim();
  const blocks = /\n[ \t]*\n/.test(body) ? body.split(/\n[ \t]*\n/) : pdfToParagraphs(body).split("\n\n");
  return blocks.map((b) => b.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
}

/**
 * Characters of real prose: paragraphs long enough to be writing, that aren't
 * citation entries, and (when `callerAbstract` is given) aren't that abstract
 * repeated. Stops counting once it passes `stopAt`.
 */
function proseChars(text: string, callerAbstract?: string, stopAt = Infinity): number {
  const abstractShingles =
    callerAbstract && callerAbstract.trim().length >= 200 ? shingles(callerAbstract) : null;
  let total = 0;
  for (const paragraph of proseBlocks(text)) {
    const words = paragraph.split(/\s+/).filter(Boolean).length;
    if (words < MIN_PROSE_WORDS || looksLikeReference(paragraph, words)) continue;
    if (abstractShingles) {
      const own = shingles(paragraph);
      let shared = 0;
      for (const sh of own) if (abstractShingles.has(sh)) shared++;
      if (own.size > 0 && shared / own.size >= ABSTRACT_OVERLAP) continue;
    }
    total += paragraph.length;
    if (total >= stopAt) break;
  }
  return total;
}

/**
 * Is this text mostly the caller's abstract? Distinguishes an abstract-only
 * landing page from a short but complete page (a news brief): both fall short
 * of full text, but only one of them is "just the abstract".
 */
export function isMostlyAbstract(text: string, callerAbstract: string | undefined): boolean {
  if (!callerAbstract || callerAbstract.trim().length < 200) return false;
  const all = proseChars(text);
  return all === 0 || proseChars(text, callerAbstract) < all / 2;
}

/**
 * Is this the article, or only its abstract?
 *
 * "Full text" used to mean "the fetch worked and came back long enough". A
 * publisher landing page showing the abstract — often followed by the entire
 * reference list — cleared that bar, and a card cut from it is the thin,
 * power-tagged card users reported: the cutter thought it had the article.
 *
 * So count only PROSE: paragraphs long enough to be writing, that aren't
 * citation entries, and that aren't the caller's abstract repeated. Headings,
 * nav, buttons and references don't count toward the bar.
 */
export function classifyText(text: string, callerAbstract?: string): TextKind {
  if (text.trim().length < MIN_FULL_TEXT_CHARS) return "abstract_only";
  return proseChars(text, callerAbstract, MIN_FULL_TEXT_CHARS) >= MIN_FULL_TEXT_CHARS
    ? "full_text"
    : "abstract_only";
}

/**
 * Fetch a URL and extract clean article text with Mozilla Readability —
 * the same engine behind Firefox Reader Mode. Free, runs on our server.
 */
/** Largest PDF we'll pull fully into memory to extract. Beyond this, reject. */
const MAX_PDF_BYTES = 25 * 1024 * 1024;

/** How an extraction should behave beyond the defaults a cut uses. */
export interface ExtractOptions {
  /** Abort early — a caller-wide deadline. */
  signal?: AbortSignal;
  /** Largest body to download at all, in bytes. Defaults to MAX_PDF_BYTES. */
  maxBytes?: number;
  /**
   * Read only the first N pages of a PDF. For a quick "is this real full text?"
   * check, never for a cut — the result is deliberately incomplete, so it must
   * never be cached as the article.
   */
  pdfMaxPages?: number;
}

/**
 * pdf.js parses on the main thread and peaks at several times the file's size
 * in memory. Unbounded, a search checking a dozen PDFs at once stalls every
 * other request on the instance — so at most two parse at a time.
 */
const pdfParseSlot = createLimiter(2);

const tooLarge = () =>
  new ArticleUnreadableError(
    "That document is too large to read here. Download it and paste the text instead.",
    "too_large",
  );

/**
 * Read a response body, refusing to hold more than `maxBytes`. The old
 * `arrayBuffer()` read the ENTIRE body into memory before the size check ran,
 * so the 25 MB cap only applied after a much bigger file had already landed.
 */
async function readBodyCapped(res: Response, maxBytes: number): Promise<ArrayBuffer> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    void res.body?.cancel().catch(() => {});
    throw tooLarge();
  }
  if (!res.body) return new ArrayBuffer(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      void reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}

/** Map an HTTP failure status to the reason the Article Finder acts on. */
function reasonForStatus(status: number): UnreadableReason {
  if (status === 401 || status === 403 || status === 429 || status === 451) return "blocked";
  if (status === 404 || status === 410) return "not_found";
  return "http_error";
}

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
async function articleFromPdf(
  bytes: Uint8Array,
  url: string,
  maxPages?: number,
): Promise<ExtractedArticle> {
  if (bytes.byteLength > MAX_PDF_BYTES) throw tooLarge();
  const { extractText, getDocumentProxy } = await import("unpdf");
  let raw: string;
  try {
    raw = await pdfParseSlot(async () => {
      const pdf = await getDocumentProxy(bytes);
      if (maxPages && pdf.numPages > maxPages) {
        // Just enough pages to tell an article from an abstract, without paying
        // to parse a 60-page report during a search.
        // Built exactly as unpdf's extractText builds a page (a line break only
        // where pdf.js marks one), so pdfToParagraphs reflows it the same way
        // it reflows a full cut — otherwise every text run became a line and
        // real PDFs were undercounted as abstract-only.
        const pages: string[] = [];
        for (let n = 1; n <= maxPages; n++) {
          const content = await (await pdf.getPage(n)).getTextContent();
          pages.push(
            content.items
              .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : "") : ""))
              .join(""),
          );
        }
        return pages.join("\n");
      }
      const result = await extractText(pdf, { mergePages: true });
      return Array.isArray(result.text) ? result.text.join("\n\n") : result.text;
    });
  } catch {
    throw new ArticleUnreadableError(
      "That PDF couldn't be read — it may be scanned images or corrupted. Paste the text instead.",
      "no_text",
    );
  }
  const text = pdfToParagraphs(raw ?? "");
  if (text.trim().length < MIN_ARTICLE_CHARS) {
    throw new ArticleUnreadableError(
      "That PDF had no extractable text (it may be scanned images). Paste the text instead.",
      "no_text",
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

/** A PubMed Central article's numeric id, from any of its link forms, or null. */
export function pmcIdFromUrl(url: string): string | null {
  const m =
    /^https?:\/\/(?:www\.)?(?:ncbi\.nlm\.nih\.gov\/pmc\/articles|pmc\.ncbi\.nlm\.nih\.gov\/articles|europepmc\.org\/(?:article\/PMC|articles))\/(?:PMC)?(\d+)/i.exec(
      url,
    );
  return m ? m[1] : null;
}

/** "H. LUKE SHAEFER" → "H. Luke Shaefer"; names already in mixed case are left alone. */
const unshout = (name: string) =>
  name === name.toUpperCase() ? name.toLowerCase().replace(/(^|[\s.'-])([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase()) : name;

/**
 * An article from Europe PMC's JATS full-text XML: the abstract and body
 * prose (never figure captions, tables or the reference list), plus the
 * metadata the XML states. Pure; null when there is no real text.
 */
export function articleFromJats(xml: string, pmcId: string): ExtractedArticle | null {
  const doc = new DOMParser().parseFromString(xml, "text/xml") as unknown as Document;
  const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  const paragraphs = [
    ...doc.querySelectorAll("abstract p"),
    ...[...doc.querySelectorAll("body p")].filter((p) => !p.closest("fig, table-wrap, fn-group, ref-list")),
  ]
    .map(text)
    .filter(Boolean);
  const body = paragraphs.join("\n\n");
  if (body.length < MIN_ARTICLE_CHARS) return null;

  // Authors are marked per person, or once on the whole group (PNAS, PMC8812534).
  const authors = [
    ...doc.querySelectorAll(
      'contrib[contrib-type="author"], contrib-group[content-type="author"] > contrib:not([contrib-type])',
    ),
  ]
    .map((c) => unshout([text(c.querySelector("given-names")), text(c.querySelector("surname"))].filter(Boolean).join(" ")))
    .filter(Boolean);
  // The electronic publication date when stated (the version a debater reads),
  // else the first one. A day-less date stays a year — never an invented day.
  const dates = [...doc.querySelectorAll("article-meta pub-date")];
  const pub =
    dates.find((d) => /epub/i.test(`${d.getAttribute("pub-type")} ${d.getAttribute("date-type")}`)) ?? dates[0];
  const [y, m, d] = ["year", "month", "day"].map((f) => text(pub?.querySelector(f)));
  const date = y && m && d ? `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}` : y;

  return {
    title: text(doc.querySelector("article-meta article-title")),
    author: authors.join(", "),
    etAl: false,
    publication: text(doc.querySelector("journal-title")),
    date,
    text: body,
    authors,
    authorQualification: "",
    publisherQualification: "",
    canonicalUrl: `https://pmc.ncbi.nlm.nih.gov/articles/PMC${pmcId}/`,
  };
}

// Europe PMC's official full-text API. NCBI asks automated readers to use its
// APIs rather than the website — which now answers servers with a reCAPTCHA.
const EUROPE_PMC_FULLTEXT = "https://www.ebi.ac.uk/europepmc/webservices/rest";
const EUROPE_PMC_TIMEOUT_MS = 8000;

/**
 * A PubMed Central article through Europe PMC, or null to fall through to the
 * ordinary fetch. Only the open-access subset is served this way; for the rest
 * the API answers "not found", and the article stays abstract-only — correctly.
 */
async function articleFromEuropePmc(
  pmcId: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<ExtractedArticle | null> {
  try {
    const res = await safeFetch(`${EUROPE_PMC_FULLTEXT}/PMC${pmcId}/fullTextXML`, {
      headers: { Accept: "application/xml" },
      timeoutMs: Math.min(timeoutMs, EUROPE_PMC_TIMEOUT_MS),
      signal,
    });
    if (!res.ok) {
      void res.body?.cancel().catch(() => {});
      return null;
    }
    const xml = decodeHtml(await readBodyCapped(res, MAX_PDF_BYTES), "charset=utf-8");
    return articleFromJats(xml, pmcId);
  } catch {
    return null;
  }
}

export async function extractArticleFromUrl(
  url: string,
  timeoutMs: number = FETCH_TIMEOUT_MS,
  opts: ExtractOptions = {},
): Promise<ExtractedArticle> {
  const pmcId = pmcIdFromUrl(url);
  if (pmcId) {
    const viaApi = await articleFromEuropePmc(pmcId, timeoutMs, opts.signal);
    if (viaApi) return viaApi;
  }
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
      signal: opts.signal,
    });
    if (!res.ok) {
      void res.body?.cancel().catch(() => {});
      throw new ArticleUnreadableError(
        `The site responded with error ${res.status}. It may be paywalled or blocking readers — try pasting the article text instead.`,
        reasonForStatus(res.status),
      );
    }
    // Read the raw bytes ONCE, then decide what they are. A URL that serves a
    // PDF (arXiv, NBER, gov reports — prime debate evidence) was being decoded
    // as text, which put the PDF's binary streams straight into the card body.
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    const buffer = await readBodyCapped(res, opts.maxBytes ?? MAX_PDF_BYTES);
    if (isPdfResponse(contentType, url, buffer)) {
      return await articleFromPdf(new Uint8Array(buffer), url, opts.pdfMaxPages);
    }
    html = decodeHtml(buffer, contentType);
  } catch (err) {
    if (err instanceof ArticleUnreadableError) throw err;
    if (err instanceof BlockedUrlError) {
      throw new ArticleUnreadableError(
        "That URL can't be fetched (it points to a private or blocked address). Paste the article text instead.",
        "blocked_url",
      );
    }
    throw new ArticleUnreadableError(
      "The article couldn't be fetched (timeout or network error). Try pasting the article text instead.",
      "timeout",
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
      "no_text",
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
      "paywall",
    );
  }

  const text = htmlToParagraphText(parsed.content ?? "", parsed.textContent);

  const publication =
    meta.publication || parsed.siteName || new URL(url).hostname.replace(/^www\./, "");
  const { raw: rawAuthor, authors, etAl } = resolvePageAuthors({
    structured: meta.author,
    byline: parsed.byline ?? "",
    text,
    publication,
    url,
    profiles: meta.profileAuthors,
  });

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
 * The people who wrote a page, most trustworthy source first:
 *   1. the page's declared author (author tags, JSON-LD) — including a ONE-WORD
 *      name, which counts only here (see soleName): Medium credits writers by
 *      display name alone;
 *   2. Readability's byline, then a visible "By …" line in the text;
 *   3. bylines given only as links to the authors' profile pages
 *      (profileLinkAuthors) — last, so a page that already resolved keeps
 *      exactly the author it had.
 * Each step drops a "byline" that is really the site's name, and an
 * organisation resolves to nobody — "no human wrote this" is not the same as
 * "the outlet is the author". A declared author that names nobody ("Anonymous",
 * the institution) no longer stops the search: the page may still name people.
 */
export function resolvePageAuthors(input: {
  structured: string;
  byline: string;
  text: string;
  publication: string;
  url: string;
  profiles?: string[];
}): { raw: string; authors: string[]; etAl: boolean } {
  const found = findPageAuthors(input);
  // "IWAO HIROSE" → "Iwao Hirose": some journals print bylines in capitals.
  return { ...found, authors: found.authors.map(unshout) };
}

function findPageAuthors(input: Parameters<typeof resolvePageAuthors>[0]): {
  raw: string;
  authors: string[];
  etAl: boolean;
} {
  const declared = cleanAuthor(input.structured, input.publication);
  const fromDeclared = parseByline(declared);
  if (fromDeclared.authors.length > 0) return { raw: declared, ...fromDeclared };
  const sole = declared ? soleName(declared, [input.publication, hostnameOf(input.url)]) : "";
  if (sole) return { raw: declared, authors: [sole], etAl: fromDeclared.etAl };

  const guessed = cleanAuthor(input.byline || findBylineInText(input.text) || "", input.publication);
  const fromGuess = parseByline(guessed);
  if (fromGuess.authors.length > 0) return { raw: guessed, ...fromGuess };

  const profiles = input.profiles ?? [];
  if (profiles.length > 0) return { raw: profiles.join(", "), authors: profiles, etAl: false };
  return { raw: declared || guessed, authors: [], etAl: fromDeclared.etAl || fromGuess.etAl };
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Extracted-article cache. An article's readable text is public and stable, so a
 * recent extraction is reused instead of downloading and re-parsing the same URL
 * — a cut followed by a re-highlight of the same source, or a re-cut at another
 * length.
 *
 * It is IN-PROCESS only (see below), so it does not carry the Article Finder's
 * checks over to a later cut in production: on Vercel the search and cut routes
 * are separate functions that never share memory. The finder's check therefore
 * doesn't use this cache at all (see verifyAccessible), and a cut plans on a
 * fresh download.
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

// The Article Finder's per-URL check: one total budget across redirects, and
// only the opening pages of a PDF. The download cap matches the cut's — a
// smaller one meant a readable 10-25 MB PDF could never be shown as full text.
const VERIFY_TIMEOUT_MS = 6500;
const VERIFY_MAX_BYTES = MAX_PDF_BYTES;
const VERIFY_PDF_PAGES = 4;

/** Outcome of checking one URL for readable full text. */
export interface AccessCheck {
  ok: boolean;
  chars: number;
  /** "ok", "abstract_only" when the page read but held only the abstract, else why it failed. */
  reason: "ok" | "abstract_only" | UnreadableReason | "error";
}

/**
 * Quick, quiet check that a URL is actually readable full text a debater could
 * cut from — used by the Article Finder to only show full-text sources. Never
 * throws: a failure just means "not full text", with the reason attached so the
 * finder can stop retrying a host that is refusing it.
 *
 * `abstract` is the database's abstract for this work, so a landing page that
 * merely repeats it is recognized as abstract-only (see classifyText).
 *
 * Deliberately NOT cached: a PDF is only read to its first pages here, which is
 * enough to tell an article from an abstract but is not the article.
 */
export async function verifyAccessible(
  url: string,
  opts: { timeoutMs?: number; signal?: AbortSignal; abstract?: string } = {},
): Promise<AccessCheck> {
  try {
    const article = await extractArticleFromUrl(url, opts.timeoutMs ?? VERIFY_TIMEOUT_MS, {
      signal: opts.signal,
      maxBytes: VERIFY_MAX_BYTES,
      pdfMaxPages: VERIFY_PDF_PAGES,
    });
    const chars = article.text.trim().length;
    return classifyText(article.text, opts.abstract) === "full_text"
      ? { ok: true, chars, reason: "ok" }
      : { ok: false, chars, reason: "abstract_only" };
  } catch (err) {
    const reason = err instanceof ArticleUnreadableError && err.reason ? err.reason : "error";
    return { ok: false, chars: 0, reason };
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
  /** Bylines given only as links to the authors' profile pages (profileLinkAuthors). */
  profileAuthors: string[];
}

// The address of a person's profile page: brookings.edu/people/steven-pifer,
// aier.org/people/peter-c-earle, nytimes.com/by/jane-doe.
const PROFILE_PATH =
  /\/(?:people|person|experts?|authors?|staff|scholars?|profiles?|contributors?|by|bios?|fellows?)\/([a-z0-9%-]+)\/?$/i;
// More profile links than this above an article is a staff listing, not a byline.
const MAX_PROFILE_AUTHORS = 6;
// The first paragraph at least this long is where the article starts.
const BODY_PARAGRAPH_CHARS = 200;

const nameLetters = (s: string): string => s.normalize("NFD").toLowerCase().replace(/[^a-z]/g, "");

/**
 * The name a link's text starts with, if it is the person the link's address
 * names ("/people/michael-e-ohanlon" ↔ "Michael E. O’Hanlon"). Anything else —
 * "Read more", "Experts", a photo caption — is not a byline.
 */
function nameMatchingSlug(text: string, slug: string): string {
  const want = nameLetters(slug.replace(/-\d+$/, ""));
  const t = text.replace(/\s+/g, " ").trim();
  if (want.length < 4 || !nameLetters(t).startsWith(want)) return "";
  let seen = 0;
  let end = 0;
  while (end < t.length && seen < want.length) {
    if (nameLetters(t[end])) seen++;
    end++;
  }
  return t.slice(0, end).trim();
}

// Containers that hold OTHER people's profile links: menus, sidebars, footers,
// "related experts" and promo boxes.
const NOT_BYLINE_TAGS = new Set(["nav", "aside", "footer"]);
const NOT_BYLINE_CLASS = /related|sidebar|menu|\bnav|footer|widget|promo|recommend|trending|popular|newsletter/i;

function insideNonByline(el: Element): boolean {
  // Stops below <body>: a page-wide class ("has-sidebar") says nothing about one link.
  for (let node = el.parentElement; node && node.tagName.toLowerCase() !== "body"; node = node.parentElement) {
    if (NOT_BYLINE_TAGS.has(node.tagName.toLowerCase())) return true;
    const role = node.getAttribute("role") ?? "";
    if (role === "navigation" || role === "complementary") return true;
    if (NOT_BYLINE_CLASS.test(`${node.getAttribute("class") ?? ""} ${node.id}`)) return true;
  }
  return false;
}

/**
 * Bylines a page gives only as links to its authors' profile pages. Think tanks
 * do this: brookings.edu states its four authors nowhere else, and aier.org's
 * author tag says "Anonymous" while the page links Peter C. Earle — both cards
 * cited the outlet.
 *
 * Deliberately narrow, because a wrong author is worse than the outlet. Only
 * links where a byline sits: between the article's title and its first real
 * paragraph, or beside the title in the title's own header (aier.org credits
 * the author above the title). Never a link below the text (author cards,
 * contacts, related articles — which can't be told apart), above the title's
 * header (menus, featured experts), or inside a menu, sidebar, footer or
 * "related" box. Only when the link's text is the person its address names, and
 * nothing when there are more people than a byline holds.
 */
export function profileLinkAuthors(doc: Document): string[] {
  const title = doc.querySelector("h1");
  const body = [...doc.querySelectorAll("p")].find(
    (p) => (p.textContent ?? "").trim().length >= BODY_PARAGRAPH_CHARS,
  );
  if (!title || !body) return [];
  // The title's header: its largest container that stops short of the text.
  // A sidebar never shares it — the layout that holds both also holds the text.
  let header: Element = title;
  while (header.parentElement && !header.parentElement.contains(body)) header = header.parentElement;

  const names = new Map<string, string>();
  let pastTitle = false;
  // Document order; a link inside the body paragraph comes after it.
  for (const el of doc.querySelectorAll("h1, a[href], p")) {
    if (el === body) break;
    if (el === title) {
      pastTitle = true;
      continue;
    }
    if (el.tagName.toLowerCase() !== "a") continue;
    if (!pastTitle && !header.contains(el)) continue;
    if (insideNonByline(el)) continue;
    let slug: string;
    try {
      const m = new URL(el.getAttribute("href") ?? "", "https://x.invalid").pathname.match(PROFILE_PATH);
      if (!m) continue;
      slug = decodeURIComponent(m[1]);
    } catch {
      continue;
    }
    const name = nameMatchingSlug(el.textContent ?? "", slug);
    const person = name ? parseByline(name).authors[0] : undefined;
    if (person && !names.has(slug)) names.set(slug, person);
  }
  if (names.size > MAX_PROFILE_AUTHORS) return [];
  return [...names.values()];
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
    profileAuthors: [],
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
  // citation_author is the scholarly standard (journals, repositories, csis.org):
  // one tag per person, in byline order, often "Surname, Given". Semicolons keep
  // those commas from splitting one person in two (see parseByline).
  const citationAuthors = [...doc.querySelectorAll('meta[name="citation_author"]')]
    .map((m) => m.getAttribute("content")?.trim() ?? "")
    .filter(Boolean);
  meta.author =
    citationAuthors.join("; ") ||
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

  try {
    meta.profileAuthors = profileLinkAuthors(doc);
  } catch {
    // a byline we can't read is just a byline we don't use
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
