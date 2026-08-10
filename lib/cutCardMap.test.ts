import { describe, expect, it } from "vitest";
import {
  CUT_CARD_FULL_COLUMNS,
  CUT_CARD_LIST_COLUMNS,
  matchesQuery,
  rowToCardSummary,
  rowToSavedCard,
  type CutCardListRow,
  type CutCardRow,
} from "./cutCardMap";
import { CUT_CARDS_MAX_PER_USER, CUT_CARDS_WARN_AT } from "./cutCardLimit";
import type { SavedCard } from "@/types";

const listRow: CutCardListRow = {
  id: "11111111-1111-4111-8111-111111111111",
  tag: "Warming causes extinction",
  cite: "Spratt 19",
  claim: "climate change leads to extinction",
  card_length: "Medium",
  origin: "finder",
  source_url: "https://example.org/paper",
  source_title: "Existential risk to human civilisation",
  source_publication: "Breakthrough",
  created_at: "2026-08-09T12:00:00.000Z",
};

const fullRow: CutCardRow = {
  ...listRow,
  cite_details: 'Spratt, "Existential risk," BTN, 2019',
  body: "The author's verbatim words.",
};

describe("column lists", () => {
  /*
   * The performance property this whole split exists for. A measured cut-card
   * body averages ~20KB while a list row is ~200 bytes, so selecting bodies for
   * the list made a page scale with how LONG people's cards were rather than how
   * many they had. If `body` ever creeps back into the list columns, a library
   * of 100 cards becomes a ~2MB download again.
   */
  it("keeps the two heavy fields OUT of the list", () => {
    const cols = CUT_CARD_LIST_COLUMNS.split(",");
    expect(cols).not.toContain("body");
    expect(cols).not.toContain("cite_details");
  });

  it("selects everything the list row actually renders", () => {
    const cols = CUT_CARD_LIST_COLUMNS.split(",");
    for (const c of ["id", "tag", "cite", "claim", "card_length", "origin", "created_at"]) {
      expect(cols).toContain(c);
    }
  });

  it("adds exactly the heavy fields for a single opened card", () => {
    const full = CUT_CARD_FULL_COLUMNS.split(",");
    const list = CUT_CARD_LIST_COLUMNS.split(",");
    expect(full).toEqual([...list, "cite_details", "body"]);
  });

  it("never selects user_id — the caller already knows whose cards these are", () => {
    expect(CUT_CARD_FULL_COLUMNS).not.toContain("user_id");
  });
});

describe("rowToCardSummary", () => {
  it("maps a list row without inventing a body", () => {
    const summary = rowToCardSummary(listRow);
    expect(summary.tag).toBe("Warming causes extinction");
    expect(summary.cite).toBe("Spratt 19");
    expect(summary.createdAt).toBe("2026-08-09T12:00:00.000Z");
    expect("body" in summary).toBe(false);
    expect("citeDetails" in summary).toBe(false);
  });

  it("turns null text into empty strings rather than leaking null into the UI", () => {
    const bare = rowToCardSummary({ ...listRow, tag: null, cite: null, claim: null, card_length: null });
    expect(bare.tag).toBe("");
    expect(bare.cite).toBe("");
    expect(bare.claim).toBe("");
    expect(bare.cardLength).toBe("");
  });

  it("drops blank optional source fields instead of rendering empty ones", () => {
    const bare = rowToCardSummary({
      ...listRow,
      source_url: null,
      source_title: "   ",
      source_publication: "",
    });
    expect(bare.sourceUrl).toBeUndefined();
    expect(bare.sourceTitle).toBeUndefined();
    expect(bare.sourcePublication).toBeUndefined();
  });

  // A newer server writing an origin this build doesn't know must not blank the
  // whole library — degrade to a label, never throw.
  it("falls back to a known origin for an unrecognised value", () => {
    expect(rowToCardSummary({ ...listRow, origin: "wiki-import" }).origin).toBe("cutter");
    expect(rowToCardSummary({ ...listRow, origin: null }).origin).toBe("cutter");
    expect(rowToCardSummary({ ...listRow, origin: "finder" }).origin).toBe("finder");
  });
});

describe("rowToSavedCard", () => {
  it("maps every column onto the domain shape", () => {
    expect(rowToSavedCard(fullRow)).toEqual<SavedCard>({
      id: fullRow.id,
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

  it("agrees with the summary mapper on every shared field", () => {
    const summary = rowToCardSummary(fullRow);
    expect(rowToSavedCard(fullRow)).toMatchObject({ ...summary });
  });

  it("turns a null body into an empty string, never null", () => {
    const bare = rowToSavedCard({ ...fullRow, body: null, cite_details: null });
    expect(bare.body).toBe("");
    expect(bare.citeDetails).toBe("");
  });
});

describe("matchesQuery", () => {
  const card = rowToCardSummary(listRow);

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

  // The filter runs on summaries, which no longer carry a body at all — so this
  // is now structural rather than a policy the function has to remember.
  it("cannot match on the card body, because the list never holds one", () => {
    expect(matchesQuery(card, "verbatim")).toBe(false);
  });

  it("rejects a term that appears nowhere", () => {
    expect(matchesQuery(card, "tariffs")).toBe(false);
  });
});

describe("library capacity", () => {
  it("warns before the ceiling, not at it", () => {
    expect(CUT_CARDS_WARN_AT).toBeGreaterThan(0);
    expect(CUT_CARDS_WARN_AT).toBeLessThan(CUT_CARDS_MAX_PER_USER);
  });

  /*
   * This number is mirrored in enforce_cut_cards_cap() in
   * supabase/migrations/…_cut_cards_cap.sql, which is where it is actually
   * enforced. They cannot be checked against each other from a unit test, so
   * this pins the app's half: if someone changes it here, the failure is a
   * reminder to change the trigger in the same commit rather than letting the
   * interface promise a ceiling the database does not honour.
   */
  it("states the ceiling the database trigger enforces", () => {
    expect(CUT_CARDS_MAX_PER_USER).toBe(500);
  });
});
