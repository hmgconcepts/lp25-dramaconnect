# Supabase Free-Tier Protection — Complete, Automated & Unambiguous

**DramaConnect · Supabase anti-pause, resilience and unattended recovery**

> **Read this sentence first.** Supabase pauses a free-tier project after **7 days (168 hours) with no activity**.
> A paused project is not deleted — your data is safe — but the site goes dark until someone clicks *Restore* at supabase.com.
> Every layer in this document exists to make sure that never happens, and to make recovery a 30-minute job if it ever does.

This guide is written so that a non-technical administrator can follow it **literally, top to bottom, without guessing**.
Every step says exactly where to click, exactly what to type, and exactly what you should see when it worked.
Where a step can fail, the failure is listed with its fix.

---

## Table of contents

1. [What is already built in (zero setup)](#1-what-is-already-built-in-zero-setup)
2. [The 12-layer map — what you are building](#2-the-12-layer-map--what-you-are-building)
3. [Layer 1 — Internal `pg_cron` heartbeat](#layer-1--internal-pg_cron-heartbeat)
4. [Layer 2 — Site-visit heartbeat](#layer-2--site-visit-heartbeat)
5. [Layer 3 — GitHub Actions heartbeat](#layer-3--github-actions-heartbeat)
6. [Layer 4 — The 60-day Actions freeze, solved automatically](#layer-4--the-60-day-actions-freeze-solved-automatically)
7. [Layer 5 — Vercel Cron](#layer-5--vercel-cron)
8. [Layer 6 — Google Apps Script](#layer-6--google-apps-script)
9. [Layer 7 — cron-job.org](#layer-7--cron-joborg)
10. [Layer 8 — Edge Function + UptimeRobot](#layer-8--edge-function--uptimerobot)
11. [Layer 9 — Manual heartbeat button](#layer-9--manual-heartbeat-button)
12. [Layer 10 — Auto-Restore Watchdog](#layer-10--auto-restore-watchdog)
13. [Layer 11 — Heartbeat quorum and dead-scheduler detection](#layer-11--heartbeat-quorum-and-dead-scheduler-detection) ⭐ *new*
14. [Layer 12 — Weekly encrypted database dump](#layer-12--weekly-encrypted-database-dump)
15. [How to verify the whole system](#how-to-verify-the-whole-system)
16. [Reading the Platform Health page](#reading-the-platform-health-page)
17. [Exact errors and exact fixes](#exact-errors-and-exact-fixes)
18. [Recommended handover checklist](#recommended-handover-checklist)
19. [The complete matrix — tick what you have](#the-complete-matrix--tick-what-you-have)
20. [When prevention fails: the 🚑 Disaster Recovery Wizard](#when-prevention-fails-the--disaster-recovery-wizard)

---

## 1. What is already built in (zero setup)

These are active the moment `database/complete-schema.sql` has been run. You do not configure them; you only verify them.

| Built-in | What it does | Where you see it |
|---|---|---|
| `dc_keep_alive(p_source)` | Records a heartbeat **per source**, so the database knows *which* safety net ran | Platform Health → **Protection layers** |
| `dc_heartbeat_sources` table | One row per scheduler, with last ping time and total count | Platform Health → **Protection layers** |
| `dc_heartbeat_health()` | Reports freshness, pause countdown, quorum, and names silent sources | Platform Health → quorum banner |
| `dc_begin_backup_run` / `dc_finish_backup_run` | Leased, audited backup runs — two admins cannot collide | Admin Data → **Backup & restore run history** |
| `dc_backup_settings` | Drive policy, schedule, retention, grace period | Admin Data → **Drive backup policy** |
| SHA-256 sealed archives | Every archive is verified **before** the first write | Admin Data → **Archive preflight** |
| Resilience client | Heartbeat, health, and lease helpers used by every page | All admin pages |

**Verification (30 seconds).**

1. Sign in as an administrator.
2. Open **Platform Health**.
3. The **Protection layers** matrix lists **every** layer (L1–L12) with a state pill: **Reporting**, **⚠ Silent** (was running, stopped) or **Not set up** (has never reported) — each non-reporting row shows its one-line fix.
4. The banner above it states how many layers are fresh, how many days of headroom remain and — new in v14.1 — warns *"Only human traffic is keeping the project awake"* when site visits and button presses are the only fresh sources (`automatedQuorum = false`). Human traffic stops during holidays; aim for at least two **automated** layers reporting.

Press **Test heartbeat** ([Layer 9](#layer-9--manual-heartbeat-button)) once to create the first row.

---

## 2. The 12-layer map — what you are building

Think of it as **twelve independent clocks**. Each one pokes the database on its own schedule. Supabase only pauses the project if **all twelve** stop for 7 days straight.

```
                        ┌─────────────────────────────────────┐
   INTERNAL (inside DB) │  Layer 1   pg_cron                  │  ⚠️ cannot wake a PAUSED database
                        └─────────────────────────────────────┘
                        ┌─────────────────────────────────────┐
                        │  Layer 2   site-visit heartbeat     │
                        │  Layer 3   GitHub Actions           │
                        │  Layer 4   self-committing workflow │  protects Layer 3
   EXTERNAL             │  Layer 5   Vercel Cron              │  ✅ these CAN wake a sleeping project
   (outside Supabase)   │  Layer 6   Google Apps Script       │
                        │  Layer 7   cron-job.org             │
                        │  Layer 8   Edge Function + UptimeRobot│
                        │  Layer 9   manual heartbeat button  │
                        └─────────────────────────────────────┘
                        ┌─────────────────────────────────────┐
   RECOVERY             │  Layer 10  Auto-Restore Watchdog    │  un-pauses if it ever happens
                        │  Layer 11  quorum + dead-scheduler  │  warns you BEFORE it happens
                        │  Layer 12  weekly encrypted dump    │  rebuilds from scratch if all else fails
                        └─────────────────────────────────────┘
```

> **The one rule that matters:** configure **at least two EXTERNAL layers**.
> Internal `pg_cron` runs *inside* the database, so when the database is paused, `pg_cron` is paused too — it can never rescue you. External layers run on other people's servers and *can* reach a sleeping project.

**Recommended minimum for a real deployment:** Layer 3 (GitHub Actions) + Layer 5 (Vercel Cron). Both are free, both take about five minutes, and they run on completely different companies' infrastructure.

---

## Layer 1 — Internal `pg_cron` heartbeat

| | |
|---|---|
| **Cost** | Free |
| **Time** | 0 minutes — installed automatically by the schema |
| **Can wake a paused project?** | ❌ No. It lives inside the database. |
| **Value** | Keeps the project warm from the inside; costs nothing. |

> **Changed in v14.1.** The live audit found the `pg-cron` source had **never** written a row: the installer only scheduled the job if `pg_cron` was *already* enabled. The schema now runs `CREATE EXTENSION IF NOT EXISTS pg_cron` itself (inside a guarded block, so a project where the extension is unavailable still installs cleanly) and then schedules `dramaconnect-internal-heartbeat` for `17 3 * * *` (daily at 03:17 UTC).

To activate it on an existing project, re-run `database/complete-schema.sql` once in the SQL Editor (it is safe to re-run). Look for the notice `Scheduled dramaconnect-internal-heartbeat via pg_cron.` in the output.

If the job still does not appear: **Database → Extensions** → search `pg_cron` → **Enable**, then re-run the schema.

**Verify:** in the **SQL Editor**, run

```sql
SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'dramaconnect-internal-heartbeat';
```

You should see one row. If you see **zero rows**, `pg_cron` was not available when you installed — that is fine, the external layers cover you.

> **Do not rely on this layer alone.** This is the single most common misunderstanding. A paused database cannot run its own cron job.

---

## Layer 2 — Site-visit heartbeat

| | |
|---|---|
| **Cost** | Free |
| **Time** | 0 minutes — built in |
| **Can wake a paused project?** | ✅ Yes |
| **Value** | Real human traffic is the strongest possible liveness signal. |

Every time an approved administrator loads a DramaConnect page, `assets/js/resilience.js` records a heartbeat tagged `site-visit`. Throttled to at most one write per five minutes per source, so heavy use cannot flood the table.

**Verify:** sign in, open any page, then check **Platform Health → Protection layers** — the `site-visit` row's *Last ping* should be within the last few minutes.

This layer costs nothing but is not dependable on its own: a quiet week with no visitors is exactly the week you get paused.

---

## Layer 3 — GitHub Actions heartbeat

| | |
|---|---|
| **Cost** | Free (2,000 minutes/month on the free tier; this uses ~1 minute/month) |
| **Time** | 0 minutes — works as soon as the repository is on GitHub |
| **Can wake a paused project?** | ✅ Yes (it keeps it from pausing; Layer 10 restores it) |
| **Value** | Reliable, auditable, runs whether or not anyone visits the site. |

The workflow file already exists at `.github/workflows/keep-alive.yml` and runs every **Monday and Thursday at 06:17 UTC**.

> **Changed in v14.1 — no secrets required.** A live audit (24 Sep 2026) found every run of this workflow failing at a *"Validate required secrets"* step because the secrets had never been added, so this layer had **never protected the project**. The workflow now finds your project in this order and uses the first one found:
>
> 1. repository **secrets** `SUPABASE_URL` / `SUPABASE_ANON_KEY` (optional),
> 2. repository **variables** with the same names (optional),
> 3. the public URL and anon key already in **`assets/js/config.js`**.
>
> The anon key is public by design (it is already served to every browser and constrained by RLS), so reading it from `config.js` is safe. Secrets only matter if you want the workflow to target a different project from the website.

### Step A — Confirm it is enabled

1. Open your repository on **github.com** → click the **Actions** tab.
2. If GitHub shows *"Workflows aren't being run on this forked repository"* or a green **I understand my workflows, go ahead and enable them** button, click it.

### Step B — Test it immediately (do not skip)

1. **Actions** → left sidebar → **Supabase resilience heartbeat**.
2. Click **Run workflow** (right side) → green **Run workflow** button.
3. Wait about 30 seconds and refresh. Open the new run → **heartbeat** job.
4. Expand **Write and verify database heartbeat**.

**✅ Success looks like this:**

```
✅ Heartbeat written and verified: {"status":"written","source":"github-actions","at":"…"}
```

(`"status":"throttled"` is also success — it means a heartbeat from this source was written in the last 5 minutes.)

**Verify in DramaConnect:** **Platform Health → Protection layers** — the **L3 · GitHub Actions** row shows **Reporting** with today's time.

### Step C (optional) — Pin the project with secrets

Only if the website and the workflow must use different projects: **Settings → Secrets and variables → Actions → New repository secret**, add `SUPABASE_URL` (e.g. `https://abcdefghijklmnop.supabase.co`, nothing after `.co`) and `SUPABASE_ANON_KEY` (the **anon / public** key — never the `service_role` key). Trailing slashes and stray spaces are cleaned automatically.

### ❌ If it fails

| Message in the log | Cause | Fix |
|---|---|---|
| ⚠ `Heartbeat not configured` (run is green) | `assets/js/config.js` still has placeholders and no secrets exist | Fill in `assets/js/config.js` (see `DEPLOYMENT.md`) and push, or add the optional secrets. |
| ❌ `Heartbeat RPC missing` | The database schema is not installed | Run `database/complete-schema.sql` once in the Supabase SQL Editor, then re-run. |
| ❌ `Heartbeat failed … after 4 attempts` | Project paused, or wrong key in a secret | Restore at supabase.com (or let Layer 10 do it); check any secret you added overrides the right project. |
| ⚠ `Push rejected` (Layer 4 step) | Actions cannot push the anti-freeze commit | **Settings → Actions → General → Workflow permissions → Read and write permissions → Save.** |

---

## Layer 4 — The 60-day Actions freeze, solved automatically

| | |
|---|---|
| **Cost** | Free |
| **Time** | 0 minutes — already in `keep-alive.yml` |
| **Value** | Closes the single most dangerous gap in Layer 3. |

**The trap.** GitHub **disables scheduled workflows** in a repository after **60 days with no commits**. Not a warning — it just stops. This is how carefully configured heartbeats die silently: you set it up perfectly, the site runs for two months, nobody pushes code, GitHub quietly switches the cron off, and seven days later Supabase pauses the project.

**How DramaConnect solves it.** `keep-alive.yml` ends with a *preservation* step:

1. On each scheduled run it checks how long ago the last commit was.
2. If the repository is **more than 30 days** old (in commit terms), it writes `.github/.keepalive` and pushes.
3. That commit resets GitHub's 60-day counter.

So the heartbeat **keeps itself alive** with no human involvement.

**Verify:**

1. **Actions** tab → **Supabase resilience heartbeat** → open any run.
2. Expand **Preserve scheduled workflow activity**.
3. You will see either:

```
Repository activity is 12 day(s) old; no preservation commit needed.
```

or, past 30 days, a `chore: preserve scheduled resilience workflow` commit.

Both are correct. The first means the repo is already fresh; the second means the safeguard fired.

> **One requirement:** the workflow needs permission to push. It declares `permissions: contents: write`. If your repository's **Settings → Actions → General → Workflow permissions** is set to *Read-only*, change it to **Read and write permissions**, or the push silently fails.

---

## Layer 5 — Vercel Cron

| | |
|---|---|
| **Cost** | Free on Hobby |
| **Time** | 0 minutes — active on the next deployment |
| **Can wake a paused project?** | ✅ Yes (keeps it from pausing) |
| **Value** | Independent of GitHub entirely — a completely separate company's scheduler. |

Everything is already in the repository:

- `vercel.json` → `"crons": [{ "path": "/api/keep-alive", "schedule": "41 4 * * *" }]` (daily at 04:41 UTC — the most frequent schedule Hobby allows).
- `api/keep-alive.js` → the endpoint.

> **Changed in v14.1 — no environment variables required.** The live endpoint returned **HTTP 503 `cron_secret_not_configured`** because it refused to run until `CRON_SECRET` was set, so Vercel's cron had never written a heartbeat. The endpoint now:
>
> 1. uses `SUPABASE_URL` / `SUPABASE_ANON_KEY` from Vercel environment variables **if present**,
> 2. otherwise reads them from the site's own public `assets/js/config.js`,
> 3. checks `CRON_SECRET` **only if you set one** (Vercel sends it automatically as `Authorization: Bearer …` on cron calls; the comparison is timing-safe).

### Step A — Deploy

Push to GitHub (or **Deployments → ⋯ → Redeploy** on vercel.com). Vercel registers the cron from `vercel.json` automatically: **vercel.com → project → Settings → Cron Jobs** lists `/api/keep-alive`.

### Step B — Verify

Open `https://YOUR-SITE.vercel.app/api/keep-alive` in a browser. Success:

```json
{"ok":true,"status":"written","source":"vercel-cron","at":"…","config":"assets/js/config.js"}
```

`"config"` tells you where the connection came from (`environment` or `assets/js/config.js`). `"status":"throttled"` is also success. Then **Platform Health → L5 · Vercel Cron** shows **Reporting**.

### Step C (optional hardening) — CRON_SECRET

**Settings → Environment Variables → Add** `CRON_SECRET` = a long random string (e.g. from `openssl rand -hex 32`), Production scope, then **Redeploy**. From then on, only Vercel's cron (and callers sending `Authorization: Bearer <secret>`) are accepted; opening the URL in a browser returns `401 unauthorized` — that is expected.

| Response | Meaning | Fix |
|---|---|---|
| `503 supabase_not_configured` | No env vars and `config.js` still has placeholders | Fill in `assets/js/config.js` or add the two env vars, then redeploy. |
| `401 unauthorized` | `CRON_SECRET` is set and the caller did not send it | Expected for manual browser tests once hardened. |
| `502 heartbeat_rejected` / `heartbeat_unreachable` | Supabase rejected or did not answer the call (paused project or schema missing) | Restore the project / run `database/complete-schema.sql`. |

> Hobby accounts allow a small number of daily cron jobs; this uses one.

---

## Layer 6 — Google Apps Script

| | |
|---|---|
| **Cost** | Free — needs one Google account |
| **Time** | ~5 minutes |
| **Can wake a paused project?** | ✅ Yes |
| **Value** | Runs on Google's infrastructure; ideal if the ministry already uses Gmail. |

A ready-made script ships at `scripts/google-apps-script-keep-alive.gs`.

### Step A — Create the project

1. Go to **script.google.com** → **New project**.
2. Delete the placeholder `myFunction` and paste the **entire** contents of `scripts/google-apps-script-keep-alive.gs`.
3. Click the floppy-disk **Save** icon. Name it `DramaConnect Keep-Alive`.

### Step B — Set the two properties

1. Click the **gear** icon (Project Settings) in the left sidebar.
2. Scroll to **Script Properties** → click **Add script property**.
3. Add `SUPABASE_URL` = your Project URL.
4. Click **Add script property** again: `SUPABASE_ANON_KEY` = your anon key.
5. Click **Save script properties**.

### Step C — Authorise once

1. In the toolbar dropdown next to **Debug**, select `dramaConnectHeartbeat`.
2. Click **Run**.
3. Google shows *"Authorization required"* → click **Review permissions**.
4. Choose your account → **Advanced** → **Go to DramaConnect Keep-Alive (unsafe)** → **Allow**.

> ⚠️ **Why "unsafe"?** Google shows this warning for any script you wrote yourself that has not gone through Google's paid verification. It is **your own code**, pasted from this repository. This is expected and safe.

### Step D — Schedule it

1. Left sidebar → **Triggers** (clock icon).
2. Click **Add Trigger** (bottom-right).
3. Configure **exactly** as follows:

| Field | Value |
|---|---|
| Choose which function to run | `dramaConnectHeartbeat` |
| Choose which deployment should run | `Head` |
| Select event source | **Time-driven** |
| Select type of time based trigger | **Day timer** |
| Select time of day | **4am to 5am** |

4. Click **Save**.

**Verify:** the **Executions** list shows a green *Completed* run. Then **Platform Health** shows an `apps-script` row.

---

## Layer 7 — cron-job.org

| | |
|---|---|
| **Cost** | Free |
| **Time** | ~3 minutes |
| **Can wake a paused project?** | ✅ Yes |
| **Value** | A fourth independent provider. Useful when GitHub and Vercel belong to one person. |

1. Register at **cron-job.org** (free).
2. **Jobs → Create job**.
3. **Common** tab:

| Field | Value |
|---|---|
| Title | `DramaConnect keep-alive` |
| Address | `https://YOURPROJECTREF.supabase.co/rest/v1/rpc/dc_keep_alive` |
| Request method | `POST` |
| Schedule | Every 2 days at `05:23` |

4. **Advanced** tab — add two **Headers**:

| Header | Value |
|---|---|
| `apikey` | your anon key |
| `Authorization` | `Bearer YOUR_ANON_KEY` (literally the word `Bearer`, a space, then the key) |
| `Content-Type` | `application/json` |

5. In **Body**, enter exactly:

```json
{"p_source":"cron-job-org"}
```

6. Click **Create job**, then press **Run now** to test immediately.

**Verify:** cron-job.org shows a green result, and **Platform Health** shows a `cron-job-org` row.

> ⚠️ Replace `YOURPROJECTREF` with your real project reference — the `abcdefgh` part of `https://abcdefgh.supabase.co`.

---

## Layer 8 — Edge Function + UptimeRobot

| | |
|---|---|
| **Cost** | Free (Supabase Edge Functions: 500k invocations/month; UptimeRobot: 50 monitors free) |
| **Time** | ~10 minutes |
| **Can wake a paused project?** | ✅ Yes — and it **emails you** when something breaks |
| **Value** | The only layer that actively *notifies* you. Every other layer is silent. |

This is worth the ten minutes because it turns silence into a warning.

### Part 1 — Deploy the Edge Function (from the GitHub website — no CLI)

> **Fixed in v14.1.** Earlier versions of this guide told you to create a new function called `keep-alive`; the repository actually ships `supabase/functions/ping`. The live URL `…/functions/v1/ping` returned **404** because nothing had ever been deployed, and the function also refused to run without `PING_SECRET`. Now `PING_SECRET` is **optional**, `supabase/config.toml` sets `verify_jwt = false` for `ping`, and a one-click workflow deploys it.

The function needs **no secrets of its own**: Supabase automatically provides `SUPABASE_URL` and `SUPABASE_ANON_KEY` to every Edge Function.

**A. Create a Supabase access token (once)**

1. Open **supabase.com/dashboard/account/tokens** → **Generate new token**.
2. Name it `github-deploy` → **Generate token** → copy it (it is shown only once).

**B. Save it in GitHub**

1. Repository → **Settings → Secrets and variables → Actions → New repository secret**.
2. **Name:** `SUPABASE_ACCESS_TOKEN` — **Secret:** paste the token → **Add secret**.
   (This same secret also upgrades Layer 10 from heartbeat-only to automatic restore.)

**C. Deploy**

1. **Actions** tab → left sidebar → **Deploy Supabase Edge Functions** → **Run workflow**.
2. Leave the box as `ping` (or type `ping birthday-bot run-reminders notify-approval admin-create-member` to deploy everything) → **Run workflow**.
3. Open the run. Success ends with:

```
✅ Deployed: ping
Ping URL for UptimeRobot / cron-job.org: https://YOURPROJECTREF.supabase.co/functions/v1/ping
Self-test → HTTP 200 {"ok":true,"status":"written","source":"edge-ping",…}
```

The project ref is read from `assets/js/config.js`; add an optional `SUPABASE_PROJECT_REF` secret only if the functions belong to a different project.

**Alternative — CLI on your own computer:**

```bash
npx supabase login
npx supabase functions deploy ping --project-ref YOURPROJECTREF --no-verify-jwt
```

**Test it.** Open `https://YOURPROJECTREF.supabase.co/functions/v1/ping` in a browser → `{"ok":true,…,"source":"edge-ping"}`. `?source=cron-job-org` records the call under Layer 7 instead.

**Optional hardening — PING_SECRET.** Supabase → **Edge Functions → Secrets** → add `PING_SECRET` = a long random string. Monitors must then call `…/ping?token=YOUR_SECRET` (or send header `x-ping-secret`); other callers get `401`. Without it the endpoint is still safe: it only writes a throttled heartbeat and returns no data.

### Part 2 — Create the UptimeRobot monitor

1. Register at **uptimerobot.com** (free).
2. **Add New Monitor**.

| Field | Value |
|---|---|
| Monitor Type | **HTTP(s)** |
| Friendly Name | `DramaConnect Keep-Alive` |
| URL | `https://YOURPROJECTREF.supabase.co/functions/v1/ping` (add `?token=…` only if you set `PING_SECRET`) |
| Monitoring Interval | **Every 30 minutes** (free tier permits 5-minute; 30 is plenty) |
| Monitor Timeout | default |

3. Click **Create Monitor**.

### Part 3 — Get alerted when it fails

1. **My Settings → Alert Contacts** → confirm your email is verified.
2. Open the monitor → **Edit** → **Alert Contacts** → tick your email.
3. Save.

UptimeRobot now calls your function every 30 minutes. **Every call is a heartbeat** — and if the call ever fails, you receive an email. That is the difference between discovering a pause on Sunday morning and discovering it three weeks later.

### Bonus — monitor the website itself

Add a **second** monitor pointed at `https://your-site.vercel.app` so you learn about a broken deployment, not just a broken database.

---

## Layer 9 — Manual heartbeat button

| | |
|---|---|
| **Cost** | Free |
| **Time** | 0 minutes |
| **Can wake a paused project?** | ✅ Yes |
| **Value** | The emergency lever. Use it after any long holiday. |

1. Sign in as an administrator.
2. Open **Platform Health**.
3. Click **💓 Test heartbeat** (top-right).
4. A toast confirms `Heartbeat written.` or `Heartbeat throttled.`

> **"Throttled" is success, not failure.** The database accepts at most one heartbeat per source per five minutes to prevent abuse. If you press the button twice, the second is throttled — the first already counted.

**When to use it:** after a holiday break, before an important event, or any time you open the site after a long gap.

---

## Layer 10 — Auto-Restore Watchdog

| | |
|---|---|
| **Cost** | Free |
| **Time** | ~10 minutes, once |
| **Value** | If a pause **ever** happens, this un-pauses the project without you. |

This is the safety net beneath the safety net. It runs from `.github/workflows/auto-restore.yml` every 12 hours.

> **Changed in v14.1 — works in two modes.** Previously the watchdog failed at step 2 on every run because three secrets were missing, so it neither restored nor heartbeated.
>
> | Mode | What you add | What it does every 12 h |
> |---|---|---|
> | **Heartbeat-only** (default, zero setup) | nothing | Writes an `auto-restore` heartbeat using `assets/js/config.js`. Log shows a blue `Heartbeat-only mode` notice. |
> | **Full restore** | `SUPABASE_ACCESS_TOKEN` secret | Asks the Management API for the project status; if `INACTIVE`/paused it calls the official restore endpoint, polls up to 10 minutes until `ACTIVE_HEALTHY`, then heartbeats. |
>
> The access token cannot be derived from anything public, so it is the one secret this layer genuinely needs for restores.

### Step A — Create a Supabase access token

1. Go to **supabase.com/dashboard/account/tokens**.
2. Click **Generate new token**. Name it `dramaconnect-watchdog` (or reuse the token from Layer 8).
3. **Copy it immediately** — it is shown once and never again.

### Step B — Add one secret

**GitHub → Settings → Secrets and variables → Actions → New repository secret** → Name `SUPABASE_ACCESS_TOKEN` → paste → **Add secret**.

The project reference is read from `assets/js/config.js` automatically. Add `SUPABASE_PROJECT_REF` (Project Settings → General → Reference ID) and `SUPABASE_URL` secrets **only** if the watchdog must watch a different project from the website.

### Step C — Test it

**Actions → Supabase paused-project recovery watchdog → Run workflow.**

**Healthy output (full restore mode):**

```
Management API HTTP 200 — project status: ACTIVE_HEALTHY
Project is up.
✅ auto-restore heartbeat written: {…"source":"auto-restore"…}
```

**Healthy output (heartbeat-only mode):** the `Heartbeat-only mode` notice followed by `✅ auto-restore heartbeat written`.

| Log message | Meaning | Fix |
|---|---|---|
| ❌ `Invalid access token` | The token is wrong, revoked or expired | Generate a new token and update the secret. This failure is intentionally loud. |
| ❌ `Project did not become healthy within 10 minutes` | Supabase is slow to restore | Re-run later or restore from the dashboard. |
| ⚠ `Heartbeat not accepted` (heartbeat-only mode) | Project paused or schema missing | Add the token so it can restore, or restore manually; run `database/complete-schema.sql` if never installed. |

> 💡 **Access tokens can expire.** The **Platform Health** matrix will show **L10** as *Silent* if the watchdog stops reporting.

---

## Layer 11 — Heartbeat quorum and dead-scheduler detection

⭐ **New in this release.** This is the layer that makes DramaConnect's anti-pause posture genuinely stronger than a simple "last heartbeat" timestamp.

| | |
|---|---|
| **Cost** | Free — installed by the schema |
| **Time** | 0 minutes |
| **Value** | Detects a **dead** scheduler while the database still looks healthy. |

### The problem this solves

A single "last heartbeat" timestamp is **dangerously reassuring**. Consider this very common sequence:

1. You configure four schedulers. Everything is green.
2. GitHub silently disables your workflow because your repository went 60 days without a commit.
3. Vercel Cron keeps running. The database stays warm. The dashboard still says **healthy**.
4. You believe you have four safety nets. You actually have **one**.
5. Something breaks Vercel Cron too — and *now* the project pauses, with no warning.

A naive dashboard reports "healthy" right up to step 5, because step 5 is the first moment the *database* notices a problem.

### How DramaConnect is different

Because the database records **each source separately** (`dc_heartbeat_sources`), it can distinguish two very different questions:

| Question | Naive dashboard | DramaConnect |
|---|---|---|
| Is the database alive? | ✅ Yes | ✅ Yes |
| Are **all my safety nets** alive? | ❌ Cannot tell | ✅ **Names the ones that went quiet** |

### What the function reports

`dc_heartbeat_health()` returns:

| Field | Meaning |
|---|---|
| `status` | `healthy` · `warning` · `critical` · `paused` · `no-heartbeat` |
| `hoursSinceHeartbeat` | Hours since **any** source last pinged |
| `hoursUntilPause` / `daysUntilPause` | Countdown to the 168-hour inactivity window |
| `sourcesTotal` / `sourcesFresh` | How many schedulers exist vs. how many are current |
| `quorum` | `true` when **two or more** independent sources are fresh |
| `singlePointOfFailure` | `true` when exactly **one** source remains — you are one failure from silence |
| `silentSources` | **The names** of the schedulers that stopped reporting |
| `automatedSourcesFresh` | *(v14.1)* Fresh sources **excluding** `site-visit`, `manual-button` and `external` |
| `automatedQuorum` | *(v14.1)* `true` when at least one unattended scheduler is fresh — `false` means only people are keeping the project awake |
| `neverReported` | *(v14.1)* Automated layers that have **never** written a row (e.g. a workflow that was never configured) |

### Where you see it

**Platform Health → Protection layers.** A banner above the table reports the verdict in plain English:

| Verdict | What it means | What to do |
|---|---|---|
| 🟢 *Healthy — 4 of 4 layers reporting, quorum held.* | Multiple independent layers running | Nothing |
| 🟠 *Single point of failure — only one scheduler is still running.* | Database warm, but one failure from silence | Configure a second external layer |
| 🟠 *Only 2 of 4 layers are fresh.* | Some schedulers have died | Check **Gone quiet:** list and repair them |
| 🔴 *Approaching the pause window — X day(s) remain.* | Fewer than 7 days of headroom | Run a heartbeat now (Layer 9) |
| 🔴 *Pause window reached.* | The window has elapsed | Restore at supabase.com, then re-arm two layers |

Sources that have gone quiet are tagged **⚠ SILENT** in the table, so you can see at a glance which scheduler needs attention — *before* you need it.

### Thresholds

| Condition | Status |
|---|---|
| Heartbeat within 72 hours | `healthy` |
| 72–120 hours | `warning` |
| 120–168 hours | `critical` |
| Over 168 hours | `paused` |
| A source silent for over 192 hours (8 days) | marked **SILENT** |

The 8-day threshold for a single source is deliberately more generous than the 7-day pause window, so a **weekly** cron job is never falsely flagged just for being weekly.

> **The rule of two.** Aim for `sourcesFresh >= 2`. One layer means a single provider outage pauses you. Two independent providers means a pause requires both to fail simultaneously — which is what makes this whole system trustworthy.

### Verifying Layer 11 is installed

In the **SQL Editor**, run:

```sql
SELECT status, sources_fresh, sources_total, quorum, silent_sources
FROM dc_heartbeat_health();
```

Wait — the function returns a single `jsonb` value, so use:

```sql
SELECT
  health->>'status'          AS status,
  health->>'sourcesFresh'    AS fresh,
  health->>'sourcesTotal'    AS total,
  health->>'quorum'          AS quorum,
  health->>'daysUntilPause'  AS days_left,
  health->'silentSources'    AS silent
FROM (SELECT public.dc_heartbeat_health() AS health) t;
```

If you see `function public.dc_heartbeat_health() does not exist`, re-run `database/complete-schema.sql`. The page degrades gracefully without it, but you lose the early warning.

---

## Layer 12 — Weekly encrypted database dump

| | |
|---|---|
| **Cost** | Free |
| **Time** | ~15 minutes, once |
| **Value** | The ultimate fallback: a real PostgreSQL dump, independent of DramaConnect itself. |

Layers 1–11 all prevent a pause. **This one assumes everything failed** and ensures you can still rebuild.

> **Changed in v14.1 — heartbeat always, dump opt-in.** The live run history showed this workflow failing whenever its secrets were absent. Now:
>
> - **Without the backup secrets** the run is **green**: it writes a `database-backup` heartbeat (so it still counts as an anti-pause layer, using `assets/js/config.js`) and shows the notice `Unattended backup not enabled` naming the missing secrets. In-app backups (**Admin Data → Backup**) keep working.
> - **With the secrets** it additionally dumps, encrypts, uploads and remotely verifies the archive. A real dump failure is still red — only configuration absence is treated as "not enabled".
> - Full secret-by-secret setup lives in `docs/BACKUP_AND_RECOVERY.md → Unattended encrypted backup to Google Drive`; Steps A–C below are the short version.

The workflow `.github/workflows/database-backup.yml` runs **Sundays at 02:53 UTC**, dumps the database with `pg_dump`, encrypts it with `gpg`, and uploads it to cloud storage via `rclone`.

### Step A — Get the database connection string

1. **Supabase → Project Settings → Database**.
2. Under **Connection string → URI**, copy the string. It looks like:

```
postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-0-eu-west-1.pooler.supabase.com:6543/postgres
```

3. Replace `[YOUR-PASSWORD]` with your real database password.
4. ⚠️ Use the **pooler** host on port `6543`, not the direct host on `5432` — GitHub Actions connects over IPv4.

### Step B — Create a strong passphrase

Generate a long random passphrase, for example:

```bash
openssl rand -base64 32
```

**Store this somewhere safe and separate from the repository.** If you lose it, the backups are unrecoverable. Write it in a password manager or on paper in a safe.

### Step C — Configure rclone and encode it

1. Configure rclone for your destination (Google Drive, Dropbox, S3, Backblaze B2…):

```bash
rclone config
```

2. Print the config as a single base64 line:

```bash
base64 -w 0 ~/.config/rclone/rclone.conf
```

Copy the entire output.

### Step D — Add three secrets

| Secret | Value |
|---|---|
| `SUPABASE_DB_URL` | the connection string from Step A |
| `RCLONE_CONFIG_BASE64` | the base64 string from Step C |
| `BACKUP_PASSPHRASE` | the passphrase from Step B |

### Step E — Test it

**Actions → Encrypted unattended database, Auth and Storage backup → Run workflow.**

**Verify afterwards:** confirm an encrypted `.sql.gpg` file appeared in your cloud destination.

### Step F — Practise a restore (do this once)

An untested backup is not a backup. See `docs/BACKUP_AND_RECOVERY.md` for the restore procedure, and `scripts/restore-database-dump.sh` for the script. Do a practice restore into a throwaway project once, so the real emergency is not the first time you run it.

---

## How to verify the whole system

Work through this once after setup, then once a quarter.

### 1. Every layer has reported

**Platform Health → Protection layers.** You should see a row for each layer you configured, with a recent *Last ping*.

### 2. Quorum is held

The banner must read **Healthy** or **Only N of M layers are fresh** — never **Single point of failure**, and never **Approaching the pause window**.

### 3. The countdown has headroom

`daysUntilPause` should be **greater than 5** at all times. Because layers ping every 1–2 days, it should normally read 6–7.

### 4. Backups are current

**Admin Data → Drive** tab. Confirm a recent backup, and that **Drive** is **Connected**.

### 5. Each workflow ran

**GitHub → Actions.** All three workflows show recent successful runs:

| Workflow | Cadence |
|---|---|
| Supabase resilience heartbeat | Mon & Thu 06:17 UTC |
| Supabase paused-project recovery watchdog | Every 12 hours |
| Encrypted unattended database, Auth and Storage backup | Sun 02:53 UTC |

### 6. The watchdog can see your project

Its last run should say `Project is ACTIVE_HEALTHY. No action needed.`

---

## Reading the Platform Health page

| Panel | Healthy looks like | Unhealthy looks like |
|---|---|---|
| **Database** | *Reachable* | *Unreachable* — check the project at supabase.com |
| **Schema** | *Schema 14.0 · checked …* | Version mismatch — re-run `complete-schema.sql` |
| **Heartbeat** | *Reporting* | *No evidence* — press **💓 Test heartbeat** |
| **Quorum banner** | 🟢 *Healthy — N of M layers reporting* | 🔴 pause countdown, or 🟠 single point of failure |
| **Verified backup** | *Verified* | *Never backed up* — run a Drive or vault backup |
| **License** | *Lifetime* | Expired — see `docs/SITE_LICENSE.md` |
| **Protection layers** | Several rows, none **SILENT** | Rows tagged ⚠ SILENT — repair those schedulers |

---

## Exact errors and exact fixes

| Symptom | Cause | Fix |
|---|---|---|
| `No source rows yet` | No heartbeat has ever run | **Platform Health → 💓 Test heartbeat** |
| `relation "dc_heartbeat_sources" does not exist` | Schema not installed, or installed before resilience existed | Re-run `database/complete-schema.sql` (safe to re-run) |
| `function dc_keep_alive does not exist` | Same as above | Re-run the schema |
| `function dc_heartbeat_health() does not exist` | Schema predates Layer 11 | Re-run the schema. The page works without it but loses early warning |
| `permission denied for function dc_keep_alive` | Grants lost | Re-run the schema |
| Heartbeat stuck on *No evidence* | `heartbeat_days` window too narrow, or no layer runs | **Settings → Resilience**; widen the window; configure Layer 3 |
| `New row violates row-level security policy` | Calling as anon instead of authenticated | Sign in first; never use the `service_role` key in the browser |
| GitHub workflow never triggers | 60-day freeze, or Actions disabled | **Actions** tab → enable workflows; see Layer 4 (secrets are no longer required) |
| ⚠ `Heartbeat not configured` (Layer 3) | No URL/key in secrets, variables **or** `assets/js/config.js` | Fill in `assets/js/config.js` and push |
| ❌ `Heartbeat RPC missing` | Schema not installed on that project | Run `database/complete-schema.sql` |
| ❌ `Heartbeat failed … after 4 attempts` | Project paused, or wrong key | Restore the project; check the anon key in `config.js` |
| ⚠ `Push rejected` (Layer 4) | Workflow permissions are read-only | **Settings → Actions → General → Workflow permissions → Read and write** |
| `Project is PAUSED` in watchdog logs | It worked — the pause happened | Confirm the project is restored at supabase.com |
| ❌ Watchdog `Invalid access token` | Access token wrong/expired | Generate a new token; update `SUPABASE_ACCESS_TOKEN` |
| Watchdog shows `Heartbeat-only mode` | No `SUPABASE_ACCESS_TOKEN` | Normal. Add the token (Layer 10) for automatic restores |
| ℹ `Unattended backup not enabled` | Backup secrets absent (opt-in) | Normal. See Layer 12 to enable dumps |
| `…/functions/v1/ping` returns **404** | Edge Function never deployed | Run **Actions → Deploy Supabase Edge Functions** (Layer 8) |
| `…/functions/v1/ping` returns **401** | `PING_SECRET` set, caller lacks `?token=` | Add the token to the monitor URL, or delete the secret |
| UptimeRobot emails you a failure | Edge Function down, or project paused | Open the function URL in a browser; restore the project if needed |
| `singlePointOfFailure: true` | Only one scheduler running | Add a second external layer (Layer 5 or 7) |
| A source is tagged ⚠ SILENT | That scheduler stopped | Read the layer's section above and re-test it |
| `/api/keep-alive` returns `503 supabase_not_configured` | No env vars and `config.js` still has placeholders | Fill in `config.js` or add env vars; **Redeploy** |
| `/api/keep-alive` returns `401 unauthorized` | `CRON_SECRET` set; manual browser call | Expected once hardened — Vercel's own cron still succeeds |
| Banner: *Only human traffic is keeping the project awake* | No automated layer fresh (`automatedQuorum: false`) | Enable Layers 3, 5, 8 or 10 |
| Apps Script shows *Authorization required* every run | Trigger not authorised | Re-run once manually and click through the consent flow |

---

## Recommended handover checklist

Give this to whoever runs the ministry website. Every box must be ticked.

- [ ] `database/complete-schema.sql` installed → *installed successfully ✅*
- [ ] Layer 1 — `cron.job` query returns `dramaconnect-internal-heartbeat`
- [ ] Layer 3 — GitHub Actions heartbeat: test run **green** with `✅ Heartbeat written and verified`
- [ ] Layer 4 — workflow permissions allow **Read and write**
- [ ] Layer 5 — `/api/keep-alive` returns `"ok":true` (second independent provider)
- [ ] Layer 8 — `…/functions/v1/ping` returns `"ok":true`; UptimeRobot monitor **Up**
- [ ] Layer 9 — **💓 Test heartbeat** pressed once, toast confirmed
- [ ] Layer 10 — watchdog run says `project status: ACTIVE_HEALTHY` (token added)
- [ ] Layer 11 — quorum banner present, **no single point of failure**
- [ ] Layer 12 — one encrypted dump exists in cloud storage
- [ ] Drive backup connected, one manual backup completed and verified
- [ ] **`sourcesFresh` is 2 or greater**
- [ ] Quorum banner shows more than **5 days** of headroom
- [ ] Printed copy of this document stored with the ministry's records
- [ ] Someone **other than** the person who set it up knows how to press **💓 Test heartbeat**

---

## The complete matrix — tick what you have

| # | Layer | Where it runs | Can wake paused? | Setup | Status |
|---|---|---|---|---|---|
| 1 | `pg_cron` heartbeat | Inside Supabase | ❌ No | Automatic | ☐ |
| 2 | Site-visit heartbeat | Members' browsers | ✅ Yes | Automatic | ☐ |
| 3 | GitHub Actions heartbeat | GitHub | ✅ Yes | Automatic (reads `config.js`) | ☐ |
| 4 | Self-committing workflow | GitHub | ✅ Yes | Automatic | ☐ |
| 5 | Vercel Cron | Vercel | ✅ Yes | Automatic on deploy | ☐ |
| 6 | Google Apps Script | Google | ✅ Yes | ~5 min | ☐ |
| 7 | cron-job.org | cron-job.org | ✅ Yes | ~3 min | ☐ |
| 8 | Edge Function + UptimeRobot | Supabase + UptimeRobot | ✅ Yes **+ alerts you** | ~10 min | ☐ |
| 9 | Manual heartbeat button | You | ✅ Yes | 0 min | ☐ |
| 10 | Auto-Restore Watchdog | GitHub | ✅ Un-pauses | Heartbeat automatic; restore needs 1 secret (~3 min) | ☐ |
| 11 | Quorum + dead-scheduler detection | Inside Supabase | ⚠️ Warns you | Automatic | ☐ |
| 12 | Weekly encrypted dump | GitHub | ➖ Rebuilds | ~15 min | ☐ |

**You do not need all twelve.** The recommended configuration is:

> **Layers 1, 2, 3, 4, 5, 9, 11 run with zero setup once deployed.** Spend ~10 minutes adding `SUPABASE_ACCESS_TOKEN` — it unlocks both **Layer 8** (deploy the ping function, then an UptimeRobot monitor that emails you) and **Layer 10** (automatic restore).

That gives you two independent providers, a human override, early warning, and automatic un-pausing. Everything else is defence in depth.

---

## When prevention fails: the 🚑 Disaster Recovery Wizard

If the project is genuinely gone — deleted, unrecoverable, or paused past the point of no return — prevention is over and recovery begins.

**Go to:** **Admin Data → 🚑 Disaster Recovery Wizard**

It walks you through all eight steps: create the fresh project → install the schema → repoint `config.js` → recreate your admin account → reconnect Drive → run the recovery → re-link members → re-arm every safeguard.

Two printable companions exist:

- `docs/DISASTER-RECOVERY-RUNBOOK.md` — the step-by-step runbook
- `docs/BACKUP_AND_RECOVERY.md` — backup strategy and restore procedures

> **A rebuilt site with no heartbeat will simply pause again.** Step 8 of the wizard is not optional.

---

## Appendix — the one-page summary

```
┌──────────────────────────────────────────────────────────────┐
│  SUPABASE PAUSES A FREE PROJECT AFTER 168 HOURS OF SILENCE.  │
│                                                              │
│  Minimum viable protection:                                  │
│    1. Run database/complete-schema.sql                       │
│    2. Add SUPABASE_URL + SUPABASE_ANON_KEY to GitHub         │
│    3. Add a Vercel Cron pointing at /api/keep-alive          │
│    4. Open Platform Health and press  💓 Test heartbeat      │
│    5. Confirm the quorum banner does NOT say                 │
│       "Single point of failure"                              │
│                                                              │
│  Review once a quarter:                                      │
│    • sourcesFresh >= 2                                       │
│    • daysUntilPause > 5                                      │
│    • no source tagged  ⚠ SILENT                              │
│                                                              │
│  If it pauses despite all this:                              │
│    Admin Data → 🚑 Disaster Recovery Wizard                  │
└──────────────────────────────────────────────────────────────┘
```

---

*Last reviewed for DramaConnect v14.1 · Supabase free tier · all tools used are free.*
