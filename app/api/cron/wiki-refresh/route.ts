import { NextResponse } from "next/server";
import { ingestActiveSeason } from "@/services/wikiIngest";

/**
 * Scheduled wiki refresh — keep the CURRENT season's disclosures current.
 *
 * The whole-history backfill is a one-time job (past seasons never change), run
 * from scripts/ingest-wiki.mjs. This cron only tops up the active season: it
 * re-ingests just the newest archives of this year's caselists, which is small
 * enough to finish inside the function budget — a full crawl never would.
 * Users never ingest anything; they search the shared index this keeps fresh.
 *
 * Wired to a weekly Vercel Cron in vercel.json and signed with CRON_SECRET,
 * exactly like /api/cron/purge — it runs a Tabroom login and writes the shared
 * corpus with the service-role key, so a stranger must not be able to trigger it.
 */

export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    if (req.headers.get("authorization") !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    // Refuse to run unauthenticated in production rather than expose a crawl
    // endpoint to the open internet.
    console.error("cron/wiki-refresh: CRON_SECRET is not set — refusing to run.");
    return NextResponse.json({ error: "Not configured." }, { status: 503 });
  }

  try {
    const summaries = await ingestActiveSeason();
    const cards = summaries.reduce((total, s) => total + s.cards, 0);
    const result = { ok: true, caselists: summaries.length, cards };
    console.info("cron/wiki-refresh complete", result);
    return NextResponse.json(result);
  } catch (err) {
    console.error("cron/wiki-refresh failed", err);
    return NextResponse.json({ error: "Refresh failed." }, { status: 500 });
  }
}
