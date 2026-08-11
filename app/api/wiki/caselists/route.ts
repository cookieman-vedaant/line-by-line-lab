import { NextResponse } from "next/server";
import { guardApi } from "@/lib/apiGuard";
import { listWikiCaselists } from "@/services/wikiMining";

/**
 * GET /api/wiki/caselists → the caselists a debater can filter a wiki search by.
 *
 * Read from the index itself rather than a hardcoded list, so a newly ingested
 * caselist becomes filterable without a deploy and a caselist we do NOT hold is
 * never offered as an option that silently returns nothing.
 *
 * Only aggregate counts leave the server — no card content — so this is cheap
 * and safe to call on panel mount. It is not counted against the global AI
 * ceiling: it does no AI work, and letting a dropdown burn that budget would
 * take the actual tools offline.
 */
export const maxDuration = 15;

export async function GET(req: Request) {
  const blocked = await guardApi(req, {
    name: "wikiCaselists",
    requireAuth: true,
    countGlobal: false,
    // The panel fetches this once per mount, so a debater flipping between tabs
    // must not trip the default per-minute cap on a read this cheap.
    perMinute: 30,
    perDay: 300,
  });
  if (blocked) return blocked;

  const caselists = await listWikiCaselists();
  return NextResponse.json(
    { caselists },
    // Same list for every user and it changes only on ingest, so let the browser
    // hold it briefly rather than refetching on each panel mount.
    { headers: { "Cache-Control": "private, max-age=300" } },
  );
}
