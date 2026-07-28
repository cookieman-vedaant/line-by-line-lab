# System Memory & Context 🧠
<!--
AGENTS: Update this file after every major milestone, structural change, or resolved bug.
DO NOT delete historical context if it is still relevant. Compress older completed items.
-->

## 🏗️ Active Phase & Goal
**Current Phase:** Phase 2 — Core Features ✅, now in an iterative bug-fix/refinement loop with the user (they test, report, we fix — "push forward until it works perfectly").
**Current Task:** 2026-07-05 fixed a batch of Card Cutter bugs (see Architectural Decisions): visible `==`/`__` impurities, everything-shrunk/no-highlighting, length specifier ignored, weak cite extraction. All live-verified. Awaiting next round of user testing feedback.
**Next Steps:**
1. Continue the test→fix loop as the user reports issues.
2. Possible refinement: trailing page junk (nav/footer/"written by" lines) still gets included in Entire-Article cuts (mahavidya has ~32 tiny trailing "paragraphs"). Not yet filtered — revisit if the user flags it.
3. Later phases: performance, security, Vercel deploy (set `GEMINI_API_KEY` in Vercel env). UI personality pass is deliberately LAST (user's explicit preference).

## 📂 Architectural Decisions
*(Log specific choices made during the build here so future agents respect them)*
- 2026-07-05 — **Card Cutter is SELECT-then-MARK, never AI-retype.** cutCard: (1) extract article → paragraphs, (2) Gemini picks a paragraph range, `fitRangeToBudget()` clamps it to the length's word share (Short 5-30%, Medium 35-65%, Long 60-95%, Entire=all — mechanically enforced so the specifier always works, even when the selector glitches: fallback seeds [0,0] and the budget sizes it, NEVER dumps the whole article), (3) Gemini returns exact substrings to underline/highlight + tag/cite; `lib/emphasis.ts` locates them in the REAL text and wraps them. The AI never writes body text → verbatim is guaranteed by construction (the old verbatim-CHECK-and-retry approach is gone). Live-verified 25/54/85/100% across the four lengths.
- 2026-07-05 — **Emphasis uses Unicode PRIVATE-USE delimiters, NOT `==`/`__`** (U+E000/E001 highlight, U+E002/E003 underline; constants + parser in `lib/cardMarkup.ts`). Reason: articles legitimately contain `==`/`__` (code, math, snake_case) which collided with markers and leaked as visible "impurities" + broke rendering. Now literal `==`/`__` always render as plain text. The whole pipeline must stay consistent: `emphasis.ts` EMITS the delimiters, `cardCutter.ts` converts the AI's tag markup via `tagMarkupToDelimiters()`, `cardMarkup.ts` PARSES them, `CardView.tsx` strips them for plain-text/clipboard via `stripDelimiters()`. Body needles are matched WITHOUT stripping `==`/`__` (they may be real article chars).
- 2026-07-05 — **Gemini thinking is DISABLED** for all `generateJson` calls (`thinkingConfig: { thinkingBudget: 0 }` in `lib/gemini.ts`). gemini-2.5-flash is a thinking model; with small maxOutputTokens it spent the budget thinking and truncated the JSON (this silently broke the length selector). Our calls are structured extraction/selection, not open reasoning — disabling thinking is more reliable, faster, and lighter on the free-tier rate limit.
- 2026-07-05 — **Card typography (user spec):** Calibri throughout; highlighted = cyan+bold+underline 12pt; underlined = 12pt; unread context = 8pt shrunk. `//vedaant` initials REMOVED. Copy card writes rich `text/html` (survives paste into Word/Google Docs) + `text/plain` fallback.
- 2026-07-05 — **Cite extraction** (`services/articleExtract.ts`): author/date/publication from `<meta>` tags → JSON-LD (Person/@graph) → Readability byline → visible "By …"/"written by:" byline in text (`findBylineInText`). Marker prompt also gets a CITE CONTEXT block (article head+tail, where bylines live) so the AI finds the author even when the selected passage excludes it — but is told to NEVER invent one; cite by publication if truly absent.
- 2026-07-05 — Article finder ranker instructed to err toward INCLUSION and return 5-8 (was capped low); per-source retrieval 12, shortlist 32.
- 2026-07-05 — vitest.config.ts added so tests resolve the `@/*` path alias. 62 unit tests (json, verbatim, emphasis, cardMarkup, cardCutter budget, academicSearch, articleExtract metadata/byline).
- 2026-07-04 — **THE COST PIVOT: no paid APIs, Claude API removed entirely** (user decision — it costs money). Replaced by: **OpenAlex + Semantic Scholar** (free, keyless academic search — real articles only), **Gemini API free tier** (`gemini-2.5-flash` default, override via `GEMINI_MODEL`) for query expansion, ranking, and cutting, and **Mozilla Readability + jsdom** for URL→text extraction.
- 2026-07-04 — **Fabrication is structurally impossible**: articles come only from scholarly databases (AI just ranks them), and card bodies are **programmatically verified verbatim** (`lib/verbatim.ts`) against source text — non-verbatim cuts get one retry with feedback, then honest rejection.
- 2026-07-04 — **Card Cutter is standalone**: accepts a URL *or* pasted article text (+ optional cite metadata) via the "Cut a Card" tab; search results just pre-fill the same `/api/cut` endpoint. Not limited to found articles (user requirement).
- 2026-07-04 — **Card format replicates the user's sample card** (the "Rodrigues 16" avidya card, provided in chat — not in the repo; the full spec is encoded in `CUTTER_SYSTEM_PROMPT`): tag bold with `__underlined__` key phrases; cite `AuthorLastName YY` (no apostrophe) + small bracketed full cite + `//vedaant` initials (constant in `CardView.tsx`); body three layers — plain-small (unread), `__underline__` (read aloud), `==highlight==` (cyan, key warrants; must read coherently alone).
- 2026-07-03 — Next.js App Router + Route Handlers, no separate backend; scaffolded at repo root (Next 16.2.10, React 19.2.4, Tailwind 4, `@/*` alias).
- 2026-07-03 — Supabase deferred — only for repeated-search caching if ever needed.
- 2026-07-03 — Shared domain types in `types/index.ts` as const arrays + derived unions. All AI/search/cutting logic in `services/`/`lib/`, never in routes or components.
- 2026-07-03 — Model JSON contract: `extractJson()` (`lib/json.ts`) tolerates fences/prose; zod validates everything.

## 🐛 Known Issues & Quirks
*(Log current bugs or weird workarounds here)*
- Search coverage is academic-first; reputable *news* is thin (no free general web-search APIs exist in 2026 — Brave and Google CSE both killed their free tiers). Revisit (GDELT?) only if the user asks.
- Gemini free tier: ~10-15 req/min, daily caps. 429s surface as a friendly "wait a minute" message (`RateLimitedError`).
- Cite metadata (author/date) comes from page bylines or user input — NOT covered by the verbatim check. E2E test cited "Wilcox 16" where the user's sample card said "Rodrigues 16" (the page byline is likely more accurate than the sample's site-admin username). Users should eyeball cites.
- Paywalled/blocked URLs fail honestly with a "try pasting the text" hint — the paste path is the designed fallback.
- `create-next-app` once clobbered AGENTS.md/CLAUDE.md during scaffold (2026-07-03); restored. Never bulk-move into root without checking collisions.
- npm: 2 moderate vulns in scaffold transitive deps; revisit before launch.

## 📜 Completed Phases
- [x] Phase 1 — Foundation (scaffold, env, Search screen shell)
- [x] Phase 2 — Core Features v1 (Claude API build; superseded same week by the cost pivot)
- [x] Phase 2 — Core Features v2 ($0 stack; live E2E verified: real search returned SSRN/journal papers with explanations; cuts verified on the sample card's own source article and on pasted text; 26 unit tests pass)
- [ ] Phase 3 — Polish (error handling done during Phase 2; performance + responsiveness remain)
- [ ] Phase 4 — Launch (security pass, Vercel deploy)
- [ ] Final — UI personality pass (user's explicit last step)
