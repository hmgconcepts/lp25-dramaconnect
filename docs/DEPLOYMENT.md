# 🚀 Deployment Guide — DramaConnect Enterprise v13.2

This guide deploys the static application and its required Supabase database controls. Resilience, Google Drive and unattended recovery are separate operational stages; do not claim production readiness until they are configured and tested.

## Prerequisites

- Organization-controlled Supabase and GitHub accounts.
- A static host: GitHub Pages, Cloudflare Pages or Vercel.
- Two named administrators/recovery custodians and a password manager.
- Optional Google Cloud/Drive account for browser and unattended backups.

The app itself needs no build step. Supabase CLI, Node, PostgreSQL clients, GnuPG and rclone are needed only for optional functions/testing/recovery.

## Stage 1 — Create and migrate Supabase

1. Create the project in the nearest suitable region.
2. Generate a strong database password and store it in the organization password manager.
3. In **SQL Editor → New query**, run the complete files in this exact order:
   1. `database/repair_and_upgrade.sql`
   2. `database/security_hardening.sql`
   3. `database/resilience_and_backup.sql`
4. Do not concatenate, reorder or ignore errors. All are intended to be safely rerunnable in order.

The first file supplies/repairs the application schema. The second replaces permissive authorization with least-privilege RLS, safe projections, guards and server-authoritative RPCs. The third adds source-aware heartbeats, backup settings, concurrency leases, run history, administrator RSVP restore access and the private archive vault.

Optional `pg_cron`: enable the extension in Supabase, rerun the third migration and check:

```sql
select jobid, jobname, schedule, active
from cron.job
where jobname = 'dramaconnect-internal-heartbeat';
```

An internal cron is not a wake-up mechanism for an already paused project.

### Email confirmation

Under **Authentication → Providers → Email**, keep confirmation ON for stricter identity verification or turn it OFF for a controlled internal rollout. This never bypasses DramaConnect approval: every new profile remains `pending` until an administrator approves it.

## Stage 2 — Connect the browser app

From **Project Settings → API**, copy only:

- Project URL, e.g. `https://PROJECT_REF.supabase.co`;
- anon/publishable key.

Set them in `assets/js/config.js`:

```js
const CONFIG = {
  SUPABASE_URL: 'https://PROJECT_REF.supabase.co',
  SUPABASE_KEY: 'ANON_OR_PUBLISHABLE_KEY',
  // ...
};
```

The anon key is designed for browser use and is constrained by RLS. Never place a database password, service-role key, Management API token, backup passphrase, rclone configuration, `PING_SECRET`, `CRON_SECRET` or Google client secret in static files.

Before publish, confirm `APP_VERSION: 'v13.2'` and service-worker cache `dramaconnect-v13.2`.

## Stage 3 — Publish the static site

`index.html` must be at the deployment root. Relative links and the path-aware routing support a repository subpath.

### GitHub Pages

1. Put the project **contents** at repository root.
2. In **Settings → Pages**, deploy `main` and `/ (root)`.
3. Wait for the HTTPS URL and open it.

### Cloudflare Pages

1. Connect the repository or use Direct Upload.
2. Framework preset: **None**; build command: blank; output: repository root.
3. Deploy and open the `pages.dev`/custom HTTPS URL.

### Vercel

1. Import the repository.
2. Framework preset: **Other**; no build/output override is required.
3. Deploy.
4. If using the included Cron, configure protected Production environment values `SUPABASE_URL`, `SUPABASE_ANON_KEY` and a high-entropy `CRON_SECRET`, then redeploy. Follow `SUPABASE_FREE_TIER_PROTECTION.md` and current Vercel plan limits.

Hard-refresh after each release. The v13.2 service worker uses network-first navigation, independent same-origin shell caching and never caches Supabase/API/CDN traffic.

## Stage 4 — Bootstrap the first administrator

1. Open the live site, select **Request Access** and sign up. Confirm email if enabled.
2. In the trusted SQL Editor, run once with the exact email:

```sql
update public.profiles
set role = 'admin', status = 'approved'
where email = 'you@example.com';
```

3. Require one affected row. If no row changed, correct the email; do not insert an orphan profile manually.
4. Sign in. Confirm Settings, Activity Log, member administration and Messaging are available.

Do not put bootstrap promotion in browser code. Later role/status changes belong in the administrator UI and remain subject to database guards. New users appear under **Members → Pending Approvals**; rejection blocks but retains an account, while permanent removal uses the approved-admin Edge Function and is a distinct destructive action.

## Stage 5 — Configure resilience

Follow `docs/SUPABASE_FREE_TIER_PROTECTION.md` completely.

Minimum production setup:

1. Confirm `site-visit` and administrator `manual-button` heartbeat rows.
2. Add GitHub Actions secrets `SUPABASE_URL` and `SUPABASE_ANON_KEY`; manually run **Supabase resilience heartbeat**.
3. Deploy the secret-protected `ping` Edge Function and configure at least one daily external monitor with HTTP/body validation.
4. Add `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF`; manually test the recovery watchdog while the project is healthy.
5. Optional: configure Vercel Cron, Apps Script and `pg_cron` as additional independent sources.

A heartbeat reduces inactivity risk but is not a backup, SLA or guarantee against provider pause/outage.

## Stage 6 — Configure backup and recovery

Follow `docs/BACKUP_AND_RECOVERY.md`.

1. Download a 22-table portable archive in Settings and verify it with:

   ```bash
   node scripts/verify-portable-archive.mjs ARCHIVE.json
   ```

2. Enable Google Drive API, create an OAuth Web client with the exact production JavaScript origin, save only the public client ID, connect with `drive.file` and create a backup.
3. Require the Drive upload → download → full verification cycle to complete.
4. Configure the weekly encrypted GitHub workflow with database, rclone and encryption secrets. Add the service-role key only as a protected Actions secret if actual Storage bytes must be included.
5. Download a matching timestamp set, verify every sidecar and rehearse the guarded restore in a non-production project.
6. Fill in the owners/contacts in the private copy of `RESILIENCE_RUNBOOK.md` and calendar monthly checks plus quarterly recovery drills.

## Stage 7 — Optional Edge Functions

- `admin-create-member`: deploy with normal gateway JWT verification; see `ADMIN_CREATE_MEMBER.md`.
- `notify-approval`: set its documented webhook/admin authorization and email-provider secrets.
- `birthday-bot` and `run-reminders`: set a strong shared/dedicated `CRON_SECRET` and configure the scheduler's matching header.
- `ping`: intentionally deploy with `--no-verify-jwt`, but only after setting high-entropy `PING_SECRET`; the function performs its own narrow authorization.

Never make service-role automations publicly invocable without their documented function-level check.

## Post-deployment verification

- [ ] Landing page and all navigation paths load over HTTPS with no console exceptions.
- [ ] New signup creates a pending profile; pending/rejected sessions cannot read operational data.
- [ ] Approved member can use member features but cannot read full private profiles or administrator backup settings.
- [ ] Approved administrator can configure backup, inspect heartbeats and create a verified archive.
- [ ] Direct RLS tests cover anonymous, pending, member, unit leader and administrator—not just UI visibility.
- [ ] Production/event/finance/attendance/RSVP/task/poll/message paths work.
- [ ] Reports export; phone/tablet menu works; optional install can be declined.
- [ ] Current service-worker cache is `dramaconnect-v13.2`.
- [ ] Daily external heartbeat and manually dispatched watchdog both pass.
- [ ] A complete encrypted backup set exists remotely and one recovery rehearsal passed.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `supabase is not defined` | Supabase JS missing/wrong order | Load `@supabase/supabase-js@2` before `config.js`; preserve shared-script order. |
| RPC/table 404 in resilience settings | Third migration missing/schema cache stale | Run all three migrations in order; reload PostgREST schema if needed. |
| `infinite recursion detected in policy` | Legacy/incomplete hardening | Rerun repair, security and resilience migrations in order. |
| Dashboard empty after signup | Trigger/profile/approval issue | Verify profile exists and status is exactly `approved`; rerun migrations. |
| Admin settings hidden | Caller is not approved admin | Complete bootstrap; inspect authoritative profile row. |
| Drive Connect fails | Wrong OAuth type/origin/test user | Use Web application client, exact HTTPS origin, Drive API and consent test user. |
| Drive schedule says overdue | No still-valid memory token | Administrator explicitly reconnects and runs a verified backup; automatic code never opens OAuth. |
| Edge ping 401 | Missing/stale `PING_SECRET` | Update function secret/monitor and rotate if disclosed. |
| Vercel endpoint 401 | Cron secret missing/mismatch | Configure protected Production `CRON_SECRET` and redeploy. |
| Weekly dump cannot connect | Paused project/wrong DB URL/pool mode/password | Activate project; use direct/session URL, URL-encoded password and SSL. |
| Archive verifier fails | Truncated/modified/corrupt copy | Do not restore; download again or choose another fully verified backup. |
| Styling is plain + low-bandwidth warning | Tailwind CDN unavailable | Local safety CSS keeps features usable; retry on a better connection. |
| Old UI persists | Older service worker/cache | Deploy matching v13.2 `sw.js`, close tabs, hard-refresh/unregister stale worker if needed. |

## Updating later

1. Create and independently verify a pre-change backup.
2. Review/apply any new migration after the existing three, in release order.
3. Deploy static files and increment `CONFIG.APP_VERSION` plus the `CACHE` name together.
4. Rerun static, RLS, browser-role and backup verification.
5. Manually run heartbeat and unattended backup after deployment.
6. Record release, migration and recovery evidence in the change register.
