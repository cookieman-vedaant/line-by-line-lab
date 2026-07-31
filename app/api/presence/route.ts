import { NextResponse } from "next/server";
import { guardApi } from "@/lib/apiGuard";
import { heartbeat } from "@/lib/presence";
import { clientKeyFromRequest } from "@/lib/requestClient";

// A tiny, frequent ping — keep it snappy.
export const maxDuration = 10;

/**
 * Presence heartbeat: record this visitor and return the live online count.
 * Not an AI call (countGlobal:false); generous per-IP limit since it's a
 * lightweight ping many people may send from one network. requireHuman:false so
 * the public count shows immediately (even on the verify screen) — inflation is
 * low-stakes since ids dedupe, the rate limit caps it, and entries auto-expire.
 *
 * The presence key comes from clientKeyFromRequest — the seam a future login
 * layer swaps from an anonymous per-browser id to the signed-in user id.
 */
export async function POST(req: Request) {
  const blocked = await guardApi(req, {
    name: "presence",
    perMinute: 120,
    countGlobal: false,
    requireHuman: false,
  });
  if (blocked) return blocked;

  const count = await heartbeat(clientKeyFromRequest(req));
  return NextResponse.json({ count });
}
