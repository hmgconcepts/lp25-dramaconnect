# 📖 DramaConnect Enterprise v5 — Detailed Feature Guide

This document explains **every feature** in the system: what it does, who can use
it, where to find it, and how it works under the hood. All features run on
**free tools** with **no AI API**.

---

## 1. Authentication & Accounts

### 1.1 Sign In
- **Where:** landing page (`index.html`).
- **What:** email + password login via Supabase Auth. On success the user is
  redirected to the dashboard. Already‑signed‑in users are auto‑redirected.

### 1.2 Member Registration (Sign Up) + Admin Approval
- **Where:** landing page → "Request Access".
- **What:** creates a Supabase auth user with the member's full name. A database
  trigger (`handle_new_user`) automatically creates a matching `profiles` row
  with role `member` and status **`pending`**.
- **Approval gate:** a newly registered user **cannot access the platform** until
  an admin approves them. If a pending user tries to sign in, they are shown
  *"Your account is awaiting admin approval"* and are signed out. Admins approve
  (or reject) requests on the **Members** page.
- **Why it matters:** without the trigger, new users would have no profile and
  the dashboard could not display their name or enforce roles.

### 1.3 Forgot Password
- **Where:** landing page → "Forgot password?".
- **What:** sends a secure Supabase reset email. The link returns the user to
  `pages/reset.html` where they set a new password.

### 1.4 Change Password
- **Where:** **My Profile** page.
- **What:** signed‑in users can change their password directly (with confirm +
  minimum‑length validation).

---

## 2. The Command Center (Dashboard)

- **Where:** `pages/dashboard.html` · **Access:** all members.
- **Four live KPIs:** Personnel count, Net Treasury balance, Productions count,
  and **Average Attendance %** (now actually computed from attendance data).
- **Treasury Distribution** — a Chart.js doughnut of income vs. expense.
- **Monthly Cash Flow** — a Chart.js bar chart of the last 6 months of income
  and expense, grouped automatically by month.
- **Upcoming panel** — merges future events and upcoming performances, sorted by
  date, each with a friendly countdown ("In 3 days", "Tomorrow").
- **Latest Announcement** — shows the most recent notices.

---

## 3. Members (Personnel Directory)

- **Where:** `pages/members.html` · **View:** all · **Manage:** admin.
- **Features:**
  - Avatar initials, email, phone, parish, **status** (approved/pending), and
    role badge for every member.
  - **Live search** across name, email, and parish.
  - **Pending Approvals panel (admin):** approve or reject each new access
    request with one click. Promoting a pending user to admin auto-approves them.
  - **Role management (admin):** one click to make a member an admin or demote
    back to member.
  - **Remove members (admin):** delete a member's profile from the platform
    (you cannot remove your own account). Every action is recorded in the
    Activity Log.

---

## 4. Productions & Scripts

- **Where:** `pages/productions.html` · **View:** all · **Manage:** admin.
- **Features:**
  - Card grid of all plays with director, performance date, and a smart status
    badge (**Upcoming / Soon / Completed**) based on the date.
  - Direct **script links** (e.g. Google Drive / Docs — free cloud storage).
  - Admins can **add** and **delete** productions (deleting cascades to casting
    and budget rows).

---

## 5. Casting (Who plays whom)

- **Where:** `pages/casting.html` · **View:** all · **Manage:** admin.
- **Features:**
  - Choose a production, then see its full cast list.
  - Admins **assign a member to a character role** (e.g. "Member A → The Prodigal
    Son") with optional notes. Uses an upsert so re‑assigning updates cleanly.
  - Remove cast assignments individually.

---

## 6. Rehearsals

- **Where:** `pages/rehearsals.html` · **View:** all · **Manage:** admin.
- **Features:**
  - Log rehearsal sessions with a date and a **goal/notes** field
    (e.g. "Act 1 Blocking").
  - Each session shows a live **present count** and a friendly relative date.
  - Direct **"Mark Attendance"** link that opens the Attendance workspace for
    that exact session.

---

## 7. Attendance Workspace

- **Where:** `pages/attendance.html` · **View:** all · **Mark:** admin.
- **Features:**
  - Pick a rehearsal (or arrive pre‑selected from the Rehearsals page).
  - Per‑member dropdown: **Present / Absent / Excused**, saved instantly (upsert).
  - **"Mark All Present"** bulk action for speed.
  - Members (non‑admin) see a read‑only status badge per person.

---

## 8. Finance (Treasury Ledger)

- **Where:** `pages/finance.html` · **View:** all · **Manage:** admin.
- **Features:**
  - Three summary cards: total **Income**, total **Expense**, and **Balance**.
  - Full transaction ledger (date, description, type badge, coloured amount).
  - Admins **record** income/expense transactions (with optional custom date)
    and **delete** entries. Amounts shown in Naira (₦).

---

## 9. Budgets

- **Where:** `pages/budgets.html` · **View:** all · **Manage:** admin.
- **Features:**
  - Admins **allocate a planned budget per production**.
  - Visual allocation cards with the amount and last‑updated date.
  - Designed for "plan vs. record" financial discipline alongside the ledger.

---

## 10. Announcements

- **Where:** `pages/announcements.html` · **View:** all · **Post:** admin.
- **What:** admins publish department‑wide notices (title + message). The newest
  appear on every member's dashboard. Admins can delete old notices.

---

## 11. Events Calendar

- **Where:** `pages/events.html` · **View:** all · **Manage:** admin.
- **What:** schedule events with a **date/time**, **location**, and description.
  Cards show a live countdown; past events are dimmed. Future events also feed
  the dashboard's "Upcoming" panel.

---

## 12. Reports & Exports

- **Where:** `pages/reports.html` · **Access:** all (export is client‑side).
- **Datasets:** Members, Finance Ledger, Productions, **Attendance Report**
  (joined member + rehearsal + status), and Events.
- **Export formats (all free, all in‑browser):**
  - **Excel** (.xlsx) via SheetJS
  - **CSV** via native browser download
  - **PDF** via jsPDF + autoTable (branded header with date)
  - **Print** via the browser's print dialog (print‑optimised CSS)
- **Live preview** table before exporting.

---

## 13. Activity Log (Audit Trail)

- **Where:** `pages/activity.html` · **Access:** admin only.
- **What:** an immutable‑style audit feed of administrative actions (role changes,
  additions, deletions, budget changes, announcements, events). Every relevant
  admin action calls `DB.logActivity(...)` automatically.

---

## 14. My Profile

- **Where:** `pages/profile.html` · **Access:** all members.
- **What:** edit your own full name, phone, and parish; change your password; and
  view your current role badge. Email is read‑only (it's your login identity).

---

## 15. Cross‑Cutting Enterprise Enhancements

### 15.1 Professional UI Toolkit (`ui.js`)
- **Toasts** replace jarring `alert()` pop‑ups (success/error/warning/info).
- **Modals & promise‑based confirm dialogs** for safe deletes.
- **Full‑screen loaders** during network operations.

### 15.2 Dark Mode
- One‑click toggle in the sidebar, **persisted** in `localStorage`, applied early
  to avoid flashes.

### 15.3 Progressive Web App (PWA) + Install Prompt
- `manifest.json` + `sw.js` make the app **installable** and cache the UI shell
  for **offline** viewing. Supabase/API calls always go to the network and are
  never cached.
- **Automatic install prompt (`install.js`):** while using the platform, the user
  sees a friendly banner inviting them to **install the app**. On
  Chrome/Edge/Android it triggers the native install dialog; on iOS Safari it
  shows "Tap Share → Add to Home Screen". The prompt is dismissible and won't
  reappear for 14 days, and never shows once the app is already installed.

### 15.4 Responsive & Mobile
- Collapsible **mobile drawer** navigation; layouts adapt from phone to desktop.

### 15.5 Security Hardening
- **Recursion‑safe RLS** using a `SECURITY DEFINER is_admin()` helper (fixes the
  classic "infinite recursion detected in policy" error).
- **XSS protection:** all dynamic, user‑supplied text is HTML‑escaped via
  `UI.esc()` before insertion into the DOM.
- **Defence in depth:** role checks in the UI **and** enforced by database RLS.
- The browser only ever holds the **anon** key; the `service_role` key is never
  shipped.

### 15.6 Feature Flags (`config.js`)
- `CONFIG.FEATURES` lets you toggle modules on/off without deleting code.

---

## Free‑Tools / No‑AI Commitment

Every capability above is delivered with **free, open tooling** and **no paid AI
API**. Charts, exports, PDF generation, and offline support all run **client‑side
in the browser**, so there is **no server compute cost**. Supabase's free tier
handles the database and authentication.
