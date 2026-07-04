# System Memory & Context 🧠
<!--
AGENTS: Update this file after every major milestone, structural change, or resolved bug.
DO NOT delete historical context if it is still relevant. Compress older completed items.
-->

## 🏗️ Active Phase & Goal
**Current Phase:** Phase 2 — Core Features (code-complete; E2E verification pending)
**Current Task:** Awaiting from the human: (1) `ANTHROPIC_API_KEY` in `.env.local`, (2) a sample debate card to use as the formatting reference.
**Next Steps:**
1. Human adds API key → run a real search + cut end-to-end in the browser.
2. Human provides sample card → adjust the formatting section of `CUTTER_SYSTEM_PROMPT` in `services/cardCutter.ts` and the `CardView` renderer to match.
3. Then Phase 3 polish: performance tuning (search <10s target), UI personality pass (user wants this as the very last phase).

## 📂 Architectural Decisions
*(Log specific choices made during the build here so future agents respect them)*
- 2026-07-03 — Chose Next.js App Router + Route Handlers over a separate backend, to keep infra minimal and deploy simply to Vercel.
- 2026-07-03 — Scaffolded with `create-next-app` (Next 16.2.10, React 19.2.4, Tailwind 4, TS, ESLint, no src dir, `@/*` alias) directly at project root, alongside the planning docs.
- 2026-07-03 — **Deferred Supabase to Phase 2** — DB only caches article metadata; not on the critical path for the core Claude search/cut flow.
- 2026-07-03 — Kept `docs/` (full PRD + Tech Design) as source of truth; `agent_docs/` holds condensed working summaries. The `prompt_eng/` toolkit was deleted after instantiation.
- 2026-07-03 — Shared domain types (`EvidenceType`, `CardLength`, `SourceType`, `PublicationAge`, `SearchParams`, `Article`, `Card`) live in `types/index.ts` as const arrays + derived unions, so form options and types never drift apart.
- 2026-07-03 — All Claude calls and business logic live in `services/`/`lib/`, never in route handlers or components.
- 2026-07-03 — **Claude API server tools** power both jobs: `web_search_20260209` (Article Finder — real articles, real URLs, no separate search API) and `web_fetch_20260209` (Card Cutter reads the selected URL). Model: `claude-opus-4-8` with adaptive thinking for both; drop the finder to a faster model later only if latency demands it.
- 2026-07-03 — Model output contract: final message is pure JSON, extracted by `extractJson()` in `lib/claude.ts` (tolerates fences/prose) and validated with zod. `pause_turn` stop reason handled with a bounded continuation loop (server tools can pause mid-loop).
- 2026-07-03 — Card body emphasis convention: `**...**` marks read-aloud warrants (rendered bold+underline), `[...]` marks omissions, unmarked text renders small — standard Verbatim style pending the user's sample card.
- 2026-07-03 — Honest-failure contract as typed errors: `NoSourcesFoundError` (200 + notice), `ArticleUnreadableError`/`NoWarrantFoundError` (422), `MissingApiKeyError` (500 with setup hint). Routes map errors; services throw them.

## 🐛 Known Issues & Quirks
*(Log current bugs or weird workarounds here)*
- `create-next-app`'s generated AGENTS.md/CLAUDE.md **overwrote** our root docs during scaffold move (2026-07-03); both restored from session context. Lesson recorded in AGENTS.md Agent Behaviors #6: check filename collisions before bulk-moving into root.
- npm reported 2 moderate vulnerabilities in scaffold transitive deps; not force-fixed (breaking changes). Revisit before launch.
- `npm test` has no runner yet — Vitest gets installed when the first pure logic lands (Phase 2 ranking helpers).
- Watch for: Claude must NEVER fabricate articles/citations. If retrieval returns nothing real, return the "No reputable sources were found" message rather than inventing one.

## 📜 Completed Phases
- [x] Initial scaffold (Next.js 16 + TS + Tailwind 4 at root; lint/tsc/build all pass; dev server verified HTTP 200)
- [x] Env setup (`.env.example` committed, `.env.local` git-ignored, keys still blank)
- [x] Search screen shell (SearchForm: Evidence Type + Claim required with validation; Source/Age/Length optional; submit captures params — API wiring is Phase 2)
- [ ] Supabase connection (deferred to Phase 2)
- [ ] Article Finder
- [ ] Card Cutter
- [ ] Deploy to Vercel
