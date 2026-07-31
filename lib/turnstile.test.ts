import { describe, expect, it } from "vitest";
import { checkHumanCookieValue, makeHumanCookieValue } from "@/lib/turnstile";

const SECRET = "test-secret-key";
const NOW = 1_000_000_000_000;

describe("human cookie sign/verify", () => {
  it("accepts a freshly minted cookie", () => {
    const value = makeHumanCookieValue(SECRET, NOW, 60_000);
    expect(checkHumanCookieValue(value, SECRET, NOW + 1000)).toBe(true);
  });

  it("rejects an expired cookie", () => {
    const value = makeHumanCookieValue(SECRET, NOW, 60_000);
    expect(checkHumanCookieValue(value, SECRET, NOW + 61_000)).toBe(false);
  });

  it("rejects a tampered expiry (signature no longer matches)", () => {
    const value = makeHumanCookieValue(SECRET, NOW, 60_000);
    const [, mac] = value.split(".");
    const forged = `${NOW + 10_000_000}.${mac}`;
    expect(checkHumanCookieValue(forged, SECRET, NOW)).toBe(false);
  });

  it("rejects a cookie signed with a different secret", () => {
    const value = makeHumanCookieValue(SECRET, NOW, 60_000);
    expect(checkHumanCookieValue(value, "other-secret", NOW + 1000)).toBe(false);
  });

  it("rejects empty / malformed values", () => {
    expect(checkHumanCookieValue(undefined, SECRET, NOW)).toBe(false);
    expect(checkHumanCookieValue("", SECRET, NOW)).toBe(false);
    expect(checkHumanCookieValue("nodot", SECRET, NOW)).toBe(false);
  });
});
