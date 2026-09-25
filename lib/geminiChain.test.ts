import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Walking the failover chain, pinned without the network. Model ids are unique
 * per test (breakers are per model name) and the chain is injected through the
 * environment, the same lever production uses to retune it.
 */

const generateContent = vi.fn();

vi.mock("@google/genai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@google/genai")>()),
  GoogleGenAI: class {
    models = { generateContent };
  },
}));

const overloaded = () =>
  new Error('{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}');
const reply = (text: string) => ({ text, usageMetadata: {} });

let generateJson: typeof import("@/lib/gemini").generateJson;
let resetModelAvailability: typeof import("@/lib/modelAvailability").resetModelAvailability;

beforeEach(async () => {
  process.env.GEMINI_API_KEY = "test-key";
  generateContent.mockReset();
  ({ generateJson } = await import("@/lib/gemini"));
  ({ resetModelAvailability } = await import("@/lib/modelAvailability"));
  resetModelAvailability();
});

afterEach(() => {
  delete process.env.GEMINI_FAILOVER_FROM_LITE;
  vi.useRealTimers();
});

let seq = 0;
/** A fresh three-model lite chain, registered through the environment. */
function chain(): [string, string, string] {
  const n = ++seq;
  const ids: [string, string, string] = [`lite-a-${n}`, `lite-b-${n}`, `strong-c-${n}`];
  process.env.GEMINI_FAILOVER_FROM_LITE = ids.join(",");
  return ids;
}
const calledModels = () => generateContent.mock.calls.map((c) => (c[0] as { model: string }).model);

describe("generateJson failover chain", () => {
  it("moves to the next model at once when one is overloaded, instead of waiting on it", async () => {
    const [a, b] = chain();
    generateContent.mockImplementation(({ model }: { model: string }) =>
      model === a ? Promise.reject(overloaded()) : Promise.resolve(reply('{"from":"b"}')),
    );

    await expect(generateJson({ system: "s", prompt: "p", model: a })).resolves.toEqual({ from: "b" });
    // One attempt on the overloaded model — no 3s + 7s of backoff on it first.
    expect(calledModels()).toEqual([a, b]);
  });

  it("walks past several overloaded models to one that answers", async () => {
    const [a, b, c] = chain();
    generateContent.mockImplementation(({ model }: { model: string }) =>
      model === c ? Promise.resolve(reply('{"from":"c"}')) : Promise.reject(overloaded()),
    );

    await expect(generateJson({ system: "s", prompt: "p", model: a, retries: 0 })).resolves.toEqual({ from: "c" });
    expect(calledModels()).toEqual([a, b, c]);
  });

  it("gives up on a stalled call at its time limit and asks the next model", async () => {
    const [a] = chain();
    generateContent.mockImplementation(({ model }: { model: string }) =>
      model === a ? new Promise(() => {}) : Promise.resolve(reply('{"from":"b"}')),
    );
    vi.useFakeTimers();
    const pending = generateJson({ system: "s", prompt: "p", model: a, attemptTimeoutMs: 5000 });
    await vi.advanceTimersByTimeAsync(5001);
    await expect(pending).resolves.toEqual({ from: "b" });
  });

  it("hands the SDK an abort signal, so a stalled request is actually cancelled", async () => {
    const [a] = chain();
    generateContent.mockResolvedValue(reply('{"ok":true}'));
    await generateJson({ system: "s", prompt: "p", model: a });
    const config = (generateContent.mock.calls[0][0] as { config: { abortSignal?: AbortSignal } }).config;
    expect(config.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it("still fails when every model in the chain is overloaded", async () => {
    const [a] = chain();
    generateContent.mockRejectedValue(overloaded());
    vi.useFakeTimers();
    const pending = generateJson({ system: "s", prompt: "p", model: a }).catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(30_000); // the last model's backoff ladder
    expect(await pending).toMatchObject({ name: "RateLimitedError" });
  });
});
