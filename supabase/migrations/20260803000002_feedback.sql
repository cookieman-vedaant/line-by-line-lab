-- In-app feedback / bug reports.
--
-- Replaces a `mailto:` link that silently did nothing for any user without an
-- OS-registered mail client (the default on Windows 11). Structured rows also
-- mean reports arrive with the tool, the app version, and the account attached,
-- instead of whatever the user remembered to type into an email.

create table if not exists public.feedback (
  id            bigint generated always as identity primary key,
  -- SET NULL, not CASCADE: when someone deletes their account the report is
  -- anonymized rather than destroyed, so a real bug doesn't disappear with the
  -- reporter. The PII (who) goes; the signal (what broke) stays.
  user_id       uuid references auth.users (id) on delete set null,
  -- Optional and only if the user asks for a reply. Cleared on account deletion.
  contact_email text check (contact_email is null or char_length(contact_email) <= 320),
  kind          text not null default 'other' check (kind in ('bug', 'idea', 'other')),
  message       text not null check (char_length(message) between 1 and 4000),
  -- Which tool/tab they were on. Helps triage without asking.
  page          text check (page is null or char_length(page) <= 200),
  user_agent    text check (user_agent is null or char_length(user_agent) <= 500),
  status        text not null default 'new' check (status in ('new', 'triaged', 'fixed', 'wontfix')),
  created_at    timestamptz not null default now()
);

alter table public.feedback enable row level security;

-- A user may file a report as themselves, and read back only their own. There is
-- deliberately NO update or delete policy: a submitted report is immutable from
-- the client, so nobody can edit or erase a trail after the fact. Triage
-- (changing `status`) happens with the service_role key, which bypasses RLS.
drop policy if exists feedback_insert_own on public.feedback;
create policy feedback_insert_own on public.feedback
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists feedback_select_own on public.feedback;
create policy feedback_select_own on public.feedback
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- FK column: Postgres does not index these automatically, and it backs both the
-- RLS predicate above and the ON DELETE SET NULL sweep when an account is removed.
create index if not exists feedback_user_id_idx on public.feedback (user_id);

-- The triage query is "what's new, newest first". Partial index — once a report
-- is handled it leaves the index, so this stays small no matter how much
-- feedback accumulates.
create index if not exists feedback_new_created_idx
  on public.feedback (created_at desc)
  where status = 'new';
