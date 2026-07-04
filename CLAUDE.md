@AGENTS.md

# CLAUDE.md — Claude Code Configuration for Line by Line Lab

## Project Context
**App:** Line by Line Lab — debate-aware evidence discovery & card cutting
**Stack:** Next.js 16 (App Router) + React 19 + TypeScript, Tailwind CSS 4, Supabase PostgreSQL, Claude API, Vercel
**Stage:** MVP Development
**User Level:** A — Vibe-coder (AI does the coding; the human guides and tests). Explain concepts simply and focus on "what to do next."

## Directives
1. **Master Plan:** `AGENTS.md` (imported above) has the current phase, roadmap, and constraints.
2. **Documentation:** Refer to `agent_docs/` for tech stack, code patterns, requirements, and testing. Load only what you need.
3. **Plan-First:** Propose a brief plan and wait for approval before coding.
4. **Incremental Build:** Build one small feature at a time. Verify in the browser frequently.
5. **Memory:** Update `MEMORY.md` after milestones or decisions; summarize into it instead of relying on long chat history.
6. **No Fabrication:** Never invent evidence, citations, or sources. The Card Cutter extracts author wording — it never paraphrases.
7. **Stay In Scope:** Only build the Article Finder and Card Cutter for MVP. Nothing from the Non-Goals list.
8. **Pre-Commit:** If hooks exist, run them before commits and fix failures.
9. **No Linting Busywork:** Don't act as a linter. Use `npm run lint` when needed.
10. **Communication:** Be concise. Ask ONE specific clarifying question when info is missing.

## Commands
- `npm run dev` — Start dev server
- `npm test` — Run tests (runner not yet installed)
- `npm run lint` — Check code style
- `npx tsc --noEmit` — Type check
- `npm run build` — Production build

## Verify Before "Done"
Check the work against `REVIEW-CHECKLIST.md`, and for UI changes confirm the flow works in the browser — not just that it compiles.
