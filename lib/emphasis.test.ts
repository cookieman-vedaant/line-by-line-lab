import { describe, expect, it } from "vitest";
import {
  HIGHLIGHT_CLOSE,
  HIGHLIGHT_OPEN,
  parseCardMarkup,
  UNDERLINE_CLOSE,
  UNDERLINE_OPEN,
} from "./cardMarkup";
import { applyEmphasis } from "./emphasis";

const TEXT =
  "Avidya is a Sanskrit word most commonly defined as ignorance. It is spiritual ignorance.\n\nThe Advaita Vedanta school of Hinduism can be traced to the Upanisads.";

const u = (s: string) => `${UNDERLINE_OPEN}${s}${UNDERLINE_CLOSE}`;

describe("applyEmphasis", () => {
  it("wraps an underline around real text", () => {
    const { body, applied, missed } = applyEmphasis(TEXT, ["Avidya is a Sanskrit word"], []);
    expect(body).toContain(u("Avidya is a Sanskrit word"));
    expect(applied).toBe(1);
    expect(missed).toBe(0);
  });

  it("highlight wins over underline in overlaps", () => {
    const { body } = applyEmphasis(
      TEXT,
      ["Avidya is a Sanskrit word most commonly defined as ignorance."],
      ["defined as ignorance"],
    );
    // Rendering the produced markup must give the right kinds.
    const nodes = parseCardMarkup(body.split("\n")[0]);
    const highlight = nodes.find((n) => n.kind === "highlight");
    expect(highlight?.text).toBe("defined as ignorance");
    expect(nodes.some((n) => n.kind === "underline" && n.text.includes("Avidya"))).toBe(true);
  });

  it("locates needles despite curly quotes and whitespace reflow", () => {
    const source = "It’s the state’s duty — nothing less. More text here.";
    const { body, applied } = applyEmphasis(source, ["It's the state's duty - nothing   less."], []);
    expect(applied).toBe(1);
    expect(body).toContain(u("It’s the state’s duty — nothing less."));
  });

  it("skips needles that aren't in the text (never invents)", () => {
    const { body, missed } = applyEmphasis(TEXT, ["completely fabricated sentence"], []);
    expect(missed).toBe(1);
    expect(body).toBe(TEXT); // untouched
  });

  it("leaves literal == and __ in the article as plain text", () => {
    const source = "The regex a==b matched the file_name__here token in the log.";
    const { body } = applyEmphasis(source, ["matched the file_name__here token"], []);
    // The literal ==/__ survive; only our private-use delimiters are added.
    expect(body).toContain("a==b");
    expect(body).toContain("file_name__here");
    const nodes = parseCardMarkup(body);
    // The literal markers render as plain, not as emphasis.
    expect(nodes.some((n) => n.kind === "plain" && n.text.includes("a==b"))).toBe(true);
    expect(nodes.some((n) => n.kind === "underline" && n.text.includes("file_name__here"))).toBe(
      true,
    );
  });

  it("never lets markers span paragraph breaks", () => {
    const needle = "It is spiritual ignorance.\n\nThe Advaita Vedanta school";
    const { body } = applyEmphasis(TEXT, [needle], []);
    expect(body).toContain(u("It is spiritual ignorance."));
    expect(body).toContain(u("The Advaita Vedanta school"));
    // Every line must have balanced delimiters — none may straddle a break.
    for (const line of body.split("\n")) {
      const opens =
        (line.split(UNDERLINE_OPEN).length - 1) + (line.split(HIGHLIGHT_OPEN).length - 1);
      const closes =
        (line.split(UNDERLINE_CLOSE).length - 1) + (line.split(HIGHLIGHT_CLOSE).length - 1);
      expect(opens).toBe(closes);
    }
  });

  it("matches needles that legitimately contain __ or == (code/snake_case)", () => {
    const source = "Call get_user__profile() then compare a==b in the loop.";
    const { applied } = applyEmphasis(source, ["get_user__profile() then compare a==b"], []);
    expect(applied).toBe(1);
  });

  it("underlines mark every occurrence of a repeated needle", () => {
    const source = "sanctions fail. We know sanctions fail.";
    const { body } = applyEmphasis(source, ["sanctions fail"], []);
    expect(body.split(u("sanctions fail")).length - 1).toBe(2);
  });

  it("highlights a recurring phrase only ONCE (no buzzword repetition)", () => {
    const source = "One. They are all one. The one truth is one.";
    const { body } = applyEmphasis(source, [], ["one"]);
    // "one" recurs, but only a single highlight is emitted.
    expect(body.split(HIGHLIGHT_OPEN).length - 1).toBe(1);
  });

  it("dedupes identical highlight phrases the model repeats", () => {
    const source = "Christian nationalism drives support in the data.";
    const { body, applied } = applyEmphasis(
      source,
      [],
      ["Christian nationalism", "Christian nationalism", "Christian nationalism"],
    );
    expect(applied).toBe(1);
    expect(body.split(HIGHLIGHT_OPEN).length - 1).toBe(1);
  });

  it("prefers the occurrence inside a read-aloud (underlined) sentence", () => {
    const source = "Truth is mentioned here. The eternal truth grounds reality.";
    const { body } = applyEmphasis(
      source,
      ["The eternal truth grounds reality."],
      ["truth"],
    );
    const nodes = parseCardMarkup(body);
    const highlight = nodes.find((n) => n.kind === "highlight");
    // The highlighted "truth" sits within the underlined second sentence,
    // not the stray "Truth" in the un-underlined first sentence.
    expect(highlight?.text.toLowerCase()).toBe("truth");
    const before = body.slice(0, body.indexOf(HIGHLIGHT_OPEN));
    expect(before).toContain("eternal");
  });

  it("won't match a short needle inside a larger word", () => {
    const source = "Their oneness is a phone call away.";
    // "one" must not light up inside "oneness" or "phone".
    const { missed, applied } = applyEmphasis(source, [], ["one"]);
    expect(applied).toBe(0);
    expect(missed).toBe(1);
  });
});
