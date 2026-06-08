# 🎭 DramaConnect Enterprise v9 — RCCG LP 25 Drama Department

DramaConnect is a complete, **zero‑cost institutional management hub** for the
RCCG LP 25 Drama Department. It runs entirely on **free‑tier tools** (Supabase +
static hosting) and requires **no paid AI API** — keeping running costs at
**₦0/month**.

> Architected by **Adewale Samson Adeagbo** · HMG Concepts
> DataTech • EdTech • FaithTech

---

## ✨ What's New in v9 (this `enterprise v4` build)

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
| 🧭 **Bulletproof navigation** | Menu uses **local CSS**, not the Tailwind CDN — always works on budget tablets / weak connections. |
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
| Offline | Service Worker + Web App Manifest | Native browser APIs |

**No AI API is used anywhere** — by design, to keep the system free to operate.

---

## 📂 Folder Structure

```
enterprise v4/
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
│       ├── db.js           # Data access layer (all tables + backup/bulk)
│       ├── utils.js        # Currency/date/CSV/export helpers
│       ├── layout.js       # Shared sidebar + header (local-CSS navigation)
│       └── install.js      # PWA install prompt
├── pages/                  # 24 authenticated app pages
│   ├── home.html       dashboard.html  members.html      productions.html
│   ├── casting.html    rehearsals.html attendance.html   finance.html
│   ├── budgets.html    inbox.html      announcements.html tasks.html
│   ├── messaging.html  events.html     polls.html        resources.html
│   ├── reports.html    reminders.html  activity.html     settings.html
│   ├── profile.html    portfolio.html  reset.html
├── database/
│   ├── schema.sql                # Full schema + RLS + triggers
│   └── repair_and_upgrade.sql    # All-in-one setup/repair (run this once)
├── supabase/functions/
│   ├── notify-approval/index.ts  # OPTIONAL auto approval email
│   └── run-reminders/index.ts    # OPTIONAL scheduled auto reminders
└── docs/
    ├── SETUP_CHECKLIST.md      # Tick‑box first‑time setup
    ├── DEPLOYMENT.md           # Step‑by‑step deployment (3 free hosts)
    ├── FEATURES.md             # Detailed explanation of every feature
    ├── EMAIL_NOTIFICATIONS.md  # Optional automated approval emails
    ├── SCHEDULED_REMINDERS.md  # Optional fully-automatic reminders
    └── USER_GUIDE.md           # End‑user manual
```

---

## 🚀 Quick Start (5 minutes)

1. **Create a Supabase project** (free) → run `database/repair_and_upgrade.sql`
   in the SQL Editor (it creates everything and is safe to re-run).
2. **Paste your credentials** into `assets/js/config.js` (`SUPABASE_URL`, `SUPABASE_KEY`).
3. **Upload the contents of the `enterprise` folder** to GitHub Pages /
   Cloudflare Pages / Vercel (so `index.html` is at the site root).
4. **Sign up** in the app, then make yourself admin (edit the email line in
   `repair_and_upgrade.sql`, or run):
   `UPDATE profiles SET role='admin', status='approved' WHERE email='you@example.com';`

Full, unambiguous instructions: **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.

---

## 👥 Roles & Permissions

| Capability | Member | Admin |
| :-- | :-: | :-: |
| View all data (dashboard, members, finance, etc.) | ✅ | ✅ |
| Edit own profile & password | ✅ | ✅ |
| Add/edit/delete productions, finance, rehearsals | ❌ | ✅ |
| Manage casting, budgets, attendance | ❌ | ✅ |
| Post announcements & events | ❌ | ✅ |
| Promote/demote members | ❌ | ✅ |
| View Activity Log (audit) | ❌ | ✅ |

Permissions are enforced **both** in the UI **and** at the database via RLS.

---

## 🔐 Security Notes

- The `SUPABASE_KEY` in `config.js` is the **anon/publishable** key — safe to ship
  to the browser. It only grants what your RLS policies allow.
- **Never** put the `service_role` key in any front‑end file.
- All user‑supplied content is HTML‑escaped before rendering (XSS protection).

---

## 📝 License & Attribution

Built for the RCCG LP 25 Drama Department. Architecture & development by
**Adewale Samson Adeagbo / HMG Concepts**.
