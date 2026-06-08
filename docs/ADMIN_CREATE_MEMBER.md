# 👤 Admin: Create Member Logins (Free)

This lets an **admin create a full login account** for someone who hasn't signed
up, and hand them their email + password. Creating a real login requires the
Supabase **service_role** key, which must NEVER be in the browser — so this runs
inside a secure **Supabase Edge Function** (free tier).

> Without this function deployed, the "Add Member & Create Login" button still
> works as far as validating input, but account creation needs the function.
> Members can always self–register and be approved instead.

---

## Step 1 — Install & link the Supabase CLI (one time)
```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```
`YOUR_PROJECT_REF` is in Supabase → Project Settings → General.

## Step 2 — Deploy the function
The function is included at `supabase/functions/admin-create-member/index.ts`.
```bash
supabase functions deploy admin-create-member --no-verify-jwt
supabase secrets set PROJECT_URL=https://YOUR_PROJECT_REF.supabase.co \
                     SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
```
> Get the **service_role** key from Project Settings → API. Keep it secret — it
> is only ever used inside this function, never in the website.

## Step 3 — Use it
1. Sign in as an **admin** → **Members** page.
2. Fill **"Add Member & Create Login"** (name, email; password optional — blank
   auto‑generates a strong one; tick *Make admin* if needed).
3. Click **Create Account**. A popup shows the **email + password** with one‑tap
   **Copy / WhatsApp / Email** so you can deliver the credentials.
4. The member signs in and can change their password under **My Profile**.

---

## How it stays secure
- The function first verifies the **caller's** session token belongs to an
  **admin** (checks `profiles.role`). Non‑admins are rejected.
- It then uses the service_role key (server‑side only) to create the auth user,
  auto‑confirm the email, and upsert an **approved** profile.

## Troubleshooting
| Problem | Fix |
| :-- | :-- |
| "function is not deployed" toast | Complete Steps 1–2. |
| 403 Admin privileges required | You're not signed in as an admin. |
| 400 email already registered | That email already has an account. |
| Want them as admin | Tick **Make admin**, or promote later on the Members page. |
