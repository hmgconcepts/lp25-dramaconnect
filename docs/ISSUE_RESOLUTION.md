# Troubleshooting and Issue Resolution

## 1. Registration or password-reset rate limits

**Symptom:** Supabase Auth returns a rate-limit error or confirmation/reset mail
is delayed.

**Cause:** Hosted Auth email quotas and SMTP limits vary by Supabase plan and may
change. Check the current project dashboard and official Supabase limits rather
than relying on a hard-coded number in this repository.

### Internal rollout option

In **Authentication → Providers → Email**, administrators may turn **Confirm
email** off if their governance process permits it. DramaConnect's separate
approval gate still applies: new profiles stay `pending` and cannot enter the
application until approved. Keep secure email-change confirmation enabled unless
you have consciously accepted the account-takeover risk of disabling it.

### Production option

Configure a verified custom SMTP provider under the current Supabase Auth SMTP
settings. Protect credentials in the provider/dashboard; never put them in this
repository or browser code. Check provider quotas, sender-domain verification,
spam placement, and function/Auth logs.

## 2. Pending and rejected registrations

- `pending`: appears in the administrator approval queue and remains blocked.
- `rejected`: retained and blocked, but can be approved later.
- **Remove**: permanent approved-administrator Edge Function operation that
  deletes the Supabase Auth account, profile, and cascade-linked records. It
  blocks self-deletion and cannot be replaced with a browser profile delete.

If an account authenticates but returns to the sign-in page, inspect its profile
status and confirm all three database migrations were run in order.

## 3. Profile photos and external gallery media

- **Profile photo:** use **My Profile → Upload Photo**. The image is cropped and
  uploaded to the public `avatars/<auth-user-id>/...` path. The owner must be an
  approved account.
- **Gallery:** administrators and approved unit leaders may upload validated
  image media; gallery rendering also validates supported Drive/YouTube/HTTP(S)
  values before creating links or embeds.
- Do not upload private/sensitive imagery to public-read buckets.

If an upload is denied by RLS, run `database/repair_and_upgrade.sql` and then
`database/security_hardening.sql`, verify approval status, and check that the
storage path begins with the caller's Auth user ID.

## 4. Edge Function authorization failures

| Function | Required caller proof |
| :-- | :-- |
| `admin-create-member` | Valid bearer JWT for an approved administrator; keep gateway JWT verification enabled. |
| `notify-approval` | Approved-admin bearer JWT **or** `X-Webhook-Secret` matching `NOTIFY_WEBHOOK_SECRET`. |
| `birthday-bot` | POST plus `X-Cron-Secret` matching `CRON_SECRET`. |
| `run-reminders` | POST plus `X-Cron-Secret` matching `CRON_SECRET`. |

Never solve `401` by removing the function's own checks or exposing the service
role. Follow the dedicated function guides to configure secrets and deployment
JWT modes.

## 5. Stale installed application shell

The v13.2 service worker uses cache `dramaconnect-v13.2`, network-first
navigation, and network-only handling for cross-origin/backend requests. Deploy
`sw.js` with the rest of the release, then hard-refresh once. For a later app
release, change the cache identifier to that release version.
