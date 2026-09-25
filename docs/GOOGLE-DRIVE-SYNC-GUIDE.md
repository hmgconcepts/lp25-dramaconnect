# Google Drive Backup & Sync — Exact Setup Guide

**DramaConnect · verified archives, automatic off-site backup, and one-click disaster recovery**

> **What you get when you finish this guide:** every production, member record, attendance history, casting decision, task,
> poll, event and announcement copied to the ministry's own Google Drive on a schedule you choose — sealed with a SHA-256
> checksum, restorable by one administrator in a few minutes, without paying for anything.

This guide is written to be followed **literally, top to bottom, without guessing**. Every step states exactly where to
click, exactly what to type, and exactly what you should see when it worked. Where a step can fail, the failure is listed
with its fix.

**Total time: about 20 minutes, once.** Nothing in this guide costs money.

---

## Table of contents

1. [What you are setting up (1-minute overview)](#1-what-you-are-setting-up-1-minute-overview)
2. [Before you start — the two things you need](#before-you-start--the-two-things-you-need)
3. [PART A — Create a Google Cloud project](#part-a--create-a-google-cloud-project)
4. [PART B — Enable the Google Drive API](#part-b--enable-the-google-drive-api)
5. [PART C — Configure the consent screen and add test users](#part-c--configure-the-consent-screen-and-add-test-users)
6. [PART D — Create the OAuth Client ID (Web application)](#part-d--create-the-oauth-client-id-web-application)
7. [PART E — Paste the Client ID into DramaConnect](#part-e--paste-the-client-id-into-dramaconnect)
8. [PART F — Run your first backup](#part-f--run-your-first-backup-this-authorises-google-once-per-browser)
9. [Set the backup policy](#set-the-backup-policy)
10. [How "automatic" works on a 100% free stack](#how-automatic-works-on-a-100-free-stack-honest-explanation)
11. [Restoring — four routes, choose by situation](#restoring--four-routes-choose-by-situation)
12. [🚑 Disaster recovery onto a fresh database](#-disaster-recovery-onto-a-fresh-database)
13. [Re-linking members after a disaster recovery](#re-linking-members-after-a-disaster-recovery)
14. [Microsoft OneDrive route (free alternative)](#microsoft-onedrive-route-free-alternative)
15. [GitHub Actions route — server-side weekly SQL dump](#github-actions-route--server-side-weekly-sql-dump)
16. [If something goes wrong — exact errors and exact fixes](#if-something-goes-wrong--exact-errors-and-exact-fixes)
17. [Security and privacy — what Google can and cannot see](#security-and-privacy--what-google-can-and-cannot-see)
18. [Layered safety summary](#layered-safety-summary)
19. [Administrator quick reference](#administrator-quick-reference)

---

## 1. What you are setting up (1-minute overview)

```
   DramaConnect (in an administrator's browser)
        │
        │  1. builds a verified archive of all 31 tables
        │  2. seals it with a SHA-256 checksum
        │  3. uploads it to Google Drive
        │  4. downloads it back and re-verifies the checksum
        │  5. deletes backups beyond your retention limit
        ▼
   Google Drive → 📁 "DramaConnect Backups"
        │
        ├── dramaconnect-backup-2026-09-23T14-05-00-000Z-1284rows.json
        ├── dramaconnect-backup-2026-09-16T14-05-00-000Z-1271rows.json
        └── dramaconnect-backup-2026-09-09T14-05-00-000Z-1250rows.json
```

**Three things make this different from an ordinary "export a file" feature:**

| Property | What it means | Why it matters |
|---|---|---|
| **Verified before upload** | The archive is sealed with a SHA-256 digest before it leaves the browser | A corrupt backup is caught immediately, not during an emergency |
| **Verified after upload** | The file is downloaded back and its checksum re-checked | Proves the copy on Google's servers is byte-for-byte intact |
| **Verified before restore** | A restore **refuses to start** unless the checksum matches | A damaged archive can never overwrite good data |

> **The rule this system never breaks:** *a restore will not write a single row until the archive's SHA-256 seal has been
> verified.* If the seal fails, you get `ARCHIVE_INTEGRITY_FAILED` and nothing is changed.

### What is included

All **25** DramaConnect tables: productions, scenes, scripts, members, attendance, cast lists, rehearsals, tasks, polls,
events, announcements, gallery metadata, messages, settings, licence state, and more.

### What is not included

| Excluded | Why | How to cover it |
|---|---|---|
| Passwords and login sessions | Stored by Supabase Auth, not DramaConnect | People re-register after a rebuild (step 7 of the wizard) |
| Uploaded photos and videos | Stored in Supabase Storage, not the database | Use the **Storage Manager** page, or the weekly GitHub dump (see §15) |
| Heartbeat and backup-run history | Operational bookkeeping, rebuilt automatically | No action needed |

---

## Before you start — the two things you need

1. **A Google account** — ideally the ministry's own account (`drama@yourchurch.org`), not a personal one. Whoever owns
   this account owns the backups.
2. **Administrator access to DramaConnect** — you must be a `super_admin`, `admin`, `proprietor` or `principal`.
   Ordinary members cannot configure backups.

> 💡 **Use the ministry's Google account.** If one person's personal Gmail owns the backups and that person leaves, the
> backups leave with them.

---

## PART A — Create a Google Cloud project

A "project" is just Google's container for tracking which applications call its APIs. You need one.

1. Sign in to the Google account from the previous section.
2. Go to **https://console.cloud.google.com/**
3. Accept the Terms of Service if prompted (once per account, ever).
4. Click the **project dropdown** at the top of the page (it may say *"Select a project"* or *"My First Project"*).
5. In the dialog that opens, click **NEW PROJECT** (top-right).
6. Fill in:

| Field | Value |
|---|---|
| **Project name** | `DramaConnect Backup` |
| **Location** | Leave as *No organisation* |

7. Click **CREATE**.
8. Wait about 20 seconds. A notification appears in the bell icon 🔔 when it is ready.
9. Click **SELECT PROJECT** in that notification — **this step matters**. If you skip it, you will configure the wrong
   project and the Client ID will not work.

**✅ You are done with Part A when:** the project dropdown at the top reads **"DramaConnect Backup"**.

### ❌ If it fails

| Error | Fix |
|---|---|
| *"You have exceeded the number of projects"* | Google allows ~12 free projects. Delete an unused one at **console.cloud.google.com → Menu → IAM & Admin → Manage Resources** |
| The new project does not appear | Refresh the page. Ensure you clicked **SELECT PROJECT** in the notification |

---

## PART B — Enable the Google Drive API

By default a new project cannot use *any* Google API. You switch on the Drive API specifically.

1. Confirm the project dropdown still reads **"DramaConnect Backup"**.
2. Open the **hamburger menu** ☰ (top-left) → **APIs & Services** → **Library**.
   *Shortcut:* go directly to **https://console.cloud.google.com/apis/library**
3. In the search box, type `Google Drive API`.
4. Click **Google Drive API** in the results (published by Google — the blue icon).
5. Click the blue **ENABLE** button.
6. Wait about 30 seconds for it to provision.

**✅ You are done with Part B when:** the page shows a green **"API enabled"** badge with a **MANAGE** button.

### ❌ If it fails

| Error | Fix |
|---|---|
| *"API is not enabled"* later, in DramaConnect | You enabled it in a **different project**. Repeat Part B in the right one |
| The Enable button is missing | You are already in the API's management page — scroll up; it is already enabled |
| *"Requires billing"* | **The Drive API is free** up to generous quotas. This message means you enabled a *different*, paid API. Search for and enable **Google Drive API** specifically |

> ⚠️ **Common mistake:** enabling "Google Drive Activity API" or "Google Picker API" instead. The one you want is
> exactly **"Google Drive API"**.

---

## PART C — Configure the consent screen and add test users

This is the screen Google shows when you authorise DramaConnect. It also controls **who is allowed to authorise**.

1. Go to **https://console.cloud.google.com/apis/credentials/consent**
2. Choose **External** → click **CREATE**.
   *(If you use Google Workspace for the ministry, **Internal** also works and skips the test-user step — pick Internal if
   it is offered and you want only church staff to authorise.)*
3. Fill in the **OAuth consent screen** form:

| Field | Value |
|---|---|
| **App name** | `DramaConnect` |
| **User support email** | your email (pick yourself from the dropdown) |
| **App logo** | optional — skip |
| **Application home page** | your live site URL, e.g. `https://your-site.vercel.app` |
| **Application privacy policy link** | optional — skip |
| **Application terms of service link** | optional — skip |
| **Authorised domains** | click **ADD DOMAIN** and enter `vercel.app` (just the domain, no `https://`) |
| **Developer contact information** | your email |

4. Click **SAVE AND CONTINUE**.

### Scopes page

5. Click **ADD OR REMOVE SCOPES**.
6. In the filter box, type `drive.file`.
7. Tick the box next to **`.../auth/drive.file`** — its full description is:
   *"See, edit, create, and delete only the specific Google Drive files you use with this app"*
8. Click **UPDATE** at the bottom.
9. Click **SAVE AND CONTINUE**.

> 🔒 **Why this scope specifically?** `drive.file` is the **least-privilege** Drive scope that exists. It lets DramaConnect
> touch *only the files it created itself*. It cannot read your sermons, spreadsheets, photos, or any other Drive content.
> Never grant the broader `drive` scope — DramaConnect does not need it and does not ask for it.

### Test users page — do not skip this

10. Click **ADD USERS**.
11. Enter the email address of **every** administrator who will run backups. Add your own address at minimum.
12. Click **ADD**.
13. Click **SAVE AND CONTINUE**.
14. On the summary page, click **BACK TO DASHBOARD**.

**✅ You are done with Part C when:** the consent screen dashboard shows **Publishing status: Testing** and your email is
listed under **Test users**.

### ❌ If it fails

| Error | Fix |
|---|---|
| *"Access blocked: This app has not completed Google verification"* | You are signing in with an email **not** on the test-user list. Add it in Part C, step 11, then try again |
| *"The OAuth client was not found"* | Your Client ID belongs to a different project. Redo Parts A–D in one project |
| *"Invalid domain"* | Remove `https://` and any trailing path from Authorised domains. Use `vercel.app` |
| *"Authorisation error 403: access_denied"* | The signed-in account is not a test user, **or** the Drive API is not enabled in this project |

> 💡 **"Testing" status is fine permanently.** Verification is only required for apps with external users beyond 100. A
> single ministry never needs it.

---

## PART D — Create the OAuth Client ID (Web application)

This produces the long ID DramaConnect uses to request authorisation.

1. Go to **https://console.cloud.google.com/apis/credentials**
2. Click **+ CREATE CREDENTIALS** (top of the page) → **OAuth client ID**.
3. For **Application type**, select **Web application**.
4. **Name:** `DramaConnect Web Client`.
5. Under **Authorised JavaScript origins**, click **+ ADD URI** and add **each** URL where DramaConnect runs:

```
https://your-site.vercel.app
http://localhost:8000
```

> 💡 Include `http://localhost:8000` only if you test locally. Google is strict — the origin must match exactly, with no
> trailing slash.

6. Under **Authorised redirect URIs**, add **the same URLs**:

```
https://your-site.vercel.app
http://localhost:8000
```

7. Click **CREATE**.
8. A dialog shows your credentials. **Copy the Client ID** — it looks like:

```
123456789012-abcdefghijklmnopqrstuvwxyz123456.apps.googleusercontent.com
```

9. Click **OK**. (You can always retrieve it later from the Credentials page.)

> 🔒 **The Client ID is not a secret.** It ships in public JavaScript. The **Client Secret** is a secret — DramaConnect
> never needs it. If a guide ever asks you to paste a Client Secret into a browser application, that guide is wrong.

**✅ You are done with Part D when:** you have the Client ID ending in `.apps.googleusercontent.com` copied to your
clipboard.

---

## PART E — Paste the Client ID into DramaConnect

1. Sign in to DramaConnect as an administrator.
2. Open **Admin Data** (sidebar) → click the **Drive** tab.
3. Find the **Drive backup policy** card.
4. Paste the Client ID into **Google OAuth Client ID**.
5. Click **Save drive policy**.
6. You should see: *"Drive policy saved. Reconnect after changing client ID."*

> ⚠️ **Changing the Client ID invalidates existing authorisations.** After saving a new Client ID, click
> **Disconnect**, then **Connect** again.

---

## PART F — Run your first backup (this authorises Google, once per browser)

1. Still on the **Drive** tab, click **☁ Connect Google Drive**.
2. A Google popup opens: *"Choose an account"* → select the ministry account.
3. **Sign in with an account on the test-user list** (Part C, step 11).
4. If Google warns *"Google hasn't verified this app"*:
   - Click **Advanced** (small grey link, bottom-left).
   - Click **Go to DramaConnect (unsafe)**.
   - This is **your own** app, configured in Part C. It is expected and safe.
5. On the consent screen, tick the box **"See, edit, create, and delete only the specific Google Drive files you use with
   this app"**.
6. Click **Continue**.
7. The popup closes. The **Drive** pill changes to **Connected**.
8. Click **☁ Backup now**.
9. Wait. Progress appears (*"Reading productions…"*, *"Preparing…"*). A large ministry takes 1–3 minutes.
10. On success you see:

```
Drive backup verified by read-back: a3f5c1… (SHA-256)
```

11. Open **drive.google.com** → **My Drive** → **DramaConnect Backups**. Your first archive is there.

**✅ Setup is complete.** Backups now run automatically whenever a privileged administrator has the site open.

### ❌ If it fails

| Error | Cause | Fix |
|---|---|---|
| Popup blocked by the browser | Browser blocked it | Click the blocked-popup icon in the address bar → always allow popups from your site → retry |
| *"Access blocked: authorisation error"* | Email not a test user | Add it in Part C, step 11 |
| *"redirect_uri_mismatch"* | The site URL is not in Authorised JavaScript origins | Part D, step 5 — add the **exact** URL, no trailing slash |
| *"The OAuth client was not found"* | Client ID from a different project, or a typo | Re-copy from **APIs & Services → Credentials** |
| *"idpiframe_initialization_failed"* | Third-party cookies blocked | Allow third-party cookies for your site, or use Chrome/Edge incognito |
| *"Missing Google OAuth Client ID"* | Saved without pasting | Redo Part E |
| Backup uploads but verification fails | Rare — transient network corruption | Run the backup again |

---

## Set the backup policy

On the **Drive** tab, in **Drive backup policy**:

| Setting | What it does | Recommended |
|---|---|---|
| **Google OAuth Client ID** | The ID from Part D | — |
| **Drive folder name** | The Drive folder to use | `DramaConnect Backups` |
| **Enable scheduled reminders** | Turns on due-date tracking | ✅ On |
| **Backup interval (days)** | How often a backup is *expected* | `7` |
| **Backups to keep** | Automatic pruning of older archives | `12` (about 3 months of weekly backups) |
| **Overdue grace (hours)** | Extra time before nagging starts | `24` |

The retention count is clamped between **1** and **50**, so a typo can never delete everything.

Click **Save drive policy** when done.

---

## How "automatic" works on a 100% free stack (honest explanation)

This matters, so here is the truth with no marketing gloss.

**Google Drive backup runs in the administrator's browser**, because that is where the signed-in Supabase session lives.
A browser cannot wake itself up at 3am — and DramaConnect never sends your data to a paid server to do it for you.

So instead of pretending to a schedule it cannot keep, DramaConnect does something more honest:

```
  ┌─────────────────────────────────────────────────────────────┐
  │  Every 30 minutes while the site is open, DramaConnect      │
  │  checks: "Is a backup due?"                                 │
  │                                                             │
  │    • Not due          → nothing happens, silently           │
  │    • Due, tab visible → one Google consent prompt           │
  │                         (at most once per day)              │
  │    • Overdue          → warning toast + overdue notice      │
  │                                                             │
  │  It also re-checks whenever you return to the tab.          │
  └─────────────────────────────────────────────────────────────┘
```

**What this means in practice:**

| Situation | Behaviour |
|---|---|
| An administrator opens the site when a backup is due | A **single** consent prompt appears. Accept once and the backup runs |
| An administrator ignores it | A warning toast appears; the **Drive** card shows the backup is overdue |
| Nobody opens the site for weeks | **No backup runs.** This is the one real limitation |

### The three rules the scheduler never breaks

1. **It never interrupts you.** Automatic checks are non-interactive — they can *remind*, never *demand*. Google
   authorisation is only ever triggered by you clicking **Connect** or by you accepting a prompt.
2. **It never nags more than once a day.** Even if due, the interactive prompt appears at most once per 24 hours.
3. **It is visible, not silent.** An overdue backup produces both a toast and a persistent notice on the **Drive** card.

### Making it fully unattended

If you genuinely need backups with **zero** human involvement, use the
[**GitHub Actions route**](#github-actions-route--server-side-weekly-sql-dump) in §15 — it runs on GitHub's servers, needs
no browser, and costs nothing.

> **Recommended: use both.** GitHub Actions guarantees a weekly floor with no human involved; Google Drive gives you
> per-record restores and one-click recovery. They are independent, so a failure in one does not affect the other.

---

## Restoring — four routes, choose by situation

**Always take a fresh backup before restoring.** A restore overwrites live data.

### Route 1 — Merge into the same database (most common)

*Use when:* some records were deleted or corrupted, the database is otherwise fine.

1. **Admin Data → Drive** tab → **📂 List backups**.
2. On the backup you want, click **Verify** (confirms integrity first).
3. Click **Restore**.
4. Type `RESTORE` exactly.
5. Rows are upserted by primary key — existing records are updated, missing ones are recreated, nothing is deleted.

### Route 2 — Restore from a file you downloaded

*Use when:* the archive is on your computer, or Drive is unavailable.

1. **Admin Data → Local** tab → **Choose file** under *Verify or restore*.
2. **Archive preflight** appears with the row count and SHA-256 seal.
3. Choose **Restore mode** (see below).
4. Type `RESTORE` → click **Restore verified archive**.

### Route 3 — Restore from the private Supabase vault

*Use when:* you enabled the private Storage vault.

**Admin Data → Vault** tab → **Restore** on the archive you want.

### Route 4 — 🚑 Disaster recovery onto a fresh database

*Use when:* the old project is **gone**. See the next section.

### Understanding the three restore modes

| Mode | Use when | What it does |
|---|---|---|
| **Merge/upsert** | Same database, routine recovery | Updates and inserts every safe row. Nothing is skipped. **This is the normal choice** |
| **Disaster recovery** | **Fresh database** after total loss | Keeps **every** operational row; defers only member links so they can be rebuilt later. ✅ **Recommended for a rebuild** |
| **Legacy degraded** | Almost never | Skips **entire tables** — loses all attendance, casting, tasks, poll votes, RSVPs and inbox rows. Retained only for backward compatibility |

> ⚠️ **Do not use "Legacy degraded".** It discards whole tables and DramaConnect will warn you before running it.
> **Disaster recovery mode** supersedes it: it keeps the same rows and *additionally* lets you rebuild the member links.

---

## 🚑 Disaster recovery onto a fresh database

**When to use:** the old Supabase project is deleted, unrecoverable, or paused beyond saving.

> 🛑 **If the project is merely PAUSED, do NOT use this.** Restore it at supabase.com instead, then press **💓 Test
> heartbeat** on **Platform Health**. This wizard is for genuine, permanent loss.

**Estimated time: 30–45 minutes. All free tools.**

### Step 1 — Create the fresh project

1. Go to **supabase.com** → **New project**.
2. Choose any region. Set a database password and **save it in a password manager**.
3. Wait 2–3 minutes for provisioning.
4. **Project Settings → API** → copy the new **Project URL** and **anon key**.

### Step 2 — Install the schema

1. In the new project, open **SQL Editor → New query**.
2. Paste the **entire** contents of `database/complete-schema.sql`.
3. Click **Run**.
4. Wait for **`installed successfully ✅`**.

> The script is cumulative and safe to re-run. If it is interrupted, simply run it again.

### Step 3 — Point the site at the new database

1. Edit `assets/js/config.js`:

```js
SUPABASE_URL: 'https://your-new-project.supabase.co',
SUPABASE_KEY: 'your-new-anon-key',
```

2. Push to GitHub. Vercel redeploys the same site automatically.

### Step 4 — Recreate your admin account

1. Open the site → **Login → Request access** → sign up.
2. **Supabase → Table Editor → profiles** → find your row.
3. Set `role = 'super_admin'` and `status = 'approved'`.
4. Sign in again. You now own the rebuilt site.

### Step 5 — Reconnect Google Drive

1. **Admin Data → Drive** tab.
2. Paste your **existing** OAuth Client ID.

> 💡 **The same Client ID still works.** OAuth credentials are scoped to your **website URL**, not to your database. You
> changed the database, not the site — so no change is needed at Google.

### Step 6 — Run the recovery

1. Click **📂 List backups** → authorise if prompted.
2. On the **newest** backup, click **🚑 Recover to new project**.
3. Type `RESTORE` to confirm.

The recovery will:

- ✅ verify the SHA-256 seal **before the first write** — a corrupt archive cannot start
- ✅ **keep every** attendance, casting, task, poll, RSVP, inbox and production row
- ✅ defer only the member links, recording each one in a ledger
- ✅ retry row-by-row, so one malformed row cannot sink the other 199
- ✅ give you an honest report: rows restored, rows failed, links deferred

Afterwards, **download the re-link manifest** from the **Local** tab.

### Step 7 — Re-onboard people

1. Broadcast the new address.
2. Approve everyone on **Approvals**.

### Step 8 — Re-arm every safeguard

Heartbeat, GitHub secrets, UptimeRobot, Drive auto-sync, one fresh backup. Visit **Platform Health** and do not stop
until every tile is green.

> **A rebuilt site with no heartbeat will simply pause again.** Step 8 is not optional.

---

## Re-linking members after a disaster recovery

⭐ **This is what makes a DramaConnect recovery better than an ordinary restore.**

### The problem with a normal recovery

Login accounts cannot be copied — Supabase Auth passwords are not exportable. So a conventional recovery **nulls** every
reference to a person. The result:

```
  BEFORE:   attendance row → Ada Okonjo attended on 4 March
  AFTER:    attendance row → (nobody) attended on 4 March       ❌
```

You keep the *fact* that someone attended, but lose *who*. For a ministry, that is most of the value gone.

### How DramaConnect solves it

Recovery mode records every deferred link in a **ledger**:

```json
{
  "table": "attendance",
  "rowId": "11111111-…",
  "column": "member_id",
  "previousUserId": "aaaaaaaa-…",
  "email": "ada@example.org"
}
```

When members re-register, each person gets a **new** UUID but the **same email address**. Email is therefore a bridge
between the old identity and the new one. The re-link pass:

1. reads the ledger;
2. resolves each old UUID to an email using the archive;
3. resolves each email to the new UUID using the live `profiles` table;
4. rewrites the deferred columns in place;
5. reports **exactly** what it could and could not match.

### How to re-link

1. After people re-register, open **Admin Data → Local** tab.
2. Click **⬆ Re-link manifest** and upload the JSON file you downloaded at the end of step 6.
3. Review the report:

```
Re-link finished: 847 link(s) rebuilt, 23 still unmatched.
  attendance: 412 rebuilt
  cast_list: 61 rebuilt
  tasks: 88 rebuilt
  …
```

4. Unmatched rows belong to people who have **not registered yet**. Upload the same manifest again once they have —
   **the pass is safe to re-run**, and rows already re-linked are simply matched again.

### Why this is trustworthy

| Guarantee | How |
|---|---|
| Nothing is guessed | Matching is by exact email (case-insensitive). No fuzzy matching, no assumptions |
| Nothing is hidden | The unmatched count is reported even when it is zero progress |
| Nothing is lost | The manifest is a file you keep; re-link any number of times |
| Nothing is overwritten blindly | Only the specific deferred columns are touched — never dates, statuses or content |

---

## Microsoft OneDrive route (free alternative)

If the ministry uses Microsoft 365 instead of Google Workspace.

### Zero-setup route (recommended — nothing can ever expire)

1. **Admin Data → Local** tab → **⬇ Export verified archive**.
2. Save the `.json` file into your **OneDrive** folder.
3. OneDrive syncs it to the cloud automatically.

**Pros:** no OAuth, no client IDs, nothing to expire, works offline.
**Cons:** manual — you must remember to do it.

> 💡 **This is the most robust backup you can have**, precisely because it has no moving parts. Do it once a month even
> if you have automated Drive backups.

### Full API route (for IT people)

Configure an Azure AD app registration with the `Files.ReadWrite` delegated permission, then use the Microsoft Graph API
at `https://graph.microsoft.com/v1.0/me/drive/special/approot:/{filename}:/content`.

---

## GitHub Actions route — server-side weekly SQL dump

**This is the only route that is genuinely unattended** — it runs on GitHub's servers with no browser and no human.

The workflow `.github/workflows/database-backup.yml` already exists and runs **Sundays at 02:53 UTC**. It dumps the
database with `pg_dump`, encrypts it with `gpg`, and uploads it via `rclone`.

### Setup

**1. Get the connection string.** **Supabase → Project Settings → Database → Connection string → URI**. Replace
`[YOUR-PASSWORD]` with your real password. Use the **pooler** host on port **6543** (GitHub Actions is IPv4-only).

**2. Create a passphrase:**

```bash
openssl rand -base64 32
```

**Store this somewhere safe and separate from the repository.** Lose it and the backups are unrecoverable.

**3. Configure rclone, then encode it:**

```bash
rclone config
base64 -w 0 ~/.config/rclone/rclone.conf
```

**4. Add three secrets** at **GitHub → Settings → Secrets and variables → Actions**:

| Secret | Value |
|---|---|
| `SUPABASE_DB_URL` | the connection string |
| `RCLONE_CONFIG_BASE64` | the base64 output |
| `BACKUP_PASSPHRASE` | the passphrase |

**5. Test it:** **Actions → Encrypted unattended database, Auth and Storage backup → Run workflow**. Confirm an encrypted
`.sql.gpg` file appears in your cloud destination.

**6. Practise a restore once.** See `docs/BACKUP_AND_RECOVERY.md` and `scripts/restore-database-dump.sh`.

---

## If something goes wrong — exact errors and exact fixes

### Setup errors

| Error | Cause | Fix |
|---|---|---|
| *"Access blocked: This app has not completed Google verification"* | Email not a test user | **Advanced → Go to DramaConnect (unsafe)**, or add the email in Part C |
| *"Error 400: redirect_uri_mismatch"* | Site URL missing from Authorised origins | Part D step 5 — add the exact URL, no trailing slash |
| *"Error 401: invalid_client"* | Wrong or mistyped Client ID | Re-copy from **APIs & Services → Credentials** |
| *"Error 403: access_denied"* | Not a test user, or Drive API disabled | Part C step 11 and Part B |
| *"idpiframe_initialization_failed"* | Third-party cookies blocked | Allow third-party cookies, or use incognito |
| *"Popup blocked"* | Browser blocked the popup | Allow popups for your site |
| *"Missing Google OAuth Client ID"* | Saved before pasting | Redo Part E |
| *"API is not enabled"* | Enabled in the wrong project | Repeat Part B in the right project |

### Backup errors

| Error | Cause | Fix |
|---|---|---|
| *"Google authorization expired"* | Token expired (≈1 hour) | Click **☁ Connect Google Drive** again |
| *"Insufficient permissions"* | Your role is not privileged | You need `super_admin`, `admin`, `proprietor` or `principal` |
| *"Archive verification failed"* | Archive corrupt | Re-export from the source database |
| *"Upload failed: 403"* | Drive storage full, or scope not granted | Free up Drive space; disconnect and reconnect to re-grant |
| *"Backup lease held"* | Another backup is running | Wait a few minutes; leases expire automatically |
| Upload succeeds, read-back fails | Transient network corruption | Run the backup again |

### Restore errors

| Error | Cause | Fix |
|---|---|---|
| `ARCHIVE_INTEGRITY_FAILED` | Seal does not match contents | **By design.** Use a different, verified backup |
| *"Unsupported archive format"* | Not a DramaConnect archive | Select a `dramaconnect-portable-archive` file |
| *"Unsupported schema version"* | Archive from a different DramaConnect major version | Use an archive from the same major version |
| *"Type RESTORE exactly"* | Confirmation mistyped | Type `RESTORE` in capitals |
| *"Required tables are missing"* | Archive truncated or edited | Use an unmodified backup |
| *"Archive exceeds the 100 MB local restore limit"* | File too large for the local path | Use the **Drive** or **Vault** restore route instead |
| *"The re-link manifest contains no deferred references"* | Manifest from a non-recovery restore | Use the manifest downloaded after a **disaster recovery** |
| *"Cannot read the new member list"* | `profiles` not readable | Confirm you are signed in as a privileged administrator |

---

## Security and privacy — what Google can and cannot see

| Question | Answer |
|---|---|
| Can Google read my ministry data? | The archive is uploaded to **your** Drive. Google's normal Drive terms apply — the same as any file you store there |
| Can DramaConnect read my other Drive files? | **No.** The `drive.file` scope permits access *only* to files the app created |
| Is the Client ID a secret? | **No.** It is public by design. The Client Secret is never used |
| Where is the access token stored? | In your **browser session** only. It is never sent to the database |
| Does the token persist? | For the browser session. Clicking **Disconnect** clears it immediately |
| Can I revoke access? | Yes — **Google Account → Security → Third-party apps with account access → DramaConnect → Remove access** |
| Who can run a backup? | Only `super_admin`, `admin`, `proprietor` and `principal` roles |
| Is the archive encrypted? | It is **sealed** with SHA-256 (tamper-proof), not encrypted. Use the GitHub route for encryption at rest |

---

## Layered safety summary

Defence in depth means **no single failure loses your data**.

| Layer | Protects against | Automated? | Where |
|---|---|---|---|
| **1. SHA-256 seal** | Silent corruption | ✅ Every archive | Built in |
| **2. Read-back verification** | Failed or partial upload | ✅ Every backup | Built in |
| **3. Pre-restore verification** | Restoring a corrupt archive | ✅ Every restore | Built in |
| **4. Retention pruning (1–50)** | Drive filling up | ✅ Every backup | Built in |
| **5. Google Drive backup** | Database-level loss | ⚠️ Semi (see §10) | Drive tab |
| **6. Private Supabase vault** | Loss of Google access | ⚠️ Semi | Vault tab |
| **7. Weekly GitHub SQL dump** | Total loss of everything | ✅ Fully | GitHub Actions |
| **8. Manual OneDrive export** | Every automated layer failing | ❌ Manual | Local tab |
| **9. 🚑 Disaster recovery** | Needing a fresh database | On demand | Drive tab |
| **10. Re-link manifest** | Losing member↔record links | On demand | Local tab |
| **11. Supabase anti-pause** | The project pausing at all | ✅ Fully | See `SUPABASE_FREE_TIER_PROTECTION.md` |

**The recommended configuration:**

> **Layer 5 + Layer 7 + Layer 8** — Google Drive for convenience, GitHub Actions for a guaranteed weekly floor, and a
> monthly manual OneDrive export that depends on nothing at all.

---

## Administrator quick reference

### Weekly (1 minute)

- [ ] **Platform Health** — quorum banner is not *"Single point of failure"*
- [ ] **Admin Data → Drive** — the backup card does not say *overdue*

### Monthly (5 minutes)

- [ ] Run one manual **☁ Backup now**
- [ ] **⬇ Export verified archive** → save to OneDrive (Layer 8)
- [ ] Confirm the **DramaConnect Backups** Drive folder has recent files

### Quarterly (15 minutes)

- [ ] **Drive** → **Verify** on the newest backup (proves it is restorable)
- [ ] Practise a restore of one table into a test project
- [ ] Review `docs/SUPABASE_FREE_TIER_PROTECTION.md` — confirm every layer still runs

### After any incident

- [ ] Take a fresh backup **before** restoring
- [ ] Use **Merge/upsert** for routine recovery, **Disaster recovery** only for a fresh database
- [ ] Download and keep the **re-link manifest**

---

## Related documents

| Document | Purpose |
|---|---|
| `docs/SUPABASE_FREE_TIER_PROTECTION.md` | Stop the project pausing in the first place |
| `docs/DISASTER-RECOVERY-RUNBOOK.md` | Printable step-by-step recovery runbook |
| `docs/BACKUP_AND_RECOVERY.md` | Backup strategy and restore procedures |
| `docs/RESILIENCE_RUNBOOK.md` | Heartbeat, health checks and operational monitoring |
| `docs/STORAGE_MANAGER.md` | Photos and videos (not covered by these archives) |

---

*Last reviewed for DramaConnect v14.1 · every tool in this guide is free.*
