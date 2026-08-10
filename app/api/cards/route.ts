import { NextResponse } from "next/server";
import { guardApi } from "@/lib/apiGuard";
import { CUT_CARD_LIST_COLUMNS, rowToCardSummary, type CutCardListRow } from "@/lib/cutCardMap";
import { CUT_CARDS_MAX_PER_USER } from "@/lib/cutCardLimit";
import { requireUser } from "@/lib/supabase/user";

/**
 * The account's card-cut history (`cut_cards` table). Rows are WRITTEN by
 * /api/cut, never by this route — a client that could post its own history
 * entries could put text into a card record that no Card Cutter ever produced,
 * which is the no-fabrication rule's whole concern. Read and delete only.
 *
 * ISOLATION IS ENFORCED TWICE, exactly as in /api/rounds:
 *   1. RLS in Postgres scopes every query to `auth.uid()`
 *      (supabase/migrations/…_cut_cards.sql).
 *   2. Every query below ALSO filters on `user_id` explicitly.
 * The id always comes from the verified session, never from the request.
 *
 *   GET    → { cards, nextCursor }
 *   DELETE → ?id=<uuid>
 */

// Same guard shape as /api/rounds: auth is the real gate, and none of this is
// AI work, so it neither demands the human cookie nor spends the AI budget.
const GUARD = { name: "cards", requireHuman: false, countGlobal: false, perMinute: 60 } as const;

/**
 * Page size. Generous BECAUSE the rows are summaries: at ~200 bytes each a
 * 100-row page is ~20KB, so most libraries arrive in a single request. Sending
 * bodies here is what used to make this expensive (~20KB per card), not the
 * number of rows.
 */
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

/**
 * GET /api/cards?limit=50&before=<iso-timestamp>
 *
 * CURSOR pagination on `created_at`, not limit/offset — offset degrades as it
 * grows and skips or duplicates rows when the set changes between pages, which
 * it does here because a user can cut a card while paging. Rides the
 * (user_id, created_at desc) index as a range scan.
 */
export async function GET(req: Request) {
  const blocked = await guardApi(req, GUARD);
  if (blocked) return blocked;
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const rawLimit = Number(url.searchParams.get("limit"));
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), MAX_LIMIT)
      : DEFAULT_LIMIT;
  const before = url.searchParams.get("before");

  let query = auth.supabase
    .from("cut_cards")
    .select(CUT_CARD_LIST_COLUMNS)
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (before) {
    // Reject a malformed cursor rather than silently returning page 1 again,
    // which would make a client loop forever.
    if (Number.isNaN(Date.parse(before))) {
      return NextResponse.json({ error: "Invalid pagination cursor." }, { status: 400 });
    }
    query = query.lt("created_at", before);
  }

  const { data, error } = await query;
  if (error) {
    console.error("cards GET failed", error);
    return NextResponse.json({ error: "Couldn't load your card history." }, { status: 500 });
  }

  const rows = data as unknown as CutCardListRow[];
  const cards = rows.map(rowToCardSummary);
  // Only advertise another page when this one came back full.
  const nextCursor = rows.length === limit ? rows[rows.length - 1].created_at : null;

  // The cap travels with the list so the panel can say what the ceiling is
  // without hardcoding a number that could drift from the database's.
  return NextResponse.json({ cards, nextCursor, limit: CUT_CARDS_MAX_PER_USER });
}

export async function DELETE(req: Request) {
  const blocked = await guardApi(req, GUARD);
  if (blocked) return blocked;
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing card id." }, { status: 400 });

  // Ownership is asserted here as well as in RLS: `id` is attacker-controlled
  // (it's a query param), so this is exactly the spot where a missing policy
  // would become "delete any card by guessing its id".
  const { error } = await auth.supabase
    .from("cut_cards")
    .delete()
    .eq("id", id)
    .eq("user_id", auth.user.id);
  if (error) {
    console.error("cards DELETE failed", error);
    return NextResponse.json({ error: "Couldn't delete that card." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
