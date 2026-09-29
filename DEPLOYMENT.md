# DramaConnect v14.2 Deployment Guide

The canonical step-by-step guide is **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**. Use **[docs/SETUP_CHECKLIST.md](docs/SETUP_CHECKLIST.md)** for final verification.

**Upgrading an existing site?** Follow *Upgrading an existing installation to v14.2* in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). It lists the exact order, which matters.

## Required order

1. Create a Supabase project. Put only its Project URL and anon/publishable key in `assets/js/config.js`; never put privileged secrets in browser code.
2. In SQL Editor run **all of `database/complete-schema.sql` once**. It is the canonical cumulative installer, is safe to rerun, and includes the repaired schema, least-privilege security, resilience/backup, the v14 management control plane, the v14.1 identity/programmes layer (ID cards, verification, programmes and public registration, duty roster, care) and the v14.2 operations layer (organisation settings and venue geofence, HMG Fleet Console contract, analytics, activity trail, Archive Vault and Schema Doctor). Do not run the component SQL files afterward.
3. Register the first account, then use the controlled SQL in the canonical guide to set both `role = 'admin'` and `status = 'approved'` for that exact email.
4. Deploy this static project with `index.html` at the site root; deploy matching service worker cache `dramaconnect-v14.2`.
5. Configure at least one daily external heartbeat using **[Supabase protection](docs/SUPABASE_FREE_TIER_PROTECTION.md)**.
6. Configure and rehearse an encrypted off-site backup using **[Backup and recovery](docs/BACKUP_AND_RECOVERY.md)**.
7. Fill in the private/offline copy of the **[resilience runbook](docs/RESILIENCE_RUNBOOK.md)** and complete every applicable setup check.
8. Deploy only the optional Edge Functions you need, following their dedicated guides.

## New in v14.2 — the short deployment additions

1. **Re-run the SQL pack.** Supabase → SQL Editor → paste all of `database/complete-schema.sql` → Run. It is idempotent: it adds the v14.2 objects, records schema version 14.2, and leaves every existing row alone. Existing 14.0/14.1 archives still restore.
2. **Upload the changed files.** `assets/js/utils.js`, `assets/js/platform-management.js`, `assets/js/layout.js`, `assets/js/i18n.js`, `assets/js/boot.js`, `assets/js/auth.js`, `assets/js/db.js`, `assets/js/assistant.js`, `assets/js/data-portability.js`, `assets/css/style.css`, `sw.js`, `api/keep-alive.js`, `.github/workflows/keep-alive.yml` and the pages `platform-health.html`, `activity.html`, `settings.html`, `storage-manager.html`, `admin-data.html`, `analytics.html`, `attendance.html`.
3. **Register the project in the HMG Fleet Console** (2 minutes): console → Projects → Add project → Type **DramaConnect**, Supabase URL, **anon** key, site URL. Then open **Platform Health → HMG Fleet Console** and press *Ping exactly as the Fleet Console does* to prove it.
4. **Optional but recommended:** add this project's keep-alive URL to the console repository's `FLEET_TARGETS` secret so GitHub pings the whole fleet every 2 days.
5. **Set the venue fence if you want proof of presence at check-in:** Settings → Attendance & venue → *Use this device's location* at the venue, set the radius, tick the fence, Save. Members then need location permission to self check-in; administrators can always mark attendance manually.
6. **Turn on two-step verification for administrators:** Settings → Security → *Set up two-step verification* → scan with an authenticator app → enter the 6 digits. Optionally tick *Ask administrators to turn on two-step verification* (advisory, never blocking).

## Security and behavior notes

- Disabling Auth email confirmation may be acceptable for a controlled internal rollout because DramaConnect has a separate administrator approval gate. Keep secure email-change confirmation unless the organization explicitly accepts the added risk.
- Provider quotas and pause policies change. Confirm current Supabase, Google, GitHub and host terms rather than relying on old figures.
- PWA installation is optional; authentication/live data require a network.
- Browser Google Drive backup is visit-triggered and uses only memory-held `drive.file` tokens. It never opens an unsolicited OAuth prompt. The weekly encrypted workflow is the closed-browser layer.
- The private Supabase archive vault is not off-site. A portable JSON archive excludes Auth credentials and Storage bytes.
- Public-read avatar/gallery media must not contain sensitive imagery.
- Full personnel profiles and resilience/restore controls are approved-administrator-only.
- The HMG Fleet Console only ever holds this project's **public anon key**; it can bump a heartbeat row and read the licence verdict, nothing else. Never paste a `service_role` key anywhere — the console rejects one by design.
- Venue geofencing is enforced inside the database (`dc_self_check_in_geo`), not in the browser, so an old client cannot bypass the fence. Location is used only at the moment of check-in and is never stored.
- Two-step verification uses authenticator TOTP — no SMS provider, no cost, and it never blocks an administrator login on its own.
- The Archive Vault deletes only after the exported file is confirmed present in the private bucket **and** the live row count still matches the export.
- Rejection blocks but retains an account. Permanent removal is a distinct secured administrator operation.

For troubleshooting, see **[docs/ISSUE_RESOLUTION.md](docs/ISSUE_RESOLUTION.md)** and the operational runbook.
