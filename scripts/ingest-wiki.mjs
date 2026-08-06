/**
 * Orchestrate a full wiki-index ingestion.
 *
 * The heavy lifting — Tabroom login, downloading zip archives, parsing .docx,
 * upserting cards — all happens SERVER-SIDE in /api/wiki/ingest. This script is
 * only a conductor: it asks the server for the caselist list, then triggers one
 * ingestion per caselist, sequentially, printing progress.
 *
 * Nothing sensitive lives here. The Tabroom ingestion credentials and the
 * Supabase service-role key stay on the server; this script just needs the URL
 * and the CRON_SECRET to authorize the calls.
 *
 * Usage:
 *   INGEST_URL=http://localhost:3000 CRON_SECRET=... node scripts/ingest-wiki.mjs
 *   INGEST_URL=https://line-by-line-lab.vercel.app CRON_SECRET=... node scripts/ingest-wiki.mjs
 *
 * Server env required (NOT here — on the server being called):
 *   CASELIST_INGEST_USERNAME, CASELIST_INGEST_PASSWORD  (a dedicated Tabroom account)
 *   SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL
 *   CRON_SECRET  (must match the one passed here)
 */

const BASE = (process.env.INGEST_URL ?? "http://localhost:3000").replace(/\/$/, "");
const SECRET = process.env.CRON_SECRET ?? "";
const ONLY = process.argv[2]; // optional: ingest a single caselist, e.g. `node ... hsld24`

const headers = { authorization: `Bearer ${SECRET}`, "content-type": "application/json" };

async function main() {
  let caselists;
  if (ONLY) {
    caselists = [ONLY];
  } else {
    const res = await fetch(`${BASE}/api/wiki/ingest`, { headers });
    if (!res.ok) {
      console.error(`Couldn't list caselists: HTTP ${res.status} ${await res.text()}`);
      process.exit(1);
    }
    caselists = (await res.json()).caselists ?? [];
  }
  console.log(`Ingesting ${caselists.length} caselist(s) via ${BASE}\n`);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Retry each caselist a few times: opencaselist throttles under sustained load
  // (CaselistUnavailableError) and a big caselist can hit a transient DB timeout.
  // Backoff lets the rate window reset; because inserts skip already-indexed
  // cards, a retry just resumes where the previous attempt stopped.
  const BACKOFFS_MS = [0, 15000, 45000, 90000];

  let totalCards = 0;
  let failed = 0;
  const incomplete = [];
  for (const caselist of caselists) {
    process.stdout.write(`${caselist.padEnd(20)} `);
    const started = Date.now();
    let summary = null;
    for (let attempt = 0; attempt < BACKOFFS_MS.length; attempt++) {
      if (BACKOFFS_MS[attempt]) await sleep(BACKOFFS_MS[attempt]);
      try {
        const res = await fetch(`${BASE}/api/wiki/ingest`, {
          method: "POST",
          headers,
          body: JSON.stringify({ caselist }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 100)}`);
        summary = (await res.json()).summary;
        break;
      } catch (err) {
        if (attempt === BACKOFFS_MS.length - 1) {
          failed++;
          console.log(`FAILED after ${attempt + 1} tries: ${err.message}`);
        } else {
          process.stdout.write("retry… ");
        }
      }
    }
    if (summary) {
      totalCards += summary.cards;
      const secs = ((Date.now() - started) / 1000).toFixed(0);
      // A caselist with failed archives finished, but INCOMPLETELY: the run kept
      // the archives that landed instead of discarding the caselist. Re-running
      // resumes it (writes dedupe by content hash), so flag it rather than
      // letting it read as a clean pass.
      if (summary.failedArchives > 0) {
        incomplete.push(caselist);
      }
      console.log(
        `${summary.cards} cards from ${summary.files} files (${summary.skipped} skipped) · ${secs}s` +
          (summary.failedArchives > 0
            ? ` · ⚠ ${summary.failedArchives} archive(s) failed — re-run to finish`
            : ""),
      );
    }
    // Pace between caselists so we don't trip opencaselist's throttling.
    await sleep(2000);
  }

  console.log(
    `\nDone. ${totalCards} distinct cards indexed.${failed ? ` ${failed} caselist(s) still failing.` : ""}`,
  );
  if (incomplete.length) {
    console.log(
      `Incomplete (re-run to finish, it resumes where it stopped): ${incomplete.join(", ")}`,
    );
  }
}

main().catch((err) => {
  console.error("ingest orchestrator failed:", err.message);
  process.exit(1);
});
