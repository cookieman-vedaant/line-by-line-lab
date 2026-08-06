import "server-only";
import { createHash } from "node:crypto";
import JSZip from "jszip";
import { readDocx } from "@/lib/docx";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  downloadArchive,
  listBulkArchives,
  listCaselists,
  login,
} from "@/services/caselist";
import { extractCards } from "@/services/wikiCards";

/**
 * Wiki ingestion — build our searchable card index from opencaselist.
 *
 * opencaselist has no whole-wiki search, so we can't query it live for "every
 * card matching a claim." Instead we do what PrepSync does: pull opencaselist's
 * weekly per-caselist zip archives, parse each disclosed .docx into cards, and
 * store them in our own table (see supabase/migrations/…_wiki_cards_index.sql).
 * Users then search THAT — instant, complete, no rate limit.
 *
 * This runs server-side under a DEDICATED ingestion account
 * (CASELIST_INGEST_USERNAME/PASSWORD), never a user's token: a global index is
 * our crawl, not something done on any individual's behalf.
 *
 * It reuses the exact parser the Card Cutter's wiki path already uses
 * (lib/docx.ts + services/wikiCards.ts), so an indexed card is identical to one
 * opened live — and, as everywhere in this feature, nothing is generated.
 */

const OPENCASELIST_SITE = "https://opencaselist.com";

/**
 * Insert in small chunks. Each row regenerates a stored `search` tsvector and a
 * GIN index entry, and college-policy cards are enormous — batches of 200 blew
 * Postgres's statement timeout. 50 keeps every statement well under it.
 */
const UPSERT_BATCH = 50;

/**
 * Floor for the adaptive chunking below. Even 50 has been seen to time out on
 * the biggest college-policy cards, so the writer halves its way down; this is
 * where it stops trying to get smaller and starts simply waiting instead.
 */
const MIN_UPSERT_BATCH = 5;

/** Attempts at one position before the caselist is considered genuinely broken. */
const MAX_UPSERT_ATTEMPTS = 5;

const UPSERT_BACKOFF_MS = 2_000;

/**
 * Idle gap after each successful chunk, to keep a bulk backfill under Supabase's
 * SUSTAINED disk-IO ceiling. Each card write rebuilds a large tsvector and two
 * GIN indexes — real write IO — and firing 50-row chunks back to back drains the
 * instance's disk-IO burst balance, after which the DB throttles EVERYTHING:
 * the backfill's own writes start timing out, and any page hitting the DB gets
 * slow. A small pause between chunks spreads the same work under the baseline so
 * throughput stays steady instead of collapsing. Default 0 (off) so the weekly
 * cron and a quiet-hours backfill run full speed; set WIKI_UPSERT_PACE_MS (e.g.
 * 250) when ingesting heavily against a live instance. Off by default also means
 * existing behavior — and the upsertInChunks tests — are unchanged.
 */
const UPSERT_PACE_MS = Math.max(0, Number(process.env.WIKI_UPSERT_PACE_MS ?? 0));

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Is this a database error worth retrying, rather than a real defect?
 *
 * Statement timeouts are the documented failure mode of this backfill: a chunk
 * of very large cards can exceed Postgres's limit, and the same chunk usually
 * succeeds when it's smaller or the database is less busy. A schema or
 * constraint error, by contrast, will fail identically forever and must
 * surface immediately instead of being retried five times.
 */
export function isRetryableWriteError(message: string): boolean {
  return /statement timeout|canceling statement|deadlock|server closed|connection|ECONNRESET|fetch failed|timeout|503|504/i.test(
    message,
  );
}

type UpsertWriter = (chunk: WikiCardRow[]) => Promise<{ error: { message: string } | null }>;

/**
 * Write cards in chunks, shrinking the chunk when the database says it's too
 * much work for one statement.
 *
 * WHY THIS EXISTS: the previous version issued fixed 50-row upserts and threw on
 * the first error, which meant one statement timeout discarded an entire
 * caselist — including every archive already downloaded and parsed, often an
 * hour of work. That is what stopped the big policy caselists from ever
 * finishing. Here a timeout instead halves the chunk and tries again from the
 * same position, so progress is kept and the writer adapts to whatever the
 * database will accept.
 *
 * Takes the write function as an argument so the retry logic can be tested
 * without a database.
 */
export async function upsertInChunks(
  rows: WikiCardRow[],
  write: UpsertWriter,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<number> {
  let batchSize = UPSERT_BATCH;
  let index = 0;
  let written = 0;
  let attempts = 0;

  while (index < rows.length) {
    const chunk = rows.slice(index, index + batchSize);
    const { error } = await write(chunk);

    if (!error) {
      index += chunk.length;
      written += chunk.length;
      attempts = 0;
      // Breathe between chunks so a bulk backfill stays under the disk-IO
      // ceiling (see UPSERT_PACE_MS). No-op at the default 0, and never after
      // the final chunk.
      if (UPSERT_PACE_MS > 0 && index < rows.length) await wait(UPSERT_PACE_MS);
      continue;
    }

    attempts++;
    if (!isRetryableWriteError(error.message) || attempts >= MAX_UPSERT_ATTEMPTS) {
      throw new Error(`wiki_cards upsert failed: ${error.message}`);
    }

    // Ask for less next time, then give the database a moment.
    batchSize = Math.max(MIN_UPSERT_BATCH, Math.floor(batchSize / 2));
    await wait(UPSERT_BACKOFF_MS * attempts);
  }

  return written;
}

export interface IngestSummary {
  caselist: string;
  archives: number;
  files: number;
  /** Distinct cards written (deduped by content). */
  cards: number;
  /** Files that weren't parseable .docx (PDF, legacy .doc, corrupt). */
  skipped: number;
  /**
   * Archives whose cards couldn't be written. Non-zero means this caselist is
   * INCOMPLETE and should be re-run — the run continued so the rest still
   * landed, but it must not be mistaken for a clean pass.
   */
  failedArchives?: number;
  /** True when the index was already at its size cap and this caselist was skipped. */
  capped?: boolean;
}

export interface IngestOptions {
  /** Reuse one login across many caselists (see `ingestAll`/`ingestActiveSeason`). */
  token?: string;
  /**
   * Process only the newest N weekly archives instead of all of them. The weekly
   * refresh cron passes a small number: a current-season caselist gains only a
   * couple of archives a week, so pulling just the newest one or two keeps each
   * scheduled run tiny and inside a function's time budget. Omit to ingest every
   * weekly (the one-time whole-history backfill).
   */
  maxArchives?: number;
}

/**
 * Target size of the index. This is the storage lever: measured live, a card
 * costs ~12KB (compressed body + search index), so 400k ≈ 5GB — comfortably
 * inside Supabase Pro's 8GB with ample room for ALL user data (accounts,
 * profiles, round logs live in other tables and are never touched here).
 *
 * It's enforced by EVICTION, not by refusing new cards: ingestion appends the
 * newest disclosures, then `enforceWikiCap` trims back to this number by
 * deleting the OLDEST cards first, so current-topic prep always wins. Override
 * with WIKI_MAX_CARDS.
 */
const MAX_INDEXED_CARDS = Number(process.env.WIKI_MAX_CARDS ?? 400_000);

/**
 * A hard stop DURING ingestion, above the target, before eviction trims back
 * down. It exists only to stop a runaway (a bug, or an unexpectedly huge topic)
 * from filling the disk between eviction passes — normal operation never reaches
 * it. At 1.25× the target it still leaves headroom under 8GB (500k ≈ 6GB).
 */
const SAFETY_CEILING = Math.round(MAX_INDEXED_CARDS * 1.25);

interface WikiCardRow {
  content_hash: string;
  tag: string;
  cite: string;
  cite_details: string;
  body: string;
  caselist: string;
  year: number | null;
  school: string | null;
  team: string | null;
  source_url: string;
  ingested_at: string;
}

/** Log in with the dedicated ingestion account. */
async function ingestToken(): Promise<string> {
  const username = process.env.CASELIST_INGEST_USERNAME;
  const password = process.env.CASELIST_INGEST_PASSWORD;
  if (!username || !password) {
    throw new Error(
      "Wiki ingestion needs CASELIST_INGEST_USERNAME and CASELIST_INGEST_PASSWORD set on the server.",
    );
  }
  const { token } = await login(username, password);
  return token;
}

/**
 * One row per distinct card — identical cards from many teams collapse here.
 * The delimiter is a NUL, written as the escape `\u0000` so this stays a plain
 * (non-binary) source file. A NUL can't occur in a tag or body, so no split of
 * `tag`/`body` can collide onto the same hash. Kept byte-for-byte identical to
 * the original scheme ON PURPOSE: re-ingesting produces the SAME hash as rows
 * already in the table, so a rebuild upserts (updates) them rather than
 * duplicating — which means a rebuild never has to delete anything.
 */
function contentHash(tag: string, body: string): string {
  return createHash("sha256").update(`${tag}\u0000${body}`).digest("hex");
}

/** `hsld24` → 2024, `openev-2024` → 2024, `ndtceda` → null. */
export function yearFromSlug(slug: string): number | null {
  const four = slug.match(/(\d{4})$/);
  if (four) return Number.parseInt(four[1], 10);
  const two = slug.match(/(\d{2})$/);
  if (two) return 2000 + Number.parseInt(two[1], 10);
  return null;
}

/**
 * The Fall-anchored debate season year that's currently active.
 *
 * Seasons start in the fall (~August), so before then the PRIOR year's season
 * is still the live one — the 2025 season runs Sep 2025 → Jun 2026. The weekly
 * refresh uses this to decide which caselists are still gaining disclosures.
 */
export function currentSeasonYear(now: Date = new Date()): number {
  const y = now.getUTCFullYear();
  return now.getUTCMonth() >= 7 ? y : y - 1;
}

/**
 * Best-effort school/team from a zip entry path.
 *
 * Real weekly archives lay files out as `caselist/school/team/file.docx`
 * (verified: `hsld24/MillardNorth/KyBl/…docx`). The school and team are always
 * the two segments before the filename, so we read from the END — that's
 * correct whether or not the caselist prefix is present. Anything shorter than
 * team/file we don't attribute; a wrong label is worse than none.
 */
export function provenanceFromPath(entryPath: string): { school: string | null; team: string | null } {
  const parts = entryPath.split("/").filter(Boolean);
  if (parts.length >= 3) {
    return { school: parts[parts.length - 3], team: parts[parts.length - 2] };
  }
  return { school: null, team: null };
}

function buildSourceUrl(caselist: string, school: string | null, team: string | null): string {
  const segs = [caselist, school, team].filter((s): s is string => !!s);
  return `${OPENCASELIST_SITE}/${segs.map(encodeURIComponent).join("/")}`;
}

type WikiAdminClient = ReturnType<typeof createSupabaseAdminClient>;

/** Outcome of ingesting ONE weekly archive. */
export interface ArchiveIngestResult {
  /** .docx files seen in this archive. */
  files: number;
  /** Files that couldn't be parsed as .docx. */
  skipped: number;
  /** Distinct cards written from this archive. */
  cards: number;
  /** Couldn't download, unzip, or write this archive — safe to retry. */
  failed: boolean;
}

/**
 * Download, parse, and upsert ONE weekly archive.
 *
 * This is the unit of work the whole backfill is built from, and isolating it is
 * what makes ingestion robust: a wedged S3 download or a write timeout costs
 * THIS archive only (returned as `failed: true`), never the rest of the
 * caselist, and because writes dedupe by content hash it can be retried freely.
 * `ingestCaselist` loops it for the cron/whole-season path; `ingestCaselistArchive`
 * exposes it one-at-a-time for the resumable backfill (scripts/ingest-archives.mjs).
 */
export async function ingestArchive(
  caselist: string,
  archive: { name: string; url: string },
  admin: WikiAdminClient,
  year: number | null,
  now: string,
): Promise<ArchiveIngestResult> {
  let bytes: ArrayBuffer;
  try {
    bytes = await downloadArchive(archive.url);
  } catch (err) {
    console.warn(`wikiIngest: "${archive.name}" couldn't be downloaded; skipping`, String(err));
    return { files: 0, skipped: 0, cards: 0, failed: true };
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    console.warn(`wikiIngest: "${archive.name}" wasn't a readable zip; skipping`);
    return { files: 0, skipped: 0, cards: 0, failed: true };
  }

  // One archive's cards. Deduped within the archive; the table's
  // unique(content_hash) dedupes across archives and past runs.
  const rows = new Map<string, WikiCardRow>();
  const docxEntries = Object.values(zip.files).filter((f) => !f.dir && /\.docx$/i.test(f.name));
  let files = 0;
  let skipped = 0;

  for (const entry of docxEntries) {
    files++;
    try {
      const buf = await entry.async("uint8array");
      const paragraphs = await readDocx(buf);
      const { school, team } = provenanceFromPath(entry.name);
      const sourceUrl = buildSourceUrl(caselist, school, team);
      for (const card of extractCards(paragraphs, sourceUrl).cards) {
        const hash = contentHash(card.tag, card.body);
        if (rows.has(hash)) continue;
        rows.set(hash, {
          content_hash: hash,
          tag: card.tag,
          cite: card.cite,
          cite_details: card.citeDetails,
          body: card.body,
          caselist,
          year,
          school,
          team,
          source_url: sourceUrl,
          ingested_at: now,
        });
      }
    } catch {
      skipped++;
    }
  }

  const batch = [...rows.values()];
  try {
    // ignoreDuplicates → INSERT ... ON CONFLICT DO NOTHING. A card's content is
    // immutable (the hash IS the content), so an already-indexed card needs no
    // update — skipping it avoids re-generating its tsvector, which is what made
    // re-ingests and dup-heavy caselists crawl. New cards still get inserted.
    const cards = await upsertInChunks(batch, async (chunk) => {
      const { error } = await admin
        .from("wiki_cards")
        .upsert(chunk, { onConflict: "content_hash", ignoreDuplicates: true });
      return { error };
    });
    return { files, skipped, cards, failed: false };
  } catch (err) {
    // Keep whatever already landed; re-running resumes this archive (dedup by
    // content hash) rather than starting over.
    console.error(`wikiIngest: "${archive.name}" failed to write; continuing`, String(err));
    return { files, skipped, cards: 0, failed: true };
  }
}

/**
 * Ingest one caselist: download its weekly archive(s), parse every .docx into
 * cards, and upsert them. Deduped by content within the run and again in the
 * table's unique(content_hash), so re-running is safe and just refreshes
 * `ingested_at`.
 *
 * Pass `opts.token` to reuse one login across many caselists (see `ingestAll`),
 * and `opts.maxArchives` to touch only the newest archives (see the refresh).
 */
export async function ingestCaselist(
  caselist: string,
  opts: IngestOptions = {},
): Promise<IngestSummary> {
  const tok = opts.token ?? (await ingestToken());
  const admin = createSupabaseAdminClient();

  // Stop before we overrun the database. Checked per caselist (not per row) so
  // it's one cheap count, and the last caselist may nudge slightly past the cap
  // rather than being cut mid-file — close enough for a storage guard.
  const { count } = await admin
    .from("wiki_cards")
    .select("*", { count: "estimated", head: true });
  if ((count ?? 0) >= SAFETY_CEILING) {
    console.warn(
      `wikiIngest: index at safety ceiling (${count}/${SAFETY_CEILING}); skipping "${caselist}". Eviction should have trimmed it to ${MAX_INDEXED_CARDS} — raise WIKI_MAX_CARDS or check enforceWikiCap.`,
    );
    return { caselist, archives: 0, files: 0, cards: 0, skipped: 0, capped: true };
  }

  // Ingest the WEEKLY archives, newest first. Each weekly holds the files
  // disclosed that week (tens of MB, bufferable). The cumulative `-all-` archive
  // is skipped: it is multiple GB, can't be loaded into memory, and is just the
  // union of the weeklies, which we already cover. Newest-first means a run that
  // stops at the cap keeps the most current prep.
  const allWeeklies = (await listBulkArchives(tok, caselist))
    .filter((a) => /-weekly-/i.test(a.name))
    .sort((a, b) => (a.name < b.name ? 1 : -1));
  const weeklies =
    opts.maxArchives != null ? allWeeklies.slice(0, Math.max(0, opts.maxArchives)) : allWeeklies;

  if (weeklies.length === 0) {
    console.warn(`wikiIngest: "${caselist}" has no weekly archives; skipping.`);
    return { caselist, archives: 0, files: 0, cards: 0, skipped: 0 };
  }

  const year = yearFromSlug(caselist);
  const now = new Date().toISOString();
  let files = 0;
  let skipped = 0;
  let indexed = 0;
  let failedArchives = 0;

  for (const archive of weeklies) {
    // Re-check the cap between archives so a big caselist stops cleanly instead
    // of downloading gigabytes we can't store.
    const { count } = await admin
      .from("wiki_cards")
      .select("*", { count: "estimated", head: true });
    if ((count ?? 0) >= SAFETY_CEILING) {
      console.warn(`wikiIngest: hit the ${SAFETY_CEILING}-card safety ceiling; stopping "${caselist}".`);
      break;
    }

    const result = await ingestArchive(caselist, archive, admin, year, now);
    files += result.files;
    skipped += result.skipped;
    indexed += result.cards;
    if (result.failed) failedArchives++;
  }

  // Every archive failing is a real fault (bad credentials, dead database),
  // not the flaky-download case this tolerance exists for. Surface it so the
  // caller retries instead of recording an empty success.
  if (failedArchives > 0 && failedArchives === weeklies.length) {
    throw new Error(`wikiIngest: every archive in "${caselist}" failed to write.`);
  }

  return { caselist, archives: weeklies.length, files, cards: indexed, skipped, failedArchives };
}

/**
 * Ingest a SINGLE weekly archive of a caselist, by name.
 *
 * This is the resumable-backfill entry point: the orchestrator
 * (scripts/ingest-archives.mjs) drives one archive per request so a hung
 * download can't sink a whole caselist and progress is never lost. The archive
 * name is validated against the caselist's real listing before anything is
 * fetched, so it can only ever resolve to a genuine opencaselist URL — never an
 * arbitrary one supplied by the caller.
 */
export async function ingestCaselistArchive(
  caselist: string,
  archiveName: string,
  opts: IngestOptions = {},
): Promise<IngestSummary> {
  const tok = opts.token ?? (await ingestToken());
  const admin = createSupabaseAdminClient();

  const { count } = await admin
    .from("wiki_cards")
    .select("*", { count: "estimated", head: true });
  if ((count ?? 0) >= SAFETY_CEILING) {
    console.warn(
      `wikiIngest: index at safety ceiling (${count}/${SAFETY_CEILING}); skipping "${archiveName}".`,
    );
    return { caselist, archives: 0, files: 0, cards: 0, skipped: 0, capped: true };
  }

  const archive = (await listBulkArchives(tok, caselist)).find(
    (a) => a.name === archiveName && /-weekly-/i.test(a.name),
  );
  if (!archive) {
    throw new Error(`wikiIngest: weekly archive "${archiveName}" not found in "${caselist}".`);
  }

  const result = await ingestArchive(
    caselist,
    archive,
    admin,
    yearFromSlug(caselist),
    new Date().toISOString(),
  );
  return {
    caselist,
    archives: 1,
    files: result.files,
    cards: result.cards,
    skipped: result.skipped,
    failedArchives: result.failed ? 1 : 0,
  };
}

/**
 * Oldest caselist year to index. This is bounded by opencaselist, not by us:
 * it only *serves* bulk archives for roughly the last three seasons. Verified
 * live (2026-08) — 2020–2023 caselists all return HTTP 500 "Failed to retrieve
 * bulk downloads", while 2024, 2025 and 2026 return real weekly archives. Older
 * seasons have no retrievable bulk data (only the slow per-file API, which we
 * don't use), so 2024 is the real floor. Override with WIKI_MIN_YEAR if
 * opencaselist's availability changes. (Caselists that 500 are skipped
 * gracefully anyway — see getBulkDownloads — so a stale floor can't crash a run.)
 */
const MIN_CASELIST_YEAR = Number(process.env.WIKI_MIN_YEAR ?? 2024);

/** The caselist slugs to ingest: every division, MIN_CASELIST_YEAR onward. */
export async function ingestableCaselists(token?: string): Promise<string[]> {
  const tok = token ?? (await ingestToken());
  const caselists = await listCaselists(tok, true);
  return caselists
    .map((c) => c.name)
    .filter((n): n is string => typeof n === "string" && n.length > 0)
    .filter((name) => {
      // Every real slug carries its year (verified: hsld20…nfald26). A slug we
      // can't date is one we can't confirm is in range, so we leave it out.
      const year = yearFromSlug(name);
      return year !== null && year >= MIN_CASELIST_YEAR;
    });
}

/**
 * Ingest every caselist under one login.
 *
 * Long-running by nature (dozens of caselists, each a zip of many files), so
 * this is for a script or scheduled worker, not a request handler. One failed
 * caselist is logged and skipped rather than sinking the whole run.
 */
export async function ingestAll(): Promise<IngestSummary[]> {
  const token = await ingestToken();
  const slugs = await ingestableCaselists(token);
  const summaries: IngestSummary[] = [];
  for (const slug of slugs) {
    try {
      const summary = await ingestCaselist(slug, { token });
      console.info(`wikiIngest: ${slug} → ${summary.cards} cards from ${summary.files} files`);
      summaries.push(summary);
    } catch (err) {
      console.error(`wikiIngest: caselist "${slug}" failed`, err);
    }
  }
  return summaries;
}

/**
 * How many of each active caselist's newest archives the weekly refresh pulls.
 * Weeklies are incremental, so at a weekly cadence one would suffice; four gives
 * a month of slack so a missed run (or a newly-created caselist) still catches
 * up without a manual backfill. Re-pulling an already-indexed archive is a
 * no-op (upsert), so the only cost of a wider window is a little bandwidth.
 */
const REFRESH_ARCHIVES_PER_CASELIST = 4;

/**
 * Refresh only the CURRENT season's caselists, newest archives first.
 *
 * Past seasons are frozen — a 2024 wiki never gains new archives — so the full
 * backfill (`ingestAll`, run once from the ingest script) covers them forever.
 * Only the active season keeps disclosing, so the recurring cron re-ingests
 * just those, and only their newest weekly archives. That keeps a scheduled run
 * small enough to finish inside one function invocation, unlike a full crawl.
 */
export async function ingestActiveSeason(): Promise<IngestSummary[]> {
  const token = await ingestToken();
  const season = currentSeasonYear();
  const slugs = (await ingestableCaselists(token)).filter((slug) => {
    const y = yearFromSlug(slug);
    return y !== null && y >= season;
  });
  const summaries: IngestSummary[] = [];
  for (const slug of slugs) {
    try {
      const summary = await ingestCaselist(slug, {
        token,
        maxArchives: REFRESH_ARCHIVES_PER_CASELIST,
      });
      console.info(`wikiRefresh: ${slug} → ${summary.cards} cards from ${summary.files} files`);
      summaries.push(summary);
    } catch (err) {
      console.error(`wikiRefresh: caselist "${slug}" failed`, err);
    }
  }
  // Appended this week's disclosures; now trim back to the storage budget by
  // dropping the OLDEST cards first (never user data).
  await enforceWikiCap();
  return summaries;
}

/**
 * Trim the index to its target size (MAX_INDEXED_CARDS), evicting the OLDEST
 * cards first so the newest current-topic prep always survives.
 *
 * Deletes from wiki_cards ONLY — user accounts, profiles, and round logs live in
 * other tables and are never referenced here, so no amount of eviction can touch
 * them. The DB function enforces the same guarantee (see the evict_oldest
 * migration). Returns how many cards were dropped (0 when already within budget).
 */
export async function enforceWikiCap(): Promise<number> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("enforce_wiki_cap", { p_max: MAX_INDEXED_CARDS });
  if (error) {
    console.error("wikiIngest: enforce_wiki_cap failed", error);
    return 0;
  }
  const removed = typeof data === "number" ? data : 0;
  if (removed > 0) {
    console.info(`wikiIngest: evicted ${removed} oldest card(s) to stay within ${MAX_INDEXED_CARDS}.`);
  }
  return removed;
}
