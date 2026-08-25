# DramaConnect Resilience and Incident Runbook

Use this runbook for Supabase pause/outage, stale protection layers, backup failure, corrupt archives, credential exposure, data loss or failed recovery. Keep an offline copy and fill in the organization-specific contacts below.

## Ownership and contacts

| Role | Named owner / contact | Responsibility |
|---|---|---|
| Incident commander | **FILL IN** | Coordinates, authorizes recovery, owns timeline |
| Supabase owner | **FILL IN** | Dashboard, billing/plan, database and Auth recovery |
| Backup custodian | **FILL IN** | Drive/rclone access, passphrase custody, restore set |
| Security/privacy lead | **FILL IN** | Credential rotation, breach/privacy assessment |
| Ministry/department lead | **FILL IN** | User communications and operational decisions |
| Alternate administrator | **FILL IN** | Recovery if primary owner is unavailable |

Record Supabase project ref, GitHub repository, Vercel project and Google backup account in the organization password manager—not in this public file.

## Service objectives

These are suggested internal targets, not provider guarantees:

- **RPO:** no more than 7 days from the weekly unattended backup; less when a recent verified Drive/local archive exists.
- **RTO:** 4 business hours for an ordinary pause/credential fault; one business day for full project recovery.
- **Heartbeat alert response:** acknowledge within 4 hours.
- **Backup failure response:** correct or create a manual verified backup within 24 hours.

Change the schedule if these targets are insufficient. A weekly workflow cannot provide a one-day RPO.

## Severity

- **SEV-1:** confirmed data loss/corruption, unauthorized administrator/service key use, unavailable production with no safe quick restore, or public exposure of private backup data.
- **SEV-2:** production unavailable/paused, failed restore, all external heartbeat layers stale, or two consecutive unattended backups failed.
- **SEV-3:** one protection provider failed, Drive is overdue, retention warning, or a backup copy failed verification while other verified copies exist.

## Universal first actions

1. **Do not improvise destructive SQL.** Do not delete a “bad” backup, truncate tables, disable RLS, bypass checksum errors or overwrite the newest verified set.
2. Start an incident timeline in UTC. Record who observed what, exact error/status, URL/provider, workflow run ID, backup timestamp and every action.
3. Capture screenshots/logs without exposing tokens, database URLs, personal data or passphrases.
4. If corruption or intrusion is possible, put the application in maintenance mode or remove public routing and stop administrator writes.
5. Preserve at least two candidate recovery sets. Download encrypted artifacts and checksum sidecars before changing retention or provider accounts.
6. Assign one incident commander. A second administrator must review any destructive restore.
7. Use the least destructive scenario below.

## Quick health commands

### Direct narrow heartbeat

```bash
SUPABASE_URL=https://PROJECT_REF.supabase.co \
SUPABASE_ANON_KEY='PUBLISHABLE_OR_ANON_KEY' \
node scripts/check-resilience.mjs
```

Success requires process exit 0 and `OK ... written|throttled`. The anon key is public by design, but do not replace it with the service-role key.

### Edge monitor endpoint

```bash
curl --fail --max-time 20 \
  'https://PROJECT_REF.supabase.co/functions/v1/ping?token=PING_SECRET'
```

Success requires HTTP 200 and `"ok":true`. Avoid pasting token-bearing URLs into tickets/chat.

### Independent portable archive verification

```bash
node scripts/verify-portable-archive.mjs path/to/archive.json
```

Any non-zero exit or digest/count/key mismatch makes that copy ineligible for restore.

### Encrypted artifact checksum

```bash
sha256sum --check FILE.gpg.sha256
```

Perform this before decryption. A missing/failed sidecar is not a warning; obtain another copy.

## Scenario A — One or more heartbeat sources are stale

1. Open **Admin Settings → Resilience** and identify exact stale sources. One stale optional source with other current external sources is SEV-3, not an outage.
2. Press the manual heartbeat button. If it succeeds, the database API is reachable.
3. Review the failed provider:
   - GitHub: Actions enabled, secrets present, schedule enabled, branch-write permission/preservation commit;
   - Edge/monitor: function deployed, `PING_SECRET` matches, monitor requires correct keyword;
   - Vercel: deployment current, Cron enabled for plan, `CRON_SECRET`/Supabase variables present;
   - Apps Script: trigger exists, execution authorization valid, script properties present;
   - `pg_cron`: extension/job active—but remember it cannot wake a paused database.
4. Manually dispatch GitHub heartbeat and require the verified JSON step to pass.
5. Repair the source without disabling RPC security or making heartbeat tables public.
6. Confirm the source timestamp advances. Close incident only after the next scheduled run also succeeds.

If the direct heartbeat fails and dashboard status is inaccessible, continue with Scenario B.

## Scenario B — Supabase reports `INACTIVE`, paused or unreachable

1. Check the Supabase status page and organization/project dashboard. Distinguish provider outage from project pause, quota, DNS and credential failure.
2. Manually dispatch **Supabase paused-project recovery watchdog**. Read its exact status output.
3. The watchdog may request restore only for `INACTIVE`; do not modify it to restore unknown/transitional statuses.
4. Alternatively use the dashboard's official restore control. Supabase's documented pause/restore terms can change; follow the current dashboard guidance.
5. Wait for `ACTIVE_HEALTHY`. Do not repeatedly submit restore requests while `RESTORING`/`COMING_UP`.
6. Run the direct heartbeat, then sign in with a test member and approved admin.
7. Verify table counts, latest events/finances/attendance, RLS and Storage objects.
8. Immediately create a new verified off-site backup.

Escalate to SEV-1/full recovery if the project cannot be restored, data is missing, or Supabase indicates the recovery window has expired.

## Scenario C — Google Drive backup is overdue or authorization failed

1. Confirm another unattended or local verified backup exists. If not, treat as SEV-2.
2. In Settings, select **Connect Google Drive**. Confirm the expected Google account and `drive.file` scope.
3. Do not add a client secret or broader Drive scope to “fix” token expiration.
4. Select **Backup Now**. It must upload, download, fully verify and update `last_success_at`.
5. Inspect retention warnings separately. Never delete old copies until the new one verifies.
6. If the Google account changed, verify the dedicated folder; `drive.file` cannot enumerate arbitrary files created by another OAuth client/account.
7. Confirm the weekly unattended rclone workflow remains healthy because browser Drive scheduling cannot run closed-browser.

## Scenario D — Portable archive or Drive/vault copy fails verification

1. Do **not** restore it and do not manually edit its JSON/seal.
2. Preserve the exact bytes, filename, source, download time and verifier output.
3. Download the same Drive/vault object again and verify it independently. This distinguishes transfer corruption from a bad stored object.
4. Test the immediately previous archive. Prefer the newest copy that passes every manifest/digest check.
5. Compare sizes and SHA-256 digests across independent copies.
6. If multiple recent archives fail, suspend restores and audit `assets/js/data-portability.js`, deployment version, browser crypto availability and possible tampering.
7. Use an encrypted database recovery set when no portable copy is trustworthy.

A valid outer Drive checksum/appProperty does not override a failing full archive verifier.

## Scenario E — Weekly unattended workflow failed

Use the first failing stage:

- **Secret validation:** add/rotate the named GitHub secret; never echo its value.
- **Database connection/server query:** verify project active, session-mode/direct URL, password URL encoding, SSL and database password rotation.
- **Docker/pg_dump:** inspect server major version and runner network; never substitute an older `pg_dump`.
- **Auth dump:** stop if permissions/schema changed; do not widen to dumping/drop-restoring all managed Auth schemas.
- **Storage export:** verify service-role key and Storage API; database/Auth artifacts can still be created, but the run should clearly report missing byte coverage.
- **GPG:** confirm passphrase availability/length. Never change passphrase mid-set.
- **rclone upload/check:** verify OAuth token, Drive quota, remote name and folder access.
- **retention:** preserve new verified files; repair deletion separately.
- **heartbeat:** verify migration/RPC. Confirm remote files before rerunning.

After correction, manually dispatch the workflow. Download all files sharing one timestamp, verify every sidecar and record the successful set in the backup register. Two consecutive failures are SEV-2.

## Scenario F — Suspected data corruption/deletion

1. Stop writes and preserve database/API/audit evidence.
2. Establish the earliest known bad time and latest known good time.
3. Verify candidate backups without writing to production.
4. Restore the best candidate to a **separate non-production Supabase project**.
5. Compare all 22 table counts, critical financial/event records, Auth/profile UUIDs and Storage object hashes.
6. Decide between:
   - limited, reviewed row-level repair from a portable archive/report; or
   - full recovery following `BACKUP_AND_RECOVERY.md`.
7. Require two-person approval for production restore.
8. Preserve incident evidence according to privacy/safeguarding policy.

Do not use browser merge restore as an exact rollback: it does not delete newer rows and is not globally transactional.

## Scenario G — Credential or backup-account compromise

Treat service-role, database URL, Supabase access token, rclone config and backup passphrase as high-impact credentials.

1. Disable/revoke the exposed credential at its provider.
2. If workflow code may have been changed, disable affected workflows before adding replacement secrets and review default-branch history.
3. Rotate in this order as applicable:
   - Supabase database password/connection URL;
   - service-role/project API keys according to Supabase rotation procedure;
   - Supabase Management API access token;
   - Google/rclone OAuth grant;
   - `PING_SECRET` and `CRON_SECRET`;
   - backup encryption passphrase for future sets.
4. Update GitHub, Vercel, monitor and Apps Script secrets; redeploy where required.
5. Review Supabase Auth/audit logs, GitHub workflow runs, Drive activity/sharing and Vercel logs.
6. Determine whether personal data was accessed and invoke the organization's NDPA/privacy notification procedure if required.
7. Produce a new backup under the new credentials. Keep old passphrase securely until unexpired historical backups are deliberately retired.

The anon/publishable key and Google OAuth client ID are designed to be public; exposure alone is not equivalent to service-role/client-secret exposure. Still investigate misuse and ensure RLS is intact.

## Scenario H — Database/Auth restore failed or partially completed

1. Keep the application closed. Save the exact command, stderr and target project state.
2. The recovery script restores Auth and public in separate transactions:
   - a failed Auth transaction should leave Auth unchanged;
   - public restore begins only after Auth succeeds;
   - a failed public transaction should roll back public changes, but Auth may already be restored.
3. Do not rerun Auth into non-empty `auth.users`. If Auth completed and the exact same public restore is being retried, set `SKIP_AUTH_RESTORE=1` only after confirming source/target user UUIDs.
4. If catalog validation/checksum/decryption failed, stop and obtain another copy. Never bypass checks.
5. If platform Auth schemas differ, create a version-compatible target or contact Supabase support; do not drop managed Auth tables or disable constraints.
6. If public restore reports dependency/RLS errors, confirm target extensions/platform generation and rehearse on another fresh project.
7. Independently verify all post-restore checks before reopening traffic.

## Full recovery decision and order

Use full recovery only when ordinary Supabase restore is unavailable or known bad.

1. Select a matching timestamp set: public dump + checksum, Auth data dump + checksum, optional Storage archive + checksum.
2. Independently verify checksums; preserve the originals read-only.
3. Provision a fresh private target and record its baseline.
4. Run the guarded database/Auth script exactly as documented in `BACKUP_AND_RECOVERY.md`.
5. Restore Storage bytes with target service-role credentials.
6. Apply migrations newer than the backup.
7. Reconfigure Auth providers, URLs, email, GitHub/Vercel/monitor secrets and Drive settings.
8. Execute role/RLS, sign-in, row-count, application and media smoke tests.
9. Obtain incident commander + second administrator sign-off.
10. Switch routing, monitor closely and create a new independent backup.

## Required backup register

Maintain a private register with no secret values:

| Field | Example |
|---|---|
| Backup timestamp (UTC) | `2026-08-09T02:53:00Z` |
| Workflow run URL/ID | GitHub run ID |
| Public/Auth/Storage filenames | Matching timestamp names |
| SHA-256 sidecars verified | Yes/No + verifier |
| Remote verification | rclone check passed |
| Portable archive rows/seal | Count + first/last digest characters |
| Restore rehearsal | Date, target, tester, result |
| Expiry/deletion date | Policy-derived |

Never record the passphrase, service-role key, database URL or monitor token in this register.

## Monthly and quarterly drills

Monthly:

- review every heartbeat source and scheduled-provider execution;
- review latest unattended workflow and remote file set;
- verify one downloaded portable archive and all sidecars in one unattended set;
- inspect Drive storage/quota/sharing and GitHub/Vercel administrator access;
- confirm two custodians can reach the offline runbook and password manager.

Quarterly:

- restore a selected encrypted set into a non-production target;
- verify Auth/profile UUIDs, all 22 table counts, RLS roles and Storage hashes;
- time the recovery against RTO/RPO;
- delete the rehearsal target and decrypted files securely;
- record defects and update this runbook through review.

An untested backup is only a hypothesis.
