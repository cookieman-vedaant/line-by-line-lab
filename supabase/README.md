# Supabase — schema, policies, and the dashboard checklist

`config.toml` and `migrations/` are the version-controlled source of truth for
the database schema and RLS policies. Before this, schema changes existed only in
the Supabase dashboard — no diff history, no rollback, no code review.

## 1. One-time setup (run these yourself)

The CLI needs your Supabase login and project ref — credentials an agent
shouldn't hold.

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>   # from the dashboard URL
npx supabase db pull                                  # capture the CURRENT live
                                                      # schema as a baseline
```

Commit the migration that produces. **Do the pull before pushing the migrations
in this folder**, so the baseline reflects reality rather than being overwritten
by it.

Then apply the new migrations:

```bash
npx supabase db push
```

They are written to be idempotent and safe to re-run, and each one no-ops if the
table it hardens doesn't exist.

| Migration | What it does |
|---|---|
| `…_harden_existing_rls.sql` | Enables RLS + declares policies and indexes for `profiles`, `rounds`, `debater_profile` |
| `…_feedback.sql` | `feedback` table for in-app bug reports |
| `…_audit_and_bans.sql` | `audit_log` (append-only) and `ip_bans` (server-only) |

## 2. Verify isolation actually holds

Policies are **OR'ed together**, so one forgotten permissive policy from the
dashboard era silently defeats every careful one. Check for strays:

```sql
select tablename, policyname, cmd, qual
from pg_policies where schemaname = 'public'
order by tablename, policyname;

-- Every table here must show rowsecurity = true.
select relname, relrowsecurity
from pg_class
where relnamespace = 'public'::regnamespace and relkind = 'r';
```

Anything you don't recognize — especially a `qual` of `true` — should be dropped.

## 3. Dashboard settings the code CANNOT enforce

These matter more than they look. `signUp`, `signInWithPassword`, and `resend`
run **browser → Supabase directly**; our API never sees them. `/api/auth-attempt`
is a preflight that gives us limits and telemetry through our own UI, but an
attacker can POST straight to Supabase with the public anon key and skip it
entirely. **These settings are the only enforcement that applies to everyone.**

- [ ] **Auth → Settings → enable CAPTCHA protection** (Turnstile — you already
      have keys). This is the single highest-value item on this page: it enforces
      at Supabase's edge for every client, ours or not. Without it, automated
      account creation is limited only by Supabase's default rate limits.
- [ ] **Auth → Rate Limits** — lower the per-hour email cap to match real usage.
      Defaults are generous enough to let one abuser burn your email quota.
- [ ] **Auth → URL Configuration → Redirect URLs** must cover `/auth/confirm`
      (already covered by a wildcard like `https://line-by-line-lab.vercel.app/**`).
- [ ] **Auth → Email Templates → Confirm signup**: change `{{ .ConfirmationURL }}`
      to
      `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next=/lab`.
      This is the only credential shape that works cross-device — opening the
      email on a different device than the one used to sign up. Still outstanding.
- [ ] **Settings → Database → backups.** The free tier is daily backups only
      (RPO ~24h). When revenue starts, a paid plan's point-in-time recovery is
      the highest-value reliability spend available.

## 4. Ongoing workflow

- New schema change: `npx supabase migration new <name>`, write the SQL, then
  `npx supabase db push`. Commit the file with the code that needs it.
- **Never hand-edit schema in the dashboard** once this is in place — it drifts
  from the repo. If it happens anyway, `npx supabase db pull` to reconcile.
- Per `AGENTS.md`, existing migration files are a protected area: don't modify
  one after it's been applied. Write a new migration instead.

## 5. Triage queries

```sql
-- New bug reports, newest first (served by a partial index).
select id, created_at, kind, page, contact_email, message
from feedback where status = 'new' order by created_at desc;

update feedback set status = 'fixed' where id = $1;

-- Recent security events.
select created_at, action, ip, detail from audit_log
order by created_at desc limit 100;

-- Active IP bans.
select ip, reason, created_at, expires_at from ip_bans
where expires_at is null or expires_at > now();

-- Grant someone Pro.
update profiles set tier = 'pro' where id = '<auth-user-uuid>';
```
