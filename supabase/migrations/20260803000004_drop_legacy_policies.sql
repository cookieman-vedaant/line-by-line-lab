-- Retire the pre-migration dashboard policies, and close the one gap dropping
-- them would otherwise open.
--
-- WHY: the legacy policies ("own rounds", "own profile", "own ai profile") were
-- CORRECT — each scoped to `auth.uid() = user_id`, so there was no data leak.
-- The problem is performance. They are declared `FOR ALL` with a BARE
-- `auth.uid()`, which Postgres re-evaluates once PER ROW. Policies are OR'ed
-- together, so leaving them in place means every query still pays that per-row
-- cost even though the new policies use the `(select auth.uid())` form that is
-- evaluated once and cached. Keeping both defeats the optimization entirely.
--
-- Verified before writing this migration: the replacements added in
-- …_harden_existing_rls.sql cover SELECT / INSERT / UPDATE / DELETE for `rounds`
-- and `debater_profile`, so dropping the legacy `FOR ALL` policy changes no
-- user's access on those tables.

-- `profiles` is the exception: the hardening migration only added SELECT and
-- UPDATE, because profile rows are normally written by the presence route using
-- the service_role key (which bypasses RLS). But that route has a documented
-- FALLBACK to the user's own client when the admin client is unavailable, and
-- that fallback performs an UPSERT — which needs INSERT. The legacy `FOR ALL`
-- policy was silently covering it. Add it explicitly BEFORE dropping, so the
-- fallback keeps working.
do $$
begin
  if to_regclass('public.profiles') is null then
    raise notice 'skipping profiles: table not found';
    return;
  end if;

  execute 'drop policy if exists profiles_insert_own on public.profiles';
  execute 'create policy profiles_insert_own on public.profiles
             for insert to authenticated
             with check ((select auth.uid()) = id)';
end $$;

-- No DELETE policy for profiles, deliberately: account deletion runs through the
-- admin client (which cascades from auth.users), so a user-facing DELETE grant
-- would be privilege we never use.

drop policy if exists "own rounds" on public.rounds;
drop policy if exists "own profile" on public.profiles;
drop policy if exists "own ai profile" on public.debater_profile;
