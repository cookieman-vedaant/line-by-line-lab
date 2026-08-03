#!/usr/bin/env node
/**
 * Probe candidate Gemini models against YOUR key, with the exact config the app
 * uses (JSON output + thinkingConfig). Run before promoting any model to a
 * default:
 *
 *   node --env-file=.env.local scripts/check-models.mjs
 *
 * WHY THIS EXISTS: model availability is per-key and per-config, not universal.
 * This project has already hit both failure modes — `gemini-2.5-flash-lite`
 * returns 404 "no longer available to new users" on a key where it's listed,
 * and several `-latest` aliases return 400 against `thinkingConfig` + JSON
 * output. Guessing an ID into a default is how you take down production for
 * everyone at once.
 *
 * Prints a table of OK / FAILED plus the current price per 1M tokens, so the
 * quality-vs-cost decision is made against real data rather than a memory of
 * what a model used to cost.
 */

import { GoogleGenAI } from "@google/genai";

// Prices are Google's published paid-tier rates as of Aug 2026, per 1M tokens.
// Re-check them at https://ai.google.dev/gemini-api/docs/pricing — they move.
const CANDIDATES = [
  { id: "gemini-3.1-flash-lite", in: 0.25, out: 1.5, note: "current default (cheapest)" },
  { id: "gemini-3.5-flash-lite", in: 0.3, out: 2.5, note: "mid — candidate for mark/coach free" },
  { id: "gemini-3.5-flash", in: 1.5, out: 9.0, note: "current marker model" },
  { id: "gemini-3.6-flash", in: 1.5, out: 7.5, note: "same input, 20% cheaper output than 3.5" },
  { id: "gemini-3.1-pro-preview", in: 2.0, out: 12.0, note: "strongest, priciest" },
];

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("GEMINI_API_KEY is not set. Run with: node --env-file=.env.local scripts/check-models.mjs");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

/** One real call in the app's shape: JSON out, thinking disabled. */
async function probe(id) {
  const started = Date.now();
  try {
    const res = await ai.models.generateContent({
      model: id,
      contents: 'Return exactly {"ok":true} and nothing else.',
      config: {
        systemInstruction: "You return only valid JSON.",
        responseMimeType: "application/json",
        temperature: 0.2,
        maxOutputTokens: 256,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    const text = (res.text ?? "").trim();
    return { ok: true, ms: Date.now() - started, sample: text.slice(0, 60) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, ms: Date.now() - started, sample: msg.slice(0, 110) };
  }
}

console.log("\nProbing Gemini models with this project's config (JSON + thinking disabled)\n");

const results = [];
for (const c of CANDIDATES) {
  process.stdout.write(`  ${c.id.padEnd(26)} … `);
  const r = await probe(c.id);
  console.log(r.ok ? `OK (${r.ms}ms)` : `FAILED — ${r.sample}`);
  results.push({ ...c, ...r });
}

console.log("\n  Working models, by output price (the dominant cost — our calls read");
console.log("  long articles but write short JSON, so compare `out` first):\n");
for (const r of results.filter((x) => x.ok).sort((a, b) => a.out - b.out)) {
  console.log(`    ${r.id.padEnd(26)} $${r.in.toFixed(2)} in / $${r.out.toFixed(2)} out   ${r.note}`);
}

const failed = results.filter((x) => !x.ok);
if (failed.length) {
  console.log(`\n  ${failed.length} model(s) unavailable on this key — do NOT set them as defaults.`);
}
console.log("\n  Override a task with e.g. GEMINI_MODEL_MARK_PRO=<id>  (see lib/models.ts)\n");
