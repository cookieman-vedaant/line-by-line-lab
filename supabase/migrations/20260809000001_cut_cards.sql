-- Card-cut history, per ACCOUNT.
--
-- Every card produced by /api/cut is saved here, whichever tool asked for it —
-- the Article Finder and the standalone Cut a Card panel both funnel through
-- that one route, so a single write covers both and always will.
--
-- Scoped to auth.users, never to an IP: a debater cuts on a school laptop and
-- reviews on a phone, and an IP is both too broad (a school NAT is one address
-- for hundreds of students) and too narrow (a phone's address changes on the
-- walk to class) to be an identity. It is also personal data under GDPR, which
-- keying a library on would be a poor trade for something a user_id does better.

create table if not exists public.cut_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- The card itself, matching the app's `Card` domain type field for field.
  tag text not null,
  cite text not null,
  cite_details text not null,
  body text not null,

  -- What was asked for, so the list can be searched by argument rather than by
  -- remembering which article it came from.
  claim text not null default '',
  card_length text not null default '',

  -- 'finder' (cut from a search result) or 'cutter' (bring-your-own article).
  -- Free text rather than an enum so adding a third entry point later is a code
  -- change, not a migration with a table rewrite.
  origin text not null default 'cutter',

  source_url text,
  source_title text,
  source_publication text,

  created_at timestamptz not null default now()
);

-- Exactly the access pattern: "my cards, newest first", with created_at doubling
-- as the pagination cursor. Same shape as rounds_user_created_idx.
create index if not exists cut_cards_user_created_idx
  on public.cut_cards (user_id, created_at desc);

alter table public.cut_cards enable row level security;

-- Policies use `(select auth.uid())` rather than a bare `auth.uid()`: the bare
-- form is re-evaluated once PER ROW, and because policies are OR'ed together a
-- single bare policy cancels the optimisation for the whole table. This repo has
-- already had to remove three legacy policies for exactly that reason
-- (…_drop_legacy_policies.sql) — don't reintroduce the pattern.
drop policy if exists cut_cards_select_own on public.cut_cards;
create policy cut_cards_select_own on public.cut_cards
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists cut_cards_insert_own on public.cut_cards;
create policy cut_cards_insert_own on public.cut_cards
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists cut_cards_delete_own on public.cut_cards;
create policy cut_cards_delete_own on public.cut_cards
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- No UPDATE policy, deliberately. This is a record of what was cut; editing a
-- saved row would let the history disagree with what the Card Cutter actually
-- produced, and the no-fabrication rule makes that the one thing this table must
-- never allow. Users still edit and export freely in the card view — that works
-- on a copy in the browser and never writes back.

-- No row cap and no time expiry, also deliberately. Volume is already bounded
-- upstream by the per-tier cut quota, a season of cards is single-digit MB, and
-- silently deleting a debater's oldest evidence to reclaim that would be a worse
-- failure than the storage it saves. Rows go when the account goes (cascade).
