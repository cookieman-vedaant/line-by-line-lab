-- Keep the wiki index within a size budget by evicting the OLDEST cards first.
--
-- Scenario this serves: as new caselists/current-topic cards are appended, the
-- index must stay inside the database's storage budget. When it would overflow,
-- the newest (current-topic) prep must survive and the OLDEST cards are dropped
-- to reclaim space — the oldest season entirely before any newer one.
--
-- SAFETY: this function deletes from wiki_cards and ONLY wiki_cards. It cannot
-- touch auth users, profiles, round logs, or any other table — those live
-- elsewhere and are never referenced here. Deletion order is deterministic:
-- newest year first is KEPT (offset p_max), everything older is removed.
create or replace function enforce_wiki_cap(p_max integer)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  removed integer;
begin
  if p_max is null or p_max < 0 then
    return 0;
  end if;

  with doomed as (
    select id
    from wiki_cards
    -- Newest first; the first p_max rows are kept, the rest (oldest) are doomed.
    order by year desc nulls last, ingested_at desc, id desc
    offset p_max
  )
  delete from wiki_cards w
  using doomed d
  where w.id = d.id;

  get diagnostics removed = row_count;
  return removed;
end;
$$;

comment on function enforce_wiki_cap(integer) is
  'Trim wiki_cards to at most p_max rows, deleting oldest-year cards first. Touches wiki_cards only — never user data.';
