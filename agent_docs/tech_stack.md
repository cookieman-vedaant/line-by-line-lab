# Tech Stack & Tools

**The golden rule of this stack: $0. No paid APIs.** The Claude API was removed by user decision (2026-07-04) because it costs money.

- **Frontend:** Next.js 16 (App Router) + React 19 + TypeScript. Server Components by default; interactive pieces are `"use client"` components.
- **Backend:** Next.js Route Handlers (`app/api/*/route.ts`) — no separate server.
- **Article search:** OpenAlex (`api.openalex.org`, no key, ~100k req/day) + Semantic Scholar (`api.semanticscholar.org`, no key, shared rate pool). Free scholarly databases — every result is a real paper.
- **AI:** Google Gemini API **free tier** via `@google/genai`. Default model `gemini-2.5-flash` (override with `GEMINI_MODEL` env var). Used for: debate-aware query expansion, candidate ranking + explanations, and card cutting. Free tier ≈ 10-15 req/min with daily caps — handle 429s gracefully (`RateLimitedError`).
- **Article extraction:** `@mozilla/readability` + `jsdom` — turns a URL into clean article text server-side (same engine as Firefox Reader Mode).
- **Validation:** zod at every boundary (form → API → model output).
- **Styling:** Tailwind CSS 4 (CSS-based config in `app/globals.css`).
- **Database:** Supabase PostgreSQL — DEFERRED. Add only if repeated-search caching proves needed.
- **Testing:** Vitest (`npm test`).
- **Hosting:** Vercel free tier, auto-deploy from GitHub. Set `GEMINI_API_KEY` in Vercel env.
- **Authentication:** None for MVP.

## Environment Variables
`.env.local` (never commit; never expose to the client):
```
GEMINI_API_KEY=...   # free key from https://aistudio.google.com — server-side only
# GEMINI_MODEL=gemini-2.5-flash   # optional override
```

## Where things live
```
lib/gemini.ts        # Gemini client + generateJson() + typed errors
lib/json.ts          # extractJson() — tolerant JSON extraction from model text
lib/verbatim.ts      # programmatic verbatim verification of card bodies
lib/apiClient.ts     # browser-side fetch helpers for the two routes
services/academicSearch.ts  # OpenAlex + Semantic Scholar fetchers (real articles only)
services/articleFinder.ts   # expand → retrieve → rank pipeline
services/articleExtract.ts  # URL → clean text via Readability
services/cardCutter.ts      # cut + sample-card formatting + verbatim check
```

## Calling Gemini (the one pattern to copy)
```typescript
import { generateJson } from "@/lib/gemini";
import { z } from "zod";

const schema = z.object({ queries: z.array(z.string()) });

const raw = await generateJson({
  system: "You are ... Return ONLY JSON: {\"queries\": [...]}",
  prompt: `Claim: ${claim}`,
  maxOutputTokens: 1024,
});
const parsed = schema.safeParse(raw);
if (!parsed.success) {
  // fail honestly — never fabricate a fallback result
}
```

## Error Handling Pattern
Typed error classes thrown by services, mapped to responses in thin routes:
```typescript
// service
if (articles.length === 0) throw new NoSourcesFoundError();

// route
if (err instanceof NoSourcesFoundError) return NextResponse.json({ articles: [], notice: err.message });
if (err instanceof RateLimitedError)    return NextResponse.json({ error: err.message }, { status: 429 });
if (err instanceof MissingApiKeyError)  return NextResponse.json({ error: err.message }, { status: 500 });
// everything else: log server-side, return a generic user-safe message
```

## The No-Fabrication Architecture (why this stack is trustworthy)
1. Articles can't be invented: they come from scholarly databases; the AI only ranks retrieved candidates by index.
2. Card bodies can't be invented: `verifyVerbatim()` checks every chunk against the source text server-side; failures get one retry with feedback, then an honest rejection.
3. Empty results stay empty: "No reputable sources were found matching your criteria." — never padded.
