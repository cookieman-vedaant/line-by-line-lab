-- Fix: tier-2 search ranked on rank_vec (tag + opening), but tier 2 fires
-- precisely when the query terms are NOT in rank_vec. Every tier-2 result
-- scored 0 and sorted by ingested_at instead of relevance.
--
-- "brahman is the ultimate truth"  → 0 tier-1, 7 tier-2, ALL rank 0
-- "us economy in 2026 is weak"    → 1 tier-1, 18 tier-2, 17 rank 0
--   ⇒ "sanctions against Russia" ranked alongside real economy cards
--
-- The fix: tier 2 uses a HYBRID score — rank_vec (weighted 2×) plus the
-- full-body search score. A card whose tag or opening matches ranks far
-- above one that merely mentions the terms in passing deep in the body.
-- Since tier 2 only fires for narrow queries (few focused matches), the row
-- count is small and de-TOASTing the full-body vector is negligible.

create or replace function public.search_wiki_cards(q text, lim int default 50)
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
           least(greatest(coalesce(lim, 50), 1), 100) as n
  ),
  focused as materialized (
    select w.id, ts_rank_cd(w.rank_vec, a.query) as rk, w.ingested_at
    from public.wiki_cards w, args a
    where w.rank_vec @@ a.query
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
      and (select count(*) from focused) < (select n from args)
  )
  select w.tag, w.cite, w.cite_details, w.body,
         w.caselist, w.year, w.school, w.team, w.source_url
  from chosen c join public.wiki_cards w on w.id = c.id
  order by c.rk desc nulls last, c.ingested_at desc
  limit (select n from args);
$$;

comment on function public.search_wiki_cards(text, int) is
  'Whole-wiki card search. Tier 1 matches+ranks on rank_vec (fast). Tier 2 uses hybrid rank (2× rank_vec + full-body) for narrow queries where rank_vec alone can''t fill the page.';

notify pgrst, 'reload schema';
