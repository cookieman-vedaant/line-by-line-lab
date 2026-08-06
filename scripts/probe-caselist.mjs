/**
 * Diagnostic probe against the opencaselist API.
 *
 * WHY THIS EXISTS: their search controller swallows Solr failures —
 *
 *     } catch (err) { debugLogger.info(err.message); solr = []; }
 *
 * — and returns 200 with an empty array. So "this query is broken" and "nothing
 * matches" look identical from outside, and no amount of reading their source
 * settles which one we're hitting. This runs the candidate strategies against
 * the real API and reports what each actually returns.
 *
 * THIS IS A LOCAL DEV TOOL. The credentials below are only ever read from your
 * own .env.local on your own machine. Real users never touch this: they connect
 * their own Tabroom account through the Wiki tab, and each user's token is
 * stored encrypted and separately (see lib/caselistAuth.ts).
 *
 * Usage — add to .env.local, then `npm run probe:caselist`:
 *     TABROOM_USERNAME=you@example.com
 *     TABROOM_PASSWORD=...
 *
 * The password is sent once to log in and never logged or written anywhere.
 * Read-only: no writes, no downloads. Their limit is 4 searches/minute, so this
 * paces itself and takes a few minutes. Let it run.
 */

import { readFileSync } from "node:fs";

const API = "https://api.opencaselist.com/v1";
const UA = "LineByLineLab/1.0 (probe; +https://line-by-line-lab.vercel.app)";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const username = process.env.TABROOM_USERNAME;
const password = process.env.TABROOM_PASSWORD;
if (!username || !password) {
  console.error(
    "Add TABROOM_USERNAME and TABROOM_PASSWORD to .env.local first (local dev only).",
  );
  process.exit(1);
}

/** A phrase the user confirmed exists on the wiki. */
const QUERY = process.env.PROBE_QUERY ?? "brahman is the ultimate truth";
/** Their limit is 4/min; 16s between searches keeps us comfortably under it. */
const PACE_MS = 16_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const loginRes = await fetch(`${API}/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": UA },
    body: JSON.stringify({ username, password, remember: true }),
  });
  if (!loginRes.ok) {
    console.error(`login failed: HTTP ${loginRes.status} ${await loginRes.text()}`);
    process.exit(1);
  }
  const body = await loginRes.json().catch(() => ({}));
  const token =
    body.token || (loginRes.headers.get("set-cookie") ?? "").match(/caselist_token=([^;]+)/)?.[1];
  if (!token) {
    console.error("logged in but no token came back.");
    process.exit(1);
  }
  console.log("login OK (token not printed)\n");

  const get = (path) =>
    fetch(`${API}${path}`, {
      headers: { cookie: `caselist_token=${token}`, "user-agent": UA },
    });

  // ---- caselist inventory -------------------------------------------------
  const clRes = await get("/caselists?archived=true");
  let shards = [];
  if (clRes.ok) {
    const caselists = await clRes.json();
    shards = caselists.map((c) => c.name).filter(Boolean);
    console.log(`${caselists.length} caselists exist (all years).`);
    console.log(`fan-out cost at 4 searches/min: ~${Math.ceil(caselists.length / 4)} minutes`);
    console.log(`first 20: ${shards.slice(0, 20).join(", ")}\n`);
  } else {
    console.log(`GET /caselists -> HTTP ${clRes.status}\n`);
  }

  const q = encodeURIComponent(QUERY);

  /*
   * Each candidate for "search every caselist at once". `label` explains what
   * we learn if it works. Order matters: cheapest/cleanest first.
   */
  const strategies = [
    { label: "no shard param at all", qs: `q=${q}` },
    { label: "shard=* (Solr wildcard)", qs: `q=${q}&shard=*` },
    { label: "shard=[* TO *] (range)", qs: `q=${q}&shard=${encodeURIComponent("[* TO *]")}` },
    {
      label: "multi-shard OR (relies on unencoded interpolation)",
      qs: `q=${q}&shard=${encodeURIComponent(`${shards[0] ?? "hsld"} OR shard:${shards[1] ?? "hspolicy"}`)}`,
    },
  ];

  // A known-good single-caselist search proves the QUERY itself finds things,
  // so an empty whole-wiki result can be blamed on the strategy, not the words.
  for (const s of shards.slice(0, 3)) {
    strategies.push({ label: `control: single caselist "${s}"`, qs: `q=${q}&shard=${s}`, control: true });
  }

  console.log(`Query: "${QUERY}"\n${"=".repeat(60)}`);

  let first = true;
  for (const strat of strategies) {
    if (!first) await sleep(PACE_MS);
    first = false;

    const res = await get(`/search?${strat.qs}`);
    process.stdout.write(`${strat.control ? "  " : ""}${strat.label}\n    HTTP ${res.status}  `);

    if (!res.ok) {
      console.log(`REJECTED: ${(await res.text()).slice(0, 140)}`);
      continue;
    }
    let hits;
    try {
      hits = await res.json();
    } catch {
      console.log("unparseable response");
      continue;
    }
    if (!Array.isArray(hits)) {
      console.log(`unexpected shape: ${JSON.stringify(hits).slice(0, 140)}`);
      continue;
    }

    const docs = hits.filter((h) => h.type !== "team");
    const spread = [...new Set(docs.map((h) => h.caselist).filter(Boolean))];
    const years = [...new Set(docs.map((h) => h.year).filter(Boolean))].sort();
    console.log(`${hits.length} hits (${docs.length} files) across ${spread.length} caselists`);
    if (docs.length > 0) {
      console.log(`      years: ${years.join(", ") || "n/a"}`);
      console.log(`      caselists: ${spread.slice(0, 10).join(", ")}`);
      console.log(`      first title: ${docs[0].title ?? "(none)"}`);
      console.log(`      has download_path: ${!!docs[0].download_path}`);
    }
  }

  console.log(`${"=".repeat(60)}`);
  console.log("Send me this whole output and I'll wire up whichever strategy won.");
}

main().catch((err) => {
  console.error("probe failed:", err.message);
  process.exit(1);
});
