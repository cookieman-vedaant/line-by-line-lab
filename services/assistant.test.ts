import { describe, expect, it } from "vitest";
import { buildSystem } from "@/services/assistant";

describe("buildSystem — uploaded document", () => {
  it("returns the base prompt unchanged when there is no context", () => {
    const base = buildSystem();
    expect(base).toContain("You are the Coach");
    // No document block was appended (the """ fenced block only exists with a doc).
    expect(base).not.toContain('"""');
  });

  it("embeds an uploaded document so the Coach can critique it", () => {
    const system = buildSystem({ document: "Contention 1: Nuclear solves warming." });
    expect(system).toContain("UPLOADED DOCUMENT");
    expect(system).toContain("Contention 1: Nuclear solves warming.");
  });

  // THE 2NR BUG: a real debate file (1NC shell + 2NR blocks + cards) runs tens of
  // thousands of characters. If the document is clipped, text near the END — the
  // 2NR — never reaches the model, so the Coach can't see it and misattributes a
  // 1NC tag as the 2NR. Long documents must reach the model in full.
  it("includes text from the END of a long uploaded file (the 2NR)", () => {
    const oneNc = `1NC — Nonduality K shell.\n${"card text ".repeat(3000)}`; // ~30k chars
    const twoNrMarker = "TWO_NR_NONDUALITY_OVERVIEW_MARKER";
    const document = `${oneNc}\n2NR — Overview\n${twoNrMarker}\nExtend the alt.`;
    expect(document.length).toBeGreaterThan(25000);

    const system = buildSystem({ document });
    expect(system).toContain(twoNrMarker);
  });

  it("tells the Coach when a document was too large to fit (so it can say so)", () => {
    const huge = "x".repeat(500000);
    const system = buildSystem({ document: huge });
    expect(system.toLowerCase()).toContain("truncated");
  });
});

describe("buildSystem — debater profile", () => {
  it("embeds the profile so the Coach can pitch to the debater's level", () => {
    const system = buildSystem({ profile: "Skill tier: Varsity. Recurring weaknesses: answering framework." });
    expect(system).toContain("DEBATER PROFILE");
    expect(system).toContain("answering framework");
  });

  it("omits the profile section when none is given", () => {
    expect(buildSystem({ claim: "x" })).not.toContain("DEBATER PROFILE");
  });

  it("embeds the logged rounds so the Coach can ground help in specifics", () => {
    const system = buildSystem({ record: "Record: 1–1. Recent rounds:\n1. Berkeley R1 — Aff, Loss: dropped the perm" });
    expect(system).toContain("DEBATER'S LOGGED ROUNDS");
    expect(system).toContain("dropped the perm");
  });
});
