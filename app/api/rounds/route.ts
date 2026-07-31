import { NextResponse } from "next/server";
import { z } from "zod";
import { guardApi } from "@/lib/apiGuard";
import { requireUser } from "@/lib/supabase/user";
import { rowToRound, type RoundRow } from "@/lib/roundMap";
import { ROUND_RESULTS, ROUND_SIDES } from "@/types";

/**
 * The debater's Round Log, stored per-account in Supabase (`rounds` table).
 * RLS scopes every query to `auth.uid()`, so a signed-in user only ever reads or
 * writes their OWN rounds — that's what makes the Record tab identical across the
 * user's devices yet private to them.
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

export async function GET(req: Request) {
  const blocked = await guardApi(req, GUARD);
  if (blocked) return blocked;
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabase
    .from("rounds")
    .select(COLUMNS)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("rounds GET failed", error);
    return NextResponse.json({ error: "Couldn't load your rounds." }, { status: 500 });
  }
  return NextResponse.json({ rounds: (data as unknown as RoundRow[]).map(rowToRound) });
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

  // RLS guarantees this only deletes a row the user owns.
  const { error } = await auth.supabase.from("rounds").delete().eq("id", id);
  if (error) {
    console.error("rounds DELETE failed", error);
    return NextResponse.json({ error: "Couldn't delete that round." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
