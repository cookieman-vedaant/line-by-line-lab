-- Make wiki search fast AND relevant. Both problems had the SAME root cause.
--
-- THE BUG: `search_wiki_cards` ranked with `ts_rank(search, q)`, where `search`
-- is the tsvector of the WHOLE card body. Measured on this table (66,084 rows):
-- that vector averages 5,073 bytes, so Postgres stores it out-of-line in TOAST
-- (heap is only 57 MB; TOAST is ~619 MB of the 778 MB total). A ranked search
-- must de-TOAST and score EVERY matching row before LIMIT can discard it — the
-- GIN index only accelerates the `@@` match, never the ORDER BY. Measured before
-- this migration: `economy` (15,111 matches) 33.2 s, `nuclear war extinction`
-- (2,313) 10.0 s, `us economy weak now` (1,102) 6.3 s. The GIN bitmap scan
-- itself is ~5 ms. So the cost was ranking, and it grows with the corpus.
--
-- The SAME fat vector caused the irrelevant tail: matching anywhere in a
-- ~6,651-character body means a passing mention counts as much as the card's
-- argument, and ts_rank saturates (dozens of rows tie at ~0.99).
--
-- THE FIX: rank on a SMALL, separate vector — the tag plus the card's opening.
-- The full-body `search` GIN index still backs matching, so no card becomes
-- unfindable; see the two-tier note on search_wiki_cards below for exactly when
-- a deep-body-only match is served and when it is skipped as unreachable.
--
-- WHY A CAPPED OPENING IS ALSO *BETTER* RANKING, not a compromise: a debate
-- card's argument is stated in its tag and its first sentences. Scoring that
-- region promotes cards that are ABOUT the query and demotes ones that merely
-- mention it in passing later on.
--
-- REJECTED ALTERNATIVE (measured, don't retry it): recomputing a smaller vector
-- INLINE in the ORDER BY made things worse — 62 s — because the planner drops
-- the GIN index and sequential-scans when the sort key is a recomputed
-- expression. The ranking vector must be STORED. The `rum` extension (available,
-- v1.3) was also rejected: a bigger index and slower inserts, and it fixes only
-- speed, not relevance.
--
-- WHY A TRIGGER AND NOT A GENERATED COLUMN (the sibling `search` column IS one):
-- adding a STORED generated column rewrites the whole table under an ACCESS
-- EXCLUSIVE lock. That was tried first and is not possible from here: this
-- project can only run SQL through the Supabase Management API (the Postgres
-- wire protocol is blocked on this network — see MEMORY.md), and Cloudflare cuts
-- that HTTP connection at ~100 s (error 524). The rewrite was still unfinished
-- at 128 s and rolled back cleanly. A plain column filled by a trigger reaches
-- the identical end state with NO rewrite and NO exclusive lock, and it can be
-- backfilled in batches that each finish well inside the limit. If this file is
-- ever replayed on an empty database the backfill below is instant.

-- Instant: a nullable column with no default is a catalog-only change.
alter table public.wiki_cards add column if not exists rank_vec tsvector;

-- Sized from a real 1,953-row sample before choosing the 1200-char cap:
--   rank_vec @1200 chars -> avg 1,347 B, p95 1,696 B
--   full-body `search`   -> avg 5,073 B
-- Because `body` (~6,651 chars) and `search` are far larger, the toaster evicts
-- THOSE first, so rank_vec stays inline in the heap where ranking reads it
-- cheaply. STORAGE MAIN reinforces that: compress it, but keep it in the row
-- unless the tuple genuinely cannot fit.
alter table public.wiki_cards alter column rank_vec set storage main;

-- Keeps rank_vec in lockstep with the columns it derives from, which is the job
-- a generated column would otherwise do. Weight A = tag, B = opening, so
-- ts_rank_cd's default {0.1,0.2,0.4,1.0} scores a tag hit above a body hit.
-- Restricted to `update of tag, body` so the batched backfill below (which sets
-- rank_vec directly) doesn't pointlessly recompute it.
create or replace function public.wiki_cards_set_rank_vec()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.rank_vec :=
    setweight(to_tsvector('english', coalesce(new.tag, '')), 'A') ||
    setweight(to_tsvector('english', left(coalesce(new.body, ''), 1200)), 'B');
  return new;
end;
$$;

drop trigger if exists wiki_cards_rank_vec_trg on public.wiki_cards;
create trigger wiki_cards_rank_vec_trg
  before insert or update of tag, body on public.wiki_cards
  for each row execute function public.wiki_cards_set_rank_vec();

-- Backfill existing rows. Applied to the live table in batches (see the note at
-- the top); this unbatched form is for a fresh replay, where it is a no-op.
update public.wiki_cards
set rank_vec =
      setweight(to_tsvector('english', coalesce(tag, '')), 'A') ||
      setweight(to_tsvector('english', left(coalesce(body, ''), 1200)), 'B')
where rank_vec is null;

-- rank_vec IS matched against, not just ranked on — see the two-tier search
-- below — so it needs its own GIN index. 33 MB on 69,585 rows.
create index if not exists wiki_cards_rank_vec_idx on public.wiki_cards using gin (rank_vec);

-- The return type changes, and CREATE OR REPLACE cannot change a return type.
drop function if exists public.search_wiki_cards(text, int);

-- Ranked full-text search over the index, in two tiers.
--
-- Returns the 9 columns the app actually uses instead of `setof wiki_cards`.
-- The old shape shipped the 5 KB `search` vector for every row — roughly 300 KB
-- of wasted payload per search — which the client parsed and discarded.
--
-- WHY TWO TIERS. Ranking is cheap now, but a broad query still has to READ every
-- candidate row's rank_vec from the heap, and that IO is what remains: `economy`
-- matches 15,729 cards and touched ~10,200 heap blocks. Only 6,347 of those
-- cards are actually ABOUT the economy (the term appears in the tag or opening);
-- the other 9,382 merely mention it in passing and could never place in a
-- 60-row result. So:
--
--   TIER 1 (focused) — match on rank_vec: cards whose tag or opening is on
--     topic. Fewer rows to fetch, and the results are better, not just faster.
--   TIER 2 (broad)   — the original full-body match, used ONLY when tier 1
--     cannot fill the page.
--
-- That condition is what keeps this honest. A narrow, specific claim is exactly
-- where a debater needs every last card, and it is also where tier 1 comes up
-- short: "us economy weak now" has 1,151 body matches but only 49 focused ones.
-- Since 49 < 60, it falls through to the full-body search and RECALL IS
-- UNCHANGED. Conversely the queries that fall back are the cheap ones — a query
-- with few focused matches has few matches overall. The rule is self-balancing:
-- broad queries get the fast path, narrow queries get full recall.
--
-- Tier 2 is skipped entirely (a one-time filter, not a per-row test) whenever
-- tier 1 filled the page, so the common case never pays for it. `focused` is
-- MATERIALIZED so it is computed once and its count is cheap to test.
--
-- Both tiers ORDER BY the same expression, so the two paths agree on ranking;
-- tier 2 is a strict superset of tier 1.
--
-- Measured after this migration (server-side execution, 69,585 rows):
--   economy                            5,515 ms cold /  87 ms warm  (was 33 s)
--   warming                            1,602 ms cold /  20 ms warm
--   nuclear war extinction               999 ms cold /  25 ms warm  (was 10 s)
--   us economy weak now  (tier 2)      1,174 ms cold /  33 ms warm
--   china taiwan deterrence               68 ms cold /  12 ms warm
--   capitalism kritik    (tier 2)         45 ms cold /   8 ms warm  (16 rows)
-- Cold numbers are first-touch disk reads; the app also caches results for 10
-- minutes (services/wikiMining.ts), so repeat searches never reach Postgres.
--
-- websearch_to_tsquery parses natural language the way a search box should: it
-- drops stopwords and never errors on punctuation, so a raw claim like
-- "brahman is the ultimate truth" Just Works. SECURITY INVOKER means it runs
-- under the caller's RLS, so it exposes nothing the caller couldn't select.
--
-- NULLS LAST matters: DESC sorts NULLs FIRST by default, so a row whose rank_vec
-- was somehow never filled would otherwise be promoted to the top of every
-- search. This keeps results correct even midway through a backfill.
create function public.search_wiki_cards(q text, lim int default 50)
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

-- PostgREST caches function signatures; this one just changed shape.
notify pgrst, 'reload schema';
