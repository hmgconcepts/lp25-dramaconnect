# DramaConnect v14.1 Deployment Guide

The canonical step-by-step guide is **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**. Use **[docs/SETUP_CHECKLIST.md](docs/SETUP_CHECKLIST.md)** for final verification.

**Upgrading an existing v14.0 site?** Follow *Upgrading an existing v14.0 site to v14.1* in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#upgrading-an-existing-v140-site-to-v141). It lists the exact order, which matters.

## Required order

1. Create a Supabase project. Put only its Project URL and anon/publishable key in `assets/js/config.js`; never put privileged secrets in browser code.
2. In SQL Editor run **all of `database/complete-schema.sql` once**. It is the canonical cumulative installer, is safe to rerun, and includes the repaired schema, least-privilege security, resilience/backup, the v14 management control plane and the v14.1 identity/programmes layer (ID cards, verification, programmes and public registration, duty roster, care). Do not run the component SQL files afterward.
3. Register the first account, then use the controlled SQL in the canonical guide to set both `role = 'admin'` and `status = 'approved'` for that exact email.
4. Deploy this static project with `index.html` at the site root; deploy matching service worker cache `dramaconnect-v14.1`.
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
