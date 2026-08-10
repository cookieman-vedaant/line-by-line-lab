import { describe, expect, it } from "vitest";
import { CUT_CARD_COLUMNS, matchesQuery, rowToSavedCard, type CutCardRow } from "./cutCardMap";
import type { SavedCard } from "@/types";

const row: CutCardRow = {
  id: "11111111-1111-4111-8111-111111111111",
  tag: "Warming causes extinction",
  cite: "Spratt 19",
  cite_details: 'Spratt, "Existential risk," BTN, 2019',
  body: "The author's verbatim words.",
  claim: "climate change leads to extinction",
  card_length: "Medium",
  origin: "finder",
  source_url: "https://example.org/paper",
  source_title: "Existential risk to human civilisation",
  source_publication: "Breakthrough",
  created_at: "2026-08-09T12:00:00.000Z",
};

describe("rowToSavedCard", () => {
  it("maps every column onto the domain shape", () => {
    expect(rowToSavedCard(row)).toEqual<SavedCard>({
      id: row.id,
      tag: "Warming causes extinction",
      cite: "Spratt 19",
      citeDetails: 'Spratt, "Existential risk," BTN, 2019',
      body: "The author's verbatim words.",
      claim: "climate change leads to extinction",
      cardLength: "Medium",
      origin: "finder",
      sourceUrl: "https://example.org/paper",
      sourceTitle: "Existential risk to human civilisation",
      sourcePublication: "Breakthrough",
      createdAt: "2026-08-09T12:00:00.000Z",
    });
  });

  it("turns null text into empty strings rather than leaking null into the UI", () => {
    const bare = rowToSavedCard({
      ...row,
      tag: null,
      cite: null,
      cite_details: null,
      body: null,
      claim: null,
      card_length: null,
    });
    expect(bare.tag).toBe("");
    expect(bare.cite).toBe("");
    expect(bare.citeDetails).toBe("");
    expect(bare.body).toBe("");
    expect(bare.claim).toBe("");
    expect(bare.cardLength).toBe("");
  });

  it("drops blank optional source fields instead of rendering empty ones", () => {
    const bare = rowToSavedCard({
      ...row,
      source_url: null,
      source_title: "   ",
      source_publication: "",
    });
    expect(bare.sourceUrl).toBeUndefined();
    expect(bare.sourceTitle).toBeUndefined();
    expect(bare.sourcePublication).toBeUndefined();
  });

  // A newer server writing an origin this build doesn't know must not blank the
  // whole history — degrade to a label, never throw.
  it("falls back to a known origin for an unrecognised value", () => {
    expect(rowToSavedCard({ ...row, origin: "wiki-import" }).origin).toBe("cutter");
    expect(rowToSavedCard({ ...row, origin: null }).origin).toBe("cutter");
    expect(rowToSavedCard({ ...row, origin: "finder" }).origin).toBe("finder");
  });

  it("never selects user_id — the caller already knows whose cards these are", () => {
    expect(CUT_CARD_COLUMNS).not.toContain("user_id");
    // Every field the mapper reads must actually be requested, or it silently
    // maps undefined and the card renders blank.
    for (const column of ["tag", "cite", "cite_details", "body", "claim", "card_length", "origin", "created_at"]) {
      expect(CUT_CARD_COLUMNS.split(",")).toContain(column);
    }
  });
});

describe("matchesQuery", () => {
  const card = rowToSavedCard(row);

  it("keeps everything when the filter is blank", () => {
    expect(matchesQuery(card, "")).toBe(true);
    expect(matchesQuery(card, "   ")).toBe(true);
  });

  it("matches the four things a debater remembers, case-insensitively", () => {
    expect(matchesQuery(card, "EXTINCTION")).toBe(true); // tag
    expect(matchesQuery(card, "spratt")).toBe(true); // cite
    expect(matchesQuery(card, "climate change")).toBe(true); // claim
    expect(matchesQuery(card, "civilisation")).toBe(true); // source title
  });

  // Deliberate: scanning bodies would match incidental words and make the filter
  // useless, the same way ranking on full bodies wrecked wiki search relevance.
  it("does not match on the card body", () => {
    expect(matchesQuery(card, "verbatim")).toBe(false);
  });

  it("rejects a term that appears nowhere", () => {
    expect(matchesQuery(card, "tariffs")).toBe(false);
  });
});
