/**
 * Scheduled wiki refresh — bring the current season's caselists up to date.
 *
 * Runs on GitHub Actions (.github/workflows/wiki-refresh.yml), not Vercel: a
 * busy week is thousands of cards per division and saving runs at ~4 cards/s on
 * this database, far past a 300s function. This works for hours, newest week
 * first, records each archive it finishes, pauses while the database is slow,
 * and stops starting new archives at its time budget — the next run resumes.
 *
 *   npx tsx --conditions=react-server scripts/wiki-refresh.ts
 *
 * `--conditions=react-server` lets the server-only modules load outside Next.
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * CASELIST_INGEST_USERNAME, CASELIST_INGEST_PASSWORD; optional
 * WIKI_REFRESH_BUDGET_MIN (default 300), WIKI_UPSERT_PACE_MS.
 */
import { ingestActiveSeason, waitForHealthyDb } from "@/services/wikiIngest";

const budgetMin = Number(process.env.WIKI_REFRESH_BUDGET_MIN) > 0 ? Number(process.env.WIKI_REFRESH_BUDGET_MIN) : 300;

async function main(): Promise<void> {
  const started = Date.now();
  const { summaries, pending } = await ingestActiveSeason({
    deadlineAt: started + budgetMin * 60_000,
    beforeArchive: waitForHealthyDb,
  });
  for (const s of summaries) {
    console.info(
      `${s.caselist}: ${s.cards} new cards from ${s.archives} archive(s)${s.failedArchives ? `, ${s.failedArchives} failed` : ""}`,
    );
  }
  const cards = summaries.reduce((n, s) => n + s.cards, 0);
  console.info(
    `wiki-refresh: ${cards} new cards in ${Math.round((Date.now() - started) / 60_000)} min; ${pending} archive(s) still pending`,
  );
}

main().catch((err: unknown) => {
  console.error("wiki-refresh failed", err);
  process.exit(1);
});
