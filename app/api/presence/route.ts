import { NextResponse } from "next/server";
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
    countGlobal: false,
    requireHuman: false,
  });
  if (blocked) return blocked;

  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  // 1) Stamp THIS user active. The RLS-bound client updates only their own row.
  //    Best-effort — a hiccup here must not break the live count.
  const stamp = await auth.supabase
    .from("profiles")
    .update({ last_seen: new Date().toISOString() })
    .eq("id", auth.user.id);
  if (stamp.error) {
    console.warn("presence last_seen update failed", stamp.error.message);
  }

  // 2) Count everyone active in the window. Service-role so it sees all rows;
  //    only the number leaves the server, never who. We stamped first, so the
  //    caller is always included — fall back to 1 (at least this user) if the
  //    count query hiccups.
  const count = (await countOnline(createSupabaseAdminClient())) ?? 1;

  return NextResponse.json({ count });
}
