import { describe, expect, it } from "vitest";
import {
  gateDecision,
  interpretGate,
  markerVeto,
  passageRange,
  tagNumbersMissingFromBody,
  tagOwnerSection,
  type GateResult,
} from "./cardCutter";

/**
 * The relevance gate is the root-cause fix for power-tagged cards: an article
 * that doesn't support the claim must never reach the marker, whose job is to
 * write a confident tag. These tests pin the parts that decide that without an
 * AI call — how the gate's answer is read, and what each verdict allows.
 */

const paragraphs = [
  "Universal basic income is a cash payment to every adult, with no conditions attached.",
  "In the Kenyan trial, households receiving the transfer reduced food insecurity by 20 percent over two years.",
  "Critics argue the cost is prohibitive for national governments.",
];

describe("interpretGate", () => {
  it("reads a direct verdict and finds the key sentence's paragraph", () => {
    const gate = interpretGate(
      {
        keyQuote:
          "In the Kenyan trial, households receiving the transfer reduced food insecurity by 20 percent over two years.",
        supports: "Kenyan UBI trial cut food insecurity 20% over two years.",
        missing: "",
        verdict: "direct",
        startIndex: 0,
        endIndex: 1,
      },
      paragraphs,
    );
    expect(gate.verdict).toBe("direct");
    expect(gate.keyIndex).toBe(1);
    expect(gate.range).toEqual([0, 1]);
  });

  it("downgrades support it cannot find in the text to unknown", () => {
    // A lenient model that invents a supporting quote has not shown support.
    const gate = interpretGate(
      {
        keyQuote: "UBI eliminated poverty in every country that tried it.",
        supports: "UBI eliminates poverty.",
        verdict: "direct",
        startIndex: 0,
        endIndex: 2,
      },
      paragraphs,
    );
    expect(gate.verdict).toBe("unknown");
    expect(gate.keyIndex).toBeNull();
  });

  it("tolerates a key sentence the model trimmed at one end", () => {
    const gate = interpretGate(
      {
        keyQuote: "households receiving the transfer reduced food insecurity by 20 percent over two years.",
        verdict: "partial",
      },
      paragraphs,
    );
    expect(gate.verdict).toBe("partial");
    expect(gate.keyIndex).toBe(1);
  });

  it("treats the old {error: no_warrant} answer as none", () => {
    expect(interpretGate({ error: "no_warrant" }, paragraphs).verdict).toBe("none");
  });

  it("treats indices with no verdict (the old format) as unknown, keeping the range", () => {
    const gate = interpretGate({ startIndex: 1, endIndex: 2 }, paragraphs);
    expect(gate.verdict).toBe("unknown");
    expect(gate.range).toEqual([1, 2]);
  });

  it("reads an answer wrapped in an array, or with a capitalized verdict", () => {
    const answer = {
      keyQuote: "households receiving the transfer reduced food insecurity",
      verdict: "Direct",
    };
    expect(interpretGate([answer], paragraphs).verdict).toBe("direct");
    expect(interpretGate(answer, paragraphs).keyIndex).toBe(1);
  });

  it("treats unreadable output as unknown", () => {
    expect(interpretGate(null, paragraphs).verdict).toBe("unknown");
    expect(interpretGate("garbage", paragraphs).verdict).toBe("unknown");
    expect(interpretGate({ verdict: "maybe" }, paragraphs).verdict).toBe("unknown");
  });

  it("clamps out-of-range indices and trims long free text", () => {
    const gate = interpretGate(
      {
        keyQuote: paragraphs[2],
        supports: "x".repeat(900),
        missing: "y".repeat(900),
        verdict: "partial",
        startIndex: -4,
        endIndex: 99,
      },
      paragraphs,
    );
    expect(gate.range).toEqual([0, 2]);
    expect(gate.supports.length).toBeLessThanOrEqual(280);
    expect(gate.missing.length).toBeLessThanOrEqual(160);
  });
});

describe("gateDecision", () => {
  const kinds = ["full_text", "pasted", "abstract_only", "short_text", "pasted_short"] as const;
  const short = ["abstract_only", "short_text", "pasted_short"] as const;

  it("refuses an article that doesn't support the claim, whatever the source", () => {
    for (const kind of kinds) expect(gateDecision({ verdict: "none" }, kind).allow).toBe(false);
  });

  it("cuts direct support from any source, including an abstract", () => {
    for (const kind of kinds) {
      expect(gateDecision({ verdict: "direct", quoteExact: true }, kind).allow).toBe(true);
    }
  });

  it("cuts partial or unverified support only when the whole article is there", () => {
    for (const verdict of ["partial", "unknown"] as const) {
      expect(gateDecision({ verdict }, "full_text").allow).toBe(true);
      expect(gateDecision({ verdict }, "pasted").allow).toBe(true);
      // An abstract or a short snippet with partial support is exactly where
      // power tags came from: three sentences, one tangential, a confident tag.
      for (const kind of short) expect(gateDecision({ verdict }, kind).allow).toBe(false);
    }
  });

  it("holds short text to an EXACT quote — half a real quote is not shown support", () => {
    for (const kind of short) {
      expect(gateDecision({ verdict: "direct", quoteExact: false }, kind).allow).toBe(false);
    }
    expect(gateDecision({ verdict: "direct", quoteExact: false }, "full_text").allow).toBe(true);
  });

  it("names the real reason in words the debater can act on", () => {
    const say = (g: Parameters<typeof gateDecision>[0], kind: Parameters<typeof gateDecision>[1]) => {
      const d = gateDecision(g, kind);
      return d.allow ? "" : d.message;
    };
    expect(say({ verdict: "partial" }, "abstract_only")).toMatch(/abstract.*doesn't directly support/i);
    expect(say({ verdict: "unknown", unknownReason: "unavailable" }, "abstract_only")).toMatch(
      /couldn't finish.*try again/i,
    );
    // The check DID finish here — telling the debater to retry would be false.
    const unquoted = say({ verdict: "unknown", unknownReason: "unquoted" }, "abstract_only");
    expect(unquoted).toMatch(/word for word/);
    expect(unquoted).not.toMatch(/couldn't finish/);
    // A short page isn't necessarily an abstract; don't call it one.
    expect(say({ verdict: "partial" }, "short_text")).toMatch(/short text.*may be just the abstract/i);
  });
});

describe("passageRange", () => {
  const words = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100];
  const base: GateResult = {
    verdict: "direct",
    supports: "",
    missing: "",
    keyQuote: "",
    quoteExact: false,
    keyIndex: null,
    range: null,
  };

  it("always returns the whole text for Entire Article", () => {
    expect(passageRange({ ...base, range: [3, 4] }, "Entire Article", words)).toEqual([0, 9]);
  });

  it("seeds a missing range at the key paragraph instead of the article's opening", () => {
    const [start, end] = passageRange({ ...base, keyIndex: 7 }, "Short", words);
    expect(start).toBeLessThanOrEqual(7);
    expect(end).toBeGreaterThanOrEqual(7);
  });

  it("never lets the length budget trim the key paragraph back out (Short)", () => {
    // Widening [2,3] to reach key 6 overshoots Short's 30%; the old shrink cut
    // from the end and dropped paragraph 6 — the one the tag was anchored to.
    const [start, end] = passageRange({ ...base, keyIndex: 6, range: [2, 3] }, "Short", words);
    expect(start).toBeLessThanOrEqual(6);
    expect(end).toBeGreaterThanOrEqual(6);
    expect(end - start + 1).toBeLessThanOrEqual(3);
  });

  it("widens a selected range that leaves out the key paragraph", () => {
    const [start, end] = passageRange({ ...base, keyIndex: 6, range: [2, 3] }, "Medium", words);
    expect(start).toBeLessThanOrEqual(6);
    expect(end).toBeGreaterThanOrEqual(6);
  });
});

describe("tagOwnerSection", () => {
  // Three sections holding 2, 3 and 2 passage paragraphs; the passage starts at
  // article paragraph 10.
  const sectionSizes = [2, 3, 2];

  it("gives the tag to the section holding the key paragraph", () => {
    expect(tagOwnerSection(10 + 3, 10, sectionSizes)).toBe(1);
    expect(tagOwnerSection(10 + 6, 10, sectionSizes)).toBe(2);
  });

  it("falls back to the opening section when there is no key paragraph", () => {
    expect(tagOwnerSection(null, 10, sectionSizes)).toBe(0);
    expect(tagOwnerSection(3, 10, sectionSizes)).toBe(0); // before the passage
    expect(tagOwnerSection(40, 10, sectionSizes)).toBe(0); // after it
  });
});

describe("tagNumbersMissingFromBody", () => {
  it("flags a number the tag states but the evidence never does", () => {
    const body = "Warming past 3°C could expose up to a billion people to extreme heat.";
    expect(tagNumbersMissingFromBody("Warming kills 5 billion people by 2050", body)).toEqual([
      "5",
      "2050",
    ]);
  });

  it("accepts numbers copied from the body, including thousands separators", () => {
    const body = "Teen employment fell 4.2 percent across 12 states, costing 12,500 jobs.";
    expect(tagNumbersMissingFromBody("Hikes cut teen jobs 4.2 percent — 12,500 jobs in 12 states", body)).toEqual([]);
  });
});

describe("markerVeto (gate unavailable)", () => {
  it("refuses when every section that answered says the passage is off-claim", () => {
    expect(markerVeto(["none"])).toBe("none");
    expect(markerVeto(["none", undefined, "none"])).toBe("none");
  });

  it("refuses when no section answered at all — nothing checked relevance", () => {
    expect(markerVeto([undefined])).toBe("unverified");
    expect(markerVeto([])).toBe("unverified");
  });

  it("cuts when any section finds support", () => {
    expect(markerVeto(["none", "partial"])).toBeNull();
    expect(markerVeto(["direct", undefined])).toBeNull();
  });
});

describe("interpretGate — what the marker is shown", () => {
  it("passes on only the words actually found, never the model's invented remainder", () => {
    // The first half is real; the tail is invented to overstate the finding.
    const gate = interpretGate(
      {
        keyQuote:
          "In the Kenyan trial, households receiving the transfer reduced food insecurity forever and permanently always",
        verdict: "direct",
      },
      paragraphs,
    );
    expect(gate.verdict).toBe("direct");
    expect(gate.quoteExact).toBe(false);
    expect(paragraphs[1]).toContain(gate.keyQuote);
    expect(gate.keyQuote).not.toMatch(/permanently|forever/);
  });

  it("marks a claimed-but-unquotable answer as 'unquoted', not as the check failing", () => {
    const gate = interpretGate({ keyQuote: "nothing like this appears anywhere in it", verdict: "direct" }, paragraphs);
    expect(gate.verdict).toBe("unknown");
    expect(gate.unknownReason).toBe("unquoted");
  });
});
