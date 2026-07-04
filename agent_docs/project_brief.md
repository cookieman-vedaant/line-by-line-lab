# Project Brief (Persistent)

- **Product vision:** Transform hours of debate evidence preparation into minutes without sacrificing evidence quality — a specialized evidence engine built by debaters for debaters, not another AI chatbot.
- **Target Audience:** High school Lincoln-Douglas debaters, from beginners to national-circuit competitors, who currently rely on Google, Google Scholar, Verbatim, and Google Docs.
- **User Level (builder):** Vibe-coder — the AI does the coding; the human guides direction and tests results. Explain concepts simply and focus on "what to do next."

## Product Philosophy (non-negotiable)
- AI should eliminate repetitive work, not thinking. Debaters still create their own arguments.
- AI must NEVER invent evidence or citations.
- AI must preserve the author's original wording.
- The user always remains in control of evidence selection (AI recommends, debater decides).
- Speed matters more than flashy UI. The app should feel like a tool, not a workspace.

## Scope Guardrails
- **In scope (the only two jobs):** Article Finder and Card Cutter.
- **Out of scope for MVP:** AI-generated cases/arguments, speech writing, flowing, judge adaptation, practice speeches, analytics, team collaboration, tournament management, cloud storage, accounts, evidence libraries, exports. If a feature does not directly improve evidence discovery or card cutting, it comes after MVP.

## Conventions
- **Naming:** kebab-case files, PascalCase components/types, camelCase functions/variables.
- **File Structure:** Feature-based. Thin API routes; logic in `services/`/`lib/`. See `code_patterns.md`.
- **Type Safety:** Strict TypeScript, no `any`.

## Quality Gates
- Lint passes (`npm run lint`) and type check passes (`tsc --noEmit`) before a task is "done."
- Both core flows (search, cut card) manually verified in the browser.
- `MEMORY.md` updated with any new architectural decision.
- Review against `REVIEW-CHECKLIST.md` before merging.

## Key Commands
- `npm run dev` — start dev server
- `npm test` — run tests
- `npm run lint` — check code style
- `npm run build` — production build

## Key Principles
- Ship the simplest possible solution that solves the user story.
- Prefer the built-in framework capability over adding a library.
- Move the user from "I need evidence" to "I have a finished card" in as few interactions as possible.

## Update Cadence
- Refresh this brief whenever scope, stack, or conventions change. Log build-time decisions in `MEMORY.md`, not here.
