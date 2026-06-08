# 🎭 DramaConnect Enterprise v5 — RCCG LP 25 Drama Department

DramaConnect is a complete, **zero‑cost institutional management hub** for the
RCCG LP 25 Drama Department. It runs entirely on **free‑tier tools** (Supabase +
static hosting) and requires **no paid AI API** — keeping running costs at
**₦0/month**.

> Architected by **Adewale Samson Adeagbo** · HMG Concepts
> DataTech • EdTech • FaithTech

---

## ✨ What's New in v5

v5 keeps **every** existing feature and adds an enterprise layer on top:

| New in v5 | Description |
| :-- | :-- |
| 🔔 **Announcements** | Department‑wide notices, shown on the dashboard. |
| 📆 **Events Calendar** | Schedule meetings/performances with location & countdown. |
| 🎭 **Dedicated Casting page** | Assign characters to members per production. |
| ✅ **Attendance workspace** | Per‑member present/absent/excused with "mark all". |
| ⚖️ **Budgets page** | Allocate planned budgets per production. |
| 🧾 **Activity Log (audit trail)** | Every admin action recorded. |
| 🌙 **Dark mode** | Persisted, one‑click theme toggle. |
| 📲 **PWA / installable + offline shell** | Add to home screen; works offline for the UI. |
| 🔑 **Password reset + change password** | Self‑service account recovery. |
| 🔍 **Search, toasts, modals, loaders** | Polished, professional UX (no more `alert()`). |
| 📤 **CSV + Excel + PDF + Print exports** | One‑click reporting in 4 formats. |
| 🛡️ **Hardened security** | Recursion‑safe RLS, XSS‑escaped rendering, role guards. |

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
dramaconnect/
├── index.html              # Landing + login / signup / forgot password
├── manifest.json           # PWA manifest
├── sw.js                   # Service worker (offline shell)
├── assets/
│   ├── css/style.css       # Theme + components (plain CSS, dark mode)
│   ├── img/rccg_logo.png   # Official RCCG logo
│   ├── icons/              # Favicons + PWA icons (generated from logo)
│   └── js/
│       ├── config.js       # Supabase client init + feature flags
│       ├── ui.js           # Toasts, modals, loaders, dark mode
│       ├── auth.js         # Sign in/up, reset, session guards
│       ├── db.js           # Data access layer (all tables)
│       ├── utils.js        # Currency/date helpers + export engine
│       └── layout.js       # Shared sidebar + header + PWA register
├── pages/                  # 15 authenticated app pages
│   ├── dashboard.html  members.html   productions.html  casting.html
│   ├── rehearsals.html attendance.html finance.html      budgets.html
│   ├── announcements.html events.html  reports.html      activity.html
│   ├── profile.html    portfolio.html  reset.html
├── database/schema.sql     # One‑click Supabase schema + RLS + triggers
└── docs/
    ├── DEPLOYMENT.md       # Step‑by‑step deployment (3 free hosts)
    ├── FEATURES.md         # Detailed explanation of every feature
    └── USER_GUIDE.md       # End‑user manual
```

---

## 🚀 Quick Start (5 minutes)

1. **Create a Supabase project** (free) → run `database/schema.sql` in the SQL Editor.
2. **Paste your credentials** into `assets/js/config.js` (`SUPABASE_URL`, `SUPABASE_KEY`).
3. **Upload the `dramaconnect` folder** to GitHub Pages / Cloudflare Pages / Vercel.
4. **Sign up** in the app, then make yourself admin:
   `UPDATE profiles SET role='admin' WHERE email='you@example.com';`

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
