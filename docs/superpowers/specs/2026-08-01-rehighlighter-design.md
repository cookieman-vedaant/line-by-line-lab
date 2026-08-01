# Card Re-Highlighter — Design & Plan

**Date:** 2026-08-01
**Status:** Draft for review (no code until approved)

## Goal
A standalone tool that takes an **opponent's card** (or a source URL), fetches the
**full original article**, and exposes where that card is misleading — producing
(1) a **re-highlighted** version of the article emphasizing the passages that
*undercut* the opponent's tag, and (2) a **contradiction report** the debater can
run in-round. Everything highlighted or quoted is **verbatim** from the source —
the tool never fabricates a contradiction.

## Why (the debate use case)
Opponents cut cards to say exactly what they want. The fuller article often hedges,
qualifies, contradicts itself, or omits context that flips the card. Today a debater
has to read the whole source by hand to catch this. This tool does that pass for
them and hands back the author's own words to use *against* the card.

## Scope (locked from clarifications)
- **Content source:** the ORIGINAL article — reuse our existing extractor. PrepSync
  is **UI inspiration only**; we do not scrape or integrate their card database.
- **Input:** paste the opponent's card (tag + cite + body) **OR** a source URL.
- **Output:** a contradiction report **plus** a re-highlight of the article.
- **Independent of the Coach:** its own tab, its own route.

## Non-goals
- No PrepSync database access / scraping.
- No fabricated or paraphrased evidence — verbatim author wording only.
- Not a card cutter for *your* side (that's the existing Cut tab); this indicts
  *theirs*.

## Data flow
1. **Input (client):** a "Paste card / Article URL" toggle; a textarea (card) or URL
   field; an optional **"Their tag / claim"** field, auto-filled from a pasted card's
   tag.
2. **Resolve source (server):**
   - URL given → `extractArticleFromUrl` (reuse; handles paywalls/teasers honestly).
   - Card pasted → parse the cite for a URL (our cites now end with the real link),
     fetch that; if no URL is present, analyze the pasted card body directly (limited
     to internal issues, surfaced honestly).
3. **Derive the opponent's claim:** from the card's tag, or the explicit field.
4. **AI analysis (Gemini), returns JSON only:**
   - `contradictions[]`: each `{ quote (verbatim), kind, explanation, howToUse }`.
   - `rehighlight`: verbatim `underlines[]` / `highlights[]` marking the
     counter-warrant passages to emphasize in the article.
5. **Verify verbatim (server):** locate every quote and every emphasis substring in
   the real article text; **drop any that don't match exactly** (reuse
   `applyEmphasis`' locate-or-drop). Nothing invented survives.
6. **Return:** `{ articleTitle, cite, body (verbatim + emphasis markers),
   contradictions[], sourceUrl }`.
7. **UI (client):** the re-highlighted article (CardView) + a stack of contradiction
   cards, each copyable.

## Types (`types/index.ts`)
```ts
export type ContradictionKind =
  | "contradiction"    // the article later states the opposite
  | "omitted_context"  // context the card cut that changes the meaning
  | "author_hedge"     // the author qualifies/limits the claim
  | "miscut";          // the highlighted span misrepresents the sentence

export interface Contradiction {
  quote: string;        // verbatim from the article
  kind: ContradictionKind;
  explanation: string;  // reasoning about the real text (allowed; not evidence)
  howToUse: string;     // how to deploy it in-round
}

export interface RehighlightSource {
  card?: string;        // pasted opponent card (tag + cite + body)
  url?: string;         // source article URL
  text?: string;        // raw pasted article text (fallback)
}

export interface RehighlightRequest {
  source: RehighlightSource;
  opponentClaim?: string; // auto-derived from the card tag when omitted
}

export interface RehighlightResult {
  articleTitle: string;
  cite: string;
  body: string;               // verbatim article with emphasis markers
  contradictions: Contradiction[];
  sourceUrl?: string;
}
```

## Files
- **Create** `services/rehighlighter.ts` — orchestration: resolve source (reuse
  `articleExtract`), build the analysis prompt, call Gemini (`generateJson`, with the
  premium→default fallback like the cutter), verify verbatim (reuse `lib/emphasis` +
  `lib/cardMarkup`), assemble the result. Honest errors (`ArticleUnreadableError`,
  a new `NoContradictionsFound` sentinel is NOT thrown — "none found" is a valid
  result).
- **Create** `app/api/rehighlight/route.ts` — thin: `botBlock()` → `guardApi(req, {
  name: "rehighlight", bodyLimitBytes: 1MB, requireAuth: true })` → zod-validate →
  call the service → map errors to status codes (422 unreadable, 429 rate, 500).
- **Edit** `lib/apiClient.ts` — `requestRehighlight(req): Promise<RehighlightOutcome>`.
- **Create** `components/RehighlighterPanel.tsx` — the input + results UI.
- **Create** `components/ContradictionCard.tsx` — one contradiction (kind badge,
  verbatim quote, explanation, "how to run it", copy button).
- **Edit** `components/EvidenceWorkbench.tsx` — add the **"Re-Highlight"** tab.
- **Reuse** `components/CardView.tsx` for the re-highlighted article (the color
  picker even lets them recolor the indict highlights).
- **Tests:** `services/rehighlighter.test.ts` (cite→URL parsing, verbatim
  verification drops non-matches, "no contradictions" path), mirroring the cutter's
  test style.

## Reuse (do not reinvent)
`articleExtract.ts` (fetch + paywall handling) · `lib/emphasis.ts` +
`lib/cardMarkup.ts` (verbatim emphasis) · `lib/gemini.ts` (throttle + model
fallback) · `CardView.tsx` (render) · `guardApi` (auth/rate/budget) ·
`createSharedCache` (cache identical re-highlights, zero AI cost on repeats).

## No-fabrication guarantees
- Every `quote` and every emphasis substring is **programmatically verified verbatim**
  against the fetched article; non-matches are dropped, never shown.
- `explanation` / `howToUse` are *analysis of real text* (like the Coach's feedback),
  never invented evidence, quotes, stats, or citations.
- If nothing genuinely contradicts the tag, the tool says so plainly rather than
  manufacturing a weakness.

## UI design — PrepSync's clarity × our zine/riso identity
Keep **our** identity (frames, hard shadows, mono labels, accent color, Calibri card
body). Borrow PrepSync's **clarity and speed**: one clean input, a fast result, a
scannable report.

- **Input card:** segmented toggle `Paste card | Article URL`; a big field; an
  optional auto-filled "Their tag/claim"; a bold **"Expose contradictions →"**.
- **Results:**
  - The **re-highlighted article** (CardView) under a header like *"Their card,
    re-cut against them."*
  - A stack of **contradiction cards**, each a framed block with a **kind badge**
    (contradiction = red, omitted-context = yellow, hedge = cyan, miscut = ink), the
    **verbatim quote** (highlighted), the **explanation**, and a **"How to run it"**
    line — each with a copy button; staggered reveal on load.
  - **Loading:** "▸ reading the whole article and hunting contradictions…"
  - **Honest empty state:** "No clear contradictions found — this card holds up.
    (Worth knowing.)"

## Broader UI polish (light pass, bundled)
- The tab bar grows to 5 (Find / Cut / Re-Highlight / Coach / Record) — make it wrap
  cleanly on mobile; verify spacing/active states.
- Consistent card chrome + copy affordances across Cut and Re-Highlight.
- Keep motion tasteful: one orchestrated reveal per results load, not scattered.

## Build sequence (each step independently testable)
1. Types + `services/rehighlighter.ts` skeleton: resolve source + cite→URL parsing
   (+ tests).
2. Gemini analysis prompt + JSON schema + verbatim verification (+ tests, mocked AI).
3. `/api/rehighlight` route + `apiClient` + guard wiring.
4. `RehighlighterPanel` + `ContradictionCard` + the new tab.
5. Wire `CardView` for the re-highlight + per-item and whole-report copy.
6. UI polish + honest empty/loading states + mobile tab wrap.
7. Verify: tsc / tests / lint / build, then a real browser run on a known
   cherry-picked card.

## Risks / calls
- **Paywalled/unfetchable source** → fall back to analyzing the pasted card body
  (internal contradictions/hedges only), surfaced honestly.
- **AI over-claiming** → strict prompt + verbatim verification + a real
  "no contradictions" outcome.
- **Cost** → one Gemini call per re-highlight (like a cut); cache identical requests.
