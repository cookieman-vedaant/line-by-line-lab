-- Automated data retention.
--
-- GDPR Art. 5(1)(e) ("storage limitation") requires personal data be kept no
-- longer than necessary for the purpose it was collected for. An IP address is
-- personal data under GDPR (Breyer, C-582/14), and `audit_log.ip` / `ip_bans.ip`
-- were being retained FOREVER with no expiry — a policy of "we keep security
-- logs indefinitely" is not a lawful retention period, it's the absence of one.
--
-- The privacy policy also promises deletion "except where we must retain it for
-- security or legal reasons". These windows are what makes that promise concrete
-- and enforceable rather than a phrase.
--
-- Periods chosen against the stated purpose (abuse investigation), not
-- convenience:
--   audit_log        90 days  — long enough to investigate a pattern of abuse
--                               across a competition season; far short of
--                               indefinite.
--   ip_bans          expired rows cleared after 30 days — the ban itself is
--                               already time-boxed; the row is only kept
--                               afterwards for repeat-offender context.
--   feedback         handled by account deletion (user_id -> NULL), so resolved
--                               reports are anonymized rather than time-expired;
--                               a bug report is not personal data once detached.

create or replace function public.purge_expired_data()
returns table (audit_deleted bigint, bans_deleted bigint)
language plpgsql
security definer
-- Empty search_path: a SECURITY DEFINER function without this can be hijacked by
-- a caller who puts a malicious schema earlier in their own search_path.
set search_path = ''
as $$
declare
  a bigint;
  b bigint;
begin
  delete from public.audit_log where created_at < now() - interval '90 days';
  get diagnostics a = row_count;

  delete from public.ip_bans
   where expires_at is not null and expires_at < now() - interval '30 days';
  get diagnostics b = row_count;

  return query select a, b;
end;
$$;

-- Only the service role may run this. Without the revoke, any signed-in user
-- could call it through the Data API — and because it is SECURITY DEFINER, it
-- would execute with the owner's privileges and delete the security trail.
revoke execute on function public.purge_expired_data() from public, anon, authenticated;
grant execute on function public.purge_expired_data() to service_role;

-- Supports the range scan the purge does on each pass.
create index if not exists audit_log_created_at_idx on public.audit_log (created_at);
