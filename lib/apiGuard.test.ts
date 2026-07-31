import { describe, expect, it } from "vitest";
import { bodyTooLarge, clientIp, sameOriginOk } from "@/lib/apiGuard";

function req(headers: Record<string, string>): Request {
  return new Request("https://lbl.example/api/x", { method: "POST", headers });
}

describe("clientIp", () => {
  it("uses the first x-forwarded-for hop", () => {
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
  });
  it("ignores the forgeable client-id header (falls back to unknown)", () => {
    expect(clientIp(req({ "x-lbl-client": "botbotbot" }))).toBe("unknown");
  });
  it("falls back to x-real-ip", () => {
    expect(clientIp(req({ "x-real-ip": "198.51.100.9" }))).toBe("198.51.100.9");
  });
});

describe("sameOriginOk", () => {
  it("allows a same-host Origin", () => {
    expect(sameOriginOk(req({ origin: "https://lbl.example", host: "lbl.example" }))).toBe(true);
  });
  it("blocks a cross-site Origin", () => {
    expect(sameOriginOk(req({ origin: "https://evil.test", host: "lbl.example" }))).toBe(false);
  });
  it("allows a missing Origin (non-browser clients handled by rate limit/BotID)", () => {
    expect(sameOriginOk(req({ host: "lbl.example" }))).toBe(true);
  });
});

describe("bodyTooLarge", () => {
  it("flags an oversized Content-Length", () => {
    expect(bodyTooLarge(req({ "content-length": "500000" }), 256 * 1024)).toBe(true);
  });
  it("allows a within-limit body and a missing Content-Length", () => {
    expect(bodyTooLarge(req({ "content-length": "1000" }), 256 * 1024)).toBe(false);
    expect(bodyTooLarge(req({}), 256 * 1024)).toBe(false);
  });
});
