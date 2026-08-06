import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken, isExpired } from "@/lib/caselistAuth";

const KEY = crypto.randomBytes(32);

describe("token encryption", () => {
  it("round-trips a token", () => {
    const token = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4";
    expect(decryptToken(encryptToken(token, KEY), KEY)).toBe(token);
  });

  it("uses a fresh IV each time, so the same token never has the same ciphertext", () => {
    // Reusing an IV with a given key breaks GCM badly. This catches a future
    // "optimization" that hoists the IV out of the function.
    const a = encryptToken("same-token", KEY);
    const b = encryptToken("same-token", KEY);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("refuses a token encrypted under a different key", () => {
    const enc = encryptToken("secret", KEY);
    expect(() => decryptToken(enc, crypto.randomBytes(32))).toThrow();
  });

  it("refuses a tampered ciphertext rather than returning garbage", () => {
    // GCM authenticates as well as encrypts — that is the point of using it.
    const enc = encryptToken("secret", KEY);
    const bytes = Buffer.from(enc.ciphertext, "base64");
    bytes[0] ^= 0xff;
    expect(() =>
      decryptToken({ ...enc, ciphertext: bytes.toString("base64") }, KEY),
    ).toThrow();
  });

  it("refuses a tampered auth tag", () => {
    const enc = encryptToken("secret", KEY);
    const tag = Buffer.from(enc.tag, "base64");
    tag[0] ^= 0xff;
    expect(() => decryptToken({ ...enc, tag: tag.toString("base64") }, KEY)).toThrow();
  });
});

describe("isExpired", () => {
  const now = Date.UTC(2026, 7, 3, 12, 0, 0);

  it("is false for a session with time left", () => {
    expect(isExpired(new Date(now + 60 * 60 * 1000), now)).toBe(false);
  });

  it("is true once past the expiry", () => {
    expect(isExpired(new Date(now - 1000), now)).toBe(true);
  });

  it("expires slightly EARLY, so we re-prompt instead of firing a doomed request", () => {
    // Within the skew window: still technically valid upstream, but we treat it
    // as gone rather than spend a request discovering a 401.
    expect(isExpired(new Date(now + 60 * 1000), now)).toBe(true);
  });
});
