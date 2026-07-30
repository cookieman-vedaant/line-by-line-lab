import { describe, expect, it } from "vitest";
import { contrastRatio, hexToRgb, relativeLuminance, themeSpecSchema } from "@/lib/themeTokens";

describe("color helpers", () => {
  it("parses #rrggbb to rgb", () => {
    expect(hexToRgb("#ffffff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb("#000000")).toEqual({ r: 0, g: 0, b: 0 });
  });
  it("computes contrast: black on white is 21", () => {
    expect(Math.round(contrastRatio("#000000", "#ffffff"))).toBe(21);
  });
  it("luminance of white > luminance of black", () => {
    expect(relativeLuminance("#ffffff")).toBeGreaterThan(relativeLuminance("#000000"));
  });
});

describe("themeSpecSchema", () => {
  const good = {
    name: "Test", paper: "#ffffff", paper2: "#f0f0f0", ink: "#111111", stroke: "#111111",
    accent: "#2f43ff", accent2: "#5b6bff", warn: "#ff4a2e", highlight: "#ffc93c",
    borderWidth: 3, radius: 0, mood: "bold", background: "dots", font: "zine",
  };
  it("accepts a valid spec", () => {
    expect(themeSpecSchema.safeParse(good).success).toBe(true);
  });
  it("rejects a bad hex and out-of-range radius", () => {
    expect(themeSpecSchema.safeParse({ ...good, paper: "red" }).success).toBe(false);
    expect(themeSpecSchema.safeParse({ ...good, radius: 99 }).success).toBe(false);
    expect(themeSpecSchema.safeParse({ ...good, font: "comic" }).success).toBe(false);
  });
});
