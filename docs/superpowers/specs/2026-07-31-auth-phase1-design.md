# Phase 1 — Accounts (Supabase Auth) Design

**Date:** 2026-07-31

## Goal
Add real user accounts so debaters sign in before using the app, their data
follows them across devices, and the developer can see who has signed up and who
is active — the foundation for payments + per-user quotas later.

## Hard requirements (from the user)
1. **No skipping login.** A visitor cannot reach the app by typing `/lab` (or any
   app URL) directly. Every protected route requires a valid session; unauthenticated
   requests are redirected to sign in — enforced server-side, not just in the UI.
2. **Developer visibility (private).** The developer can see, in the database,
   **how many people have signed up / logged in** and **who is currently active** —
   private to the developer, tying the login system to the live user count.

## Stack decision
- **Supabase** for Auth + Postgres (already provisioned; keys in `.env.local`).
- Client: **`@supabase/ssr`** (the current, cookie-based SSR helper) — a browser
  client, a server client, and middleware session refresh.
- **Auth method: email + password first.** Zero external setup, works immediately.
  **Google sign-in is a fast follow-up** — it needs a Google Cloud OAuth client
  (the developer creates it; ID + secret go into Supabase). The login UI + gating
  are provider-agnostic, so adding Google later is additive.

## Requirement 1 — hard route-gating (can't skip login)
- A **Next.js middleware** (`middleware.ts`) runs on every request to app routes
  (`/lab` and any future app paths). It reads the Supabase session from cookies;
  **no session → redirect to `/` (sign in)**. Runs regardless of how the user
  navigates (typed URL, link, refresh), so `/lab` can't be reached logged-out.
- The API routes additionally check the session server-side (defense in depth): an
  unauthenticated call to `/api/search` etc. returns 401 even if middleware were
  bypassed. Slots into the existing `guardApi`.
- The landing `/` stays public (it's the sign-in surface). The `HumanGate`
  (Turnstile) stays on top for bot protection.

## Requirement 2 — developer visibility of users + who's online
- **Who signed up / logged in:** Supabase already records this in **`auth.users`**
  (email, `created_at`, `last_sign_in_at`). The developer views it privately in the
  Supabase dashboard → Authentication → Users. Count of rows = total users.
- **Who's active right now:** a **`profiles.last_seen`** timestamp, updated by the
  presence heartbeat (which becomes authenticated). The developer queries `profiles`
  ordered by `last_seen` (or a `SELECT count(*) … WHERE last_seen > now()-interval
  '1 minute'`) in the dashboard to see who's online. This is the same signal the
  **live count** uses — now keyed by real user id (the `clientKeyFromRequest` seam).
- All of this is **private**: RLS lets a user read/write only their own row; the
  developer uses the service_role key / dashboard to see everyone.

## Database schema (created via one SQL migration the dev runs in Supabase)
```
profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text,
  tier text not null default 'free',      -- 'free' now; 'pro' in Phase 2
  last_seen timestamptz,
  created_at timestamptz not null default now()
)
rounds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  tournament text, round_label text, side text, result text,
  opponent text, report text,
  created_at timestamptz not null default now()
)
debater_profile (                          -- the AI profile, one row per user
  user_id uuid primary key references auth.users on delete cascade,
  profile jsonb not null,
  signature text,
  generated_at timestamptz not null default now()
)
```
- **RLS ON** for all three: policy `user_id = auth.uid()` for select/insert/update/
  delete, so each debater only ever touches their own rows. The server uses the
  service_role key for admin/dev reads.
- A trigger creates a `profiles` row automatically when a new `auth.users` row is
  inserted (so every signup has a profile).

## Data migration (localStorage → account)
- On first sign-in, if the browser has local `lbl-rounds` / `lbl-profile`, offer a
  one-click "import your saved rounds" → write them to the user's DB rows, then
  clear local. Afterwards `lib/roundLog.ts` / `lib/profileStore.ts` read/write the
  DB (via API routes) instead of localStorage — the single storage seam, so the
  Record UI doesn't change.

## Architecture / files (outline)
- `lib/supabase/server.ts`, `lib/supabase/client.ts`, `lib/supabase/middleware.ts`
  — the `@supabase/ssr` clients + session refresh.
- `middleware.ts` — route-gating (redirect unauthenticated app routes to `/`).
- `app/page.tsx` — becomes the sign-in / sign-up surface (email + password), still
  the public landing; "Get Started" → the auth form.
- `app/api/auth/...` or server actions — sign in / sign up / sign out.
- `app/lab/page.tsx` — reads the session (already gated by middleware); shows the
  signed-in user + a sign-out control in the header.
- Presence: heartbeat updates `profiles.last_seen`; live count counts active users.
- Round log / profile: swap localStorage internals for DB-backed API calls.

## What the developer does (I can't reach these from the coding session)
1. **Run one SQL block** in Supabase → SQL Editor (I provide it) to create the
   tables + RLS + trigger. ~30 seconds, copy-paste.
2. **Add the 3 Supabase env vars to Vercel** (Settings → Environment Variables,
   Production) so auth works in production.
3. **Google sign-in (later):** create a Google Cloud OAuth client and paste its ID
   + secret into Supabase → Authentication → Providers → Google. I'll give exact
   steps; the Supabase callback URL is
   `https://jgghzowoczislthhegah.supabase.co/auth/v1/callback`.

## Testing
- Locally with the real Supabase keys: sign up a test account, confirm `/lab` is
  unreachable when logged out (redirect to `/`), reachable when logged in; sign out
  works; a second account can't see the first's rounds (RLS); `profiles.last_seen`
  updates.
- Unit-test the pure helpers (e.g. the auth redirect decision, migration mapping).

## Out of scope (later phases)
- Payments / tiers (Phase 2). Per-user quotas + API scaling (Phase 3). Google
  sign-in is a Phase-1 follow-up once the Google Cloud client exists.
