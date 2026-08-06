import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALL_SHARDS,
  buildShardFilter,
  CaselistInvalidQueryError,
  isValidShard,
  listCaselists,
  sanitizeQuery,
  search,
  splitSnippet,
} from "@/services/caselist";

/** Capture the URL a call would hit, without touching the network. */
function mockFetch(body: unknown = [], status = 200) {
  const spy = vi.fn(
    async (...args: unknown[]): Promise<Response> => {
      void args;
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    },
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

const urlOf = (spy: ReturnType<typeof mockFetch>) => String(spy.mock.calls[0]?.[0] ?? "");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("search — whole-wiki by default", () => {
  /*
   * The product requirement: a debater types what they want and searches the
   * ENTIRE wiki. They never pick a caselist, because they don't know which one
   * their card is in. Upstream, `shard` is a conditional Solr filter
   * (`if (shard) { URL += '&fq=shard:' + shard }`) over a single unified index,
   * so omitting it searches everything.
   */
  it("sends the wildcard shard verbatim, so the whole index is searched", async () => {
    const spy = mockFetch();
    await search("tok", "climate extinction", ALL_SHARDS);
    // Must arrive UNESCAPED: their filter is `fq=shard:${shard}`, and an
    // encoded `%2A` would match a caselist literally named "*" — i.e. nothing.
    // encodeURIComponent leaves `*` alone, which is what makes this work.
    expect(urlOf(spy)).toContain("shard=*");
    expect(urlOf(spy)).toContain("q=climate%20extinction");
  });

  it("sends NO shard param when none is given", async () => {
    // Kept to document the upstream API: the filter is conditional. We don't
    // use this path — their route marks `shard` required and 400s without it.
    const spy = mockFetch();
    await search("tok", "climate extinction");
    expect(urlOf(spy)).not.toContain("shard");
  });

  it("still scopes to one caselist when a shard is given (fan-out fallback)", async () => {
    const spy = mockFetch();
    await search("tok", "warming", "hsld");
    expect(urlOf(spy)).toContain("shard=hsld");
  });

  it("sends an explicit every-caselist filter in ONE request", async () => {
    const spy = mockFetch();
    const filter = buildShardFilter(["hsld26", "hspolicy26", "ndtceda25"]);
    await search("tok", "warming", filter);
    // Upstream expands this to `fq=shard:hsld26 OR shard:hspolicy26 OR …`,
    // covering every caselist for one of the four searches a minute.
    expect(decodeURIComponent(urlOf(spy))).toContain(
      "shard=hsld26 OR shard:hspolicy26 OR shard:ndtceda25",
    );
  });

  it("rejects a malformed shard rather than passing it upstream", async () => {
    mockFetch();
    // Guards the fq interpolation: upstream builds `fq=shard:${shard}` WITHOUT
    // encoding, so a shard carrying other Solr syntax would alter their filter.
    await expect(search("tok", "warming", "hsld OR content:secret")).rejects.toBeInstanceOf(
      CaselistInvalidQueryError,
    );
  });

  it("short-circuits an empty query without calling upstream", async () => {
    const spy = mockFetch();
    expect(await search("tok", "")).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("listCaselists", () => {
  // Archived caselists are PREVIOUS YEARS, which is where most disclosed
  // evidence lives. Dropping them silently limits a debater to this season.
  it("asks for archived caselists by default", async () => {
    const spy = mockFetch();
    await listCaselists("tok");
    expect(urlOf(spy)).toContain("archived=true");
  });
});

describe("sanitizeQuery", () => {
  // opencaselist's getSearch controller hard-rejects a query matching
  // /[|~^;?!&%$*+=]/ with a 400. Each of these must be gone.
  const REJECTED = ["|", "~", "^", ";", "?", "!", "&", "%", "$", "*", "+", "="];

  for (const char of REJECTED) {
    it(`strips ${char}, which upstream rejects with a 400`, () => {
      const out = sanitizeQuery(`climate ${char} extinction`);
      expect(out).not.toContain(char);
      expect(out).toBe("climate extinction");
    });
  }

  it("handles the realistic case: a natural question with punctuation", () => {
    expect(sanitizeQuery("Does climate change cause extinction?")).toBe(
      "Does climate change cause extinction",
    );
  });

  it("strips Solr syntax characters upstream does NOT reject", () => {
    // These don't 400 — they make the Solr parse fail, and the controller
    // swallows that and returns an empty doc list. Silent no-results.
    expect(sanitizeQuery('warming (impacts) [x] {y} "quoted" a:b c\\d e/f')).toBe(
      "warming impacts x y quoted a b c d e f",
    );
  });

  it("removes a leading hyphen, which is Solr negation", () => {
    // "-extinction" would EXCLUDE the user's own search term.
    expect(sanitizeQuery("climate -extinction")).toBe("climate extinction");
    expect(sanitizeQuery("-warming")).toBe("warming");
  });

  /*
   * The bug this exists to prevent: a debater searches for a file by its name,
   * "1ac---dharma", and gets nothing back. Solr's parser reads `-` before a term
   * as NOT, so the query could resolve to "1ac, but NOT dharma" — the opposite
   * of the request. Solr splits on these separators at index time anyway, so
   * turning them into spaces costs nothing and makes the query matchable.
   */
  it("splits filename separators so disclosed files are findable by name", () => {
    expect(sanitizeQuery("1ac---dharma")).toBe("1ac dharma");
    expect(sanitizeQuery("Aff_Case_Neg")).toBe("Aff Case Neg");
    expect(sanitizeQuery("1AC---Dharma.docx")).toBe("1AC Dharma docx");
  });

  it("keeps apostrophes, and splits hyphenated words into their tokens", () => {
    // "cost-benefit" is indexed as two tokens, so querying it as two matches
    // the same documents while removing any chance of a negation misparse.
    expect(sanitizeQuery("author's cost-benefit analysis")).toBe(
      "author's cost benefit analysis",
    );
  });

  it("collapses whitespace and trims", () => {
    expect(sanitizeQuery("  climate   \n change  ")).toBe("climate change");
  });

  it("caps length", () => {
    expect(sanitizeQuery("a ".repeat(400), 20).length).toBeLessThanOrEqual(20);
  });

  it("returns empty string for input with nothing searchable", () => {
    expect(sanitizeQuery("?!?!")).toBe("");
  });
});

describe("isValidShard", () => {
  it("accepts real caselist slugs", () => {
    expect(isValidShard("hsld")).toBe(true);
    expect(isValidShard("hspolicy")).toBe(true);
  });

  it("accepts the two whole-wiki forms", () => {
    expect(isValidShard(ALL_SHARDS)).toBe(true);
    // An explicit list of every caselist, which buildShardFilter constructs.
    expect(isValidShard("hsld26 OR shard:hspolicy26")).toBe(true);
  });

  /*
   * The value is interpolated into `fq=shard:${shard}` upstream WITHOUT
   * encoding, so validation here is what stops a caselist name — or anything
   * else — from restructuring their filter. Only the three known-good shapes
   * get through.
   */
  it("rejects every other shape, including near-misses of the list form", () => {
    expect(isValidShard("*:*")).toBe(false);
    expect(isValidShard("hsld*")).toBe(false);
    expect(isValidShard("hsld OR shard:*")).toBe(false);
    expect(isValidShard("hsld OR content:secret")).toBe(false);
    expect(isValidShard("hsld OR shard:a b")).toBe(false);
    expect(isValidShard("hsld)) OR (( shard:x")).toBe(false);
    expect(isValidShard("hsld OR shard:")).toBe(false);
  });

  it("rejects anything that could alter the query string", () => {
    expect(isValidShard("hsld&q=x")).toBe(false);
    expect(isValidShard("../etc")).toBe(false);
    expect(isValidShard("")).toBe(false);
    expect(isValidShard("has space")).toBe(false);
  });
});

describe("splitSnippet", () => {
  it("splits Solr <b> highlights into flagged segments", () => {
    expect(splitSnippet("warming causes <b>extinction</b> soon")).toEqual([
      { text: "warming causes ", match: false },
      { text: "extinction", match: true },
      { text: " soon", match: false },
    ]);
  });

  it("handles a snippet with no highlight at all", () => {
    // hl.defaultSummary=true means we can get leading text with no tags.
    expect(splitSnippet("just leading text")).toEqual([
      { text: "just leading text", match: false },
    ]);
  });

  it("handles multiple highlights", () => {
    const out = splitSnippet("<b>climate</b> and <b>extinction</b>");
    expect(out.filter((s) => s.match).map((s) => s.text)).toEqual(["climate", "extinction"]);
  });

  it("NEVER emits markup — hostile document text stays inert", () => {
    // This is the XSS boundary. The document is user-uploaded, and Solr does not
    // escape its content, so this must come back as plain text segments.
    const hostile = '<b>hit</b> <script>alert(1)</script> & <img src=x onerror=y>';
    const out = splitSnippet(hostile);
    const rejoined = out.map((s) => s.text).join("");
    expect(rejoined).toContain("<script>alert(1)</script>");
    // The point: it is DATA in a text field, never markup we hand to a renderer.
    expect(out.every((s) => typeof s.text === "string")).toBe(true);
    expect(out.some((s) => s.match && s.text === "hit")).toBe(true);
  });

  it("tolerates an unclosed tag without losing the text", () => {
    expect(splitSnippet("start <b>rest")).toEqual([
      { text: "start ", match: false },
      { text: "rest", match: true },
    ]);
  });

  it("truncates long snippets on a segment boundary", () => {
    const out = splitSnippet(`${"a".repeat(500)}<b>${"b".repeat(500)}</b>`, 100);
    const total = out.reduce((n, s) => n + s.text.length, 0);
    expect(total).toBeLessThanOrEqual(102); // allow the ellipsis
    expect(out[0].text.endsWith("…")).toBe(true);
  });

  it("returns nothing for an empty snippet", () => {
    expect(splitSnippet("")).toEqual([]);
  });
});

describe("buildShardFilter", () => {
  it("names every caselist in one Solr boolean filter", () => {
    expect(buildShardFilter(["hsld26", "hspolicy25"])).toBe("hsld26 OR shard:hspolicy25");
  });

  /*
   * Caselist names come from upstream, so they are DATA. They are validated
   * one by one and joined with syntax we own, which is what stops a hostile or
   * merely odd name from changing the filter's structure.
   */
  it("drops any name that isn't a plain slug", () => {
    expect(buildShardFilter(["hsld26", "evil OR content:x", "*", "has space"])).toBe("hsld26");
  });

  it("dedupes and survives an empty list", () => {
    expect(buildShardFilter(["hsld26", "hsld26"])).toBe("hsld26");
    expect(buildShardFilter([])).toBe("");
  });

  it("produces a filter that passes our own shard validation", () => {
    // The two must agree, or every whole-wiki search would be rejected locally
    // before it was ever sent.
    expect(isValidShard(buildShardFilter(["a1", "b2", "c3"]))).toBe(true);
  });
});
