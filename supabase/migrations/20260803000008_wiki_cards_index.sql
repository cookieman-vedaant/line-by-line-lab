-- Wiki card index — our own searchable copy of opencaselist's disclosed prep.
--
-- WHY THIS EXISTS: opencaselist has no whole-wiki search. Its own website
-- searches ONE caselist at a time (see client/src/search — every query is
-- scoped to a single shard), and the API caps /search at 4 requests a minute.
-- So "type a claim, get every matching card across the whole wiki, instantly"
-- is impossible as a live query. Tools like PrepSync solve this by INDEXING the
-- wiki into their own database (PrepSync: "5.5M pre-cut cards, new sources every
-- two weeks") and searching that. This table is our index.
--
-- Ingestion downloads opencaselist's weekly per-caselist zip archives, parses
-- each .docx into cards, and upserts them here. Users then search THIS table —
-- instant, complete, no rate limit, no per-user opencaselist login required.
--
-- This is SHARED PUBLIC CONTENT, not user data: every row is a card a debater
-- disclosed publicly, and every signed-in user searches the same corpus. That
-- is why the RLS shape here is the opposite of our per-user tables.

create table if not exists public.wiki_cards (
  id            uuid primary key default gen_random_uuid(),

  -- Dedup key. The same card is disclosed by many teams; we keep ONE row per
  -- distinct card (hash of tag + body) so a search doesn't return fifty copies.
  content_hash  text not null unique,

  -- The card itself, in the same shape the Card Cutter produces. `body` carries
  -- our internal emphasis delimiters (U+E000..E005) so CardView renders the
  -- debater's original highlighting unchanged.
  tag           text not null,
  cite          text not null default '',
  cite_details  text not null default '',
  body          text not null,

  -- Representative provenance (the first disclosure we saw of this card).
  caselist      text,
  year          int,
  school        text,
  team          text,
  source_url    text,

  -- Full-text index. tag is weighted above body so a card whose TAG is about the
  -- query outranks one that merely mentions it in passing. The 2-arg
  -- to_tsvector with an explicit config is IMMUTABLE, so it is valid in a stored
  -- generated column. The private-use delimiters in `body` are non-word
  -- characters to the parser, so they never pollute the index.
  search        tsvector generated always as (
                  setweight(to_tsvector('english', coalesce(tag, '')), 'A') ||
                  setweight(to_tsvector('english', coalesce(body, '')), 'B')
                ) stored,

  ingested_at   timestamptz not null default now()
);

create index if not exists wiki_cards_search_idx on public.wiki_cards using gin (search);
create index if not exists wiki_cards_year_idx on public.wiki_cards (year desc nulls last);

alter table public.wiki_cards enable row level security;

-- Any signed-in user may READ every card — that is the entire point of a shared
-- index. Writes come only from the ingester (service_role, which bypasses RLS);
-- there is deliberately no insert/update/delete policy, so no client can alter
-- the corpus.
drop policy if exists wiki_cards_read on public.wiki_cards;
create policy wiki_cards_read on public.wiki_cards
  for select to authenticated using (true);

-- Ranked full-text search over the index.
--
-- websearch_to_tsquery parses natural language the way a search box should — it
-- ignores stopwords ("is", "the") and never errors on punctuation, so a raw
-- claim like "brahman is the ultimate truth" Just Works. SECURITY INVOKER means
-- it runs under the caller's RLS (the read policy above), so it exposes nothing
-- the caller couldn't already select.
create or replace function public.search_wiki_cards(q text, lim int default 50)
returns setof public.wiki_cards
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from public.wiki_cards
  where search @@ websearch_to_tsquery('english', q)
  order by ts_rank(search, websearch_to_tsquery('english', q)) desc,
           ingested_at desc
  limit least(greatest(coalesce(lim, 50), 1), 100);
$$;

-- Freshness: drop cards not seen in the last two refresh cycles (~5 weeks), so
-- disclosures pulled from the wiki don't linger here forever after removal.
-- Wired into the existing purge cron alongside the other retention windows.
create or replace function public.purge_stale_wiki_cards()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer;
begin
  delete from public.wiki_cards where ingested_at < now() - interval '5 weeks';
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke execute on function public.purge_stale_wiki_cards() from anon, authenticated;
