import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * BotID has two halves that must agree, and nothing at build time enforces it.
 *
 * The client (instrumentation-client.ts) runs an invisible challenge and
 * attaches the proof ONLY to the paths it is told to protect. The server
 * (botBlock) rejects any request whose proof is missing. So a route that calls
 * botBlock without being listed client-side rejects EVERY REAL USER, 100% of
 * the time, and only in production — local dev always returns isBot:false.
 *
 * That is exactly what shipped: /api/sharpen called botBlock but was never
 * added to the protect list, so "Sharpen this claim" answered every debater
 * with "This request was flagged as automated."
 *
 * tsc and eslint cannot see this. This test can.
 */

const ROOT = path.resolve(__dirname, "..");

/**
 * Routes allowed to call botBlock without a client registration, because no
 * browser is involved and no proof could ever be attached.
 */
const EXEMPT = new Set([
  // Stripe calls this server-to-server; a browser challenge is impossible.
  "/api/billing/webhook",
]);

function routePathsCallingBotBlock(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      routePathsCallingBotBlock(full, acc);
    } else if (entry.name === "route.ts" && /\bbotBlock\s*\(/.test(fs.readFileSync(full, "utf8"))) {
      acc.push(
        `/${path.relative(ROOT, path.dirname(full)).split(path.sep).join("/")}`.replace(/^\/app/, ""),
      );
    }
  }
  return acc;
}

describe("BotID client/server registration", () => {
  const client = fs.readFileSync(path.join(ROOT, "instrumentation-client.ts"), "utf8");
  const protectedPaths = new Set(
    [...client.matchAll(/path:\s*"([^"]+)"/g)].map((m) => m[1]),
  );

  it("protects every route that verifies a bot proof", () => {
    const unregistered = routePathsCallingBotBlock(path.join(ROOT, "app", "api"))
      .filter((p) => !protectedPaths.has(p) && !EXEMPT.has(p))
      .sort();
    expect(unregistered).toEqual([]);
  });

  it("found the real routes, so the scan itself can't silently pass", () => {
    expect(protectedPaths.has("/api/search")).toBe(true);
    expect(protectedPaths.has("/api/sharpen")).toBe(true);
  });
});
