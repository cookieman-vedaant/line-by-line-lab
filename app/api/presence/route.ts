import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { guardApi } from "@/lib/apiGuard";
import { countOnline } from "@/lib/presence";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/supabase/user";

// A tiny, frequent ping — keep it snappy.
export const maxDuration = 10;

/**
 * Presence heartbeat: record that THIS signed-in user is active and return the
 * live online count.
 *
 * Both the stamp and the count go through `profiles.last_seen` in Postgres — the
 * one store shared across every serverless instance — so the count is correct
 * across DIFFERENT users on different devices (an in-memory count only ever sees
 * one instance's visitors). The developer reads the same signal in Supabase
 * (Table editor / SQL on `profiles`, ordered by `last_seen`) to see WHO is online.
 *
 * Only logged-in users reach the Lab (where the count lives), so this requires a
 * session. Not an AI call (countGlobal:false); generous per-IP limit since many
 * people may ping from one school network.
 */
export async function POST(req: Request) {
  const blocked = await guardApi(req, {
    name: "presence",
    perMinute: 120,
    // A 15s heartbeat is ~5,760 pings/day (more with several tabs). The default
    // 120/day cap would 429 the live count after ~30 min of use, so give the
    // heartbeat a generous daily ceiling that still bounds abuse.
    perDay: 20000,
    countGlobal: false,
    requireHuman: false,
  });
  if (blocked) return blocked;

  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  // Prefer the service-role admin client for BOTH the stamp and the count. Using
  // it for the stamp matters: the write is scoped to the caller's OWN row by their
  // verified session id (auth.user.id — never client input), so a missing/edge
  // RLS UPDATE policy on `profiles` can't silently drop the heartbeat (Postgres
  // returns no error for an RLS-blocked update, so that failure is invisible).
  // If the admin client is unavailable (e.g. SUPABASE_SERVICE_ROLE_KEY isn't set
  // in this environment), fall back to the user's RLS client for the stamp and
  // just report the caller as online — never 500, never hide the chip.
  let admin: SupabaseClient | null = null;
  try {
    admin = createSupabaseAdminClient();
  } catch (err) {
    console.warn("presence: admin client unavailable; using RLS client, count=1", err);
  }

  // 1) Stamp THIS user active. UPSERT (not UPDATE) so a user with no `profiles`
  //    row yet is created and counted: the signup->profiles trigger is
  //    unreliable (we saw more auth users than profiles rows), and a plain UPDATE
  //    on a missing row stamps ZERO rows, making that user invisible to the count
  //    — the "live count doesn't move when a new person logs in" bug. `tier` and
  //    `created_at` fill from their column defaults; the id FK is satisfied
  //    because auth.user.id is a verified, existing auth user. Best-effort — a
  //    hiccup here must not break the count.
  const stamp = await (admin ?? auth.supabase)
    .from("profiles")
    .upsert({ id: auth.user.id, last_seen: new Date().toISOString() }, { onConflict: "id" });
  if (stamp.error) {
    console.warn("presence last_seen upsert failed", stamp.error.message);
  }

  // 2) Count everyone active in the window. Only the NUMBER leaves the server,
  //    never who. We just stamped the caller, so they're always in the window —
  //    and because a signed-in caller IS online by definition, we floor the
  //    result at 1. This is the crux of the "chip won't show" bug: countOnline
  //    returns 0 (not null) for an empty window, so `?? 1` couldn't catch it and
  //    the route returned {count: 0}, which LiveCount hides at `count < 1`.
  let count = 1;
  if (admin) {
    try {
      count = Math.max(1, (await countOnline(admin)) ?? 1);
    } catch (err) {
      console.warn("presence count unavailable; showing 1", err);
    }
  }

  return NextResponse.json({ count });
}
