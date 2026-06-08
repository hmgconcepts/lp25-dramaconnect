# 🎂 Automatic Birthday Greetings (Free)

DramaConnect can **automatically celebrate members on their birthday**. Members
enter only their **birth month + day** (no year, for privacy) on their Profile.

There are two layers — use either or both:

1. **In-app (works immediately, no setup):** the **Birthdays** page shows today's
   celebrants and the month list. Admins can one-tap **WhatsApp** or **Email** a
   greeting. (WhatsApp can't be auto-sent for free — Meta charges for that — so
   one-tap is the free way.)
2. **Fully automatic (optional, free):** the `birthday-bot` Edge Function runs
   every morning and automatically posts a greeting to each celebrant's
   **in-platform Inbox**, posts a **department-wide** celebration, and (if you
   add a free Resend key) **emails** them. It marks each as done so it never
   double-sends.

---

## Deploy the automatic bot

### Step 1 — CLI (one time)
```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

### Step 2 — Deploy + secrets
```bash
supabase functions deploy birthday-bot --no-verify-jwt
supabase secrets set PROJECT_URL=https://YOUR_PROJECT_REF.supabase.co \
                     SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
# OPTIONAL e-mail delivery (free Resend account):
supabase secrets set RESEND_API_KEY=re_xxx FROM_EMAIL=you@yourdomain.com
```

### Step 3 — Schedule it daily (e.g. 06:00)
In Supabase → SQL Editor:
```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'birthday-bot',
  '0 6 * * *',                         -- every day at 06:00 (server time)
  $$
    select net.http_post(
      url := 'https://YOUR_PROJECT_REF.functions.supabase.co/birthday-bot',
      headers := '{"Content-Type":"application/json"}'::jsonb
    );
  $$
);
```

### Step 4 — Test now
```bash
curl -X POST https://YOUR_PROJECT_REF.functions.supabase.co/birthday-bot
```
Set a test member's birth month/day to today, run the curl, then check their
Inbox (and email if configured). Logs: `supabase functions logs birthday-bot`.

---

## How members provide their birthday
**My Profile → Birthday — Month / Day.** Only month and day are stored; there is
no birth-year field.

## Troubleshooting
| Problem | Fix |
| :-- | :-- |
| No greetings | Confirm a member's `birth_month`/`birth_day` equal today; check function logs. |
| Sends twice | It shouldn't — `bday_last_sent` guards per day. Ensure the column exists (re-run `repair_and_upgrade.sql`). |
| No emails | Set `RESEND_API_KEY` + verified `FROM_EMAIL`; emails are optional. |
| WhatsApp not automatic | Correct — use the one-tap WhatsApp buttons on the Birthdays page (free). |
