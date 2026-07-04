# Tech Stack & Tools

- **Frontend:** Next.js (App Router) + React + TypeScript. Uses Server Components to reduce complexity.
- **Backend:** Next.js Route Handlers (API routes) — no separate backend server.
- **Database:** Supabase PostgreSQL. Stores cached article metadata now; search history and user preferences are future-only.
- **Styling:** Tailwind CSS. Fast, responsive, zero CSS maintenance.
- **AI:** Claude API (Anthropic). Powers article discovery/ranking and card cutting. Use a current Claude model (e.g. Claude Sonnet for speed on search, Claude Opus if deeper reasoning is needed for card cutting). Model choice can be tuned later.
- **Authentication:** None for MVP. (Future: Supabase Auth or Clerk.)
- **Hosting:** Vercel, with automatic deployments from GitHub.

## Setup Commands
```bash
# 1. Scaffold (first time only)
npx create-next-app@latest line-by-line-lab --typescript --tailwind --app --eslint

# 2. Install the Claude + Supabase SDKs
npm install @anthropic-ai/sdk @supabase/supabase-js

# 3. Run locally
npm run dev
```

## Environment Variables
Store these in `.env.local` (never commit; never expose to the client):
```
ANTHROPIC_API_KEY=...            # server-side only
NEXT_PUBLIC_SUPABASE_URL=...     # safe to expose
SUPABASE_SERVICE_ROLE_KEY=...    # server-side only — never send to the browser
```

## Calling Claude (server-side Route Handler pattern)
```typescript
// app/api/search/route.ts — logic lives in services/, this route just wires it up
import { NextResponse } from "next/server";
import { findArticles } from "@/services/articleFinder";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    // Validate input at the boundary before doing any work.
    if (!body.claim || !body.evidenceType) {
      return NextResponse.json(
        { error: "Claim and evidence type are required." },
        { status: 400 },
      );
    }
    const results = await findArticles(body); // Claude call happens inside the service
    return NextResponse.json({ results });
  } catch (err) {
    // Never leak internals to the client; log server-side.
    console.error("search failed", err);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}
```

## Error Handling Pattern
```typescript
// Normalize errors at the service boundary. Return user-safe messages; log detail server-side.
export async function findArticles(params: SearchParams): Promise<Article[]> {
  const articles = await callClaudeForArticles(params);
  // If Claude finds nothing real, return the honest message — do NOT fabricate a source.
  if (articles.length === 0) {
    throw new NoSourcesFoundError(
      "No reputable sources were found matching your criteria.",
    );
  }
  return articles;
}
```

## Styling & Component Example
```tsx
// A simple, clean, fast card — the app should feel like a tool, not a workspace.
function ArticleResult({ article }: { article: Article }) {
  return (
    <div className="rounded-lg border border-gray-200 p-4 hover:border-gray-400 transition">
      <h3 className="font-semibold text-gray-900">{article.title}</h3>
      <p className="text-sm text-gray-500">
        {article.author} · {article.publication} · {article.date}
      </p>
      <p className="mt-2 text-sm text-gray-700">{article.explanation}</p>
    </div>
  );
}
```
