-- opencaselist (wiki mining) per-user sessions.
--
-- Each user connects their OWN Tabroom account. We exchange those credentials
-- once with api.opencaselist.com for a `caselist_token` cookie and store only
-- the token, encrypted. The PASSWORD IS NEVER STORED, in any form.
--
-- Why per-user rather than one shared account: opencaselist rate-limits
-- /search to 4 requests per MINUTE keyed on user_id, so a single shared account
-- would make every user of this app share four searches a minute. It would also
-- be credential misuse against Tabroom. Per-user login is how opencaselist's own
-- frontend works, and it means a user sees exactly what they'd see signed in
-- themselves — we never widen anyone's access.

create table if not exists public.caselist_sessions (
  -- One live connection per user. Reconnecting overwrites (upsert on conflict).
  user_id          uuid primary key references auth.users (id) on delete cascade,

  -- AES-256-GCM. The key lives in the app env (CASELIST_TOKEN_KEY), NOT in the
  -- database, so a database compromise alone yields no usable credential.
  token_ciphertext text        not null,
  token_iv         text        not null,
  token_tag        text        not null,

  -- Display only ("Connected as …"). Deliberately NOT the Tabroom username:
  -- that's an email address, i.e. personal data we have no purpose for here.
  connected_label  text check (connected_label is null or char_length(connected_label) <= 120),

  -- opencaselist issues sessions with a two-week life
  -- (postLogin.js: DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 2 WEEK)). Past this we
  -- re-prompt rather than firing a request we know will 401.
  expires_at       timestamptz not null,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.caselist_sessions enable row level security;

-- DELIBERATELY NO POLICIES.
--
-- Every other table here grants the owner select/insert on their own rows. This
-- one grants nothing to `anon` or `authenticated`, so PostgREST returns nothing
-- to anybody holding the public anon key — including for their own row. Only
-- server code using the service_role key (which bypasses RLS) touches it.
--
-- The reasoning: this row holds a credential for a THIRD-PARTY service. The
-- ciphertext is useless without CASELIST_TOKEN_KEY, which never leaves the
-- server, but there is no feature that requires a browser to read it — so it
-- should not be reachable from one at all. RLS stays ENABLED (not disabled) so
-- the default-deny is explicit and survives anyone later adding a broad grant.

-- Belt and braces. Supabase grants table privileges to anon/authenticated by
-- default, so RLS-with-no-policy was the ONLY thing standing between the public
-- anon key and this table. That is enough on its own (no policy = no rows), but
-- it is one accidental `create policy` away from not being enough. Removing the
-- grant means a future permissive policy still cannot expose a credential.
-- service_role is unaffected — it bypasses both.
revoke all on public.caselist_sessions from anon, authenticated;

-- Expired sessions are dead weight and hold a (useless, but real) credential.
-- Fold them into the existing retention sweep. The return type gains a column,
-- and Postgres will not change a function's return type in place, so drop first.
-- app/api/cron/purge spreads the returned row, so it needs no change.
drop function if exists public.purge_expired_data();

create function public.purge_expired_data()
returns table (audit_deleted bigint, bans_deleted bigint, caselist_sessions_deleted bigint)
language plpgsql
security definer
-- Empty search_path: a SECURITY DEFINER function without this can be hijacked by
-- a caller who puts a malicious schema earlier in their own search_path.
set search_path = ''
as $$
declare
  a bigint;
  b bigint;
  c bigint;
begin
  delete from public.audit_log where created_at < now() - interval '90 days';
  get diagnostics a = row_count;

  delete from public.ip_bans
   where expires_at is not null and expires_at < now() - interval '30 days';
  get diagnostics b = row_count;

  -- No grace period: an expired opencaselist token cannot be used for anything,
  -- so there is no investigative value in keeping it the way there is for bans.
  delete from public.caselist_sessions where expires_at < now();
  get diagnostics c = row_count;

  return query select a, b, c;
end;
$$;

revoke execute on function public.purge_expired_data() from public, anon, authenticated;
grant execute on function public.purge_expired_data() to service_role;

-- Backs the purge sweep above.
create index if not exists caselist_sessions_expires_at_idx
  on public.caselist_sessions (expires_at);
