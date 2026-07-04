# System Memory & Context 🧠
<!--
AGENTS: Update this file after every major milestone, structural change, or resolved bug.
DO NOT delete historical context if it is still relevant. Compress older completed items.
-->

## 🏗️ Active Phase & Goal
**Current Phase:** Phase 2 — Core Features ✅ complete and live-verified on the $0 stack (2026-07-04).
**Current Task:** Ready for Phase 3 polish (error handling, performance). UI personality pass is deliberately the VERY LAST phase — the user said so explicitly.
**Next Steps:**
1. Phase 3: tune search latency (2 Gemini calls + 2 database fan-outs per search), responsive layout check.
2. Phase 4: security pass, deploy to Vercel (set `GEMINI_API_KEY` in Vercel env).
3. Last: UI personality pass with the user.

## 📂 Architectural Decisions
*(Log specific choices made during the build here so future agents respect them)*
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
