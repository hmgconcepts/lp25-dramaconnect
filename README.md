# 🎭 DramaConnect Enterprise v13.2 — RCCG LP 25 Drama Department

DramaConnect is a complete institutional management hub for the RCCG LP 25
Drama Department. It can operate within the free allowances of Supabase and a
static host for modest usage and requires no paid AI API. Provider plans, quotas,
and pricing can change, so confirm current limits before rollout.

> Architected by **Adewale Samson Adeagbo** · HMG Concepts
> DataTech • EdTech • FaithTech

---

## ✨ v13 feature set (resilience-maintained v13.2 build)

### New in v13.2: resilience and verified backup

- Ten-layer, source-visible Supabase inactivity protection: browser visit, GitHub schedule, Edge monitor, optional `pg_cron`, manual heartbeat, cron-job.org, Vercel Cron, Apps Script, workflow-preservation commit and Management API recovery watchdog.
- Full portable export of all **22** application/configuration tables with stable pagination, completeness manifest, row counts, per-table SHA-256 hashes and a full archive seal.
- Approved-admin merge restore with database-backed concurrency leases, completion/failure history, precise row reports and an explicit degraded disaster-recovery mode.
- Google Identity Services + least-privilege `drive.file`, a dedicated per-account folder, verified upload/list/download/restore/delete, retention and visit-triggered scheduling without unsolicited OAuth popups.
- Private Supabase archive vault plus an encrypted, unattended weekly `pg_dump` workflow for true closed-browser backup.

Operational setup: **[Supabase protection](docs/SUPABASE_FREE_TIER_PROTECTION.md)** · **[Backup and recovery](docs/BACKUP_AND_RECOVERY.md)** · **[Incident runbook](docs/RESILIENCE_RUNBOOK.md)**


| New in v13 | Description |
| :-- | :-- |
| 🌐 **Multi‑language (English / Yorùbá)** | One‑click language switch in the sidebar (persists per device); extendable dictionary in `assets/js/i18n.js`. |
| 🧑‍🤝‍🧑 **Per‑unit dashboard ("My Unit")** | Unit leaders get a focused view of their unit: members, avg attendance, open tasks, monthly birthdays, and one‑click "Message My Unit". |
| 📥 **Excel + CSV member import** | Bulk‑create logins from `.xlsx/.xls` as well as `.csv`. |
| ✂️ **Photo cropping before upload** | A free, built‑in (no library) drag‑to‑pan + zoom **square cropper** for profile photos and gallery images. |
| 🧑‍✈️ **Unit-leader permissions** | Admins can mark approved members as **Unit Leaders**. Leaders can upload gallery media and delete only their own uploads; profile, role, unit, approval, and account management remain administrator-only. |
| 🖼️ **Org‑wide Photo Gallery** | Albums for productions/events with upload (admins + leaders), album filter, and a fullscreen lightbox. |
| 💡 **Suggestion Box** | Members submit ideas/feedback (optionally **anonymous**); admins triage with statuses (new/reviewed/actioned/closed). |

---

## ✨ What's New in v12 (carried over)

| New in v12 | Description |
| :-- | :-- |
| 📸 **Profile photo uploads** | Members upload a photo (free Supabase Storage) shown on their **digital ID card**, the **Directory** and the **Members** list. Each user manages only their own photo (storage RLS). |
| 📇 **Member Directory** | A photo‑rich, searchable card grid with units filter and one‑tap WhatsApp/Email/social links. |
| 🚑 **Emergency / Next‑of‑kin contact** | Captured on the profile — essential safeguarding info for any real organisation. |
| ❓ **Help & FAQ page** | Searchable in‑app answers + a "Message an Admin" shortcut for onboarding. |
| 🪪 **ID card with real photo** | The digital ID now shows the uploaded photo (initials fallback). |

---

## ✨ What's New in v11 (carried over)

| New in v11 | Description |
| :-- | :-- |
| 🧑‍💼 **Rich member profiles** | Phone, WhatsApp, birthday (month+day only), gender, occupation, drama unit, home address & social links (Facebook, Instagram, TikTok, X). Members **complete their own details later** — ideal for admin‑created accounts. |
| 📊 **Profile completion meter** | Shows each member how complete their profile is. |
| 🎂 **Automatic birthday greetings** | A free **birthday‑bot** Edge Function posts Inbox + department greetings (and optional email) every birthday. Plus a **Birthdays** page with one‑tap WhatsApp/Email greetings. |
| 👥 **Bulk CSV account creation** | Admins create many logins at once and download a credential sheet. |
| 📈 **Attendance Analytics** | Per‑member attendance rate %, chart, KPIs & Excel export. |
| 🪪 **Printable ID cards** | Each member gets a branded membership card with a QR code (print or save as PDF). |

---

## ✨ What's New in v10 (carried over)

| New in v10 | Description |
| :-- | :-- |
| 🆕 **Admin creates member logins** | Admins add members who haven't signed up and **generate their login credentials** (auto‑generated or chosen password), then hand them over via Copy/WhatsApp/Email. Powered by a secure Edge Function (service_role server‑side only). |
| 📍 **Member self check‑in** | Admin opens a **check‑in code** for a rehearsal; members mark **their own** attendance by entering the code. |
| 📅 **Event RSVP** | Members RSVP **Going / Maybe / No**; admins see counts and the full RSVP list. |
| 🔒 **Granular RLS** | New per‑row policies so members manage only their own attendance & RSVPs. |

---

## ✨ What's New in v9 (carried over)

| New in v9 | Description |
| :-- | :-- |
| 🏠 **My Dashboard (personalized home)** | Each member's landing page: greeting, unread messages, open tasks, next rehearsal/event, announcements & quick actions. Login now lands here. |
| 🔔 **Notifications bell** | A header bell on every page showing unread messages + open tasks, with a live count. |
| 📁 **Resource Library** | Scripts, documents, audio, video & links (stored free on Drive/YouTube) with category filters. |
| 🗳️ **Polls & Voting** | Admins create polls; members vote; live results bars. One vote per member (changeable). |
| ⏰ **Fully-automatic reminders** | Optional free Supabase **scheduled** Edge Function (`run-reminders`) auto-posts due reminders to the Inbox — no admin action needed. The in-app "Send now" still works without it. |

---

## ✨ What's New in v8 (carried over)

v8 makes the platform fully **self-contained** — communication, coordination &
supervision all happen **inside** the platform — and embeds the HMG brand.

| New in v8 | Description |
| :-- | :-- |
| 📥 **In-platform Inbox** | Private member↔admin & broadcast messages **inside the app** (no external app needed). Unread badge in the sidebar. |
| 👥 **Two-way communication** | Members can message the **admins/leadership**; admins can message any member or broadcast to all. |
| ✅ **Tasks & assignments** | Admins assign tasks (with due date & priority); members update their own status. Assignees are auto-notified in their Inbox. |
| 🔔 **Scheduled reminders** | Recurring reminder templates (daily/weekly/monthly) with a one-click "Send now" to everyone's Inbox + auto-reschedule. |
| 🧑‍✈️ **Coordinate & supervise** | Admins run admin/coordination/supervision functions end-to-end from the platform. |
| 🏷️ **HMG brand embedded** | "Powered by HMG Concepts" in the sidebar + a full ecosystem showcase (Academy · Technologies · Media · Gospel) on the Bio page. |

> The earlier **WhatsApp/Email broadcast** tool is **retained** as an *external*
> outreach option — but day-to-day messaging now lives inside the platform.

---

## ✨ What's New in v7 (carried over)

v7 keeps **every** existing feature and adds messaging + notifications:

| New in v7 | Description |
| :-- | :-- |
| 📨 **Messaging Center (admin)** | Send **WhatsApp** or **Email** to members — **individually or collectively** (All / Members / Admins / one person). Free; uses your own WhatsApp & email, no API. |
| 💬 **Quick contact on Members page** | One‑tap WhatsApp/Email icons per member. |
| 🔔 **Approval notifications** | On approval, a popup offers to notify the member via WhatsApp/Email. Plus an **optional** auto‑email Edge Function (free Resend). |
| 🗂️ **Message history** | Every broadcast is logged and reviewable. |
| ✅ **Setup checklist** | `docs/SETUP_CHECKLIST.md` — tick‑box first‑time setup. |

### Carried over from v6 (still here)

| Feature | Description |
| :-- | :-- |
| 🧭 **Resilient navigation** | Menu structure uses **local CSS** and remains available when the Tailwind CDN is unavailable. |
| 🛟 **Low‑bandwidth mode** | `boot.js` + `fallback.css` keep the app usable if the CDN fails. |
| ⚙️ **Settings & Backup** · 💾 **JSON backup** · 📥 **CSV roster import** | Admin tools. |

### Carried over from v5 (still here)

| Feature | Description |
| :-- | :-- |
| 🔔 Announcements · 📆 Events · 🎭 Casting · ✅ Attendance · ⚖️ Budgets | Full modules |
| 🧾 Activity Log | Every admin action recorded |
| 👮 **Admin approval workflow** | New sign‑ups are `pending` until an admin approves |
| 👥 **Member management** | Make admin / demote / remove / approve / reject |
| 🌙 Dark mode · 📲 PWA install prompt · 🔑 Password reset & change | UX |
| 🔍 Search · toasts · modals · loaders | Polished UX (no `alert()`) |
| 📤 CSV + Excel + PDF + Print exports | Reporting in 4 formats |
| 🛡️ Hardened security | Recursion‑safe RLS, XSS‑escaped rendering, role guards |
| 🖼️ Developer photo | Real photo on the Developer Bio page |

See **[docs/FEATURES.md](docs/FEATURES.md)** for a detailed explanation of every feature.

---

## 🧱 Technical Architecture

| Layer | Technology | Why (cost) |
| :-- | :-- | :-- |
| Frontend | HTML5 + Tailwind (CDN) + vanilla JS | No build step, no framework cost |
| Backend | **Supabase** free tier | PostgreSQL + Auth + RLS |
| Hosting | GitHub Pages / Cloudflare Pages / Vercel (free) | Global CDN |
| Charts | Chart.js (CDN) | Free, lightweight |
| Exports | SheetJS + jsPDF + autoTable (CDN) | 100% client‑side, zero server cost |
| Limited offline shell | Service Worker + Web App Manifest; live data stays network-dependent | Native browser APIs |

**No AI API is used anywhere** — by design, to keep the system free to operate.

---

## 📂 Folder Structure

```
lp25-dramaconnect/
├── index.html              # Landing + login / signup / forgot password
├── manifest.json           # PWA manifest
├── sw.js                   # Service worker (offline shell)
├── .nojekyll               # Lets GitHub Pages serve all folders as-is
├── assets/
│   ├── css/
│   │   ├── style.css       # Theme + components + app-shell navigation (local)
│   │   └── fallback.css    # Styles used if the Tailwind CDN fails to load
│   ├── img/
│   │   ├── rccg_logo.png   # Official RCCG logo
│   │   └── developer.jpg   # Developer photo (Bio page)
│   ├── icons/              # Favicons + PWA icons (generated from logo)
│   └── js/
│       ├── boot.js         # CDN-resilience guard (low-bandwidth mode)
│       ├── config.js       # Supabase client init + feature flags
│       ├── ui.js           # Toasts, modals, loaders, dark mode
│       ├── auth.js         # Sign in/up, reset, approval gate, guards
│       ├── db.js           # Data access layer + portable archive compatibility
│       ├── resilience.js   # Heartbeats, health, backup leases and run metadata
│       ├── data-portability.js # 22-table sealed export + safe restore + vault
│       ├── drive-sync.js   # GIS / Drive file backup, retention and scheduler
│       ├── utils.js        # Currency/date/CSV/export helpers
│       ├── layout.js       # Shared sidebar + header (local-CSS navigation)
│       └── install.js      # PWA install prompt
├── pages/                  # 31 authenticated app pages + reset page
│   ├── home.html       dashboard.html  members.html      directory.html
│   ├── productions.html casting.html   rehearsals.html   attendance.html
│   ├── analytics.html  finance.html    budgets.html      inventory.html
│   ├── myunit.html     inbox.html
│   ├── announcements.html tasks.html   messaging.html    events.html
│   ├── birthdays.html  gallery.html    polls.html        suggestions.html
│   ├── resources.html  idcard.html     reports.html      reminders.html
│   ├── activity.html   settings.html   profile.html      help.html
│   ├── portfolio.html  reset.html
├── database/
│   ├── schema.sql                # Full schema + RLS + triggers
│   ├── repair_and_upgrade.sql    # Legacy schema/upgrade prerequisite
│   ├── security_hardening.sql    # Required least-privilege hardening (run second)
│   └── resilience_and_backup.sql # Heartbeat, backup leases/vault (run third)
├── supabase/functions/
│   ├── notify-approval/index.ts      # OPTIONAL auto approval email
│   ├── run-reminders/index.ts        # OPTIONAL scheduled auto reminders
│   ├── birthday-bot/index.ts         # OPTIONAL automatic birthday greetings
│   ├── admin-create-member/index.ts  # Admin creates member logins
│   └── ping/index.ts                 # Secret-protected external heartbeat
├── api/keep-alive.js                 # Secret-protected Vercel Cron endpoint
├── .github/workflows/                # Heartbeat, recovery and encrypted backup
├── scripts/                          # Verification, monitors and guarded restore
└── docs/
    ├── SETUP_CHECKLIST.md       # Tick‑box first‑time setup
    ├── DEPLOYMENT.md            # Step‑by‑step deployment (3 free hosts)
    ├── FEATURES.md              # Detailed explanation of every feature
    ├── ADMIN_CREATE_MEMBER.md   # Admin-created logins (Edge Function)
    ├── SCHEDULED_REMINDERS.md   # Optional fully-automatic reminders
    ├── BIRTHDAY_BOT.md          # Optional automatic birthday greetings
    ├── PHOTO_UPLOADS.md         # Profile photos via Supabase Storage
    ├── EMAIL_NOTIFICATIONS.md   # Optional automated approval emails
    ├── SUPABASE_FREE_TIER_PROTECTION.md # Protection-layer operations
    ├── BACKUP_AND_RECOVERY.md   # Drive, dump, Storage and restore guide
    ├── RESILIENCE_RUNBOOK.md    # Incident response and recovery drills
    └── USER_GUIDE.md            # End‑user manual
```

---

## 🚀 Quick Start (5 minutes)

1. **Create a Supabase project** (free) → in the SQL Editor run
   `database/repair_and_upgrade.sql`, then run
   `database/security_hardening.sql`, then
   `database/resilience_and_backup.sql`. They are designed to be safely re-run in
   that order; the latter two migrations are required for the fixed authorization,
   resilience, backup-vault and restore model.
2. **Paste your credentials** into `assets/js/config.js` (`SUPABASE_URL`, `SUPABASE_KEY`).
3. **Upload the contents of the project folder** to GitHub Pages /
   Cloudflare Pages / Vercel (so `index.html` is at the site root).
4. **Sign up** in the app, then make yourself admin (edit the email line in
   `repair_and_upgrade.sql`, or run):
   `UPDATE profiles SET role='admin', status='approved' WHERE email='you@example.com';`
5. Configure at least one daily external heartbeat and one encrypted off-site
   backup using the linked protection and recovery guides above.

Full, unambiguous instructions: **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.

---

## 👥 Roles & Permissions

| Capability | Member | Admin |
| :-- | :-: | :-: |
| View approved-member directory and department operations | ✅ | ✅ |
| View full private profiles and RSVP identities | Own profile / own RSVP only | ✅ |
| Edit own profile & password | ✅ | ✅ |
| Add/edit/delete productions, finance, rehearsals | ❌ | ✅ |
| Manage casting, budgets, attendance | ❌ | ✅ |
| Post announcements & events | ❌ | ✅ |
| Approve/reject, change role/unit/leader, permanently delete accounts | ❌ | ✅ |
| View Activity Log (audit) | ❌ | ✅ |
| Configure resilience, export/verify/restore archives, use Drive/vault | ❌ | ✅ |

Permissions are enforced **both** in the UI **and** at the database via RLS.

---

## 🔐 Security Notes

- The `SUPABASE_KEY` in `config.js` is the **anon/publishable** key — safe to ship
  to the browser. It only grants what your RLS policies allow.
- **Never** put the `service_role` key in any front‑end file. It is optional only
  as a protected GitHub Actions secret for the unattended Storage-byte export.
- Keep database URLs, Management API tokens, rclone configuration, cron/ping
  secrets and backup passphrases server-side. See the operational guides for the
  exact secret-to-provider mapping and rotation procedure.
- Dynamic content is rendered through escaped text, validated URLs, constrained
  values, or explicit trusted-markup boundaries to reduce XSS risk.

---

## 📝 License & Attribution

Built for the RCCG LP 25 Drama Department. Architecture & development by
**Adewale Samson Adeagbo / HMG Concepts**.
