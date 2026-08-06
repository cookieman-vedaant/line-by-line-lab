/**
 * Resumable, per-archive wiki backfill — one or more caselists, back to back.
 *
 * The whole-caselist path (scripts/ingest-wiki.mjs) ingests all of a caselist's
 * weekly archives inside ONE long request. That was fragile: a single wedged S3
 * download stalled everything behind it, which is what left the 2025 season only
 * ~5% ingested. This script instead POSTs ONE archive at a time to
 * /api/wiki/ingest (the `archive` field), so:
 *
 *   - a hung/slow download costs that archive only, never the caselist;
 *   - memory is freed after each request (no multi-hundred-MB pile-ups);
 *   - it's fully resumable — writes dedupe by content hash, so re-running skips
 *     what's already indexed and finishes the rest;
 *   - anything that fails or times out is retried on a second pass.
 *
 * Caselists run sequentially (NEVER concurrently — two big archives at once is
 * the exact memory pile-up we're avoiding). Within a caselist, archives are
 * ingested OLDEST-first so brand-new cards start landing immediately.
 *
 * Usage (local dev):
 *   INGEST_URL=http://localhost:3000 node --env-file=.env.local scripts/ingest-archives.mjs hsld25 hspolicy25 ...
 *
 * Env required (from .env.local):
 *   CRON_SECRET                                  authorize the ingest calls
 *   CASELIST_INGEST_USERNAME/PASSWORD            list each caselist's archives
 *   INGEST_URL (optional, default localhost:3000)
 */
import { Agent, setGlobalDispatcher } from "undici";

// The server sends nothing until an archive is fully ingested (can be minutes),
// so undici's default idle timeouts would abort the wait. Disable them; the
// per-archive AbortController below is the real cap.
setGlobalDispatcher(new Agent({ headersTimeout: 0, bodyTimeout: 0, connectTimeout: 30_000 }));

const API = "https://api.opencaselist.com/v1";
const UA = "LineByLineLab/1.0 (+https://line-by-line-lab.vercel.app)";
const BASE = (process.env.INGEST_URL ?? "http://localhost:3000").replace(/\/$/, "");
const SECRET = process.env.CRON_SECRET ?? "";

const caselists = process.argv.slice(2);
if (caselists.length === 0) {
  console.error("usage: node --env-file=.env.local scripts/ingest-archives.mjs <caselist> [caselist...]");
  process.exit(1);
}

// Generous per-archive cap: the server's own budget is ~6 min/attempt × 2, so a
// legitimately huge-but-slow archive still fits; anything past this is wedged
// and gets retried on the next pass.
const PER_ARCHIVE_TIMEOUT_MS = 14 * 60 * 1000;
const PACE_MS = 2_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function opencaselistToken() {
  const username = process.env.CASELIST_INGEST_USERNAME;
  const password = process.env.CASELIST_INGEST_PASSWORD;
  if (!username || !password) throw new Error("missing CASELIST_INGEST_USERNAME/PASSWORD in env");
  const res = await fetch(`${API}/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": UA },
    body: JSON.stringify({ username, password, remember: true }),
  });
  if (!res.ok) throw new Error(`opencaselist login failed: HTTP ${res.status}`);
  return (await res.json()).token;
}

async function listWeeklies(token, caselist) {
  const res = await fetch(`${API}/caselists/${caselist}/downloads`, {
    headers: { cookie: `caselist_token=${token}`, "user-agent": UA },
  });
  const body = await res.json();
  if (!Array.isArray(body)) throw new Error(`unexpected downloads listing for ${caselist}`);
  return body
    .filter((a) => /-weekly-/i.test(a.name || ""))
    .map((a) => a.name)
    .sort(); // ascending = oldest-first (names are date-suffixed)
}

/** POST one archive; returns { cards, failed } or throws on timeout/HTTP error. */
async function ingestOne(caselist, archive) {
  const res = await fetch(`${BASE}/api/wiki/ingest`, {
    method: "POST",
    headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
    body: JSON.stringify({ caselist, archive }),
    signal: AbortSignal.timeout(PER_ARCHIVE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const summary = (await res.json()).summary ?? {};
  return { cards: summary.cards ?? 0, failed: (summary.failedArchives ?? 0) > 0 };
}

async function runPass(caselist, archives, label) {
  const failures = [];
  let cards = 0;
  console.log(`\n--- ${caselist} ${label}: ${archives.length} archive(s) ---`);
  for (let i = 0; i < archives.length; i++) {
    const archive = archives[i];
    const n = `${i + 1}/${archives.length}`;
    const started = Date.now();
    process.stdout.write(`[${new Date().toISOString()}] ${caselist} ${n} ${archive.padEnd(34)} `);
    try {
      const r = await ingestOne(caselist, archive);
      const secs = ((Date.now() - started) / 1000).toFixed(0);
      cards += r.cards;
      if (r.failed) {
        failures.push(archive);
        console.log(`⚠ failed to write (${secs}s) — will retry`);
      } else {
        console.log(`+${r.cards} cards (${secs}s)`);
      }
    } catch (err) {
      const secs = ((Date.now() - started) / 1000).toFixed(0);
      failures.push(archive);
      console.log(`✗ ${err.message} (${secs}s) — will retry`);
    }
    await sleep(PACE_MS);
  }
  return { cards, failures };
}

async function backfillCaselist(token, caselist) {
  console.log(`\n================ ${caselist} ================`);
  const archives = await listWeeklies(token, caselist);
  console.log(`${archives.length} weekly archives (oldest → newest).`);

  let total = 0;
  const pass1 = await runPass(caselist, archives, "Pass 1");
  total += pass1.cards;

  let retry = pass1.failures;
  for (let round = 1; round <= 2 && retry.length > 0; round++) {
    const pass = await runPass(caselist, retry, `Retry ${round}`);
    total += pass.cards;
    retry = pass.failures;
  }
  console.log(`>>> ${caselist} done: ${total} cards processed` + (retry.length ? `, still failing: ${retry.join(", ")}` : ""));
  return total;
}

async function main() {
  console.log(`Backfilling ${caselists.length} caselist(s) via ${BASE}: ${caselists.join(", ")}`);
  const token = await opencaselistToken();
  let grand = 0;
  for (const caselist of caselists) {
    grand += await backfillCaselist(token, caselist);
    await sleep(PACE_MS);
  }
  console.log(`\nAll done. ${grand} total cards processed across ${caselists.length} caselist(s).`);
}

main().catch((err) => {
  console.error("ingest-archives failed:", err.message);
  process.exit(1);
});
