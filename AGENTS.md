<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# AGENTS.md — Master Plan for Line by Line Lab

## Project Overview & Stack
**App:** Line by Line Lab
**Overview:** Line by Line Lab is a web app that automates the two most time-consuming parts of competitive debate prep: (1) finding high-quality, reputable articles and (2) cutting debate-ready evidence ("cards") from them. Unlike generic AI tools, it is *debate-aware* — it understands links, impacts, solvency, framework, kritiks, theory, counterplans, and disadvantages. Primary users are high school Lincoln-Douglas debaters, from beginners to national-circuit competitors. The goal is to eliminate repetitive evidence collection, NOT to write arguments or replace debaters.
**Stack:** Next.js 16 (App Router) + React 19 + TypeScript, Tailwind CSS 4, Next.js Route Handlers (no separate backend), Supabase PostgreSQL, Claude API, deployed on Vercel.
**Critical Constraints:**
- **Web only.** No mobile app.
- **~$0 budget** outside Claude Code. Prefer free tiers (Vercel, Supabase free tier).
- **No authentication for MVP.** Users must be able to use the app immediately with no account.
- **Never fabricate evidence or sources.** The app only returns articles that actually exist and only *extracts* author wording — it never paraphrases, summarizes, or invents citations.
- **Strict TypeScript.** No `any`.

## Setup & Commands
Execute these commands for standard development workflows. Do not invent new package manager commands.
- **Setup:** `npm install`
- **Development:** `npm run dev`
- **Testing:** `npm test` (test runner not yet installed — see `agent_docs/testing.md`)
- **Linting & Formatting:** `npm run lint`
- **Type Check:** `npx tsc --noEmit`
- **Build:** `npm run build`

## Protected Areas
Do NOT modify these areas without explicit human approval:
- **Secrets & Environment:** `.env*` files and any file holding the Claude API key or Supabase keys. Never expose secrets to the client.
- **Database Migrations:** Existing Supabase migration files.
- **Infrastructure:** Vercel deployment config and `.github/workflows/` (if added later).

## Coding Conventions
- **Formatting:** Follow ESLint/Prettier defaults from `create-next-app`. No lint warnings in new code.
- **Architecture rules:** Keep API Route Handlers thin — request/response only. All Claude calls, search logic, and card-cutting logic live in `services/` or `lib/`, never inline in route handlers or components.
- **Testing Expectations:** Unit-test pure logic (ranking, formatting helpers). Manually verify the two core flows (search, cut card) in the browser before marking a task complete.
- **Type Safety:** Strict TypeScript. Avoid `any`; use `unknown` with type guards. Validate all external inputs (form fields, API payloads, env vars). Shared domain types live in `types/index.ts`.

## Agent Behaviors
These rules apply across all AI coding assistants (Claude Code, Cursor, Copilot, Gemini):
1. **Plan Before Execution:** ALWAYS propose a brief step-by-step plan before changing more than one file. Wait for approval.
2. **Refactor Over Rewrite:** Prefer incremental edits over rewriting large blocks.
3. **Context Compaction:** Write current state to `MEMORY.md` instead of filling context history during long sessions. Do not restart in an empty chat mid-feature — summarize into `MEMORY.md` first.
4. **Iterative Verification:** Run lint/tests and manually check in the browser after each logical change. Fix errors before proceeding (see `REVIEW-CHECKLIST.md`).
5. **One Feature at a Time:** Build and verify a single feature before starting the next. Checkpoint/commit after each working feature.
6. **Beware `mv`/overwrites into the root:** Root doc files (AGENTS.md, CLAUDE.md, MEMORY.md) share the folder with the app. Never bulk-move or scaffold over the project root without checking for filename collisions first.

## How I Should Think
1. **Understand Intent First:** Identify what the user actually needs before answering.
2. **Ask If Unsure:** If critical info is missing, ask ONE specific question before proceeding.
3. **Plan Before Coding:** Propose a plan, get approval, then implement.
4. **Verify After Changes:** Run checks after each change; for UI, verify in the browser.
5. **Explain Trade-offs:** When recommending something, briefly mention alternatives.

## Plan → Execute → Verify
1. **Plan:** Outline the approach and ask for approval. Use Plan Mode if available.
2. **Execute:** Implement one feature at a time.
3. **Verify:** Run checks and fix failures before moving on.

## Context Files (load only when needed)
- `agent_docs/tech_stack.md` — Tech details, versions, setup commands, code examples
- `agent_docs/code_patterns.md` — Architecture, data fetching, error handling, naming
- `agent_docs/project_brief.md` — Persistent product vision, conventions, quality gates
- `agent_docs/product_requirements.md` — Full feature list, user stories, success metrics
- `agent_docs/testing.md` — Test strategy and verification loop
- `docs/` — Original PRD and Tech Design (source of truth; load only if the summaries are insufficient)

## Current State
**Last Updated:** 2026-07-03
**Current Phase:** Phase 1 — Foundation (built & verified; pending human browser check)
**Working On:** Ready to start Phase 2 — Article Finder.
**Recently Completed:** Next.js 16 scaffold at root, folder structure (`services/`, `lib/`, `components/`, `types/`), env placeholder files, Search screen shell with validation.
**Blocked By:** `ANTHROPIC_API_KEY` must be added to `.env.local` before Phase 2 search can work.

## Roadmap

### Phase 1: Foundation ✅
- [x] Initialize Next.js (App Router) + TypeScript + Tailwind project
- [x] Set up environment variable placeholders for Claude API key and Supabase (`.env.example` + `.env.local`)
- [x] Build the Search screen shell (Evidence Type, Claim, optional filters)

### Phase 2: Core Features
- [ ] **Article Finder** — API route that takes search params, calls Claude to find/verify/rank real articles, returns ranked results with explanations
- [ ] **Search results UI** — ranked cards showing title, author, publication, date, source quality, and why-it-matches explanation
- [ ] **Card Cutter** — API route that takes a selected article + card length + claim, extracts the strongest warrant, preserves author wording, applies debate formatting
- [ ] **Card length controls** — Short / Medium / Long / Entire Article
- [ ] **Card output UI** — display the finished, debate-ready card
- [ ] Connect Supabase PostgreSQL for cached article metadata (deferred from Phase 1 — not on the critical path)

### Phase 3: Polish
- [ ] Error handling (no sources found, article can't be parsed, no strong warrant)
- [ ] Performance: search < 10s, card cutting < 15s, instant navigation
- [ ] Clean, minimal, fast UI polish; responsive layout

### Phase 4: Launch
- [ ] Security pass (secrets in env only, minimal logging, no unnecessary data)
- [ ] Deploy to Vercel from GitHub
- [ ] Launch checklist verified against Acceptance Criteria

## What NOT To Do
- Do NOT fabricate, hallucinate, or paraphrase evidence — only extract real author wording from real articles.
- Do NOT invent citations or sources.
- Do NOT build anything in the Non-Goals list (case writing, AI-generated arguments, speech generation, accounts, evidence libraries, analytics, team collaboration, exports).
- Do NOT add authentication for the MVP.
- Do NOT delete files without confirmation.
- Do NOT modify database schemas without a backup plan.
- Do NOT add features not in the current phase.
- Do NOT skip verification for "simple" changes.
- Do NOT use deprecated libraries or expose secrets to the client.
