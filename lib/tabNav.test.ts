import { describe, expect, it } from "vitest";
import { nextTabIndex } from "./tabNav";

// The workbench has six tools; most cases below use that real count.
const COUNT = 6;

describe("nextTabIndex", () => {
  it("moves right and left", () => {
    expect(nextTabIndex("ArrowRight", 0, COUNT)).toBe(1);
    expect(nextTabIndex("ArrowRight", 3, COUNT)).toBe(4);
    expect(nextTabIndex("ArrowLeft", 4, COUNT)).toBe(3);
    expect(nextTabIndex("ArrowLeft", 1, COUNT)).toBe(0);
  });

  // The reason this is a module and not three lines inside the component:
  // (current - 1) % count is -1 here, which would focus nothing at all.
  it("wraps at both ends", () => {
    expect(nextTabIndex("ArrowLeft", 0, COUNT)).toBe(COUNT - 1);
    expect(nextTabIndex("ArrowRight", COUNT - 1, COUNT)).toBe(0);
  });

  it("jumps to the edges with Home and End", () => {
    expect(nextTabIndex("Home", 3, COUNT)).toBe(0);
    expect(nextTabIndex("End", 3, COUNT)).toBe(COUNT - 1);
    expect(nextTabIndex("Home", 0, COUNT)).toBe(0);
    expect(nextTabIndex("End", COUNT - 1, COUNT)).toBe(COUNT - 1);
  });

  // Returning null (not a number) is what lets the caller avoid swallowing
  // every other keystroke with preventDefault.
  it("ignores keys that aren't navigation keys", () => {
    for (const key of ["a", "Enter", " ", "Tab", "ArrowUp", "ArrowDown", "Escape"]) {
      expect(nextTabIndex(key, 2, COUNT)).toBeNull();
    }
  });

  it("survives an out-of-range or missing current index", () => {
    expect(nextTabIndex("ArrowRight", -1, COUNT)).toBe(1);
    expect(nextTabIndex("ArrowLeft", -1, COUNT)).toBe(COUNT - 1);
    expect(nextTabIndex("ArrowRight", 99, COUNT)).toBe(1);
  });

  it("refuses to navigate an empty tab set", () => {
    expect(nextTabIndex("ArrowRight", 0, 0)).toBeNull();
    expect(nextTabIndex("Home", 0, 0)).toBeNull();
  });

  it("handles a single tab by staying put", () => {
    expect(nextTabIndex("ArrowRight", 0, 1)).toBe(0);
    expect(nextTabIndex("ArrowLeft", 0, 1)).toBe(0);
  });
});
