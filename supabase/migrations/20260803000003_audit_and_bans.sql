-- Security audit trail + IP ban list.
--
-- Both tables are SERVER-ONLY. They have RLS enabled and deliberately NO
-- policies at all, which in Postgres means "deny everything" for the `anon` and
-- `authenticated` roles — a signed-in user cannot read the audit log, cannot see
-- whether an IP is banned, and cannot write either table. Only the service_role
-- key (server-side, never shipped to the browser) bypasses RLS to touch them.

-- --------------------------------------------------------------- audit_log --
-- Append-only record of security-relevant events: sign-ups, account deletions,
-- bans, tier changes, repeated auth failures. Needed before taking payments —
-- when a user disputes "I never deleted that" you need a record, not a memory.
create table if not exists public.audit_log (
  id         bigint generated always as identity primary key,
  -- SET NULL so the trail survives the account it describes. An account-deletion
  -- event whose row vanished with the account would be worse than useless.
  user_id    uuid references auth.users (id) on delete set null,
  action     text not null check (char_length(action) between 1 and 100),
  -- Structured context (never raw article text or card bodies — this table is
  -- for security events, not user content).
  detail     jsonb not null default '{}'::jsonb,
  ip         text check (ip is null or char_length(ip) <= 100),
  created_at timestamptz not null default now()
);

alter table public.audit_log enable row level security;
-- No policies: authenticated/anon get nothing. (Stated explicitly so a future
-- reader doesn't "helpfully" add one.)

-- Tamper-evidence: even with the service_role key, rows cannot be edited or
-- removed through the Data API. Revoking these is what makes the log
-- append-only rather than merely "we promise not to change it". Deliberate
-- history edits require a direct superuser SQL connection, which is auditable
-- at the Postgres level.
revoke update, delete on public.audit_log from anon, authenticated, service_role;

create index if not exists audit_log_user_created_idx
  on public.audit_log (user_id, created_at desc);
create index if not exists audit_log_action_created_idx
  on public.audit_log (action, created_at desc);

-- ----------------------------------------------------------------- ip_bans --
-- Blocks an IP at the API guard. The motivating case is one person spinning up
-- many throwaway accounts: rate limits slow that down, a ban stops it.
create table if not exists public.ip_bans (
  ip         text primary key check (char_length(ip) between 1 and 100),
  reason     text check (reason is null or char_length(reason) <= 500),
  -- NULL = permanent. A timestamp = a temporary cool-off that expires on its own,
  -- which is the right default for automated bans (a shared school NAT can put a
  -- whole team behind one address — a permanent auto-ban would lock out a room).
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.ip_bans enable row level security;
-- No policies: server-only, same as audit_log.

-- Lookup is by primary key (exact IP), so no extra index is needed for the hot
-- path. This one supports the sweep that clears expired bans.
create index if not exists ip_bans_expires_idx
  on public.ip_bans (expires_at)
  where expires_at is not null;
