import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FONT_IDS } from "@/lib/themeTokens";

/**
 * Regression guard for a silent, whole-feature bug: the theme agent's font
 * never changed because globals.css named its runtime-switchable font vars the
 * SAME as Tailwind's @theme keys (--font-display / --font-mono). A @theme key
 * emits a :root definition; when our :root/[data-font] overrides shared that
 * name, the dev CSS pipeline merged the :root blocks and dropped our overrides,
 * so data-font had no effect. The fix decouples the namespaces: @theme keys stay
 * --font-*, the runtime-switchable vars are --app-display / --app-mono.
 *
 * These assertions lock that invariant in so an innocent rename can't quietly
 * reintroduce the collision.
 */
const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");

describe("globals.css font wiring", () => {
  it("has no self-referential font variable (the bug that broke font switching)", () => {
    expect(css).not.toMatch(/--font-display:\s*var\(--font-display\)/);
    expect(css).not.toMatch(/--font-mono:\s*var\(--font-mono\)/);
  });

  it("drives the runtime font off the decoupled --app-* namespace, not the @theme keys", () => {
    // [data-font] overrides must set --app-display, never --font-display.
    expect(css).toMatch(/\[data-font="zine"\][^}]*--app-display/);
    expect(css).not.toMatch(/\[data-font="[^"]+"\][^}]*--font-display:/);
  });

  it("defines a [data-font] rule for every FontId the agent can pick", () => {
    for (const id of FONT_IDS) {
      expect(css).toMatch(new RegExp(`\\[data-font="${id}"\\][^}]*--app-display`));
    }
  });

  it("keeps a default --app-display on :root so the base theme has a font", () => {
    expect(css).toMatch(/:root\s*\{[^}]*--app-display/);
  });
});
