import { z } from "zod";

/** One run of snippet text; `match` marks the part the search engine highlighted. */
export interface SnippetSegment {
  text: string;
  match: boolean;
}

/**
 * Client for the opencaselist API (https://api.opencaselist.com/v1).
 *
 * Knows nothing about debate or about our UI — it speaks HTTP to one upstream
 * and returns validated data. `services/wikiMining.ts` holds the product logic.
 *
 * IMPORTANT: their published OpenAPI spec at /v1/docs is STALE. In particular
 * the documented `SearchResult` schema ({id, shard, content, path}) is wrong —
 * see the notes on `search()` below. Everything here was derived from the open
 * source at github.com/ashtarcommunications/caselist (server/v1/controllers/).
 */

const BASE_URL = process.env.CASELIST_API_URL ?? "https://api.opencaselist.com/v1";

/**
 * We identify ourselves rather than impersonating a browser. This is a
 * sanctioned per-user client, so there is nothing to hide, and it lets the
 * maintainers see who we are (and contact us) if we ever cause trouble.
 */
const USER_AGENT = "LineByLineLab/1.0 (+https://line-by-line-lab.vercel.app)";

const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Their limits, from the controllers. We mirror them so we can fail fast with a
 * useful message instead of spending the user's real quota to discover it.
 *   /search   4/minute   (getSearch.js searchLimiter)
 *   /download 10/minute  (getDownload.js downloadLimiter)
 *   /login    20/minute  (postLogin.js loginLimiter)
 */
export const CASELIST_SEARCHES_PER_MINUTE = 4;
export const CASELIST_DOWNLOADS_PER_MINUTE = 10;

/**
 * Prep files are big. This bounds what we'll pull into memory to parse — a
 * disclosed 1AC is well under this, and anything larger is almost certainly a
 * whole-season backfile that would be a bad download and a worse parse.
 */
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** No usable session — not connected, expired, or upstream rejected the token. */
export class CaselistAuthRequiredError extends Error {
  constructor(message = "Connect your Tabroom account to search the wiki.") {
    super(message);
    this.name = "CaselistAuthRequiredError";
  }
}

/** Upstream (or our mirror of it) says slow down. */
export class CaselistRateLimitedError extends Error {
  readonly retryAfterSeconds: number;
  constructor(message: string, retryAfterSeconds = 60) {
    super(message);
    this.name = "CaselistRateLimitedError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** The query itself was rejected (should be unreachable after sanitizeQuery). */
export class CaselistInvalidQueryError extends Error {
  constructor(message = "That search couldn't be run. Try rewording it.") {
    super(message);
    this.name = "CaselistInvalidQueryError";
  }
}

/** Upstream is down, unreachable, or returned something unusable. */
export class CaselistUnavailableError extends Error {
  constructor(message = "opencaselist isn't responding right now. Try again in a moment.") {
    super(message);
    this.name = "CaselistUnavailableError";
  }
}

// ---------------------------------------------------------------------------
// Query sanitization
// ---------------------------------------------------------------------------

/**
 * Make a user's natural-language claim safe to send as `q`.
 *
 * TWO separate hazards, and stripping only the first is a bug we would hit
 * immediately:
 *
 *  1. The controller HARD-REJECTS the query with a 400 when it matches
 *     /[|~^;?!&%$*+=]/. Ordinary English contains `?` and `!` constantly, so an
 *     unsanitized claim like "does warming cause extinction?" never runs.
 *
 *  2. Solr's own syntax characters — ( ) { } [ ] " : \ / and a leading - —
 *     aren't rejected upstream, but they can make the Solr parse fail. Their
 *     controller swallows that in a try/catch and returns an EMPTY doc list, so
 *     the failure is silent: the user sees "no results" for a query that was
 *     merely malformed.
 *
 *  3. Hyphens and underscores are how disclosed FILES are named — "1AC---Dharma",
 *     "Aff_Case_Neg". Left in place they are actively harmful, because Solr's
 *     standard parser reads a `-` before a term as NOT: `1ac---dharma` can parse
 *     as "1ac, but NOT dharma" — the exact opposite of what was asked. Solr's
 *     tokenizer splits on them at index time anyway, so joining is worth
 *     nothing and risks inverting the query.
 *
 * So the rule is an allowlist, not a denylist: keep letters, digits, whitespace
 * and apostrophes; every other character — hyphens and underscores included —
 * becomes a space.
 */
export function sanitizeQuery(raw: string, maxChars = 300): string {
  return raw
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars)
    .trim();
}

/**
 * Solr wildcard meaning "any shard" — i.e. search the ENTIRE wiki.
 *
 * Their route marks `shard` required, so it cannot simply be omitted (verified
 * live: a shard-less search is rejected). But the value lands in a Solr filter
 * query — `fq=shard:${shard}` — and `shard:*` matches every indexed document,
 * which is exactly the all-caselists/all-years search this product needs.
 *
 * This is a standard Solr idiom in a filter field, not a restructured query: we
 * pass one character, reach only documents this user could already reach by
 * searching each caselist in turn, and do it in ONE request instead of ~80 —
 * strictly less load upstream, and it still costs one of the four searches a
 * minute like any other.
 */
export const ALL_SHARDS = "*";

/** One caselist slug, e.g. `hsld26`. The only shape user data may ever take. */
const SLUG = /^[a-z0-9]{1,40}$/i;

/**
 * A filter naming EVERY caselist explicitly: `hsld26 OR shard:hsld25 OR …`.
 *
 * Upstream builds `fq=shard:${shard}`, so this expands to a plain Solr boolean
 * filter across all shards — one request covering the whole wiki, instead of
 * ~80 requests at 4 a minute.
 *
 * Every slug is validated individually against {@link SLUG} and the joining
 * syntax is ours, so no caselist name — however odd — can change the filter's
 * structure. Data stays data.
 */
export function buildShardFilter(slugs: string[]): string {
  const safe = [...new Set(slugs.filter((s) => SLUG.test(s)))];
  return safe.join(" OR shard:");
}

/**
 * Shapes the `shard` parameter is allowed to take:
 *   `hsld26`                       one caselist
 *   `*`                            Solr wildcard — every document
 *   `a OR shard:b OR shard:c`      an explicit list, built by buildShardFilter
 *
 * Anything else is rejected. This matters because upstream interpolates the
 * value into `fq=shard:${shard}` WITHOUT encoding, so an unvalidated value
 * could restructure their filter. Only these three forms get through, and only
 * the first can originate from user input.
 */
export function isValidShard(shard: string): boolean {
  if (shard === ALL_SHARDS) return true;
  if (SLUG.test(shard)) return true;
  return /^[a-z0-9]{1,40}( OR shard:[a-z0-9]{1,40})+$/i.test(shard);
}

// ---------------------------------------------------------------------------
// Snippet handling
// ---------------------------------------------------------------------------

/**
 * Turn a Solr highlight snippet into plain-text segments.
 *
 * This is an XSS boundary. Solr inserts real `<b>` tags into text extracted from
 * USER-UPLOADED documents, and it does not escape that text — so the snippet is
 * trusted markup mixed with untrusted content. Rendering it as HTML would be a
 * hole; escaping the whole string would show literal `<b>` tags.
 *
 * Splitting on the tag tokens and returning segments lets React render each one
 * as text with its normal escaping, and the emphasis becomes a real element. No
 * `dangerouslySetInnerHTML` anywhere.
 *
 * A document that literally contains the characters `<b>` will produce a
 * spurious bold. That is unavoidable (Solr gives us no way to tell the two
 * apart) and harmless — the worst case is cosmetic, never executable.
 */
export function splitSnippet(snippet: string, maxChars = 1200): SnippetSegment[] {
  const segments: SnippetSegment[] = [];
  let match = false;
  let used = 0;

  for (const part of snippet.split(/(<\/?b>)/)) {
    if (part === "<b>") {
      match = true;
      continue;
    }
    if (part === "</b>") {
      match = false;
      continue;
    }
    if (!part) continue;

    const remaining = maxChars - used;
    if (remaining <= 0) {
      segments.push({ text: "…", match: false });
      break;
    }
    const text = part.length > remaining ? `${part.slice(0, remaining)}…` : part;
    segments.push({ text, match });
    used += text.length;
  }

  return segments;
}

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

/**
 * The REAL /search response: an array mixing two different record types.
 *
 *  - `type: "team"` rows come from a MySQL LIKE against team display names and
 *    debater last names (a name match — "who is this team?").
 *  - everything else is a Solr document hit (a CONTENT match) and carries
 *    `snippet` + `download_path`.
 *
 * Note what is NOT here: `content`. The controller's Solr field list omits it,
 * so full document text requires a separate /download call.
 *
 * Fields are almost all optional because Solr returns multi-valued fields that
 * the controller flattens with `?.[0]`, which yields undefined whenever a
 * document is missing that field. Being strict here would throw away otherwise
 * good results.
 */
const searchHitSchema = z
  .object({
    type: z.string().optional(),
    shard: z.string().optional(),
    year: z.union([z.number(), z.string()]).optional(),
    caselist: z.string().optional(),
    caselist_display_name: z.string().optional(),
    school: z.string().optional(),
    school_display_name: z.string().optional(),
    team: z.string().optional(),
    team_id: z.union([z.number(), z.string()]).optional(),
    team_display_name: z.string().optional(),
    path: z.string().optional(),
    download_path: z.string().optional(),
    cite_id: z.union([z.number(), z.string()]).optional(),
    title: z.string().optional(),
    snippet: z.string().optional(),
  })
  .passthrough();

export type CaselistSearchHit = z.infer<typeof searchHitSchema>;

const searchResponseSchema = z.array(searchHitSchema);

const loginResponseSchema = z.object({
  token: z.string().min(1),
  expires: z.string().optional(),
});

const caselistSchema = z
  .object({
    name: z.string().optional(),
    display_name: z.string().optional(),
    event: z.string().optional(),
    year: z.union([z.number(), z.string()]).optional(),
    archived: z.union([z.boolean(), z.number()]).optional(),
  })
  .passthrough();

export type CaselistSummary = z.infer<typeof caselistSchema>;

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

function authHeaders(token: string): Record<string, string> {
  return {
    // Their auth is a cookie (securitySchemes.cookie -> caselist_token).
    Cookie: `caselist_token=${token}`,
    Accept: "application/json",
    "User-Agent": USER_AGENT,
  };
}

/** Map an upstream status onto our typed errors. Shared by every call. */
async function throwForStatus(res: Response): Promise<never> {
  let upstreamMessage = "";
  try {
    const body = await res.json();
    if (body && typeof body === "object" && typeof (body as { message?: unknown }).message === "string") {
      upstreamMessage = (body as { message: string }).message;
    }
  } catch {
    // Non-JSON error body; the status alone is enough.
  }

  if (res.status === 401 || res.status === 403) {
    throw new CaselistAuthRequiredError();
  }
  if (res.status === 429) {
    const header = Number(res.headers.get("retry-after"));
    throw new CaselistRateLimitedError(
      upstreamMessage || "opencaselist is rate-limiting this account. Wait a minute and try again.",
      Number.isFinite(header) && header > 0 ? header : 60,
    );
  }
  if (res.status === 400) {
    throw new CaselistInvalidQueryError(upstreamMessage || undefined);
  }
  throw new CaselistUnavailableError();
}

async function getJson(path: string, token: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      headers: authHeaders(token),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new CaselistUnavailableError();
  }
  if (!res.ok) await throwForStatus(res);
  try {
    return await res.json();
  } catch {
    throw new CaselistUnavailableError();
  }
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export interface CaselistLogin {
  token: string;
  expiresAt: Date | null;
}

/**
 * Exchange Tabroom credentials for a session token.
 *
 * The token comes back in the JSON BODY (postLogin.js returns
 * `{message, token, expires, trusted, userId, admin}`), so there is no
 * Set-Cookie parsing to do. The upstream session row is always two weeks;
 * `remember` only affects their browser cookie's maxAge, which is irrelevant to
 * us because we store the token ourselves.
 *
 * The response contains no display name, so there is nothing here worth keeping
 * as a label — we deliberately do not store the username (an email address).
 */
export async function login(username: string, password: string): Promise<CaselistLogin> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify({ username, password, remember: true }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new CaselistUnavailableError();
  }

  if (!res.ok) {
    if (res.status === 401) {
      throw new CaselistAuthRequiredError(
        "Tabroom didn't accept that username or password. If you're sure they're right, try resetting your password on Tabroom.",
      );
    }
    await throwForStatus(res);
  }

  let parsed: z.infer<typeof loginResponseSchema>;
  try {
    parsed = loginResponseSchema.parse(await res.json());
  } catch {
    throw new CaselistUnavailableError("opencaselist returned an unexpected login response.");
  }

  const expiresAt = parsed.expires ? new Date(parsed.expires) : null;
  return {
    token: parsed.token,
    expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null,
  };
}

/**
 * Full-text search. **Pass {@link ALL_SHARDS} to search the ENTIRE wiki — every
 * caselist, every year.** That is the mode this product wants: a debater looking
 * for a climate-extinction card has no idea whether it lives in `hspolicy24`,
 * `hsld19`, or an NDT/CEDA list, and evidence does not go stale the way a topic
 * does.
 *
 * How this was settled (source read + live behaviour, 2026-08-03):
 *
 *  - `shard` is a conditional Solr FILTER, not a database or core selector:
 *        if (shard) { URL += `&fq=shard:${shard}` }
 *  - There is exactly ONE index. `buildIndex.js` pushes opensource *and* OpenEv
 *    files to a single SOLR_UPDATE_URL with `shard`/`year` as ordinary document
 *    FIELDS. There are no per-caselist cores.
 *  - **Omitting `shard` does NOT work.** Their route marks it `required: true`
 *    and the validation middleware rejects the call with a 400 before the
 *    controller's conditional runs. This was confirmed in production use, not
 *    assumed — the first build shipped shard-less and fell back on every search.
 *  - The param is `type: string` with **no pattern and no enum**, so the
 *    wildcard {@link ALL_SHARDS} satisfies validation and reaches the filter.
 *
 * Callers should still handle `CaselistInvalidQueryError` and degrade — see
 * `wikiMining.searchEverything`, which falls back to a per-caselist fan-out if
 * the wildcard ever stops being accepted.
 *
 * `q` MUST already be sanitized — see {@link sanitizeQuery}. Callers pass a
 * cleaned string; this is the last line of defence, not the first.
 */
export async function search(
  token: string,
  q: string,
  shard?: string,
): Promise<CaselistSearchHit[]> {
  if (!q) return [];

  let url = `/search?q=${encodeURIComponent(q)}`;
  if (shard !== undefined) {
    if (!isValidShard(shard)) throw new CaselistInvalidQueryError("Unknown caselist.");
    url += `&shard=${encodeURIComponent(shard)}`;
  }
  const raw = await getJson(url, token);

  const parsed = searchResponseSchema.safeParse(raw);
  if (!parsed.success) {
    console.error("caselist.search: unexpected response shape");
    throw new CaselistUnavailableError("opencaselist returned an unexpected search response.");
  }
  return parsed.data;
}

/** Disclosed file formats we can actually turn into cards. */
export type DownloadKind = "docx" | "pdf" | "other";

export interface CaselistDownload {
  bytes: ArrayBuffer;
  kind: DownloadKind;
  filename: string;
}

function kindOf(path: string): DownloadKind {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  if (ext === "docx") return "docx";
  if (ext === "pdf") return "pdf";
  return "other";
}

/**
 * Fetch one disclosed file's bytes.
 *
 * `path` comes from a search hit's `download_path` and is passed through
 * untouched — it is THEIR identifier, not ours to construct. It is still
 * validated here (no `..`, no absolute path) because building a path from
 * anything user-supplied would be a traversal bug, and upstream's own guard is
 * not a reason to skip our own.
 *
 * Their limit is 10 downloads a minute, mirrored by the caller.
 */
export async function download(token: string, path: string): Promise<CaselistDownload> {
  const clean = path.trim();
  if (!clean || clean.startsWith("/") || clean.includes("..") || clean.includes("\\")) {
    throw new CaselistInvalidQueryError("That file path isn't valid.");
  }

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/download?path=${encodeURIComponent(clean)}`, {
      headers: authHeaders(token),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new CaselistUnavailableError();
  }
  if (!res.ok) await throwForStatus(res);

  // Trust the declared length only as an early exit; the real check is on the
  // bytes we actually received, since the header can be absent or wrong.
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_DOWNLOAD_BYTES) {
    throw new CaselistUnavailableError("That file is too large to open here.");
  }

  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_DOWNLOAD_BYTES) {
    throw new CaselistUnavailableError("That file is too large to open here.");
  }

  return { bytes, kind: kindOf(clean), filename: clean.split("/").pop() ?? clean };
}

/** One weekly bulk archive: a zip of a caselist's disclosed files on S3. */
export interface BulkArchive {
  name: string;
  url: string;
}

const bulkArchiveSchema = z
  .object({ name: z.string().optional(), url: z.string().url() })
  .passthrough();

/**
 * The weekly bulk archives for one caselist.
 *
 * opencaselist zips each caselist's files to S3 every Tuesday
 * (`getBulkDownloads.js` lists `weekly/{caselist}/*.zip`) and this endpoint
 * returns their URLs. This is the ingestion fast path: ~one zip per caselist
 * instead of tens of thousands of individual `/download` calls, and it carries
 * no rate limit.
 */
/**
 * Fetch the bulk-downloads listing, tolerating an opencaselist quirk: for some
 * caselists this endpoint returns HTTP 500 but STILL includes a valid archive
 * array in the body (verified live — ndtceda20 responds 500 yet lists 33
 * archives, with rate-limit quota to spare). Discarding that body over the status
 * alone was skipping whole caselists during the backfill. So we use the body
 * whenever it parses; only auth failures and rate limits — where the body is
 * genuinely unusable — stay fatal. A broken or empty body still falls through to
 * the caller's schema check, which yields [].
 */
async function getBulkDownloads(caselist: string, token: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/caselists/${encodeURIComponent(caselist)}/downloads`, {
      headers: authHeaders(token),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new CaselistUnavailableError();
  }
  if (res.status === 401 || res.status === 403) throw new CaselistAuthRequiredError();
  if (res.status === 429) {
    const header = Number(res.headers.get("retry-after"));
    throw new CaselistRateLimitedError(
      "opencaselist is rate-limiting this account. Wait a minute and try again.",
      Number.isFinite(header) && header > 0 ? header : 60,
    );
  }
  try {
    return await res.json();
  } catch {
    throw new CaselistUnavailableError();
  }
}

export async function listBulkArchives(token: string, caselist: string): Promise<BulkArchive[]> {
  if (!SLUG.test(caselist)) throw new CaselistInvalidQueryError("Unknown caselist.");
  const raw = await getBulkDownloads(caselist, token);
  const parsed = z.array(bulkArchiveSchema).safeParse(raw);
  if (!parsed.success) {
    console.error("caselist.listBulkArchives: unexpected response shape");
    return [];
  }
  return parsed.data
    .filter((a) => typeof a.name === "string")
    .map((a) => ({ name: a.name as string, url: a.url }));
}

/**
 * Per-archive size cap. The WEEKLY archives we ingest run up to ~450MB; the
 * cumulative `-all-` snapshot (multiple GB) is deliberately never fetched — it
 * can't be buffered and is just the union of the weeklies anyway. This ceiling
 * lets every real weekly through while refusing anything pathological.
 */
const MAX_ARCHIVE_BYTES = 600 * 1024 * 1024;

/**
 * Overall wall-clock BACKSTOP for one archive download. Sized for the largest
 * archive (~450MB) on a slow-but-moving link; the real defence against a wedged
 * connection is STALL_TIMEOUT_MS below, so this only has to catch the rare
 * slow-trickle case (bytes arriving, but far too slowly to ever finish). 6
 * minutes clears ~450MB at ~1.25MB/s.
 */
const ARCHIVE_TIMEOUT_MS = 6 * 60 * 1000;

/**
 * Abort a download that goes SILENT — the failure that actually stalled the
 * 2025 backfill. undici's own body timeout is coarse, and a wedged S3 socket
 * (headers received, then no bytes) otherwise pins a whole caselist for tens of
 * minutes with the process idle. We stream the body and reset this timer on
 * every chunk; if nothing arrives for this long, we abort and let the retry/skip
 * logic take over in ~90s instead of ~10min.
 */
const STALL_TIMEOUT_MS = 90_000;

/**
 * Retry a failed archive download. These are large transfers over S3 and a
 * dropped connection partway through is ordinary, not exceptional — and without
 * a retry it costs the caller that archive's cards entirely. Two attempts: a
 * genuinely stalled URL now fails in ~90s (STALL_TIMEOUT_MS), so a third attempt
 * mostly adds latency; the resumable backfill retries across passes anyway.
 */
const ARCHIVE_RETRY_BACKOFFS_MS = [0, 15_000];

/** Refused on size — deterministic, so retrying would only waste the bandwidth. */
class ArchiveTooLargeError extends Error {}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function downloadArchiveOnce(url: string): Promise<ArrayBuffer> {
  // One controller drives both timeouts: an overall backstop (created once) and
  // an inactivity timer that's re-armed on every chunk. Either firing aborts the
  // fetch AND the in-progress body read.
  const controller = new AbortController();
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  const overallTimer = setTimeout(
    () => controller.abort(new Error("archive download exceeded time budget")),
    ARCHIVE_TIMEOUT_MS,
  );
  const armStall = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(
      () => controller.abort(new Error("archive download stalled")),
      STALL_TIMEOUT_MS,
    );
  };
  const clearTimers = () => {
    clearTimeout(overallTimer);
    if (stallTimer) clearTimeout(stallTimer);
  };

  let res: Response;
  try {
    armStall(); // also covers a hung connect/headers phase
    res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
      cache: "no-store",
    });
  } catch {
    clearTimers();
    throw new CaselistUnavailableError("A bulk archive couldn't be downloaded.");
  }

  if (!res.ok) {
    clearTimers();
    throw new CaselistUnavailableError(`Archive fetch failed (HTTP ${res.status}).`);
  }

  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_ARCHIVE_BYTES) {
    clearTimers();
    throw new ArchiveTooLargeError();
  }

  const reader = res.body?.getReader();
  if (!reader) {
    // No readable stream to police (shouldn't happen with undici); fall back.
    try {
      const bytes = await res.arrayBuffer();
      if (bytes.byteLength > MAX_ARCHIVE_BYTES) throw new ArchiveTooLargeError();
      return bytes;
    } finally {
      clearTimers();
    }
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      armStall();
      total += value.byteLength;
      if (total > MAX_ARCHIVE_BYTES) {
        await reader.cancel();
        throw new ArchiveTooLargeError();
      }
      chunks.push(value);
    }
  } catch (err) {
    clearTimers();
    if (err instanceof ArchiveTooLargeError) throw err;
    // Aborted (stall or backstop) or a mid-stream network error.
    throw new CaselistUnavailableError("A bulk archive download was interrupted.");
  }
  clearTimers();

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}

/**
 * Download one bulk archive by its (S3) URL, retrying transient failures.
 *
 * The URL comes straight from {@link listBulkArchives}, i.e. from opencaselist,
 * so it is not user-controlled. We still bound the response size — an archive is
 * fetched into memory to unzip — and identify ourselves like every other call.
 */
export async function downloadArchive(url: string): Promise<ArrayBuffer> {
  let lastError: unknown;

  for (let attempt = 0; attempt < ARCHIVE_RETRY_BACKOFFS_MS.length; attempt++) {
    if (ARCHIVE_RETRY_BACKOFFS_MS[attempt]) await sleep(ARCHIVE_RETRY_BACKOFFS_MS[attempt]);
    try {
      return await downloadArchiveOnce(url);
    } catch (err) {
      if (err instanceof ArchiveTooLargeError) {
        throw new CaselistUnavailableError("A bulk archive was too large to ingest.");
      }
      lastError = err;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new CaselistUnavailableError("A bulk archive couldn't be downloaded.");
}

/**
 * Every caselist this user can search.
 *
 * `archived: true` is REQUIRED for our purposes: archived caselists are previous
 * years' topics, and previous years are exactly where most disclosed evidence
 * lives. Filtering them out silently limits a debater to the current season —
 * the bug this feature exists to avoid.
 */
export async function listCaselists(
  token: string,
  includeArchived = true,
): Promise<CaselistSummary[]> {
  const raw = await getJson(`/caselists${includeArchived ? "?archived=true" : ""}`, token);
  const parsed = z.array(caselistSchema).safeParse(raw);
  if (!parsed.success) {
    console.error("caselist.listCaselists: unexpected response shape");
    return [];
  }
  return parsed.data;
}
