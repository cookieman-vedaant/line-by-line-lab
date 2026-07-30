import { describe, expect, it } from "vitest";
import { filterReputable, isBlockedDomain } from "./sourceFilter";

describe("isBlockedDomain", () => {
  it("blocks the listed non-citable domains", () => {
    expect(isBlockedDomain("https://www.reddit.com/r/debate/xyz")).toBe(true);
    expect(isBlockedDomain("https://en.wikipedia.org/wiki/Nuclear_power")).toBe(true);
    expect(isBlockedDomain("https://www.linkedin.com/in/someone")).toBe(true);
    expect(isBlockedDomain("https://medium.com/@writer/post")).toBe(true);
    expect(isBlockedDomain("https://x.com/user/status/1")).toBe(true);
  });

  it("blocks subdomains of blocked domains", () => {
    expect(isBlockedDomain("https://old.reddit.com/r/x")).toBe(true);
    expect(isBlockedDomain("https://simple.wikipedia.org/wiki/X")).toBe(true);
  });

  it("allows reputable outlets", () => {
    expect(isBlockedDomain("https://www.brookings.edu/articles/x")).toBe(false);
    expect(isBlockedDomain("https://www.nature.com/articles/x")).toBe(false);
    expect(isBlockedDomain("https://www.nytimes.com/2026/01/01/x.html")).toBe(false);
    expect(isBlockedDomain("https://www.state.gov/report")).toBe(false);
  });

  it("does not block domains that merely contain a blocked name as a substring", () => {
    // "notreddit.com" ends with "reddit.com" only if we're careless — guard it.
    expect(isBlockedDomain("https://notreddit.com/article")).toBe(false);
    expect(isBlockedDomain("https://myask.com/article")).toBe(false);
  });

  it("treats unparseable URLs as non-citable", () => {
    expect(isBlockedDomain("not a url")).toBe(true);
    expect(isBlockedDomain("")).toBe(true);
  });
});

describe("filterReputable", () => {
  it("drops blocked items and keeps the rest", () => {
    const items = [
      { url: "https://www.reddit.com/r/x", id: 1 },
      { url: "https://www.brookings.edu/x", id: 2 },
      { url: "https://en.wikipedia.org/wiki/X", id: 3 },
      { url: "https://www.rand.org/x", id: 4 },
    ];
    expect(filterReputable(items).map((i) => i.id)).toEqual([2, 4]);
  });
});
