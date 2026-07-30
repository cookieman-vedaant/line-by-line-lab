import { describe, expect, it } from "vitest";
import { applyPayload, type ThemeRoot } from "@/lib/theme";
import { themeToPayload } from "@/lib/themeTokens";

function fakeRoot() {
  const attrs: Record<string, string> = {};
  const props: Record<string, string> = {};
  const root: ThemeRoot = {
    setAttribute: (k, v) => void (attrs[k] = v),
    removeAttribute: (k) => void delete attrs[k],
    style: {
      setProperty: (k, v) => void (props[k] = v),
      removeProperty: (k) => void delete props[k],
    },
  };
  return { root, attrs, props };
}

const spec = {
  name: "T", paper: "#0b0b0b", paper2: "#161616", ink: "#eeeeee", stroke: "#333333",
  accent: "#5ce0ff", accent2: "#7c86ff", warn: "#ff6b6b", highlight: "#ffd27a",
  borderWidth: 1, radius: 14, mood: "sleek", background: "grid", font: "space",
} as const;

describe("applyPayload", () => {
  it("writes data-* attributes and CSS variables to the root", () => {
    const { root, attrs, props } = fakeRoot();
    applyPayload(themeToPayload(spec), root);
    expect(attrs["data-theme"]).toBe("custom");
    expect(attrs["data-bg"]).toBe("grid");
    expect(attrs["data-mood"]).toBe("sleek");
    expect(attrs["data-font"]).toBe("space");
    expect(props["--accent"]).toBe("#5ce0ff");
    expect(props["--radius"]).toBe("14px");
  });
});
