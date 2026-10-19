-- Which opencaselist weekly archives the wiki index has fully ingested.
--
-- WHY THIS EXISTS: the weekly refresh used to re-pull "the newest 4 archives" of
-- each current-season caselist inside one 300s Vercel function. Saving runs at
-- ~4 cards/s on this instance and a mid-season week is thousands of cards, so
-- every run died inside the first caselist — hsld26/hspf26/nfald26 went weeks
-- with nothing — and any week a run didn't finish slid out of the window for
-- good. The refresh (services/wikiIngest ingestActiveSeason, run from GitHub
-- Actions) now works from THIS record instead: every weekly archive not listed
-- here is still to do, however old.
--
-- Additive and self-contained: nothing references it, and dropping it only makes
-- the next refresh re-check archives (cheap — already-indexed cards are skipped
-- before any write). Backup plan = `drop table public.wiki_ingest_archives;`.

create table if not exists public.wiki_ingest_archives (
  -- opencaselist's archive file name, e.g. hsld26-weekly-2026-10-13.zip.
  archive      text primary key,
  caselist     text not null,
  files        integer not null default 0,
  -- New cards this archive added (already-indexed cards are not counted).
  cards        integer not null default 0,
  ingested_at  timestamptz not null default now()
);

-- Written and read only by the ingester with the service-role key, which
-- bypasses RLS. RLS on with NO policies, plus no grants, keeps it out of reach
-- of the anon/authenticated roles entirely.
alter table public.wiki_ingest_archives enable row level security;
revoke all on public.wiki_ingest_archives from anon, authenticated;
