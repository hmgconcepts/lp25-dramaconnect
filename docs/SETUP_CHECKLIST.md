# ✅ DramaConnect v13.2 — First-Time Setup Checklist

Follow the mandatory sections in order. The core app can be launched quickly; production resilience, OAuth and verified recovery require additional provider setup and a rehearsal.

## A. Backend (Supabase) — mandatory

- [ ] **A1.** Create a Supabase project, choose the nearest suitable region and store the database password in the organization password manager.
- [ ] **A2.** In **SQL Editor**, run all of `database/repair_and_upgrade.sql`.
- [ ] **A3.** In a new query, run all of `database/security_hardening.sql`.
- [ ] **A4.** In a third query, run all of `database/resilience_and_backup.sql`.
- [ ] **A5.** Confirm the three scripts completed in that exact order without ignored errors.
- [ ] **A6.** Create/sign up the first account, then promote that exact email to `admin` + `approved` once through the trusted SQL Editor (see `DEPLOYMENT.md`).
- [ ] **A7.** Decide whether email confirmation remains ON. Turning it off does not bypass DramaConnect's administrator approval gate.
- [ ] **A8.** Optional: enable `pg_cron`, rerun the third migration and confirm `dramaconnect-internal-heartbeat` exists. Do not treat an internal cron as a wake-up layer.

## B. Connect the static app — mandatory

- [ ] **B1.** Copy only the Supabase **Project URL** and **anon/publishable** key.
- [ ] **B2.** Put them in `assets/js/config.js` as `SUPABASE_URL` and `SUPABASE_KEY`.
- [ ] **B3.** Confirm no placeholder remains and no database password, service-role key, Management API token, cron secret or OAuth client secret exists in any frontend file.
- [ ] **B4.** Confirm `CONFIG.APP_VERSION` is `v13.2` and deploy the matching `sw.js`.

## C. Publish the site — choose one

- [ ] **C1.** Upload the **contents** of the project directory so `index.html` is at the deployment root.
- [ ] **C2.** GitHub Pages: deploy `main` / root; or Cloudflare Pages: no framework/build; or Vercel: Other/static.
- [ ] **C3.** Open the production HTTPS URL. Confirm the logo and sign-in screen appear without console errors.
- [ ] **C4.** Hard-refresh once and confirm old service-worker assets are not serving a prior release.

## D. Create and test the first administrator — mandatory

- [ ] **D1.** Sign up on the live site and confirm email if enabled.
- [ ] **D2.** Run the one-time bootstrap SQL from `DEPLOYMENT.md` for the exact email.
- [ ] **D3.** Sign in and confirm **Activity Log**, **Settings, Resilience & Backup**, and **Messaging** are available.
- [ ] **D4.** Sign in with an approved ordinary member and confirm administrator settings/data are unavailable even through direct database API calls.
- [ ] **D5.** Confirm a pending/rejected account remains blocked.

## E. Supabase inactivity protection — production

Use `SUPABASE_FREE_TIER_PROTECTION.md` for the exact procedure.

- [ ] **E1.** Confirm a browser visit records `site-visit` and the administrator test records `manual-button`.
- [ ] **E2.** Add GitHub Actions secrets `SUPABASE_URL` and `SUPABASE_ANON_KEY`; manually run **Supabase resilience heartbeat**.
- [ ] **E3.** Configure at least one daily, independent external monitor through the secret-protected Edge `ping` function.
- [ ] **E4.** Optional: configure Vercel Cron and/or Apps Script as another provider—not as a replacement for backup.
- [ ] **E5.** Add `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF`; manually run the paused-project watchdog and confirm it does nothing destructive to a healthy project.
- [ ] **E6.** Confirm missing/incorrect `PING_SECRET` and `CRON_SECRET` receive 401.
- [ ] **E7.** Assign an owner to review source timestamps and provider executions monthly.

## F. Portable and Google Drive backup

Use `BACKUP_AND_RECOVERY.md`.

- [ ] **F1.** In Settings, download the full 22-table portable archive.
- [ ] **F2.** Run `node scripts/verify-portable-archive.mjs ARCHIVE.json`; retain the successful output in the private backup register.
- [ ] **F3.** Enable Google Drive API and create an OAuth **Web application** client with the exact production origin.
- [ ] **F4.** Save only the public OAuth client ID in Admin Settings; connect explicitly with `drive.file` scope.
- [ ] **F5.** Create a Drive backup and confirm upload → download → full re-verification completes before retention.
- [ ] **F6.** Create/list/download a private vault copy, while acknowledging that it is not off-site.
- [ ] **F7.** Enable visit-triggered scheduling and confirm that expired authorization causes an overdue warning, never an unsolicited popup.

## G. Unattended encrypted recovery set

- [ ] **G1.** Configure an organization-controlled rclone Google Drive account with MFA.
- [ ] **G2.** Add required GitHub secrets: `SUPABASE_DB_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `RCLONE_CONFIG_BASE64`, and a separately escrowed `BACKUP_PASSPHRASE`.
- [ ] **G3.** Add recommended `SUPABASE_SERVICE_ROLE_KEY` only as a protected Actions secret to include actual Storage bytes; never put it in browser code.
- [ ] **G4.** Set optional `RCLONE_REMOTE_NAME` and numeric `BACKUP_RETENTION_DAYS`.
- [ ] **G5.** Manually run **Encrypted unattended database, Auth and Storage backup**.
- [ ] **G6.** Confirm matching timestamp files: encrypted public dump + checksum, encrypted Auth data dump + checksum, and—when configured—encrypted Storage tar + checksum.
- [ ] **G7.** Download a set, verify sidecars and rehearse the guarded restore into a non-production project.
- [ ] **G8.** Store the encryption passphrase separately from GitHub and Drive; document a second custodian.

## H. Optional Edge automations

- [ ] **H1.** Admin-created member logins: deploy using `ADMIN_CREATE_MEMBER.md`.
- [ ] **H2.** Scheduled reminders: set a strong `CRON_SECRET` and follow `SCHEDULED_REMINDERS.md`.
- [ ] **H3.** Birthday greetings: use the same secured scheduler pattern in `BIRTHDAY_BOT.md`.
- [ ] **H4.** Approval email webhook: configure `NOTIFY_WEBHOOK_SECRET`, `APP_URL` and provider secrets according to `EMAIL_NOTIFICATIONS.md`.

## I. Final verification and operations

- [ ] New signup appears under **Members → Pending Approvals**; approval permits sign-in.
- [ ] Add/test a production, finance entry, event/RSVP, rehearsal, attendance, task, message and poll.
- [ ] Reports export Excel/PDF/CSV; menu works on phone/tablet.
- [ ] RLS tests cover anonymous, pending, member, unit leader and administrator—not only hidden buttons.
- [ ] Public avatar/gallery privacy is acceptable for the content policy.
- [ ] Incident owners/contact details are filled in `RESILIENCE_RUNBOOK.md` (or the private offline copy).
- [ ] Monthly checks and quarterly recovery rehearsals are calendared.
- [ ] The first verified backup set is registered without recording any secret values.
