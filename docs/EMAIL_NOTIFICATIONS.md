# 📧 Optional: Automated Approval Emails (Free)

The app **already** lets admins notify members for free (a WhatsApp/email popup
appears when you approve someone). This guide is **only** if you want the
**server to send approval emails automatically** — no admin action needed.

It uses two free tools:
- **Supabase Edge Functions** (free tier) — runs the code.
- **Resend** (https://resend.com, free tier, no card) — sends the email.

> ⚠️ This is optional and a bit technical. If you're happy with the in-app
> "Notify member" popup, you can skip this entire file.

---

## Step 1 — Get a free email provider key (Resend)
1. Sign up at https://resend.com (free).
2. Verify a sender address (or use their test sender `onboarding@resend.dev`).
3. **API Keys → Create API Key** → copy it (starts with `re_...`).

## Step 2 — Install the Supabase CLI (one time)
- Guide: https://supabase.com/docs/guides/cli
- Then log in and link your project:
  ```bash
  supabase login
  supabase link --project-ref YOUR_PROJECT_REF
  ```
  (Find `YOUR_PROJECT_REF` in Supabase → Project Settings → General.)

## Step 3 — Deploy the function
The function lives in `supabase/functions/notify-approval/index.ts` (included).
```bash
supabase functions deploy notify-approval --no-verify-jwt
supabase secrets set RESEND_API_KEY=re_your_key FROM_EMAIL=you@yourdomain.com
```

## Step 4 — Call it automatically when a member is approved
Pick **ONE** of these:

### Option A (simplest): call it from the app
In `pages/members.html`, inside the `approve()` function, after the member is
approved, add a `fetch` to your function URL:
```js
fetch('https://YOUR_PROJECT_REF.functions.supabase.co/notify-approval', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: m.email,
    full_name: m.full_name,
    app_url: location.origin + location.pathname.replace(/pages\/.*$/, 'index.html')
  })
}).catch(() => {});
```

### Option B (fully automatic): Database Webhook
1. Supabase → **Database → Webhooks → Create a new hook**.
2. Table: `profiles`, Events: **Update**.
3. Type: **HTTP Request** → URL = your function URL above.
4. (Advanced) add a condition so it only fires when `status` becomes `approved`.

## Step 5 — Test
Approve a member (or update a row's `status` to `approved`). Check the recipient's
inbox. Logs: `supabase functions logs notify-approval`.

---

## Troubleshooting
| Problem | Fix |
| :-- | :-- |
| No email arrives | Check `supabase functions logs notify-approval`; verify `RESEND_API_KEY` and that the sender is verified in Resend. |
| 401/JWT error | Re-deploy with `--no-verify-jwt`. |
| CORS error from app | The function already returns `Access-Control-Allow-Origin: *`. |
| Don't want to code | Just use the built-in **Notify member** popup — no setup needed. |
