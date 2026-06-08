# 🚀 Deployment Guide — DramaConnect Enterprise v5

This guide gives **clear, unambiguous, step‑by‑step** instructions to take
DramaConnect from these files to a **live, free URL**. Everything here uses
**free‑tier tools only**. Total time: ~15 minutes.

You will complete **4 stages**:
1. Set up the backend (Supabase) — free
2. Connect the app to your backend
3. Publish the site (choose ONE free host)
4. Create the first administrator

---

## ✅ Prerequisites (all free)

- A **GitHub** account → https://github.com/signup
- A **Supabase** account → https://supabase.com
- (Optional) A **Cloudflare** or **Vercel** account if you prefer them over
  GitHub Pages.

You do **not** need to install anything on your computer.

---

## STAGE 1 — Set Up the Backend (Supabase)

### 1.1 Create the project
1. Go to https://supabase.com and **Sign in**.
2. Click **New project**.
3. Fill in:
   - **Name:** `dramaconnect`
   - **Database Password:** choose a strong one and **save it somewhere safe**.
   - **Region:** pick the one closest to your members (e.g. `West EU` or
     `Africa` if available).
4. Click **Create new project** and wait ~2 minutes for it to provision.

### 1.2 Create all tables, security, and triggers (one click)
1. In the left sidebar, click **SQL Editor**.
2. Click **+ New query**.
3. Open the file **`database/schema.sql`** from this project, **copy ALL of it**,
   and paste it into the editor.
4. Click **Run** (or press `Ctrl/Cmd + Enter`).
5. You should see **"Success. No rows returned"**. This created all 10 tables,
   Row Level Security, the admin helper, and the auto‑profile trigger.

> ℹ️ The script is **safe to re‑run** — it uses `IF NOT EXISTS` / `CREATE OR
> REPLACE` / `DROP ... IF EXISTS`.

### 1.3 (Recommended) Email confirmation setting
- Go to **Authentication → Providers → Email**.
- For a quick internal launch you may turn **"Confirm email" OFF** so members can
  log in immediately after signing up. For a stricter setup, leave it ON
  (members must click the confirmation email first).

---

## STAGE 2 — Connect the App to Your Backend

1. In Supabase, go to **Project Settings** (gear icon) → **API**.
2. Copy these two values:
   - **Project URL** (e.g. `https://abcd1234.supabase.co`)
   - **anon public** key (a long token under *Project API keys*)
3. Open **`assets/js/config.js`** in this project and replace the placeholders:

   ```js
   const CONFIG = {
       SUPABASE_URL: 'https://YOUR-PROJECT.supabase.co',   // ← paste Project URL
       SUPABASE_KEY: 'YOUR-ANON-PUBLIC-KEY',               // ← paste anon key
       ...
   };
   ```

4. **Save** the file.

> 🔐 The **anon public** key is meant to be used in the browser — it is safe to
> publish. **Never** paste the `service_role` key here.

---

## STAGE 3 — Publish the Website (pick ONE)

> Whichever host you choose, the **`index.html` must be at the root** of what you
> upload. The `dramaconnect` folder already has it at the root.

### Option A — GitHub Pages (simplest, 100% free)

1. Create a new GitHub repository, e.g. `dramaconnect` (Public).
2. Upload **the contents of the `dramaconnect` folder** (not the folder itself)
   so that `index.html` sits at the repository root.
   - Easiest: on the repo page click **"Add file → Upload files"**, drag in
     everything, then **Commit**.
3. Go to **Settings → Pages**.
4. Under **"Build and deployment" → Source**, choose **"Deploy from a branch"**.
5. Branch: **`main`**, Folder: **`/ (root)`** → **Save**.
6. Wait ~1 minute. Your live URL appears at the top, e.g.
   `https://YOUR-USERNAME.github.io/dramaconnect/`.

> ✅ This project already uses **relative paths** and a path‑aware redirect, so it
> works correctly under the `/dramaconnect/` sub‑path on GitHub Pages.

### Option B — Cloudflare Pages (free, custom domains easy)

1. Go to https://dash.cloudflare.com → **Workers & Pages → Create → Pages**.
2. **Connect to Git** and select your repository (or use **Direct Upload** and
   drag the folder contents).
3. **Build settings:** Framework preset = **None**, Build command = *(leave
   blank)*, Build output directory = **`/`**.
4. Click **Save and Deploy**. You get a `*.pages.dev` URL.

### Option C — Vercel (free)

1. Go to https://vercel.com → **Add New → Project**.
2. Import your GitHub repository.
3. **Framework Preset:** *Other*. Leave build/output settings empty (it's static).
4. Click **Deploy**. You get a `*.vercel.app` URL.

---

## STAGE 4 — Create the First Administrator

The system is **secure by default**: new users are plain members. Promote
yourself once:

1. Open your **live URL** and click **"Request Access"** to **sign up**.
   (If email confirmation is ON, click the link in your inbox first.)
2. Go to **Supabase → Table Editor → `profiles`**.
3. Find your row, change the **`role`** column from `member` to **`admin`**, and
   save.
   - Or run this in the SQL Editor:
     ```sql
     UPDATE profiles SET role = 'admin' WHERE email = 'you@example.com';
     ```
4. **Refresh** the app. All management tools (add/edit/delete, Activity Log,
   role management) are now unlocked for you.

---

## 🧪 Post‑Deployment Checklist

- [ ] Landing page loads with the RCCG logo and no console errors.
- [ ] You can **sign up**, and a row appears in `profiles` automatically.
- [ ] After promoting to admin, the **Activity Log** link appears in the sidebar.
- [ ] You can add a **production**, a **finance** entry, and an **event**.
- [ ] Dashboard KPIs and charts update.
- [ ] **Reports** exports an Excel/PDF/CSV file.
- [ ] On a phone, the browser offers **"Add to Home Screen"** (PWA).

---

## 🛠️ Troubleshooting

| Symptom | Cause | Fix |
| :-- | :-- | :-- |
| `supabase is not defined` | Library script missing or wrong order | Every page already loads `@supabase/supabase-js@2` **before** `config.js`. Don't remove or reorder these tags. |
| `Failed to fetch` / nothing loads | Wrong URL/key in `config.js` | Re‑copy the **Project URL** and **anon** key exactly. |
| `infinite recursion detected in policy` | Old RLS policies | Re‑run `database/schema.sql` (it uses the recursion‑safe `is_admin()` helper). |
| Dashboard empty after signup | Missing profile trigger | Re‑run `database/schema.sql` — it creates `handle_new_user`. |
| **Registered user not in `profiles` table** (can't make them admin) | Trigger didn't run, OR signup happened before the trigger existed | Run **`database/fix_profiles.sql`** — it re‑installs a hardened trigger AND backfills profiles for users who already signed up. Edit the email line to promote your admin. |
| Can't see admin buttons | You're still a `member` | Complete **Stage 4** to set your role to `admin`. |
| Login email never arrives | Email confirmation ON + slow SMTP | Turn confirmation OFF for internal use (Stage 1.3) or check spam. |

---

## 🔄 Updating the App Later

1. Edit the files locally.
2. Re‑upload / push to your host (GitHub/Cloudflare/Vercel auto‑redeploy).
3. If you changed the database, re‑run the relevant part of `schema.sql`.
4. For PWA users, bump the `CACHE` name in `sw.js` (e.g. `dramaconnect-v6`) so
   browsers fetch the new files.
