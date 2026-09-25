# 🚀 Deployment Guide — DramaConnect Enterprise v14.1

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
3. In **SQL Editor → New query**, run all of `database/complete-schema.sql` once. Do not ignore errors or run only a selected section.
4. The cumulative installer is idempotent and safe to rerun. It includes the repaired application schema, least-privilege RLS, safe projections and server-authoritative RPCs, source-aware heartbeats, backup leases/history/vault, and the v14 management control plane. No individual component SQL is required afterward.

Optional `pg_cron`: enable the extension in Supabase, rerun `database/complete-schema.sql` and check:

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

Before publish, confirm `APP_VERSION: 'v14.1'` and service-worker cache `dramaconnect-v14.1`.

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
4. The included Vercel Cron (`/api/keep-alive`, daily `41 4 * * *`) needs **no** environment variables: it reads the public URL/anon key from `assets/js/config.js`. After deploying, open `https://YOUR-SITE.vercel.app/api/keep-alive` and expect `"ok":true`. Optional hardening: add a Production `CRON_SECRET` and redeploy (manual browser calls then return 401 — expected). See `SUPABASE_FREE_TIER_PROTECTION.md` → Layer 5.

Hard-refresh after each release. The v14.1 service worker uses network-first navigation, independent same-origin shell caching and never caches Supabase/API/CDN traffic.

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

1. Confirm `site-visit` and administrator `manual-button` heartbeat rows (**Platform Health → Test heartbeat**).
2. **Actions** tab → enable workflows if prompted → **Supabase resilience heartbeat → Run workflow**. No secrets are required (it falls back to `assets/js/config.js`); expect `✅ Heartbeat written and verified`.
3. **Settings → Actions → General → Workflow permissions → Read and write** (Layer 4 self-commit against the 60-day freeze).
4. Add the repository secret `SUPABASE_ACCESS_TOKEN` (supabase.com/dashboard/account/tokens). Then run **Deploy Supabase Edge Functions** (deploys `ping`) and **Supabase paused-project recovery watchdog** (expect `project status: ACTIVE_HEALTHY`).
5. Create an UptimeRobot HTTP monitor for `https://YOURREF.supabase.co/functions/v1/ping?source=edge-ping`.
6. Re-run `database/complete-schema.sql` once so it enables `pg_cron` and schedules the internal job.
7. Open `/api/keep-alive` to confirm Vercel Cron. Optional extras: Apps Script, cron-job.org.
8. **Platform Health → Protection layers** should show L1, L2, L3, L5, L8, L9 and L10 as **Reporting** within a day, and the banner must not say *Only human traffic*.

A heartbeat reduces inactivity risk but is not a backup, SLA or guarantee against provider pause/outage.

## Stage 6 — Configure backup and recovery

Follow `docs/BACKUP_AND_RECOVERY.md`.

1. Download a 31-table portable archive in Settings and verify it with:

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
- `ping`: deployed with `verify_jwt = false` (`supabase/config.toml`) by the **Deploy Supabase Edge Functions** workflow. It only writes a throttled heartbeat and returns no data, so `PING_SECRET` is **optional**; if you set it, monitors must add `?token=…`.

Never make service-role automations publicly invocable without their documented function-level check.

## Stage 8 — Identity cards and programmes (v14.1)

1. **ID card design:** as an administrator, open **ID Card → Settings**. Choose the template and validity period, then save. Open **ID Card → Register**, select members and choose **Issue**. Every card gets a random verification token plus a Code 128 barcode of the member code.
2. **Scan test (mandatory):** print one card, or show it on screen at full brightness.
   - Scan the **QR** with a phone camera. It must open `/pages/verify.html?t=…` and show **Valid**.
   - Scan the **barcode** with a USB/Bluetooth scanner into the **Attendance → Scan** box. It must record attendance.
   - If the barcode fails, print at 100% scale (no "fit to page") on matte paper. Code 128 needs its quiet zones.
3. **Revocation test:** revoke the test card. The verify page must show **Revoked**, and scanning it at the attendance desk must be refused.
4. **Programme:** open **Programmes → New**. Fill in the details, set status **Open**, then save.
   - Choose **Share**: copy the link or download the QR poster. Each channel has its own tracked link (`?src=whatsapp`, `?src=instagram`, …).
   - Open the link in a private window and register as a guest. A ticket QR must appear.
5. **Check-in desk:** open **Programmes → Desk** and scan that ticket. It must turn **Checked in**, and **Insights** must count one registration, one check-in and the channel.
6. **Roster and care:** assign a test duty on **Duty Roster** and confirm it as that member. Then open **Care** and run *Find absentees*.

## Upgrading an existing v14.0 site to v14.1

Follow this order exactly. Deploying the pages before the SQL makes the new pages show "schema update required".

1. **Back up first:** Admin Data → *Download portable archive*, then run the verifier:
   `node scripts/verify-portable-archive.mjs ARCHIVE.json`
2. **Database:** Supabase → SQL Editor → paste **all** of `database/complete-schema.sql` → Run. Running it twice is safe. It adds the six v14.1 tables, the card and programme functions, the pg_cron keep-alive job and the fixed `dc_update_platform_settings`.
3. **Repository clean-up.** The live repo, checked at commit `6ac22a3`, carries three stray files: `.github/workflows/a`, plus `gitignore` and `nojekyll` in the root. Delete all three (open each file on GitHub → ⋯ → *Delete file*). The dotted `.gitignore` and `.nojekyll` are the real ones.
4. **Push the v14.1 files.** Replace the repository contents with the v14.1 package, keeping `assets/js/config.js` with your real URL and anon key. Commit and push; Vercel redeploys automatically. Confirm that `.github/workflows/` now contains `keep-alive.yml`, `auto-restore.yml`, `deploy-edge-functions.yml` and `database-backup.yml`. The files keep the same names, but their contents must be **overwritten**. The old `keep-alive.yml` fails at "Validate required secrets" whenever the secrets are absent; the new one falls back to `assets/js/config.js`.
5. **Secrets:** GitHub → Settings → Secrets and variables → Actions → *New repository secret*:
   - `SUPABASE_ACCESS_TOKEN`, created at supabase.com/dashboard/account/tokens.
   - `PING_SECRET` and `CRON_SECRET` are optional.
6. **Edge functions:** Actions → **Deploy Supabase Edge Functions** → *Run workflow*. Afterwards, `https://YOURREF.supabase.co/functions/v1/ping` must return JSON, not 404.
7. **Workflows:** Actions → run **keep-alive** and then **auto-restore** once each. Both must be green.
8. **Vercel:** open `https://YOURSITE/api/keep-alive`. It must return `{"ok":true…}`. A `503 supabase_not_configured` means `config.js` still has placeholders.
9. **Browsers:** hard-refresh. The footer must show v14.1 and the service-worker cache must be `dramaconnect-v14.1`.
10. **Verify:** Platform Health → Protection layers must show L1, L2, L3, L5, L8, L9 and L10 as *Reporting* within 24 h. Then complete Stage 8.

## Post-deployment verification

- [ ] Landing page and all navigation paths load over HTTPS with no console exceptions.
- [ ] New signup creates a pending profile; pending/rejected sessions cannot read operational data.
- [ ] Approved member can use member features but cannot read full private profiles or administrator backup settings.
- [ ] Approved administrator can configure backup, inspect heartbeats and create a verified archive.
- [ ] Direct RLS tests cover anonymous, pending, member, unit leader and administrator—not just UI visibility.
- [ ] Production/event/finance/attendance/RSVP/task/poll/message paths work.
- [ ] Reports export; phone/tablet menu works; optional install can be declined.
- [ ] Current service-worker cache is `dramaconnect-v14.1`.
- [ ] Daily external heartbeat and manually dispatched watchdog both pass.
- [ ] A complete encrypted backup set exists remotely and one recovery rehearsal passed.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `supabase is not defined` | Supabase JS missing/wrong order | Load `@supabase/supabase-js@2` before `config.js`; preserve shared-script order. |
| RPC/table 404 in resilience settings | Cumulative schema missing/schema cache stale | Run all of `database/complete-schema.sql`; reload PostgREST schema if needed. |
| `infinite recursion detected in policy` | Legacy/incomplete hardening | Rerun all of `database/complete-schema.sql`. |
| Dashboard empty after signup | Trigger/profile/approval issue | Verify profile exists and status is exactly `approved`; rerun the cumulative schema. |
| Admin settings hidden | Caller is not approved admin | Complete bootstrap; inspect authoritative profile row. |
| Drive Connect fails | Wrong OAuth type/origin/test user | Use Web application client, exact HTTPS origin, Drive API and consent test user. |
| Drive schedule says overdue | No still-valid memory token | Administrator explicitly reconnects and runs a verified backup; automatic code never opens OAuth. |
| Edge ping 404 | Function never deployed | Run **Actions → Deploy Supabase Edge Functions**. |
| Edge ping 401 | `PING_SECRET` set; monitor lacks `?token=` | Add the token to the monitor URL, or delete the secret. |
| Vercel endpoint 401 | `CRON_SECRET` set; manual browser call | Expected once hardened; Vercel's cron sends the secret automatically. |
| Vercel endpoint 503 `supabase_not_configured` | `config.js` has placeholders and no env vars | Fill in `assets/js/config.js`, redeploy. |
| Sidebar stacks above content on a tablet | Page `<body>` lacks `app-shell` | All pages ship it; `layout.js` self-heals. Verify with `npm run smoke:tablet`. |
| Vercel endpoint 503 `cron_secret_not_configured` | An **older** `api/keep-alive.js` (pre-v14.1) is still deployed; it refused to run without `CRON_SECRET` | Upload the v14.1 `api/keep-alive.js` and `vercel.json` (it works with no secret; `CRON_SECRET` is optional hardening), redeploy, then open `/api/keep-alive` — expect `200 {"ok":true…}`. |
| Actions → keep-alive run fails at **Validate required secrets** | Older `.github/workflows/keep-alive.yml` still in the repo | Overwrite all four files in `.github/workflows/` with the v14.1 copies and delete any stray file (e.g. `.github/workflows/a`). The v14.1 workflow reads `assets/js/config.js` when secrets are absent and warns instead of failing. |
| Platform Health → **Save security state** fails (`null value … login_audit_retention_days` / NaN) | Database still has the pre-v14.1 `dc_update_platform_settings`, while the page no longer sends a retention value (retention is edited only in Storage Manager) | Rerun all of `database/complete-schema.sql` (v14.1 keeps the current retention when the argument is NULL), reload, save again. |
| `/pages/programs.html`, `/verify.html` or `/404.html` return 404 | Partial upload — only some v14.1 files were pushed | Upload the **whole** v14.1 folder (all 43 pages, `assets/js/dc-codes.js`, `assets/js/vendor/`, `database/identity_and_programs.sql`, `supabase/config.toml`), keeping the folder structure. |
| ID card barcode/QR will not scan | Printed at < 100 % scale, glossy glare, or `vendor/` scripts missing | Print at **Actual size**; confirm `assets/js/vendor/qrcode-generator.js` loads (200) on the live site; test with Attendance → camera scanner or any phone QR app. |
| Weekly dump cannot connect | Paused project/wrong DB URL/pool mode/password | Activate project; use direct/session URL, URL-encoded password and SSL. |
| Archive verifier fails | Truncated/modified/corrupt copy | Do not restore; download again or choose another fully verified backup. |
| Styling is plain + low-bandwidth warning | Tailwind CDN unavailable | Local safety CSS keeps features usable; retry on a better connection. |
| Old UI persists | Older service worker/cache | Deploy matching v14.1 `sw.js`, close tabs, hard-refresh/unregister stale worker if needed. |

## Updating later

1. Create and independently verify a pre-change backup.
2. Apply the release's cumulative `database/complete-schema.sql`; do not mix component SQL from different releases.
3. Deploy static files and increment `CONFIG.APP_VERSION` plus the `CACHE` name together.
4. Rerun static, RLS, browser-role and backup verification.
5. Manually run heartbeat and unattended backup after deployment.
6. Record release, migration and recovery evidence in the change register.
