# 🎂 Optional Automatic Birthday Greetings

Members store only birth month and day. The Birthdays page always supports
manual WhatsApp/email greetings. The optional `birthday-bot` Edge Function posts
personal and department Inbox greetings and can also send email through Resend.

## Security and duplicate protection

The function uses the service role and therefore accepts **POST only** with an
`X-Cron-Secret` matching `CRON_SECRET`. It conditionally claims each member/day
before sending, so overlapping scheduler runs do not duplicate a greeting. If
Inbox delivery fails, it restores the previous claim. Only `approved` profiles
are targeted.

## 1. Set secrets

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set CRON_SECRET='YOUR_LONG_RANDOM_SECRET'

# Optional email delivery:
supabase secrets set RESEND_API_KEY='re_xxx' FROM_EMAIL='you@yourdomain.com'
```

Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to its deployed
functions. Never store the service-role value in frontend code or the repository.

## 2. Deploy

The scheduler has no user JWT, so disable only the gateway JWT check. The
function's own strong-secret check remains mandatory:

```bash
supabase functions deploy birthday-bot --no-verify-jwt
```

## 3. Schedule daily

Use Supabase Vault rather than embedding the plaintext cron secret in stored SQL.
If you already created `dramaconnect_cron_secret` while configuring reminders,
reuse it and skip `vault.create_secret`.

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists vault;

select vault.create_secret('YOUR_LONG_RANDOM_SECRET', 'dramaconnect_cron_secret');

select cron.schedule(
  'birthday-bot',
  '0 6 * * *',
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/birthday-bot',
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

The function evaluates birthdays in **UTC**. If a Lagos-morning run must always
reflect a particular local date around midnight, choose an appropriate UTC cron
time or adapt the function to a named timezone.

## 4. Test

```bash
curl -i -X POST \
  -H 'X-Cron-Secret: YOUR_LONG_RANDOM_SECRET' \
  https://YOUR_PROJECT_REF.supabase.co/functions/v1/birthday-bot
```

A wrong/missing secret must return `401`; GET must return `405`. Check the Inbox,
`bday_last_sent`, optional email, and function logs.

## Troubleshooting

| Problem | Resolution |
| :-- | :-- |
| No greetings | Confirm the profile is approved and its birth month/day match the function's current UTC date. |
| `401 Unauthorized` | Make the scheduler header match the Edge Function `CRON_SECRET`. |
| `500 CRON_SECRET is not configured` | Set the secret in Supabase and retry. |
| No email | Verify `RESEND_API_KEY`, `FROM_EMAIL`, and the sender domain; Inbox delivery works without email. |
| WhatsApp not automatic | Expected: use the one-tap WhatsApp action; the bot does not call the WhatsApp API. |
