import { beforeEach, describe, expect, it, vi } from "vitest";

const generateJson = vi.fn();
vi.mock("@/lib/gemini", () => ({
  generateJson: (...args: unknown[]) => generateJson(...args),
  RateLimitedError: class RateLimitedError extends Error {},
  MissingApiKeyError: class MissingApiKeyError extends Error {},
}));

import { contrastRatio } from "@/lib/themeTokens";
import { ThemeGenerationError, generateTheme } from "@/services/themeAgent";

const raw = {
  name: "Charizard", paper: "#17110d", paper2: "#241a13", ink: "#f7ede2", stroke: "#3a2a20",
  accent: "#ff6a1f", accent2: "#ffb020", warn: "#ff4a2e", highlight: "#ffd27a",
  borderWidth: 1, radius: 12, mood: "sleek", background: "glow", font: "impact",
};

describe("generateTheme", () => {
  beforeEach(() => generateJson.mockReset());

  it("returns a validated spec", async () => {
    generateJson.mockResolvedValue(raw);
    const spec = await generateTheme("charizard");
    expect(spec.name).toBe("Charizard");
    expect(spec.font).toBe("impact");
  });

  it("repairs unreadable model output", async () => {
    generateJson.mockResolvedValue({ ...raw, ink: "#1a1a1a" }); // dark ink on dark paper
    const spec = await generateTheme("charizard");
    expect(contrastRatio(spec.ink, spec.paper)).toBeGreaterThanOrEqual(4.5);
  });

  it("throws ThemeGenerationError on unparseable output", async () => {
    generateJson.mockResolvedValue({ nonsense: true });
    await expect(generateTheme("x")).rejects.toBeInstanceOf(ThemeGenerationError);
  });
});
