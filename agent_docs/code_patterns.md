# Code Patterns

## Purpose
This file defines the implementation patterns the agent should follow for Line by Line Lab.
Prefer these patterns over inventing new ones.

## Architecture Pattern
- **Primary pattern:** Feature-based + thin transport layer.
- **Rule:** Route Handlers (`app/api/**/route.ts`) handle request/response ONLY. No Claude calls, no ranking, no formatting logic inside them.
- **Rule:** All business logic (article finding, ranking, card cutting, debate formatting) lives in `services/` or `lib/`. Route handlers call these.
- **Rule:** Keep domain logic separate from UI. Reuse existing modules before creating new abstractions.

## Suggested Folder Layout
```
app/
  page.tsx              # Search screen
  api/
    search/route.ts     # Article Finder endpoint (thin)
    cut/route.ts        # Card Cutter endpoint (thin)
services/
  articleFinder.ts      # Claude search + verify + rank
  cardCutter.ts         # Claude extract + debate formatting
lib/
  claude.ts             # Claude client setup
  debate.ts             # Debate knowledge (evidence types, formatting helpers)
  supabase.ts           # Supabase client
components/              # UI components (SearchForm, ArticleResult, CardOutput)
types/                  # Shared TypeScript types (Article, SearchParams, Card)
```

## Data Fetching
- **Primary approach:** React Server Components for reads where possible; client components post to Route Handlers (`/api/search`, `/api/cut`) for the AI actions.
- **Rule:** Do not add a data-fetching library (React Query, SWR, axios) unless a concrete need appears. Native `fetch` is sufficient for MVP.
- **Rule:** Keep fetch logic out of render functions.

## State Management
- **Server state:** Fetched per-request via Route Handlers; no global cache needed for MVP.
- **Client state:** React `useState` for form fields and the currently selected article/card. Do NOT add Redux/Zustand — built-in state is enough.
- **Forms:** Plain controlled inputs. Validate before submitting.

## Error Handling
- Normalize errors at the service/API boundary — never let raw exceptions reach the UI.
- Never swallow errors silently; always log server-side.
- Return user-safe messages in the UI; log developer context on the server.
- Use a consistent error shape across all API responses (e.g. `{ error: string }`).
- **Debate-specific honest failures (never fabricate to hide them):**
  - No reputable sources → "No reputable sources were found matching your criteria."
  - Article can't be parsed → explain the failure and let the user pick another article.
  - No strong warrant → "Unable to identify a sufficiently strong argumentative passage."

## Validation
- Validate all external inputs: search form (Evidence Type + Claim required), API payloads, environment variables.
- Apply runtime validation at system boundaries; trust internal types within.
- Co-locate validation with the relevant route/form.

## File and Naming Conventions
- **Files:** kebab-case (Next.js default) e.g. `article-finder.ts`. Match existing convention once the project is scaffolded.
- **Components / classes / types:** PascalCase (`ArticleResult`, `SearchParams`).
- **Functions / variables:** camelCase (`findArticles`, `cardLength`).
- **Constants / env vars:** UPPER_SNAKE_CASE (`ANTHROPIC_API_KEY`).

## The Core Domain Rule (most important pattern in this app)
- The Card Cutter **extracts**, it does not summarize or paraphrase. Preserve the author's original wording exactly, except for omitted text.
- Optimize card selection for **the strongest warrant supporting the user's claim** — not the first paragraph, longest paragraph, or most famous quote.
- Always output citation metadata (author, publication, date, URL) before the evidence body.
- The AI recommends; the debater decides. Never auto-select on the user's behalf.

## Testing Pattern
- Unit-test pure logic: ranking helpers, formatting helpers, debate-type mapping.
- Manually verify the two core flows (search, cut card) in the browser after each feature.
- Run checks after every feature; fix failures before moving on.

## Change Discipline
- Prefer focused, minimal edits over large rewrites.
- Do not introduce new dependencies without checking `tech_stack.md` first.
- Do not change database schemas, auth flows, or secrets handling without explicit approval.
- One feature at a time — commit or checkpoint after each working feature.
