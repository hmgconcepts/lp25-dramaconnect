# 📧 Optional Automated Approval Emails

DramaConnect already offers a zero-setup WhatsApp/email handoff after an
administrator approves a member. This optional Edge Function sends an approval
email through Resend.

## Authorization model

`notify-approval` accepts POST requests only and authorizes either:

1. a bearer token belonging to an **approved administrator**, or
2. `X-Webhook-Secret` matching the Supabase secret
   `NOTIFY_WEBHOOK_SECRET`.

A public unauthenticated call is rejected. Database webhooks have no end-user
JWT, so the webhook path must use the strong secret. The function also ignores
webhook updates that do not transition a profile to `approved`.

## 1. Configure email and application secrets

Create and verify a sender in Resend, then run:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set \
  RESEND_API_KEY='re_your_key' \
  FROM_EMAIL='DramaConnect <you@yourdomain.com>' \
  APP_URL='https://YOUR_PUBLIC_DRAMACONNECT_URL/' \
  NOTIFY_WEBHOOK_SECRET='YOUR_LONG_RANDOM_SECRET'
```

Optionally set `APP_ORIGIN` to the exact browser origin if the function will be
called from browser code. Do not put any of these secrets in `config.js` or the
repository.

## 2. Deploy

For the database-webhook option, deploy with gateway JWT verification disabled;
the function's own admin-token/webhook-secret authorization remains active:

```bash
supabase functions deploy notify-approval --no-verify-jwt
```

## 3. Configure the database webhook

In **Supabase → Database → Webhooks**:

- table: `public.profiles`
- event: `UPDATE`
- method: `POST`
- URL: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/notify-approval`
- headers:
  - `Content-Type: application/json`
  - `X-Webhook-Secret: YOUR_LONG_RANDOM_SECRET`

The standard Supabase update payload (`record` and `old_record`) is supported.
The function sends only when `record.status` is `approved` and the previous
status was not already `approved`. Store/provision the header secret through the
secure dashboard; do not commit an exported webhook configuration containing it.

Alternatively, trusted app code may invoke the same function with the current
administrator's bearer token and a direct body containing `email`, `full_name`,
and optionally `app_url`. No such call is required for the built-in manual
notification flow.

## 4. Test

Approve a pending or rejected test profile and inspect the recipient Inbox and
`supabase functions logs notify-approval`. Also verify:

- a request with no authorization returns `401`;
- a webhook update that leaves an already-approved profile approved is ignored;
- invalid email/application URLs are rejected;
- provider failures return a sanitized message while details stay in server logs.

## Troubleshooting

| Problem | Resolution |
| :-- | :-- |
| `401 Unauthorized` | Match `X-Webhook-Secret` to `NOTIFY_WEBHOOK_SECRET`, or use an approved-admin JWT. |
| `APP_URL ... required` | Set a valid HTTP(S) `APP_URL` Edge Function secret. |
| No email | Verify Resend key, verified sender/domain, webhook logs, and that status actually transitioned to `approved`. |
| Browser CORS issue | Set `APP_ORIGIN` to the deployed site origin and redeploy. |
