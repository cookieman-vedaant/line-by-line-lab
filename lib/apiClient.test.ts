import { afterEach, describe, expect, it, vi } from "vitest";
import { requestSearch } from "./apiClient";
import type { SearchParams } from "@/types";

const PARAMS: SearchParams = { evidenceType: "Impact", claim: "nuclear war causes extinction" };

const ARTICLE = {
  title: "A real paper",
  author: "Doe et al.",
  url: "https://example.org/paper",
  publication: "Journal",
  date: "2024",
  explanation: "why it matters",
  credibilityScore: 90,
};

/** A response whose body arrives as the given chunks, exactly as split. */
function streamed(chunks: string[], init?: ResponseInit): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status: 200, ...init });
}

function mockFetch(res: Response) {
  vi.stubGlobal("fetch", vi.fn(async () => res));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requestSearch (NDJSON stream)", () => {
  it("reports each stage in order, then returns the articles", async () => {
    mockFetch(
      streamed([
        '{"type":"stage","stage":"retrieve"}\n',
        '{"type":"stage","stage":"rank"}\n',
        '{"type":"stage","stage":"verify"}\n',
        `{"type":"result","articles":[${JSON.stringify(ARTICLE)}]}\n`,
      ]),
    );

    const stages: string[] = [];
    const outcome = await requestSearch(PARAMS, (s) => stages.push(s));

    expect(stages).toEqual(["retrieve", "rank", "verify"]);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.articles).toHaveLength(1);
  });

  // The whole reason this test file exists: TCP does not respect our newlines.
  it("reassembles an event split across chunk boundaries", async () => {
    mockFetch(
      streamed([
        '{"type":"stage","sta',
        'ge":"rank"}\n{"type":"resu',
        `lt","articles":[${JSON.stringify(ARTICLE)}]}\n`,
      ]),
    );

    const stages: string[] = [];
    const outcome = await requestSearch(PARAMS, (s) => stages.push(s));

    expect(stages).toEqual(["rank"]);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.articles).toHaveLength(1);
  });

  it("accepts several events packed into one chunk", async () => {
    mockFetch(
      streamed([
        '{"type":"stage","stage":"retrieve"}\n{"type":"stage","stage":"rank"}\n{"type":"result","articles":[]}\n',
      ]),
    );

    const stages: string[] = [];
    const outcome = await requestSearch(PARAMS, (s) => stages.push(s));

    expect(stages).toEqual(["retrieve", "rank"]);
    expect(outcome.ok).toBe(true);
  });

  it("reads a final event that has no trailing newline", async () => {
    mockFetch(streamed([`{"type":"result","articles":[${JSON.stringify(ARTICLE)}]}`]));

    const outcome = await requestSearch(PARAMS);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.articles).toHaveLength(1);
  });

  it("treats zero articles as an honest notice, not a failure", async () => {
    mockFetch(streamed(['{"type":"result","articles":[],"notice":"No reputable sources."}\n']));

    const outcome = await requestSearch(PARAMS);
    expect(outcome).toEqual({ ok: true, articles: [], notice: "No reputable sources." });
  });

  it("surfaces an in-stream error even though the status was 200", async () => {
    mockFetch(
      streamed([
        '{"type":"stage","stage":"retrieve"}\n',
        '{"type":"error","error":"Gemini is rate limited."}\n',
      ]),
    );

    const outcome = await requestSearch(PARAMS);
    expect(outcome).toEqual({ ok: false, error: "Gemini is rate limited." });
  });

  // A killed function or dropped connection must not read as "0 results".
  it("fails honestly when the stream ends with no terminal event", async () => {
    mockFetch(streamed(['{"type":"stage","stage":"rank"}\n']));

    const outcome = await requestSearch(PARAMS);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toMatch(/ended before returning a result/i);
  });

  it("still reads pre-flight rejections as plain JSON with a status code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "Too many requests." }, { status: 429 })),
    );

    const outcome = await requestSearch(PARAMS);
    expect(outcome).toEqual({ ok: false, error: "Too many requests." });
  });

  it("ignores a torn line rather than failing the whole search", async () => {
    mockFetch(
      streamed([
        "not json at all\n",
        `{"type":"result","articles":[${JSON.stringify(ARTICLE)}]}\n`,
      ]),
    );

    const outcome = await requestSearch(PARAMS);
    expect(outcome.ok).toBe(true);
  });

  it("reports a dead server rather than throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    const outcome = await requestSearch(PARAMS);
    expect(outcome.ok).toBe(false);
  });
});
