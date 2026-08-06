-- The Wire: a small, cheap sample of real disclosed card tags for the landing
-- page's press-ticker (components/marketing/Wire.tsx).
--
-- WHY TABLESAMPLE: this is a marketing widget, not a hot path, and it must not
-- add heavy IO. `order by random() limit 30` would sort the whole 100k+ row
-- index every call. BERNOULLI (2) instead samples ~2% of ROWS spread across the
-- whole table, so the wire mixes divisions (LD / PF / Policy) instead of one
-- caselist — SYSTEM sampling reads whole pages, which are clustered by caselist,
-- so it returns a single division. Bernoulli only reads the ~57 MB heap (tag and
-- caselist are inline columns; the big TOASTed body/search vectors are never
-- touched because they aren't selected), and the landing caches this for an
-- hour, so it runs at most once an hour.
--
-- WHAT LEAVES: only the tag (the argument, already public on opencaselist) and
-- the caselist (a division + year, e.g. hsld25). NEVER school, team, or the card
-- body — the public landing must not attribute a specific (often minor)
-- debater's case by name.
create or replace function public.wire_tags(lim int default 30)
returns table (tag text, caselist text)
language sql
stable
security invoker
set search_path = ''
as $$
  with sample as (
    select public.wiki_cards.tag, public.wiki_cards.caselist
    from public.wiki_cards tablesample bernoulli (2)
  )
  select s.tag, s.caselist
  from sample s
  where char_length(s.tag) between 32 and 120
    and s.tag ~ '^[A-Z]'          -- reads as a full claim, not a "1]"/"A]" fragment
    and s.tag !~ '[<>{}\\|]'       -- skip markup-ish noise
  -- Shuffle the SAMPLE (a couple thousand rows), not the table: bernoulli returns
  -- rows in heap order, which is clustered by caselist, so an unordered limit
  -- reads a single division. This sort is in-memory and cheap.
  order by random()
  limit least(greatest(coalesce(lim, 30), 1), 60);
$$;

comment on function public.wire_tags(int) is
  'Cheap TABLESAMPLE of real card tags (+ caselist) for the landing ticker. No school/team, no body.';

-- PostgREST caches function signatures.
notify pgrst, 'reload schema';
