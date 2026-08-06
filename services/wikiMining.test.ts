import { describe, expect, it } from "vitest";
import { buildWikiQuery } from "@/services/wikiMining";

/**
 * Wiki search now queries our own index (Postgres full-text) rather than
 * opencaselist live, so the service's pure surface is just the query builder.
 * The heavier path — the RPC and card mapping — is exercised end-to-end by the
 * ingestion + extraction tests (wikiCards.test.ts) plus the DB migration.
 */

describe("buildWikiQuery", () => {
  it("passes a plain claim through", () => {
    expect(buildWikiQuery("brahman is the ultimate truth")).toBe("brahman is the ultimate truth");
  });

  it("makes a filename-style query matchable", () => {
    // The reported failure: prep the user KNEW existed returned nothing because
    // "1ac---dharma" reached search intact. Splitting separators fixes it.
    expect(buildWikiQuery("1ac---dharma")).toBe("1ac dharma");
    expect(buildWikiQuery("Aff_Case_Neg")).toBe("Aff Case Neg");
  });

  it("keeps debate jargon (it's how disclosed files are named)", () => {
    expect(buildWikiQuery("dharma aff")).toBe("dharma aff");
    expect(buildWikiQuery("cap k framework")).toBe("cap k framework");
  });

  it("returns empty string when there's nothing searchable", () => {
    expect(buildWikiQuery("?!")).toBe("");
  });
});
