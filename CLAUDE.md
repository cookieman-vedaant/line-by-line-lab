@AGENTS.md

# CLAUDE.md — Claude Code Configuration for Line by Line Lab

## Project Context
**App:** Line by Line Lab — debate-aware evidence discovery & card cutting
**Stack:** Next.js 16 (App Router) + React 19 + TypeScript, Tailwind CSS 4, OpenAlex + Semantic Scholar (free search), Gemini API free tier (AI), Supabase PostgreSQL (deferred), Vercel. No paid APIs.
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

DISTILLED_AESTHETICS_PROMPT = """
<frontend_aesthetics>
You tend to converge toward generic, "on distribution" outputs. In frontend design, this creates what users call the "AI slop" aesthetic. Avoid this: make creative, distinctive frontends that surprise and delight. Focus on:
 
Typography: Choose fonts that are beautiful, unique, and interesting. Avoid generic fonts like Arial and Inter; opt instead for distinctive choices that elevate the frontend's aesthetics.
 
Color & Theme: Commit to a cohesive aesthetic. Use CSS variables for consistency. Dominant colors with sharp accents outperform timid, evenly-distributed palettes. Draw from IDE themes and cultural aesthetics for inspiration.
 
Motion: Use animations for effects and micro-interactions. Prioritize CSS-only solutions for HTML. Use Motion library for React when available. Focus on high-impact moments: one well-orchestrated page load with staggered reveals (animation-delay) creates more delight than scattered micro-interactions.
 
Backgrounds: Create atmosphere and depth rather than defaulting to solid colors. Layer CSS gradients, use geometric patterns, or add contextual effects that match the overall aesthetic.
 
Avoid generic AI-generated aesthetics:
- Overused font families (Inter, Roboto, Arial, system fonts)
- Clichéd color schemes (particularly purple gradients on white backgrounds)
- Predictable layouts and component patterns
- Cookie-cutter design that lacks context-specific character
 
Interpret creatively and make unexpected choices that feel genuinely designed for the context. Vary between light and dark themes, different fonts, different aesthetics. You still tend to converge on common choices (Space Grotesk, for example) across generations. Avoid this: it is critical that you think outside the box!
</frontend_aesthetics>
"""