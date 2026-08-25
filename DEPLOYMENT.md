# DramaConnect v13.2 Deployment Guide

The canonical step-by-step guide is **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**. Use **[docs/SETUP_CHECKLIST.md](docs/SETUP_CHECKLIST.md)** for final verification.

## Required order

1. Create a Supabase project. Put only its Project URL and anon/publishable key in `assets/js/config.js`; never put privileged secrets in browser code.
2. In SQL Editor run, in order:
   1. `database/repair_and_upgrade.sql`
   2. `database/security_hardening.sql`
   3. `database/resilience_and_backup.sql`
3. Register the first account, then use the controlled SQL in the canonical guide to set both `role = 'admin'` and `status = 'approved'` for that exact email.
4. Deploy this static project with `index.html` at the site root; deploy matching service worker cache `dramaconnect-v13.2`.
5. Configure at least one daily external heartbeat using **[Supabase protection](docs/SUPABASE_FREE_TIER_PROTECTION.md)**.
6. Configure and rehearse an encrypted off-site backup using **[Backup and recovery](docs/BACKUP_AND_RECOVERY.md)**.
7. Fill in the private/offline copy of the **[resilience runbook](docs/RESILIENCE_RUNBOOK.md)** and complete every applicable setup check.
8. Deploy only the optional Edge Functions you need, following their dedicated guides.

## Security and behavior notes

- Disabling Auth email confirmation may be acceptable for a controlled internal rollout because DramaConnect has a separate administrator approval gate. Keep secure email-change confirmation unless the organization explicitly accepts the added risk.
- Provider quotas and pause policies change. Confirm current Supabase, Google, GitHub and host terms rather than relying on old figures.
- PWA installation is optional; authentication/live data require a network.
- Browser Google Drive backup is visit-triggered and uses only memory-held `drive.file` tokens. It never opens an unsolicited OAuth prompt. The weekly encrypted workflow is the closed-browser layer.
- The private Supabase archive vault is not off-site. A portable JSON archive excludes Auth credentials and Storage bytes.
- Public-read avatar/gallery media must not contain sensitive imagery.
- Full personnel profiles and resilience/restore controls are approved-administrator-only.
- Rejection blocks but retains an account. Permanent removal is a distinct secured administrator operation.

For troubleshooting, see **[docs/ISSUE_RESOLUTION.md](docs/ISSUE_RESOLUTION.md)** and the operational runbook.
