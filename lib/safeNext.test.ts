import { describe, expect, it } from "vitest";
import { DEFAULT_NEXT, safeNext } from "./safeNext";

describe("safeNext", () => {
  it("keeps ordinary same-origin paths", () => {
    expect(safeNext("/lab")).toBe("/lab");
    expect(safeNext("/lab/record")).toBe("/lab/record");
    expect(safeNext("/lab?tab=cut")).toBe("/lab?tab=cut");
  });

  it("falls back when nothing usable was supplied", () => {
    expect(safeNext(null)).toBe(DEFAULT_NEXT);
    expect(safeNext(undefined)).toBe(DEFAULT_NEXT);
    expect(safeNext("")).toBe(DEFAULT_NEXT);
  });

  it("rejects absolute URLs", () => {
    expect(safeNext("https://evil.com")).toBe(DEFAULT_NEXT);
    expect(safeNext("http://evil.com")).toBe(DEFAULT_NEXT);
    expect(safeNext("javascript:alert(1)")).toBe(DEFAULT_NEXT);
    expect(safeNext("lab")).toBe(DEFAULT_NEXT);
  });

  // The whole reason this helper exists: every one of these starts with "/" and
  // so passed the startsWith("/") check this replaced, while still navigating
  // the user off-site once a browser resolves it.
  it("rejects protocol-relative and backslash escapes", () => {
    expect(safeNext("//evil.com")).toBe(DEFAULT_NEXT);
    expect(safeNext("//evil.com/steal")).toBe(DEFAULT_NEXT);
    expect(safeNext("/\\evil.com")).toBe(DEFAULT_NEXT);
    expect(safeNext("/\\\\evil.com")).toBe(DEFAULT_NEXT);
  });

  it("rejects whitespace and control characters used to smuggle past parsers", () => {
    expect(safeNext("/ /evil.com")).toBe(DEFAULT_NEXT);
    expect(safeNext("/\tlab")).toBe(DEFAULT_NEXT);
    expect(safeNext("/\nlab")).toBe(DEFAULT_NEXT);
    expect(safeNext("/lab ")).toBe(DEFAULT_NEXT);
  });
});
