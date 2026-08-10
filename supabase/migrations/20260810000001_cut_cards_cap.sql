-- Cap each account's card library, evicting the OLDEST card first.
--
-- WHY A CAP AT ALL. Measured, not guessed: a real cut-card body averages ~20KB
-- (an "Entire Article" cut is larger still), so an uncapped library is ~10MB per
-- 500 cards. Against the ≤100-user target that is a ~1GB worst case on an
-- instance that has already hit a hard capacity ceiling once during the wiki
-- backfill. The cap bounds that; it is a storage budget, not a usage opinion.
--
-- WHY EVICT RATHER THAN REFUSE. The library's promise is that you never think
-- about saving. A full library that silently stopped recording would break that
-- at the worst possible moment — the card you just cut is the one you are about
-- to read. So the window rolls: the newest card always survives, the oldest
-- falls off, and the panel says plainly that it is a window.
--
-- WHY A TRIGGER RATHER THAN APP CODE. RLS lets a signed-in user INSERT their own
-- rows, so anything enforced only in /api/cut could be sidestepped by writing
-- straight to PostgREST with their own token. The trigger holds regardless of
-- who does the insert.
--
-- SAFETY: deletes from public.cut_cards and ONLY within the inserting user's own
-- rows (`where user_id = new.user_id`). It cannot touch another account's cards,
-- and it cannot touch any other table.

-- THE NUMBER LIVES HERE, hardcoded, because it cannot live anywhere better on
-- this instance: managed Supabase denies `alter database ... set app.*` and
-- `alter role ... set app.*` alike (both tested, both 42501), so a runtime GUC
-- would be a knob that can never be turned. To retune, re-run this function with
-- a new value and update CUT_CARDS_MAX_PER_USER in lib/cutCardLimit.ts to match
-- so the interface stops promising the old number.
create or replace function public.enforce_cut_cards_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cap constant integer := 500;
begin
  -- Keep the newest `cap` rows for THIS user; delete whatever is older. The
  -- ordering matches cut_cards_user_created_idx, so the scan stops at `cap`
  -- rows and the common case (a user under the cap) deletes nothing.
  delete from public.cut_cards
   where id in (
     select id
     from public.cut_cards
     where user_id = new.user_id
     order by created_at desc, id desc
     offset cap
   );

  return null; -- AFTER trigger: return value is ignored
end;
$$;

comment on function public.enforce_cut_cards_cap() is
  'Trim one account''s cut_cards to 500 rows, oldest first. Touches only the inserting user''s own rows.';

drop trigger if exists cut_cards_cap on public.cut_cards;
create trigger cut_cards_cap
  after insert on public.cut_cards
  for each row
  execute function public.enforce_cut_cards_cap();

-- The function is SECURITY DEFINER so the delete is not itself filtered by the
-- inserting user's RLS policy (which would still permit it, but relying on that
-- would make the cap depend on policy details staying exactly as they are).
-- It takes no arguments and is only reachable as a trigger, so there is no call
-- surface to revoke beyond the usual hygiene below.
revoke execute on function public.enforce_cut_cards_cap() from public, anon, authenticated;
