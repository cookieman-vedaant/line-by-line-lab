-- Wiki search: let a debater narrow to specific caselists.
--
-- WHY: the index is 211k cards across every caselist and year, and a search
-- returns at most 60 of them. On a broad claim those 60 slots get spent on
-- whatever ranked highest overall — frequently the wrong division entirely, so
-- prep that exists is unreachable. Filtering server-side spends the 60 on
-- material the debater can actually read in their own event.
--
-- The cap deliberately stays where it is. Card bodies average 28-46 KB, so 60
-- results is already a ~2.8 MB response and 100 measured at 4.6 MB; raising the
-- cap would push cold queries past the 8 s statement timeout and make finding
-- cards harder, not easier. Narrowing the corpus is the cheap lever. (Raising it
-- properly means returning a light list and loading bodies on demand — the same
-- fix cut_cards needed — which is a bigger change for another day.)

-- Filtering and the caselist listing below both group/scan on this column, and
-- nothing indexed it. Cheap: one small text column over 211k rows.
create index if not exists wiki_cards_caselist_idx on public.wiki_cards (caselist);

-- Replaced, not overloaded. With a defaulted third argument PostgREST could not
-- tell a {q, lim} call apart from the old two-argument signature, and would
-- refuse the request as ambiguous. The new argument defaults to null, so any
-- caller still passing {q, lim} keeps working unchanged — which is what makes
-- it safe to apply this BEFORE the code that uses it ships.
drop function if exists public.search_wiki_cards(text, int);

create or replace function public.search_wiki_cards(
  q text,
  lim int default 50,
  caselists text[] default null
)
returns table (
  tag          text,
  cite         text,
  cite_details text,
  body         text,
  caselist     text,
  year         int,
  school       text,
  team         text,
  source_url   text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with args as (
    select websearch_to_tsquery('english', q) as query,
           least(greatest(coalesce(lim, 50), 1), 100) as n,
           -- An empty array means "no filter", same as null. Without this a UI
           -- that posts [] would silently match nothing.
           nullif(caselists, '{}'::text[]) as cl
  ),
  focused as materialized (
    select w.id, ts_rank_cd(w.rank_vec, a.query) as rk, w.ingested_at
    from public.wiki_cards w, args a
    where w.rank_vec @@ a.query
      and (a.cl is null or w.caselist = any(a.cl))
    order by 2 desc, 3 desc
    limit (select n from args)
  ),
  chosen as (
    select id, rk, ingested_at from focused
    where (select count(*) from focused) >= (select n from args)
    union all
    select w.id,
           coalesce(ts_rank_cd(w.rank_vec, a.query), 0) * 2
             + ts_rank_cd(w.search, a.query),
           w.ingested_at
    from public.wiki_cards w, args a
    where w.search @@ a.query
      and (a.cl is null or w.caselist = any(a.cl))
      and (select count(*) from focused) < (select n from args)
  )
  select w.tag, w.cite, w.cite_details, w.body,
         w.caselist, w.year, w.school, w.team, w.source_url
  from chosen c join public.wiki_cards w on w.id = c.id
  order by c.rk desc nulls last, c.ingested_at desc
  limit (select n from args);
$$;

comment on function public.search_wiki_cards(text, int, text[]) is
  'Whole-wiki card search. Tier 1 matches+ranks on rank_vec (fast); tier 2 uses a hybrid rank for narrow queries. Optional caselists[] narrows the corpus before ranking, so the result cap is spent on the debater''s own division.';

-- The caselists a debater can actually choose from, and how much prep each
-- holds. Read from the table rather than hardcoded: the index grows on its own,
-- and a stale hardcoded list would offer filters that match nothing.
create or replace function public.wiki_caselists()
returns table (caselist text, cards bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select w.caselist, count(*)::bigint as cards
  from public.wiki_cards w
  where w.caselist is not null and w.caselist <> ''
  group by w.caselist
  order by count(*) desc, w.caselist;
$$;

comment on function public.wiki_caselists() is
  'Distinct caselists in the index with card counts, for the wiki search filter.';

notify pgrst, 'reload schema';
