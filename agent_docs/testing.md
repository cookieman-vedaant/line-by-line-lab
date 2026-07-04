# Testing Strategy

For a vibe-coded MVP, keep testing lightweight but real. The most important gate is **browser verification of the two core flows** — automated tests support that, they don't replace it.

## Frameworks
- **Unit Tests:** Vitest (fast, works well with Next.js/TypeScript).
- **E2E Tests:** Playwright — add only for the top user journeys (search → results, select → cut card) once those flows are stable. Not required for early Phase 1/2 work.

## What to Test
- **Unit:** pure logic only — source-ranking helpers, card-length selection helpers, debate evidence-type mapping, formatting utilities. These are where bugs hide and where tests pay off.
- **Manual / Browser (required every feature):** run `npm run dev` and confirm:
  - Search form validates (Evidence Type + Claim required) and returns ranked, real articles with explanations.
  - Selecting an article + a length produces a debate-ready card that preserves wording and shows citation metadata first.
  - Error states show the honest messages (no sources / can't parse / no strong warrant) — never a fabricated result.
- **AI-quality spot check:** For the Card Cutter, confirm the output is *extracted* not paraphrased — the card text should appear verbatim in the source article.

## Rules & Requirements
- **Before Commit:** run `npm run lint`, `tsc --noEmit`, and `npm test`; verify the touched flow in the browser.
- **Failures:** NEVER skip tests or weaken assertions to make things pass without human approval. If the agent breaks a test, the agent fixes it.
- **Pre-commit Hooks:** When ready, add a pre-commit hook (e.g. Husky + lint-staged) to run lint + type check before each commit. If a hook fails, fix the cause — do not bypass with `--no-verify` unless the human approves.

## Execution
- Run all tests: `npm test`
- Run a single test file: `npm test -- path/to/file.test.ts`
- Type check: `npx tsc --noEmit`
- Lint: `npm run lint`

## Verification Loop
After each feature: run checks → verify in the browser → fix any failure before starting the next feature → update `MEMORY.md` → check against `REVIEW-CHECKLIST.md`.
