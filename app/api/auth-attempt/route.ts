import { NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, sameOriginOk } from "@/lib/apiGuard";
import { audit } from "@/lib/audit";
import { AUTH_ATTEMPT_KINDS, checkAuthAttempt } from "@/lib/authAbuse";
import { banIp, isIpBanned } from "@/lib/ipBan";

/**
 * Preflight for the browser's auth calls (sign-up, confirmation resend, password
 * reset). The AuthForm asks here BEFORE calling Supabase; a block short-circuits
 * the attempt.
 *
 * This route deliberately does NOT use `guardApi`: that guard requires a human
 * cookie and counts against the AI budget, and neither fits a pre-auth call the
 * user makes before they have any session at all. It runs the pieces that do
 * apply — same-origin, ban list — by hand.
 *
 * See lib/authAbuse.ts for why this is a UX/telemetry layer rather than the
 * authoritative defense (short version: enable CAPTCHA protection in the
 * Supabase dashboard — that's the one an attacker can't route around).
 */

export const maxDuration = 10;

const schema = z.object({
  kind: z.enum(AUTH_ATTEMPT_KINDS),
  email: z.string().trim().min(3).max(320).email(),
});

export async function POST(req: Request) {
  if (!sameOriginOk(req)) {
    return NextResponse.json({ ok: false, error: "This request looks cross-site." }, { status: 403 });
  }

  const ip = clientIp(req);
  if (await isIpBanned(ip)) {
    return NextResponse.json(
      { ok: false, error: "This request was blocked. If you think that's a mistake, contact support." },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    // A malformed address never reaches Supabase — and never spends a counter.
    return NextResponse.json({ ok: false, error: "Enter a valid email address." }, { status: 400 });
  }

  const { kind, email } = parsed.data;
  const decision = await checkAuthAttempt(kind, email, ip);

  if (!decision.allowed) {
    if (decision.shouldBan) {
      // Sustained, far past the daily ceiling: automation, not a confused user.
      // Time-boxed on purpose — a school NAT shares one address, so a permanent
      // auto-ban would lock out an entire team over one bad actor.
      const banned = await banIp(ip, {
        reason: `auto: ${kind} attempts past daily threshold`,
        durationMinutes: 24 * 60,
      });
      if (banned) void audit({ action: "ip.banned", ip, detail: { kind, auto: true } });
    }
    void audit({
      action: kind === "signup" ? "auth.signup_throttled" : "auth.resend_throttled",
      ip,
      detail: { kind, tripped: decision.tripped },
    });
    return NextResponse.json({ ok: false, error: decision.error }, { status: 429 });
  }

  return NextResponse.json({ ok: true });
}
