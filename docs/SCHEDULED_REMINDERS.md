# ⏰ Optional Fully Automatic Scheduled Reminders

The administrator-only **Reminders** page works without server automation: an
administrator can send a due reminder manually. This optional setup invokes
`run-reminders` with Supabase Cron (`pg_cron` + `pg_net`).

## Security model

The function uses the service role internally, so it must never be an open URL.
It accepts **POST only** and requires `X-Cron-Secret` to exactly match the
`CRON_SECRET` stored in Supabase secrets. It claims each due schedule before
sending, which prevents overlapping runs from sending the same occurrence; a
failed Inbox insert restores the old schedule.

## 1. Link the CLI and set a strong secret

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
# Generate this with a password manager or: openssl rand -hex 32
supabase secrets set CRON_SECRET='YOUR_LONG_RANDOM_SECRET'
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are supplied to deployed Supabase
Edge Functions. Never copy the service-role value into the repository,
`config.js`, SQL text, or a browser.

## 2. Deploy

The scheduler cannot provide an end-user JWT, so deploy this function without
gateway JWT verification. The function's own `CRON_SECRET` check remains
mandatory:

```bash
supabase functions deploy run-reminders --no-verify-jwt
```

## 3. Schedule every 15 minutes

Enable `pg_cron` and `pg_net` in Supabase, then use **Supabase Vault** for the
secret. Do not place the plaintext secret in a checked-in SQL file.

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists vault;

-- Run once and replace the value. Keep the returned secret id private.
select vault.create_secret('YOUR_LONG_RANDOM_SECRET', 'dramaconnect_cron_secret');

select cron.schedule(
  'run-reminders',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/run-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'dramaconnect_cron_secret'
      )
    ),
    body := '{}'::jsonb
  );
  $$
);
```

If the current Supabase dashboard offers a native scheduled Edge Function UI,
you may use it instead; configure the same POST method and header.

## 4. Test

Create a due reminder, then call:

```bash
curl -i -X POST \
  -H 'X-Cron-Secret: YOUR_LONG_RANDOM_SECRET' \
  https://YOUR_PROJECT_REF.supabase.co/functions/v1/run-reminders
```

A missing or incorrect secret must return `401`; a GET must return `405`. Check
`supabase functions logs run-reminders` and member Inbox rows after an authorized
POST.

## Troubleshooting

| Problem | Resolution |
| :-- | :-- |
| `401 Unauthorized` | Ensure the Edge Function secret and scheduler header are identical. |
| `500 CRON_SECRET is not configured` | Run `supabase secrets set CRON_SECRET=...`, then redeploy if necessary. |
| Nothing posts | Confirm the reminder is active and `next_run` is in the past. |
| Cron not firing | Inspect `cron.job`, `cron.job_run_details`, and the `net` responses. |
| Duplicate concern | Keep the fixed function; its conditional schedule claim is the concurrency guard. |
