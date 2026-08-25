# Backup, Google Drive Sync and Recovery

DramaConnect v13.2 uses several complementary backup types. No single copy is enough.

## Coverage matrix

| Backup | Browser must be open? | Off-site? | Application rows | Auth credentials | Storage bytes | Primary purpose |
|---|---:|---:|---:|---:|---:|---|
| Downloaded portable archive | Yes | After you move it | All 22 app/config tables visible to an approved admin | No | No | Easy verified export/import |
| Google Drive portable archive | Yes for creation | Yes | Same 22 tables | No | No | Convenient versioned copies |
| Private Supabase vault | Yes for creation | **No** | Same 22 tables | No | No | Fast secondary copy in-project |
| Encrypted weekly public-schema dump | No | Yes, through rclone | All `public` schema objects/data | Separate Auth component | No | Database disaster recovery |
| Encrypted Auth data dump | No | Yes, through rclone | N/A | `auth.users` and `auth.identities`; no sessions/tokens | No | Recreate user UUIDs and password hashes |
| Encrypted Storage export | No | Yes, through rclone | Storage manifest | No | Yes, when service-role secret is configured | Restore avatars/gallery/media |

A portable archive is not a PostgreSQL dump. The vault is not independent of Supabase. Google Drive browser scheduling is visit-triggered and cannot run indefinitely with every browser closed. The weekly GitHub workflow is the unattended recovery layer.

## Portable archive format

The archive format is `dramaconnect-portable-archive`, version 2. It contains these 22 tables in dependency order:

`profiles`, `productions`, `rehearsals`, `events`, `polls`, `finances`, `announcements`, `messages`, `reminders`, `resources`, `inventory`, `tenant_settings`, `activity_log`, `budgets`, `cast_list`, `attendance`, `inbox`, `tasks`, `poll_votes`, `event_rsvps`, `gallery`, `suggestions`.

Export safeguards:

- stable primary-key ordering and 500-row pagination;
- exact server count before/after each table, retried if the table changes mid-export;
- duplicate/missing primary-key detection;
- per-table canonical SHA-256 digests;
- table and total row manifests;
- a full canonical archive SHA-256 seal;
- maximum 100 MiB browser archive size;
- database-backed lease so two admins cannot overlap backup/restore work;
- completed/failed run history visible to administrators.

The archive intentionally excludes Supabase Auth passwords/sessions, Storage object bytes, heartbeats, backup leases and run history. Never describe it as a full Supabase project backup.

### Create and independently verify a local archive

1. Sign in as an approved administrator.
2. Open **Settings → Local Portable Backup**.
3. Select **Download full archive** and keep the resulting `.json` unchanged.
4. Verify it independently, outside the browser application:

```bash
node scripts/verify-portable-archive.mjs path/to/dramaconnect-archive.json
```

The verifier has no application or npm dependency. A successful result identifies format/version, all 22 table manifests, keys, duplicate status, row counts, every table digest and the full seal. Keep at least one verified copy on a second device.

### Browser restore modes

- **Merge** — upserts the full verified archive in dependency order. Use when the target Supabase Auth project already contains the same user UUIDs.
- **Degraded disaster recovery** — skips identity-dependent tables (`profiles`, `cast_list`, `attendance`, `inbox`, `tasks`, `poll_votes`, `event_rsvps`) and removes unrecoverable actor references from supported rows. The report states what was skipped.

Every browser restore verifies the complete archive before its first write and reports attempted/restored/skipped rows by table. Restore is merge/upsert-only; it does not delete rows absent from the archive and is not one transaction across all 22 tables. A network/RLS failure may leave a partial merge. Preserve the report, correct the cause and rerun the same archive; primary-key upserts are designed to be repeatable.

Use the encrypted database/Auth recovery set—not degraded browser mode—when exact identities must be recovered.

## Google Drive Backup & Sync

### Google Cloud setup

1. Create or select a Google Cloud project under the organization that owns the backups.
2. Enable **Google Drive API**.
3. Configure the OAuth consent screen. Add only trusted administrators as test users while the app remains in Testing.
4. Create **OAuth client ID → Web application**.
5. Add every exact deployed origin under **Authorized JavaScript origins**, for example:
   - `https://your-production-domain.example`
   - the exact Vercel deployment origin used for administration
   - `http://localhost:PORT` only for deliberate local testing
6. No OAuth redirect URI is needed by the Google Identity Services token client used here.
7. Copy the client ID ending in `.apps.googleusercontent.com`.

The client ID is a public identifier, not a client secret. Never create or embed a Google OAuth client secret in this static application.

### Connect and configure

1. Open **Settings → Google Drive Backup & Sync** as an approved administrator.
2. Enter the OAuth Web Client ID.
3. Choose a dedicated folder name, interval (1–30 days), retention count (1–50) and overdue grace period (0–168 hours).
4. Save settings, then select **Connect Google Drive**.
5. Review the Google account and requested scope, then approve.
6. Select **Backup Now** for the first backup.

DramaConnect requests only `https://www.googleapis.com/auth/drive.file`. Google documents this as access to files created/opened by the app: <https://developers.google.com/drive/api/v3/about-auth>. Tokens stay in JavaScript memory and are not saved to localStorage or Supabase. The dedicated folder ID may be cached per Google account locally, but the OAuth token is not.

The upload process creates the archive, seals it, uploads it, downloads it again from Drive, fully verifies the downloaded bytes and compares the remote seal. **Only then** is the backup marked successful and old Drive archives considered for retention deletion. A retention failure is a warning; it does not turn a valid new backup into a failure.

### Scheduling limitations

Drive scheduling is visit-triggered. The app checks every 15 minutes while open and on eligible visits. It can use only a still-valid in-memory token. It never opens an unsolicited OAuth popup; when authorization is absent/expired, it shows an overdue warning and requires an administrator to press **Connect Google Drive**.

Therefore:

- it cannot run while all browsers are closed;
- browser refresh/navigation loses the memory-only token;
- Google can expire/revoke access;
- use the weekly unattended workflow as the closed-browser layer.

### Drive recovery

In Settings, connect the same Google account, select **List**, then use **Download** or **Restore**. DramaConnect downloads and verifies the full archive before enabling restore. Do not bypass a digest, manifest, table-count, row-count or key error. Preserve a suspicious file for investigation; never edit its JSON manually.

## Private Supabase archive vault

The migration creates private bucket `dramaconnect-backups` with administrator-only Storage policies. **Create** generates and verifies the same v2 archive before upload. Downloads are verified again before use. Ordinary members and anonymous users cannot list, read, upload, update or delete vault objects.

The vault is useful for quick rollback but shares the same Supabase failure domain as the primary database. It does not satisfy off-site backup requirements and is excluded from the unattended Storage-byte export to prevent recursive backups.

## Unattended encrypted backup to Google Drive

Workflow: `.github/workflows/database-backup.yml` (weekly and manually dispatchable).

It performs these stages:

1. validates required secrets and passphrase strength;
2. queries the server version and uses the matching official PostgreSQL Docker image;
3. creates a custom-format full `public` schema dump;
4. creates a separate data-only custom dump of `auth.users` and `auth.identities`—sessions, refresh tokens and transient codes are deliberately excluded;
5. validates both catalogs with `pg_restore --list`;
6. optionally exports every Storage object except the recursive archive vault, with size and SHA-256 manifest;
7. encrypts each artifact with GnuPG AES-256 and creates a SHA-256 sidecar;
8. uploads only the encrypted artifacts and sidecars through rclone;
9. runs `rclone check` against the remote files;
10. applies retention only after remote verification;
11. sends a verified `database-backup` heartbeat.

### Configure rclone on a trusted computer

Install rclone, then:

```bash
rclone config
rclone lsd gdrive:
rclone config file
```

Create a Google Drive remote named `gdrive` (or choose another name and set `RCLONE_REMOTE_NAME`). Prefer a dedicated organization-controlled backup account with MFA and recovery contacts. Do not share the destination folder publicly.

Base64-encode the complete rclone configuration without line wrapping:

```bash
# GNU/Linux
base64 -w 0 ~/.config/rclone/rclone.conf

# macOS
base64 < ~/.config/rclone/rclone.conf | tr -d '\n'
```

Paste the result directly into the GitHub secret `RCLONE_CONFIG_BASE64`. The config contains a renewable Google OAuth token and must be treated as a secret.

### GitHub Actions secrets

| Secret | Required | Purpose |
|---|---:|---|
| `SUPABASE_DB_URL` | Yes | Session-mode/direct PostgreSQL URL from Supabase **Connect**, including SSL requirements |
| `SUPABASE_URL` | Yes | Project API URL |
| `SUPABASE_ANON_KEY` | Yes | Narrow heartbeat RPC only |
| `RCLONE_CONFIG_BASE64` | Yes | Encoded rclone configuration |
| `RCLONE_REMOTE_NAME` | No | Defaults to `gdrive` |
| `BACKUP_PASSPHRASE` | Yes | High-entropy encryption passphrase, at least 20 characters |
| `BACKUP_RETENTION_DAYS` | No | Defaults to 180; numeric |
| `SUPABASE_SERVICE_ROLE_KEY` | Recommended | Server-side export of actual Storage bytes |

Use the direct or session-mode pooler connection, not a transaction-mode URL, for `pg_dump`. URL-encode special password characters. Never print/test the URL in a public shell transcript.

The service-role key is accepted only by the GitHub runner and Node Storage scripts; it must never appear in HTML, browser JavaScript, Vercel public variables, Apps Script or monitor URLs. Pull-request workflows do not receive repository secrets, but workflow-file changes on the default branch can use them—require review for `.github/workflows/**` and `scripts/**`.

Store `BACKUP_PASSPHRASE` separately from Google Drive and GitHub, for example in the organization password manager plus a sealed recovery copy. Losing it makes every encrypted backup unrecoverable. Rotation does not re-encrypt old files; retain the old passphrase until those files expire.

Run **Encrypted unattended database, Auth and Storage backup** manually once. Confirm four remote files (six when Storage is enabled) share one timestamp and the run ends with `uploaded and remotely verified`. Download one full set and perform a rehearsal.

## Database/Auth disaster recovery

### Safety conditions

- Put the application in maintenance mode and prevent writes.
- Use a **new/fresh recovery project** wherever possible.
- Export/backup the target before changing it.
- Match the source PostgreSQL/Supabase generation and rehearse on non-production first.
- The target `auth.users` must be empty unless `SKIP_AUTH_RESTORE=1` is used after independently confirming that every required UUID already exists.
- Use a current `pg_restore`; an older client may reject a newer custom archive.
- Direct Auth-table migration is sensitive to platform schema changes. If source and target Supabase Auth versions differ or the restore fails, stop and contact Supabase support rather than disabling constraints.

### Restore public data and Auth identities

Download the four matching timestamp files and run:

```bash
chmod 700 scripts/restore-database-dump.sh
BACKUP_PASSPHRASE='retrieve-from-password-manager' \
RESTORE_CONFIRM=RESTORE \
scripts/restore-database-dump.sh \
  dramaconnect-public-TIMESTAMP.dump.gpg \
  dramaconnect-public-TIMESTAMP.dump.gpg.sha256 \
  dramaconnect-auth-TIMESTAMP.data.dump.gpg \
  dramaconnect-auth-TIMESTAMP.data.dump.gpg.sha256 \
  'postgresql://TARGET_CONNECTION' --apply
```

The script fails unless every checksum, GPG decryption, catalog allow-list and target connection check succeeds. It refuses to merge credentials into a non-empty Auth user table. Auth data is restored in one transaction; then the public schema is clean-restored in a separate single transaction. If Auth succeeded but the public transaction failed, investigate and retry with `SKIP_AUTH_RESTORE=1` only against that same target.

Restored sessions/tokens are intentionally absent, so users must sign in again. Password hashes and supported identity rows are preserved, but OAuth/SAML provider settings and external provider secrets must be reconfigured in the target Supabase dashboard.

### Restore Storage bytes

For the matching Storage files:

```bash
sha256sum --check dramaconnect-storage-TIMESTAMP.tar.gpg.sha256
mkdir -m 700 recovered-storage
gpg --decrypt --output recovered-storage.tar dramaconnect-storage-TIMESTAMP.tar.gpg
tar -tf recovered-storage.tar                    # inspect before extraction
tar --extract --file recovered-storage.tar --directory recovered-storage \
  --no-same-owner --no-same-permissions

RESTORE_CONFIRM=RESTORE \
SUPABASE_URL=https://TARGET_REF.supabase.co \
SUPABASE_SERVICE_ROLE_KEY='TARGET_SERVICE_ROLE_KEY' \
node scripts/restore-storage.mjs recovered-storage
```

The restore utility verifies the strict manifest and all local object sizes/hashes **before the first remote write**, creates missing buckets, upserts objects, and reads every upload back to verify its remote size and SHA-256. It does not delete target objects absent from the backup. Existing bucket settings are preserved when they match; any public/private, size-limit, or MIME-policy conflict stops recovery before remote writes. After reviewing such a conflict, only an intentional reconciliation may add `RESTORE_RECONCILE_BUCKETS=RECONCILE` to the command. Destroy shell history, decrypted files and temporary service-key material securely after verification.

### Post-restore checklist

- [ ] Reapply any migrations released after the backup timestamp, in order.
- [ ] Confirm all 22 application tables exist and compare row counts with a verified portable archive/report.
- [ ] Confirm `auth.users` IDs match `profiles.id`; test password and OAuth sign-in with designated accounts.
- [ ] Confirm avatars/gallery objects load and private buckets remain private.
- [ ] Reapply/review RLS and run anonymous-versus-member-versus-admin authorization tests.
- [ ] Rotate target database password, service-role key exposure, rclone token if handled outside the runner, and temporary credentials.
- [ ] Set new GitHub/Vercel/Apps Script/monitor secrets to the target project.
- [ ] Manually run heartbeat and a new backup; never rely only on the pre-incident set.
- [ ] Check events, finances, attendance, messages, RSVP and tenant settings in the UI.
- [ ] Obtain administrator sign-off before switching DNS or reopening writes.

## Retention and rehearsal policy

Recommended minimum (adjust for legal/privacy requirements):

- Drive portable archives: 12 verified copies;
- encrypted unattended sets: 180 days;
- one monthly set retained for 12 months outside the active account;
- quarterly restore rehearsal into a non-production project;
- monthly review of GitHub logs and Drive free space;
- immediate manual backup before migrations, large imports or authorization changes.

Backups contain personal data, contact details, private messages, financial information and password hashes. Limit access, use MFA, document retention/deletion, and follow applicable Nigerian data-protection and church safeguarding policies.
