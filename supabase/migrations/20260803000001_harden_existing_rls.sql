-- Harden the tables that already exist (profiles, rounds, debater_profile).
--
-- WHY THIS EXISTS: the app's API routes previously relied ENTIRELY on RLS for
-- tenant isolation, but RLS lived only in the Supabase dashboard — nothing in
-- the repo asserted it was on, and nothing could verify it. This migration makes
-- the policies explicit, reviewable, and diffable. The routes were also fixed to
-- filter by user_id explicitly, so isolation now holds even if a policy is
-- dropped by accident (defense in depth, not a substitute for RLS).
--
-- SAFE TO RE-RUN. Every statement is idempotent and every block no-ops if the
-- table isn't there, so this can be applied before or after `supabase db pull`
-- without clobbering the live schema.
--
-- Policies use `(select auth.uid())` rather than a bare `auth.uid()`: the bare
-- form is re-evaluated per row, the subquery form is evaluated once and cached.
-- Every column named in a policy is indexed below for the same reason.

-- ---------------------------------------------------------------- profiles --
-- One row per user; `id` IS the auth user id. Holds last_seen (presence) + tier.
do $$
begin
  if to_regclass('public.profiles') is null then
    raise notice 'skipping profiles: table not found';
    return;
  end if;

  execute 'alter table public.profiles enable row level security';

  -- A user may read and update ONLY their own row. No insert/delete policy:
  -- rows are created by the presence route via the service_role key, which
  -- bypasses RLS, so the client can never mint or destroy a profile row.
  execute 'drop policy if exists profiles_select_own on public.profiles';
  execute 'create policy profiles_select_own on public.profiles
             for select to authenticated
             using ((select auth.uid()) = id)';

  execute 'drop policy if exists profiles_update_own on public.profiles';
  execute 'create policy profiles_update_own on public.profiles
             for update to authenticated
             using ((select auth.uid()) = id)
             with check ((select auth.uid()) = id)';
end $$;

-- Presence counts "everyone seen in the last N minutes" — an index makes that a
-- range scan instead of a full table scan as the user count grows.
create index if not exists profiles_last_seen_idx on public.profiles (last_seen desc);

-- ------------------------------------------------------------------ rounds --
-- The Round Log. Many rows per user; the hot query is "my rounds, newest first".
do $$
begin
  if to_regclass('public.rounds') is null then
    raise notice 'skipping rounds: table not found';
    return;
  end if;

  execute 'alter table public.rounds enable row level security';

  execute 'drop policy if exists rounds_select_own on public.rounds';
  execute 'create policy rounds_select_own on public.rounds
             for select to authenticated
             using ((select auth.uid()) = user_id)';

  execute 'drop policy if exists rounds_insert_own on public.rounds';
  execute 'create policy rounds_insert_own on public.rounds
             for insert to authenticated
             with check ((select auth.uid()) = user_id)';

  execute 'drop policy if exists rounds_update_own on public.rounds';
  execute 'create policy rounds_update_own on public.rounds
             for update to authenticated
             using ((select auth.uid()) = user_id)
             with check ((select auth.uid()) = user_id)';

  execute 'drop policy if exists rounds_delete_own on public.rounds';
  execute 'create policy rounds_delete_own on public.rounds
             for delete to authenticated
             using ((select auth.uid()) = user_id)';
end $$;

-- Composite, in the order the route actually queries: filter by owner, sort by
-- recency. A lone user_id index would still leave a sort; this serves both.
create index if not exists rounds_user_created_idx
  on public.rounds (user_id, created_at desc);

-- --------------------------------------------------------- debater_profile --
-- One row per user (the saved AI "read on your game").
do $$
begin
  if to_regclass('public.debater_profile') is null then
    raise notice 'skipping debater_profile: table not found';
    return;
  end if;

  execute 'alter table public.debater_profile enable row level security';

  execute 'drop policy if exists debater_profile_select_own on public.debater_profile';
  execute 'create policy debater_profile_select_own on public.debater_profile
             for select to authenticated
             using ((select auth.uid()) = user_id)';

  execute 'drop policy if exists debater_profile_insert_own on public.debater_profile';
  execute 'create policy debater_profile_insert_own on public.debater_profile
             for insert to authenticated
             with check ((select auth.uid()) = user_id)';

  execute 'drop policy if exists debater_profile_update_own on public.debater_profile';
  execute 'create policy debater_profile_update_own on public.debater_profile
             for update to authenticated
             using ((select auth.uid()) = user_id)
             with check ((select auth.uid()) = user_id)';

  execute 'drop policy if exists debater_profile_delete_own on public.debater_profile';
  execute 'create policy debater_profile_delete_own on public.debater_profile
             for delete to authenticated
             using ((select auth.uid()) = user_id)';
end $$;

-- The route upserts on user_id, so it must be unique — this also backs the FK
-- lookup. Unique (not plain) because "one profile per user" is a real invariant
-- and `upsert(..., onConflict: "user_id")` requires a unique constraint to work.
create unique index if not exists debater_profile_user_id_key
  on public.debater_profile (user_id);
