# ⏰ Optional: Fully-Automatic Scheduled Reminders (Free)

The **Reminders** page already works manually: when a reminder is due, an admin
clicks **"Send now"** to post it to everyone's Inbox. This guide makes that
**fully automatic** using **free** Supabase features — no admin action, no paid
cron, no AI API.

It uses:
- **Supabase Edge Functions** (free tier) — runs `run-reminders`.
- **Supabase Cron** (`pg_cron` + `pg_net`, free) — calls it on a schedule.

> Optional. If you're happy clicking "Send now", skip this file.

---

## Step 1 — Install & link the Supabase CLI (one time)
```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```
Find `YOUR_PROJECT_REF` in Supabase → Project Settings → General.

## Step 2 — Deploy the function
The function is included at `supabase/functions/run-reminders/index.ts`.
```bash
supabase functions deploy run-reminders --no-verify-jwt
supabase secrets set PROJECT_URL=https://YOUR_PROJECT_REF.supabase.co \
                     SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
```
> The **service_role** key is used ONLY inside the server function (never in the
> browser). Get it from Project Settings → API → service_role (keep it secret).

## Step 3 — Schedule it (every 15 minutes)
In Supabase → **SQL Editor**, enable the extensions and add the cron job:
```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'run-reminders',
  '*/15 * * * *',
  $$
    select net.http_post(
      url := 'https://YOUR_PROJECT_REF.functions.supabase.co/run-reminders',
      headers := '{"Content-Type":"application/json"}'::jsonb
    );
  $$
);
```
That's it — every 15 minutes the function posts any **due** reminders to the
in-platform Inbox and advances/deactivates them automatically.

## Step 4 — Test
1. On the Reminders page, create a reminder with **next run** a minute or two ago.
2. Wait for the next cron tick (≤15 min) — or run the function once manually:
   ```bash
   curl -X POST https://YOUR_PROJECT_REF.functions.supabase.co/run-reminders
   ```
3. Check any member's **Inbox** for the reminder. Logs:
   `supabase functions logs run-reminders`.

---

## Troubleshooting
| Problem | Fix |
| :-- | :-- |
| Nothing posts | Confirm the reminder is `active` and `next_run` is in the past. |
| 500 / missing env | Re-run the `supabase secrets set …` command. |
| Cron not firing | Ensure `pg_cron`/`pg_net` are enabled; check `select * from cron.job;`. |
| Want a different cadence | Change `'*/15 * * * *'` (e.g. `'0 * * * *'` = hourly). |
