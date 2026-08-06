// Holds a credential for a third-party service. Importing this from a Client
// Component is a BUILD ERROR, not a silent leak — same guard as supabase/admin.
import "server-only";
import crypto from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Storage for each user's opencaselist session token.
 *
 * The user signs in with their OWN Tabroom account; we exchange the credentials
 * once for a `caselist_token` and keep only that, encrypted. The password is
 * never written anywhere — not to the database, not to a log.
 *
 * The token never reaches the browser. Everything here runs server-side.
 */

/** opencaselist issues two-week sessions (server/v1/controllers/login/postLogin.js). */
export const CASELIST_SESSION_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * A session is treated as expired slightly early. Discovering expiry by firing a
 * request and getting a 401 costs the user a round trip and looks like a bug;
 * re-prompting a few minutes sooner costs nothing.
 */
const EXPIRY_SKEW_MS = 5 * 60 * 1000;

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12; // 96-bit nonce, the GCM standard

export interface EncryptedToken {
  ciphertext: string;
  iv: string;
  tag: string;
}

export interface CaselistSession {
  token: string;
  expiresAt: Date;
  connectedLabel: string | null;
}

/** Thrown when the feature is enabled in the UI but the server key is missing. */
export class CaselistNotConfiguredError extends Error {
  constructor() {
    super("The opencaselist connection isn't configured on this server.");
    this.name = "CaselistNotConfiguredError";
  }
}

/**
 * The encryption key, from CASELIST_TOKEN_KEY (32 bytes, base64).
 *
 * Absent key means the feature is OFF, not that we fall back to storing tokens
 * in the clear. Generate one with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 */
function readKey(): Buffer | null {
  const raw = process.env.CASELIST_TOKEN_KEY;
  if (!raw) return null;
  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    return null;
  }
  if (key.length !== KEY_BYTES) {
    console.error(
      `CASELIST_TOKEN_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}. The opencaselist connection is disabled.`,
    );
    return null;
  }
  return key;
}

/** Whether the wiki feature can run at all on this deployment. */
export function isCaselistConfigured(): boolean {
  return readKey() !== null;
}

function requireKey(): Buffer {
  const key = readKey();
  if (!key) throw new CaselistNotConfiguredError();
  return key;
}

/** AES-256-GCM. A fresh random IV per call — never reuse one with a given key. */
export function encryptToken(token: string, key: Buffer = requireKey()): EncryptedToken {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

/**
 * Reverse of {@link encryptToken}. GCM authenticates as well as encrypts, so a
 * tampered row throws here instead of yielding a corrupted token — callers treat
 * a throw as "not connected" and re-prompt.
 */
export function decryptToken(enc: EncryptedToken, key: Buffer = requireKey()): string {
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(enc.iv, "base64"));
  decipher.setAuthTag(Buffer.from(enc.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(enc.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** True when a session is past its (skew-adjusted) life. Pure — exported for tests. */
export function isExpired(expiresAt: Date, now: number = Date.now()): boolean {
  return expiresAt.getTime() - EXPIRY_SKEW_MS <= now;
}

/** Default expiry for a freshly minted session. */
export function defaultExpiry(now: number = Date.now()): Date {
  return new Date(now + CASELIST_SESSION_MS);
}

/** Store (or replace) a user's connection. Upsert — one live session per user. */
export async function saveSession(
  userId: string,
  token: string,
  opts: { expiresAt?: Date; connectedLabel?: string | null } = {},
): Promise<void> {
  const enc = encryptToken(token);
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("caselist_sessions").upsert(
    {
      user_id: userId,
      token_ciphertext: enc.ciphertext,
      token_iv: enc.iv,
      token_tag: enc.tag,
      connected_label: opts.connectedLabel ?? null,
      expires_at: (opts.expiresAt ?? defaultExpiry()).toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) {
    // Deliberately does not include the row — it holds the credential.
    console.error("caselistAuth.saveSession failed", error.message);
    throw new Error("Couldn't save the opencaselist connection.");
  }
}

/**
 * The user's live session, or null when absent, expired, or undecryptable.
 *
 * Every "no usable session" case collapses to null on purpose: the caller's
 * response is identical in all of them (ask the user to reconnect), and
 * distinguishing them in the UI would only leak detail about our storage.
 */
export async function loadSession(userId: string): Promise<CaselistSession | null> {
  if (!isCaselistConfigured()) return null;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("caselist_sessions")
    .select("token_ciphertext, token_iv, token_tag, connected_label, expires_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("caselistAuth.loadSession failed", error.message);
    return null;
  }
  if (!data) return null;

  const expiresAt = new Date(data.expires_at as string);
  if (Number.isNaN(expiresAt.getTime()) || isExpired(expiresAt)) return null;

  try {
    const token = decryptToken({
      ciphertext: data.token_ciphertext as string,
      iv: data.token_iv as string,
      tag: data.token_tag as string,
    });
    return {
      token,
      expiresAt,
      connectedLabel: (data.connected_label as string | null) ?? null,
    };
  } catch {
    // Wrong key or tampered row. Not recoverable and not worth alarming about —
    // the user simply reconnects.
    console.warn("caselistAuth: stored token could not be decrypted; treating as disconnected.");
    return null;
  }
}

/** Forget a user's connection (explicit disconnect). */
export async function clearSession(userId: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("caselist_sessions").delete().eq("user_id", userId);
  if (error) {
    console.error("caselistAuth.clearSession failed", error.message);
    throw new Error("Couldn't disconnect from opencaselist.");
  }
}
