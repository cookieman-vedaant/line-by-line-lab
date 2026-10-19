import { NextResponse } from "next/server";
import { ingestActiveSeason } from "@/services/wikiIngest";

/**
 * Manual wiki refresh — a short slice of the current season's catch-up.
 *
 * The scheduled refresh runs on GitHub Actions (scripts/wiki-refresh.ts), NOT
 * here: saving is ~4 cards/s on this database and a busy week is thousands of
 * cards per division, which a 300s function can never finish. As the weekly
 * Vercel cron it died inside the first caselist every week, so later caselists
 * starved. It stays as a manual trigger: it ingests archives until its deadline
 * and records each one it finishes, so the scheduled job picks up after it.
 *
 * Signed with CRON_SECRET, exactly like /api/cron/purge — it runs a Tabroom
 * login and writes the shared corpus with the service-role key, so a stranger
 * must not be able to trigger it.
 */

export const maxDuration = 300;

// Stop STARTING archives with time left for the one in flight.
const DEADLINE_MS = 150_000;

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
    const { summaries, pending } = await ingestActiveSeason({ deadlineAt: Date.now() + DEADLINE_MS });
    const cards = summaries.reduce((total, s) => total + s.cards, 0);
    const result = { ok: true, caselists: summaries.length, cards, pending };
    console.info("cron/wiki-refresh complete", result);
    return NextResponse.json(result);
  } catch (err) {
    console.error("cron/wiki-refresh failed", err);
    return NextResponse.json({ error: "Refresh failed." }, { status: 500 });
  }
}
