import { describe, expect, it } from "vitest";
import {
  CSS_VAR_KEYS,
  PRESETS,
  PRESET_ORDER,
  contrastRatio,
  ensureReadable,
  hexToRgb,
  relativeLuminance,
  themeSpecSchema,
  themeToCssVars,
  themeToPayload,
} from "@/lib/themeTokens";

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

describe("ensureReadable", () => {
  const base = {
    name: "T", paper: "#ffffff", paper2: "#f0f0f0", ink: "#111111", stroke: "#111111",
    accent: "#2f43ff", accent2: "#5b6bff", warn: "#ff4a2e", highlight: "#ffc93c",
    borderWidth: 3, radius: 0, mood: "bold", background: "dots", font: "zine",
  } as const;

  it("leaves an already-readable spec unchanged", () => {
    expect(ensureReadable({ ...base })).toEqual(base);
  });
  it("fixes low ink/paper contrast", () => {
    const fixed = ensureReadable({ ...base, ink: "#eeeeee" }); // near-white on white
    expect(contrastRatio(fixed.ink, fixed.paper)).toBeGreaterThanOrEqual(4.5);
  });
  it("fixes low accent/paper contrast", () => {
    const fixed = ensureReadable({ ...base, accent: "#fdfdfd" });
    expect(contrastRatio(fixed.accent, fixed.paper)).toBeGreaterThanOrEqual(3);
  });
  it("separates paper2 from paper when identical", () => {
    const fixed = ensureReadable({ ...base, paper2: "#ffffff" });
    expect(contrastRatio(fixed.paper2, fixed.paper)).toBeGreaterThanOrEqual(1.06);
  });
});

const mapSpec = {
  name: "T", paper: "#0b0b0b", paper2: "#161616", ink: "#eeeeee", stroke: "#333333",
  accent: "#5ce0ff", accent2: "#7c86ff", warn: "#ff6b6b", highlight: "#ffd27a",
  borderWidth: 1, radius: 14, mood: "sleek", background: "grid", font: "space",
} as const;

describe("themeToCssVars", () => {
  it("maps colors and structure to CSS variables", () => {
    const v = themeToCssVars(mapSpec);
    expect(v["--paper"]).toBe("#0b0b0b");
    expect(v["--paper-2"]).toBe("#161616");
    expect(v["--red"]).toBe("#ff6b6b");
    expect(v["--yellow"]).toBe("#ffd27a");
    expect(v["--bw"]).toBe("1px");
    expect(v["--radius"]).toBe("14px");
    expect(v["--shadow"]).toContain("inset"); // sleek = soft glow shadow
  });
  it("bold mood uses a hard offset shadow", () => {
    expect(themeToCssVars({ ...mapSpec, mood: "bold" })["--shadow"]).toContain("0 0 var(--stroke)");
  });
  it("CSS_VAR_KEYS lists exactly the keys produced", () => {
    expect(new Set(Object.keys(themeToCssVars(mapSpec)))).toEqual(new Set(CSS_VAR_KEYS));
  });
});

describe("themeToPayload", () => {
  it("packages dataset + vars", () => {
    const p = themeToPayload(mapSpec);
    expect(p.dataset).toEqual({ bg: "grid", mood: "sleek", font: "space" });
    expect(p.vars["--accent"]).toBe("#5ce0ff");
    expect(p.name).toBe("T");
  });
});

describe("PRESETS", () => {
  it("every preset is schema-valid and readable as authored", () => {
    for (const id of PRESET_ORDER) {
      const spec = PRESETS[id];
      expect(themeSpecSchema.safeParse(spec).success).toBe(true);
      expect(contrastRatio(spec.ink, spec.paper)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(spec.accent, spec.paper)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(spec.paper2, spec.paper)).toBeGreaterThanOrEqual(1.06);
      // Authored to already pass the guard — no auto-fix should be needed.
      expect(ensureReadable(spec)).toEqual(spec);
    }
  });
});
