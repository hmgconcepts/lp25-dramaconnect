# DramaConnect v13.2 User Guide

The current, complete user manual is **[docs/USER_GUIDE.md](docs/USER_GUIDE.md)**.
The full feature-by-feature reference is **[docs/FEATURES.md](docs/FEATURES.md)**.

## Essential rules

- Registration creates a `pending` profile. Pending and rejected accounts cannot
  enter the application; an administrator may later approve either state.
- Full personnel profiles are administrator-only. Approved members use the
  restricted directory and can edit only permitted fields on their own profile.
- Role, approval status, drama unit, and unit-leader assignment are managed by
  approved administrators.
- Unit leaders coordinate their unit and may manage their own gallery uploads;
  they cannot edit other member profiles or authorization fields.
- **Remove** is permanent account deletion: the secured administrator function
  deletes the Supabase Auth account and cascade-linked profile/data. Rejection is
  the reversible blocked state.
- Poll and RSVP pages show aggregate results plus the caller's own choice. Raw
  RSVP identities are available only to approved administrators.
- App installation is optional. Cached shell pages may open without a network,
  but authentication and live data features require connectivity.
- Automatic reminders, birthday messages, and approval emails work only when the
  optional secured Edge Functions have been deployed and configured.
- Only approved administrators can view resilience health, create/restore sealed
  22-table archives, connect Google Drive or use the private backup vault.
  Browser archives exclude Auth passwords/sessions and Storage object bytes.

For setup and troubleshooting, see **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**
and **[docs/ISSUE_RESOLUTION.md](docs/ISSUE_RESOLUTION.md)**.
