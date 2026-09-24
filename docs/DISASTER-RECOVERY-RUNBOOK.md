# 🚑 Disaster Recovery Runbook

**Print this page. Keep it somewhere that does not depend on the site working.**

> This is the document you reach for at the worst possible moment: the database is gone, the site is broken, and people are
> asking when it will be back. It is therefore written as a **checklist with no decisions to make and no steps to
> improvise**. Work top to bottom. Tick every box.

**Estimated time: 30–45 minutes. Every tool is free. No developer required.**

---

## The one decision you must make first

```
        Is the Supabase project PAUSED, or is it GONE?
                          │
        ┌─────────────────┴──────────────────┐
        │                                    │
     PAUSED                                GONE
   (it still exists,                  (deleted, or you
    just inactive)                     cannot sign in)
        │                                    │
        ▼                                    ▼
   Use ROUTE A                          Use ROUTE B
   Restore it.                          Rebuild it.
   5 minutes.                           30–45 minutes.
   No data touched.                     Data restored from
                                        your last backup.
```

**How to tell:** sign in to **supabase.com** and open your organisation.
Can you still see the project in the list, even if it says *Paused* or *Inactive*? → **Route A**.
Is it absent, or does clicking it give a permissions error? → **Route B**.

> 🛑 **Never use Route B on a paused project.** Route B rebuilds from your last backup, so anything newer is lost. If the
> project merely paused, Route A restores it with **every single record intact**.

---

## ROUTE A — The project is paused (5 minutes)

**Use when:** you received *"Your project has been paused due to inactivity"*, or the site reports connection errors but
the project still exists.

### A1 — Restore the project

1. Go to **supabase.com** and sign in.
2. Open the organisation that owns the project.
3. Click the paused project.
4. Click the **Restore project** button (or **Resume** / **Unpause**, depending on what is shown).
5. Wait 2–5 minutes. The status changes to **Active**.

### A2 — Confirm it is alive

6. In the project, open **SQL Editor → New query**.
7. Paste:

```sql
SELECT COUNT(*) AS members FROM public.profiles;
```

8. Click **Run**. You get a number. **This is your proof that no data was lost.**

### A3 — Send one heartbeat

9. Open your DramaConnect site → **Platform Health**.
10. Click **💓 Test heartbeat**.
11. Confirm `ok: true`.

### A4 — Stop this happening again

12. Open `docs/SUPABASE_FREE_TIER_PROTECTION.md`.
13. Go to the **tick-matrix** at the end.
14. Enable **at least two independent external heartbeat sources** — for example a GitHub Actions workflow *and* a Vercel
    Cron job.
15. Re-read §"Layer 11" — a **single** source is a single point of failure, and the platform will tell you so.

### A5 — Verify

- [ ] Site loads and you can sign in
- [ ] Member count matches what you expect
- [ ] **Platform Health** shows every layer healthy
- [ ] No *"Single point of failure"* warning

**✅ Route A complete. You are done — stop here.**

---

## ROUTE B — The project is gone (30–45 minutes)

**Use when:** the project was deleted, the organisation is inaccessible, or Supabase support has confirmed it cannot be
restored.

### Before you start — the three things you need

- [ ] A Google Drive backup (or a downloaded archive file, or a GitHub Actions dump)
- [ ] Your **Google OAuth Client ID** (ends in `.apps.googleusercontent.com`)
- [ ] The ability to edit one file and push it to GitHub

> 💡 **Everything you need to rebuild is in Google Drive.** The OAuth Client ID lives in your Google Cloud Console — it
> does **not** live in the database, so it survives database loss.

---

### Step 1 — Create the replacement project (5 min)

1. Go to **supabase.com** → **New project**.
2. Organisation: any. Region: **choose one close to your ministry**.
3. Set a **strong database password** → **store it in a password manager immediately**.
4. Click **Create new project** and wait 2–3 minutes.

- [ ] Project shows **Active**

5. **Project Settings → API** → copy:
   - the **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - the **anon public** key

---

### Step 2 — Install the schema (5 min)

6. Open **SQL Editor → New query** in the new project.
7. Open the file `database/complete-schema.sql` from your repository.
8. Copy **all** of it (Ctrl+A, Ctrl+C) and paste into the SQL editor.
9. Click **Run**.
10. Wait 1–3 minutes.

- [ ] Output ends with **`installed successfully ✅`**

> The script is **cumulative and idempotent** — safe to re-run. If it is interrupted or errors partway, simply run it
> again from the top.

- [ ] **Verification** — run this and confirm 25 tables:

```sql
SELECT COUNT(*) FROM information_schema.tables
WHERE table_schema='public' AND table_type='BASE TABLE';
```

---

### Step 3 — Point the site at the new database (3 min)

11. In your repository, open `assets/js/config.js`.
12. Replace **only these two values**:

```js
SUPABASE_URL: 'https://YOUR-NEW-PROJECT.supabase.co',
SUPABASE_KEY: 'YOUR-NEW-ANON-KEY',
```

13. Commit and push. Vercel redeploys automatically — wait about 2 minutes.

- [ ] Site loads (it will look empty — that is correct)

---

### Step 4 — Recreate your administrator account (5 min)

14. Open the site → **Login → Request access**.
15. Register with **the same email address you used before**.
16. In Supabase: **Table Editor → profiles** → find your row.
17. Set:
    - `role` → `super_admin`
    - `status` → `approved`
    - `must_change_password` → `false`
18. Sign out and sign back in.

- [ ] You are signed in as a super administrator

---

### Step 5 — Reconnect Google Drive (2 min)

19. **Admin Data → Drive** tab.
20. Paste your **existing** Google OAuth Client ID.
21. Click **Save drive policy**.
22. Click **Disconnect**, then **☁ Connect Google Drive**.
23. Click **☁ Backup now** — **this creates a safety net before you restore anything.**

- [ ] The Drive pill reads **Connected**
- [ ] A fresh backup exists

> 💡 **Why the same Client ID still works:** OAuth credentials are tied to your **website URL**, not your database.
> You changed the database, not the site.

---

### Step 6 — Restore your data (10 min)

24. **Admin Data → Drive → 📂 List backups**.
25. Find the **newest** backup. Click **Verify** first.
26. Confirm the seal is valid, then click **🚑 Recover to new project**.
27. Type `RESTORE` to confirm.
28. Wait. A large ministry takes several minutes.
29. Read the report:

```
Disaster recovery finished: 1284 row(s) restored,
0 failed, 143 member link(s) preserved for re-linking.
```

30. **Download the re-link manifest.** Save it next to the backup.

- [ ] Rows restored > 0
- [ ] Re-link manifest downloaded

**What just happened:**

- ✅ every attendance record, casting decision, task, poll, RSVP, inbox row and production was **kept**
- ✅ only member links were deferred, and **each one was written to a ledger**
- ✅ the SHA-256 seal was verified **before the first write** — a corrupt archive cannot start
- ✅ rows were retried individually, so one bad row cannot sink the other 1,283

---

### Step 7 — Restore photos and videos (5 min, if you use the Gallery)

Database archives contain **metadata only**, not the image files themselves.

- **If you have a GitHub Actions storage dump** → see `docs/BACKUP_AND_RECOVERY.md`, storage section.
- **If not** → the original files are unrecoverable. Clear the gallery rows and re-upload.

- [ ] Gallery is either restored or deliberately cleared

---

### Step 8 — Re-onboard people (10 min)

31. Broadcast the site address to your ministry.
32. Ask everyone to register.
33. **Approvals** → approve each person.

> ⚠️ **Ask people to use the same email address they used before.** The email address is what lets DramaConnect stitch
> their history back to them in Step 9.

- [ ] Members are registering and being approved

---

### Step 9 — Re-link member histories (5 min)

⭐ **This is the step that makes a DramaConnect recovery better than an ordinary restore.**

After a normal restore, every attendance record would say "someone attended" but not **who** — because login accounts
cannot be copied. DramaConnect instead records every deferred link in a ledger, then rebuilds them by email.

34. **Admin Data → Local** tab → **⬆ Re-link manifest**.
35. Select the JSON file you downloaded in Step 6.
36. Review the report:

```
Re-link finished: 847 link(s) rebuilt, 23 still unmatched.
  attendance: 412 rebuilt
  cast_list: 61 rebuilt
  tasks: 88 rebuilt
  …
```

37. Unmatched links belong to people who have **not registered yet**. Once they do, **upload the same manifest again** —
    it is safe to re-run as many times as you like.

- [ ] Re-link run at least once
- [ ] Unmatched count reviewed

**Why this is safe:** matching is by exact email only — nothing is guessed. Only the specific deferred columns are
touched; never dates, statuses or content.

---

### Step 10 — Re-arm every safeguard (10 min) — DO NOT SKIP

> 🛑 **A rebuilt site with no heartbeat will simply pause again.** This step is not optional.

Work through `docs/SUPABASE_FREE_TIER_PROTECTION.md` and restore **each** layer:

- [ ] **Layer 3** — GitHub Actions heartbeat secrets (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) point at the **new** project
- [ ] **Layer 5** — Vercel Cron job enabled
- [ ] **Layer 6** — Google Apps Script heartbeat updated
- [ ] **Layer 7** — cron-job.org monitor updated
- [ ] **Layer 8** — UptimeRobot monitor updated
- [ ] **Layer 10** — Auto-restore watchdog secrets (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`) updated
- [ ] **Layer 12** — Weekly dump `SUPABASE_DB_URL` updated
- [ ] **Platform Health** → **💓 Test heartbeat** → `ok: true`

---

### Step 11 — Final verification (5 min)

- [ ] **Platform Health** — every tile green, and **no** "Single point of failure" warning
- [ ] Member count matches expectations
- [ ] A recent production has its full cast and attendance
- [ ] Tasks and polls show their original assignees and voters
- [ ] **☁ Backup now** → one fresh backup of the rebuilt site exists
- [ ] The re-link manifest is saved somewhere safe (you may need it again)

---

## After the incident — one page for later

Fill this in once things are calm. It makes the next incident faster.

| Question | Answer |
|---|---|
| What caused it? | |
| How old was the newest backup? | |
| How much data was lost? | |
| Which safeguard failed? | |
| What will you change? | |
| How long did recovery take? | |

**Then do the two things that actually prevent a repeat:**

1. Enable **at least two independent external heartbeat sources** (the rule of two).
2. Set a recurring calendar reminder to **verify a backup once a quarter** — an unverified backup is not a backup.

---

## Quick reference card

```
╔══════════════════════════════════════════════════════════════════╗
║  DRAMA CONNECT — DISASTER RECOVERY                               ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  PAUSED?  → Restore at supabase.com, then 💓 Test heartbeat       ║
║  GONE?    → 11 steps, 30–45 min, all free                        ║
║                                                                  ║
║  1  New Supabase project                                    5 min║
║  2  Run database/complete-schema.sql                        5 min║
║  3  Update assets/js/config.js + push                       3 min║
║  4  Register, set role = super_admin                        5 min║
║  5  Reconnect Drive + take a backup FIRST                   2 min║
║  6  🚑 Recover to new project + save manifest              10 min║
║  7  Gallery files (re-upload if no dump)                    5 min║
║  8  Everyone registers; approve them                       10 min║
║  9  Upload re-link manifest (repeat as people join)         5 min║
║ 10  Re-arm EVERY anti-pause layer                          10 min║
║ 11  Verify: all green, no single point of failure           5 min║
║                                                                  ║
╠══════════════════════════════════════════════════════════════════╣
║  ALWAYS                                                          ║
║   • Back up BEFORE restoring                                     ║
║   • Merge/upsert for routine recovery                            ║
║   • Disaster-recovery mode for a fresh database                  ║
║   • Never use "Legacy degraded" — it discards whole tables       ║
╠══════════════════════════════════════════════════════════════════╣
║  CONTACTS                                                        ║
║   Supabase support: supabase.com/dashboard/support              ║
║   Vercel support:   vercel.com/support                          ║
╚══════════════════════════════════════════════════════════════════╝
```

---

## Related documents

| Document | When you need it |
|---|---|
| `docs/GOOGLE-DRIVE-SYNC-GUIDE.md` | Setting up backups in the first place |
| `docs/SUPABASE_FREE_TIER_PROTECTION.md` | Preventing the pause that causes all this |
| `docs/BACKUP_AND_RECOVERY.md` | Backup strategy and restore modes in depth |
| `docs/RESILIENCE_RUNBOOK.md` | Day-to-day health monitoring |

---

*Part of the DramaConnect v15.0 resilience suite. Review this document twice a year.*
