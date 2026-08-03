import { NextResponse } from "next/server";
import { z } from "zod";
import { guardApi } from "@/lib/apiGuard";
import { requireUser } from "@/lib/supabase/user";
import { rowToRound, type RoundRow } from "@/lib/roundMap";
import { ROUND_RESULTS, ROUND_SIDES } from "@/types";

/**
 * The debater's Round Log, stored per-account in Supabase (`rounds` table).
 *
 * ISOLATION IS ENFORCED TWICE, on purpose:
 *   1. RLS in Postgres scopes every query to `auth.uid()`
 *      (supabase/migrations/…_harden_existing_rls.sql).
 *   2. Every query below ALSO filters on `user_id` explicitly.
 * (2) exists because (1) used to be the only line of defense while living
 * exclusively in the Supabase dashboard — invisible to code review, absent from
 * version control, and one accidental toggle away from turning these handlers
 * into "return every user's rounds". The id always comes from the verified
 * session (`auth.user.id`), never from the request.
 *
 *   GET    → { rounds }         all of my rounds, newest first
 *   POST   → { round } | { rounds }   add one round, or a batch (localStorage import)
 *   DELETE → ?id=<uuid>         remove one of my rounds
 */

const newRoundSchema = z.object({
  tournament: z.string().trim().min(1).max(200),
  roundLabel: z.string().trim().min(1).max(100),
  side: z.enum(ROUND_SIDES),
  result: z.enum(ROUND_RESULTS),
  opponent: z.string().trim().max(200).optional(),
  report: z.string().max(4000).optional().default(""),
});

// Accept a single round OR a batch (the one-time import of on-device rounds).
const postSchema = z.union([
  z.object({ round: newRoundSchema }),
  z.object({ rounds: z.array(newRoundSchema).min(1).max(500) }),
]);

const COLUMNS = "id,tournament,round_label,side,result,opponent,report,created_at";

// Lightweight guard: same-origin + a generous rate limit. No Turnstile gate
// (auth is the real gate here) and no AI-budget counting (this isn't AI work).
const GUARD = { name: "rounds", requireHuman: false, countGlobal: false, perMinute: 60 } as const;

/** Page size: default, and the ceiling a caller may request. */
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/**
 * GET /api/rounds?limit=100&before=<iso-timestamp>
 *
 * CURSOR pagination, not limit/offset. Offset was rejected deliberately: it
 * degrades as the offset grows (Postgres still walks and discards every skipped
 * row), and it SKIPS OR DUPLICATES rows when the underlying set changes between
 * pages — which it does here, because a user can log a round while paging. A
 * cursor on `created_at` is stable under concurrent inserts and rides the
 * existing (user_id, created_at desc) index as a range scan.
 *
 * Returns `nextCursor` when more rows may exist; null when the page wasn't full,
 * which means the caller has reached the end.
 */
export async function GET(req: Request) {
  const blocked = await guardApi(req, GUARD);
  if (blocked) return blocked;
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const rawLimit = Number(url.searchParams.get("limit"));
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), MAX_LIMIT) : DEFAULT_LIMIT;
  const before = url.searchParams.get("before");

  let query = auth.supabase
    .from("rounds")
    .select(COLUMNS)
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
    console.error("rounds GET failed", error);
    return NextResponse.json({ error: "Couldn't load your rounds." }, { status: 500 });
  }

  const rows = data as unknown as RoundRow[];
  const rounds = rows.map(rowToRound);
  // Only advertise another page when this one came back full.
  const nextCursor = rows.length === limit ? rows[rows.length - 1].created_at : null;

  return NextResponse.json({ rounds, nextCursor });
}

export async function POST(req: Request) {
  const blocked = await guardApi(req, GUARD);
  if (blocked) return blocked;
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Add at least the tournament and the round." }, { status: 400 });
  }

  const single = "round" in parsed.data;
  const inputs = "round" in parsed.data ? [parsed.data.round] : parsed.data.rounds;
  const rows = inputs.map((r) => ({
    user_id: auth.user.id,
    tournament: r.tournament,
    round_label: r.roundLabel,
    side: r.side,
    result: r.result,
    opponent: r.opponent ?? null,
    report: r.report,
  }));

  const { data, error } = await auth.supabase.from("rounds").insert(rows).select(COLUMNS);
  if (error) {
    console.error("rounds POST failed", error);
    return NextResponse.json({ error: "Couldn't save your round." }, { status: 500 });
  }
  const saved = (data as unknown as RoundRow[]).map(rowToRound);
  return NextResponse.json(single ? { round: saved[0] } : { rounds: saved });
}

export async function DELETE(req: Request) {
  const blocked = await guardApi(req, GUARD);
  if (blocked) return blocked;
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing round id." }, { status: 400 });

  // Ownership is asserted here as well as in RLS: `id` is attacker-controlled
  // (it's a query param), so this is exactly the spot where a missing policy
  // would become "delete any round by guessing its id".
  const { error } = await auth.supabase
    .from("rounds")
    .delete()
    .eq("id", id)
    .eq("user_id", auth.user.id);
  if (error) {
    console.error("rounds DELETE failed", error);
    return NextResponse.json({ error: "Couldn't delete that round." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
