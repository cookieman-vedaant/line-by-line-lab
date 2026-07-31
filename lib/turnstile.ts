import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Server side of the "verify you're human" gate (Cloudflare Turnstile — free).
 * A visitor solves a Turnstile challenge once; the server verifies it with
 * Cloudflare and issues a short-lived signed cookie. Protected API routes then
 * require that cookie (see lib/apiGuard). A bot can't solve Turnstile, so it
 * never gets the cookie and is blocked from every expensive endpoint.
 *
 * The gate is OPTIONAL: with no TURNSTILE_SECRET_KEY set it's OFF (the app works
 * exactly as before). Add the key to switch it on — like the Redis/BotID layers.
 * The cookie is signed with the Turnstile secret, so no extra secret is needed.
 */

export const HUMAN_COOKIE = "lbl-human";
export const HUMAN_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** True when the gate is switched on (server secret present). */
export function turnstileEnabled(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY);
}

// ---- pure signed-cookie logic (unit-tested) -------------------------------

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** Build a signed cookie value `<exp>.<hmac>` that expires `ttlMs` from `now`. */
export function makeHumanCookieValue(secret: string, now: number, ttlMs: number = HUMAN_TTL_MS): string {
  const exp = String(now + ttlMs);
  return `${exp}.${sign(exp, secret)}`;
}

/** Validate a cookie value: correct signature (constant-time) and not expired. */
export function checkHumanCookieValue(value: string | undefined, secret: string, now: number): boolean {
  if (!value) return false;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return false;
  const exp = value.slice(0, dot);
  const mac = value.slice(dot + 1);
  const expected = sign(exp, secret);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  const expNum = Number(exp);
  return Number.isFinite(expNum) && expNum > now;
}

// ---- request-facing wrappers ---------------------------------------------

function cookieFromHeader(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

/** True if the request carries a valid human cookie — or the gate is OFF. */
export function requestIsVerifiedHuman(req: Request): boolean {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true; // gate disabled → allow
  const value = cookieFromHeader(req.headers.get("cookie"), HUMAN_COOKIE);
  return checkHumanCookieValue(value, secret, Date.now());
}

/** Verify a Turnstile token with Cloudflare. Returns false on any failure. */
export async function verifyTurnstileToken(token: string, ip?: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true; // gate off
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip && ip !== "unknown") body.set("remoteip", ip);
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch (err) {
    console.warn("turnstile siteverify failed", String(err));
    return false;
  }
}
