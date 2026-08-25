# Supabase Free-Tier Protection and Resilience

DramaConnect v13.2 implements independent, source-visible database activity paths plus a paused-project recovery watchdog. These controls reduce the risk of an inactive Supabase Free project being paused; they do **not** change Supabase's plan, create an SLA, or guarantee that Supabase will never pause, limit, or retire a project. As of this release, Supabase documents that Free projects with low activity may be paused after a seven-day period and that a paused project can be restored from the dashboard. Recheck the current policy before deployment: <https://supabase.com/docs/guides/platform/free-project-pausing>.

## Protection layers

| Layer | Source shown in Admin Settings | Runs with the browser closed? | Can wake a paused project? | Implementation |
|---|---|---:|---:|---|
| Normal browser visit | `site-visit` | No | Usually, when someone visits | `assets/js/resilience.js` |
| GitHub scheduled heartbeat | `github-actions` | Yes | Usually | `.github/workflows/keep-alive.yml` |
| Edge Function + external monitor | `edge-ping` | Yes | Usually | `supabase/functions/ping/` |
| In-database `pg_cron` | `pg-cron` | Yes, while database runs | **No**—an internal job cannot wake a paused database | `database/resilience_and_backup.sql` |
| Administrator test button | `manual-button` | No | Usually | `pages/settings.html` |
| cron-job.org | `cron-job-org` | Yes | Usually | Edge URL with the source query below |
| Vercel Cron | `vercel-cron` | Yes | Usually | `api/keep-alive.js`, `vercel.json` |
| Google Apps Script | `apps-script` | Yes | Usually | `scripts/google-apps-script-keep-alive.gs` |
| Scheduled-workflow preservation | repository activity, not a heartbeat row | Yes | Keeps the GitHub schedule eligible | `.github/workflows/keep-alive.yml` |
| Management API recovery watchdog | `auto-restore` after the API is available | Yes | Yes, if Supabase reports `INACTIVE` | `.github/workflows/auto-restore.yml` |
| Weekly database backup | `database-backup` | Yes | Usually | `.github/workflows/database-backup.yml` |

Only two or three independent external layers are needed in most deployments. Configure at least one **daily** external monitor in addition to browser activity. Excessive requests add no protection: `dc_keep_alive` accepts only an allow-listed source and throttles physical writes for each source to one per five minutes.

## 1. Apply the database migration

Run these in the Supabase SQL Editor, in order:

1. `database/repair_and_upgrade.sql`
2. `database/security_hardening.sql`
3. `database/resilience_and_backup.sql`

The third migration creates the heartbeat table/RPC, administrator-only health visibility, backup settings, concurrency leases, run history, private backup vault policies and optional `pg_cron` job. It is idempotent and can be rerun after enabling `pg_cron`.

Do not expose any table directly to `anon`. Anonymous callers can execute only the narrow `dc_keep_alive(text)` function. Unknown source values collapse to `external`, preventing unbounded row creation.

## 2. Browser and administrator layers

No additional deployment setting is required for browser heartbeats after the migration. A visit calls the RPC in the background; failures do not block sign-in or page rendering.

An approved administrator can open **Settings → Resilience & backups** to:

- send a verified manual heartbeat;
- view every source and its last successful write;
- see missing/stale/error status;
- change browser/Drive backup settings;
- inspect backup/restore run history.

Ordinary members cannot read resilience rows or change backup settings. “Administrator” means an authenticated, approved profile with `role = 'admin'`; never infer this privilege from browser UI alone.

## 3. GitHub heartbeat and schedule preservation

In **GitHub → repository → Settings → Secrets and variables → Actions**, add:

- `SUPABASE_URL` — `https://PROJECT_REF.supabase.co`
- `SUPABASE_ANON_KEY` — the project publishable/legacy anon key, never the service-role key

Enable **Supabase resilience heartbeat** under Actions and run `workflow_dispatch` once. The run must print `Verified Supabase heartbeat response.`

GitHub documents that scheduled workflows in public repositories may be disabled after 60 days without repository activity: <https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows>. The workflow attempts a small preservation commit after 30 inactive days. It therefore needs **Workflow permissions → Read and write permissions** and a branch policy that permits the GitHub Actions bot to push. If branch protection blocks that commit, use normal repository activity or a dedicated approved bot instead; do not weaken review controls solely for this feature.

GitHub schedules are best-effort and may be delayed. Treat this as one layer, not the only layer.

## 4. Edge Function and external uptime monitor

Install the Supabase CLI, link the correct project and run:

```bash
supabase secrets set PING_SECRET="$(openssl rand -hex 32)"
supabase functions deploy ping --no-verify-jwt
```

`--no-verify-jwt` is intentional because an external monitor has no Supabase user JWT. The function still requires a dedicated high-entropy `PING_SECRET`, accepts only GET/HEAD, validates the upstream JSON response, times out, disables caching and never receives the service-role key.

Create a daily monitor for:

```text
https://PROJECT_REF.supabase.co/functions/v1/ping?token=PING_SECRET
```

Require HTTP 200 and response keyword `"ok":true`. For cron-job.org, use:

```text
https://PROJECT_REF.supabase.co/functions/v1/ping?token=PING_SECRET&source=cron-job-org
```

The query source is allow-listed. Rotate `PING_SECRET` immediately if the monitor URL is disclosed; URLs can appear in provider logs and screenshots. Prefer an `x-ping-secret` request header if the monitor supports custom headers.

For a server/monitor that can safely hold the public anon key, an alternative is:

```bash
SUPABASE_URL=https://PROJECT_REF.supabase.co \
SUPABASE_ANON_KEY=... HEARTBEAT_SOURCE=external \
node scripts/check-resilience.mjs
```

## 5. Optional `pg_cron`

In the Supabase dashboard, enable the `pg_cron` extension, then rerun `database/resilience_and_backup.sql`. Confirm the job exists:

```sql
select jobid, jobname, schedule, active
from cron.job
where jobname = 'dramaconnect-internal-heartbeat';
```

This job is an activity source and health signal only. It runs inside PostgreSQL, so it cannot start an already paused project. Keep an external layer enabled.

## 6. Vercel Cron

The repository already contains `vercel.json` and `api/keep-alive.js`. Add these protected Vercel environment variables to Production:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `CRON_SECRET` — generate at least 32 random bytes, for example `openssl rand -hex 32`

Deploy and inspect the Cron Jobs page. Vercel calls `/api/keep-alive` with `Authorization: Bearer $CRON_SECRET`; direct unauthenticated calls receive 401. The endpoint validates the Supabase origin, enforces a timeout and requires `{ "ok": true }` from the RPC.

Provider cron availability and frequency vary by Vercel plan. If the job is unavailable on the selected plan, keep the endpoint protected and use GitHub, the Edge monitor, or Apps Script instead.

## 7. Google Apps Script

1. Create a standalone Apps Script project at <https://script.google.com/>.
2. Copy `scripts/google-apps-script-keep-alive.gs` into the editor.
3. Open **Project Settings → Script properties** and add `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
4. Run `dramaConnectHeartbeat` once and approve the outbound-request permission.
5. Run `installDramaConnectHeartbeatTrigger` once. It removes duplicate DramaConnect triggers and creates one daily trigger.
6. Review **Executions** the following day and confirm `apps-script` in Admin Settings.

Do not place `SUPABASE_SERVICE_ROLE_KEY`, a database password, or a Management API token in Apps Script.

## 8. Paused-project recovery watchdog

Create a narrowly managed Supabase personal access token from the account/organization that owns the project. In GitHub Actions secrets add:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_PROJECT_REF`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

Enable **Supabase paused-project recovery watchdog** and manually dispatch it once. It reads project status from the official Management API and calls `POST /v1/projects/{ref}/restore` **only** when the exact status is `INACTIVE`. It does nothing for healthy or transitional states and fails closed for unknown values. API reference: <https://supabase.com/docs/reference/api/returns-projects-readonly-mode-status>.

A personal access token is powerful. Store it only in GitHub Actions secrets, restrict repository administration, rotate it after contributor changes, and review workflow modifications before merging. If your organization can issue a narrower machine token, prefer that.

## Verification checklist

- [ ] All three SQL files were applied in order without errors.
- [ ] An anonymous RPC call returns `ok: true` but cannot select `dc_heartbeat_sources`.
- [ ] An approved administrator sees health; an ordinary approved member does not.
- [ ] GitHub manual heartbeat succeeds.
- [ ] At least one daily external monitor succeeds and alerts on failure.
- [ ] Edge/cron secret returns 401 when missing or incorrect.
- [ ] `pg_cron` is labelled internal-only and is not the sole layer.
- [ ] Auto-restore reports healthy without making a restore request.
- [ ] GitHub/Vercel/Apps Script execution logs are reviewed monthly.
- [ ] The organization has a current independent encrypted database backup; activity prevention is not backup.

## Failure interpretation

| Symptom | Likely cause | Response |
|---|---|---|
| 401 from Edge ping | Missing/stale `PING_SECRET` | Update monitor or rotate/deploy the secret |
| 401 from Vercel endpoint | Missing/stale `CRON_SECRET` | Confirm Vercel environment and redeploy |
| RPC 404 | Third migration not applied or schema cache stale | Apply migration; reload PostgREST schema if necessary |
| RPC says `throttled` | Same source wrote within five minutes | Healthy and expected |
| GitHub schedule vanished | Public-repository inactivity or Actions disabled | Re-enable workflow; fix activity policy |
| `pg-cron` stale while external rows are current | Extension/job disabled | Rerun migration after enabling extension |
| Every external source is stale | Project/network/provider failure | Follow `RESILIENCE_RUNBOOK.md` |
| Project status `INACTIVE` | Supabase paused the project | Dispatch recovery watchdog or restore in dashboard; then verify data |
