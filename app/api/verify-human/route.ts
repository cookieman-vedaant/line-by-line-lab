import { NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, guardApi } from "@/lib/apiGuard";
import {
  HUMAN_COOKIE,
  HUMAN_TTL_MS,
  makeHumanCookieValue,
  turnstileEnabled,
  verifyTurnstileToken,
} from "@/lib/turnstile";

// Fast: one Cloudflare siteverify call.
export const maxDuration = 15;

const requestSchema = z.object({ token: z.string().min(1).max(4096) });

/**
 * Issue the "human" cookie after a solved Turnstile challenge. This is the gate
 * ENTRY point, so it must NOT require the human cookie itself (requireHuman:
 * false); it is still rate-limited and doesn't count toward the AI budget.
 */
export async function POST(req: Request) {
  const blocked = await guardApi(req, { name: "verify", requireHuman: false, countGlobal: false });
  if (blocked) return blocked;

  // Gate off (no secret configured): nothing to verify.
  if (!turnstileEnabled()) {
    return NextResponse.json({ ok: true, gate: "off", ttlMs: HUMAN_TTL_MS });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Missing verification token." }, { status: 400 });
  }

  const passed = await verifyTurnstileToken(parsed.data.token, clientIp(req));
  if (!passed) {
    return NextResponse.json(
      { ok: false, error: "Verification failed. Please try the check again." },
      { status: 403 },
    );
  }

  const secret = process.env.TURNSTILE_SECRET_KEY!;
  const res = NextResponse.json({ ok: true, ttlMs: HUMAN_TTL_MS });
  res.cookies.set(HUMAN_COOKIE, makeHumanCookieValue(secret, Date.now(), HUMAN_TTL_MS), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production", // http on localhost, https in prod
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(HUMAN_TTL_MS / 1000),
  });
  return res;
}
