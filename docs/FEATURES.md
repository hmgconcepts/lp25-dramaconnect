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

### 15.7 CDN‑Resilient Navigation & Low‑Bandwidth Mode (NEW in v6)
- **The problem we fixed:** the navigation used to rely on Tailwind's responsive
  CSS classes (`lg:flex`, `lg:hidden`), which only work if the Tailwind CDN
  script finishes loading. On budget tablets (e.g. **Itel Vista Tab 30s**) or
  weak connections, that large CDN script can fail — leaving the menu hidden and
  unreachable (it only appeared when split‑screen changed the width/timing).
- **The fix:** the entire app shell (sidebar, hamburger button, mobile/tablet
  drawer) is now driven by **our own local CSS** in `style.css`
  (`.app-shell`, `.app-sidebar`, `.nav-toggle`, `.app-drawer`). Local CSS always
  loads with the page, so **navigation works on every device**, online or with a
  flaky CDN. The hamburger uses a Unicode ☰ so it shows even if Font Awesome
  fails.
- **Low‑bandwidth mode (`boot.js` + `fallback.css`):** after load, `boot.js`
  checks whether Tailwind actually initialised. If not, it adds a `no-tailwind`
  class so `fallback.css` supplies essential layout/typography, and shows a small
  notice: *"Running in low‑bandwidth mode — some styling is simplified, but all
  features work."* The core experience never breaks.

## 16. Settings & Backup (NEW in v6, admin only)

- **Where:** `pages/settings.html` · **Access:** admin only.
- **Department Profile:** store the department name, province, leader, and
  contact (saved on the device for quick reference and report headers).
- **Full Data Backup:** one click downloads a complete **JSON snapshot** of every
  table (`DB.exportAll()`) — your free, portable disaster‑recovery copy.
- **Bulk Member CSV:** parse a roster spreadsheet
  (`full_name,email,phone,parish`). Because a login profile is tied to a Supabase
  auth user, members still sign up with those emails (their profile is then
  auto‑created); the importer prepares and validates the roster.
- **Appearance:** dark/light toggle. **System Information:** app, version,
  backend, your role, and whether the app is installed as a PWA.

---

## 17. Messaging Center (NEW in v7, admin only)

- **Where:** `pages/messaging.html` · **Access:** admin only.
- **Purpose:** send messages to members — **individually or collectively** — via
  **WhatsApp** or **Email**, completely free (it uses the admin's own WhatsApp
  and email; no paid API and no per‑message cost from us).
- **Audiences:** *All approved members*, *Members only*, *Admins only*, or *a
  specific member*.
- **WhatsApp:**
  - *Individual* → opens WhatsApp with that member's number and your message
    pre‑filled; just press send.
  - *Group* → copies your message to the clipboard and opens each member's chat
    in turn, so you can also paste it into your department WhatsApp group.
  - Phone numbers are auto‑normalised to international format (defaults to
    Nigeria `+234`, handles `0…`, `+234…`, `234…`, and bare 10‑digit numbers).
- **Email:**
  - *Individual* → opens your email app addressed to the member.
  - *Group* → opens your email app with everyone added as **BCC** (privacy‑safe),
    subject and body pre‑filled.
- **Quick templates:** one‑tap rehearsal reminder, event invite, availability
  check.
- **Message History:** every send is logged (channel, audience, recipients,
  subject, body, who sent it) and can be reviewed or deleted.
- **From the Members page:** each member row also has quick **WhatsApp** and
  **Email** icons for instant one‑to‑one contact.

## 18. Approval Notifications

- **Built‑in (zero setup):** when an admin approves a member, a popup offers to
  notify them via **WhatsApp** or **Email** (pre‑filled with a sign‑in link) —
  free, using the admin's own apps.
- **Optional automated emails:** deploy the included Supabase Edge Function
  (`supabase/functions/notify-approval`) with a free Resend account to send
  approval emails **automatically**. Full steps in
  `docs/EMAIL_NOTIFICATIONS.md`. This is optional and uses only free tiers.

---

## 19. In‑Platform Inbox (NEW in v8 — everyone)

- **Where:** `pages/inbox.html` · **Access:** all members.
- **Purpose:** private messaging that stays **inside DramaConnect** — no external
  app required. This is the self‑contained communication layer.
- **Admins can:** message any individual member, or **broadcast to all members**.
- **Members can:** message the **Department Admins (leadership)**, or any
  individual member. This is how members "message the admin" from the platform.
- **Received / Sent tabs**, unread **NEW** badges, mark‑as‑read, and delete.
- **Sidebar unread badge:** a red count appears on the *Inbox* link.
- **Privacy by RLS:** you can only read a message if you sent it, it's addressed
  to you, it's an all‑members broadcast, or it's a "to admins" message and you're
  an admin. Enforced at the database, not just the UI.

## 20. Tasks & Assignments (NEW in v8)

- **Where:** `pages/tasks.html` · **Assign:** admin · **Update status:** the
  assignee (or admin).
- **Admins** assign a task with title, details, **assignee**, **due date**, and
  **priority** (low/normal/high). The assignee is **auto‑notified in their
  Inbox**.
- **Members** see *My Tasks* and update status: Open → In progress → Done.
- **Supervision:** admins see *all* tasks, filter by status, spot **overdue**
  items (highlighted), and delete tasks. This powers the admin's coordinating &
  supervising role from within the platform.

## 21. Scheduled Reminders (NEW in v8, admin)

- **Where:** `pages/reminders.html` · **Access:** admin only.
- Create **recurring** reminder templates (once / daily / weekly / monthly) with
  an audience (all / members / admins) and a first run date‑time.
- When a reminder is **due**, a **"Send now"** button posts it to everyone's
  in‑platform Inbox and **auto‑reschedules** the next run (or deactivates a
  "once" reminder).
- **Why this design (free & no server):** truly automatic server‑side scheduling
  would need a paid cron/always‑on worker. This approach keeps the system at
  **₦0/month** while still giving one‑click recurring reminders. *(Optional: you
  can later wire a free Supabase scheduled Edge Function to fully automate it.)*

## 22. Brand Embedding — HMG Concepts

- **Sidebar:** a "Powered by **HMG Concepts** — EdTech · DataTech · FaithTech"
  link on every page.
- **Developer Bio page:** full founder profile (Adewale Samson Adeagbo) and the
  **HMG ecosystem** — Academy, Technologies, Media, Gospel — each linking to its
  live site, plus portfolio and WhatsApp.

---

## 23. My Dashboard — Personalized Home (NEW in v9 — everyone)

- **Where:** `pages/home.html` · **Access:** all members. Login now lands here.
- A personal, at-a-glance view: time-aware greeting, your **unread messages**,
  **open tasks**, **next rehearsal** and **next event**, your task list, recent
  messages, latest announcements, and **quick action** buttons.
- The original full analytics dashboard is retained as **Command Center**
  (`dashboard.html`).

## 24. Notifications Bell (NEW in v9 — everyone)

- A **bell icon** in the header of every page, with a red **count** of items
  needing attention (unread inbox messages + your open tasks). Click it for a
  dropdown that links straight to the Inbox or Tasks.

## 25. Resource Library (NEW in v9)

- **Where:** `pages/resources.html` · **View:** all · **Manage:** admin.
- A categorised library of **scripts, documents, audio, video, images & links**.
  Files are stored **free** on Google Drive / YouTube / Dropbox; you paste the
  share link. Members filter by category and open resources in one click.

## 26. Polls & Voting (NEW in v9)

- **Where:** `pages/polls.html` · **Create/close:** admin · **Vote:** all.
- Admins create a poll with 2+ options; members vote (one vote each, changeable)
  and see **live result bars** with percentages. Admins can close/reopen or
  delete polls. Great for picking rehearsal dates, roles, themes, etc.

## 27. Fully-Automatic Reminders (NEW in v9 — optional)

- The included **scheduled** Edge Function `supabase/functions/run-reminders`
  (with Supabase Cron) posts **due** reminders to everyone's Inbox automatically
  and reschedules them — **no admin action**. All on free tiers.
- Full steps: `docs/SCHEDULED_REMINDERS.md`. The manual **"Send now"** button on
  the Reminders page keeps working with or without this function.

---

## 28. Admin-Created Member Logins (NEW in v10)

- **Where:** `pages/members.html` → "Add Member & Create Login" · **Admin only.**
- Admins create a complete login account for someone who **hasn't signed up**:
  enter name + email (password optional — leave blank to **auto-generate** a
  strong one), optionally mark them admin, and click **Create Account**.
- A popup returns the **email + password** with **Copy / WhatsApp / Email**
  buttons to deliver the credentials. The new member is auto-approved and can
  change their password under My Profile.
- **Security:** account creation runs in the secure `admin-create-member` Edge
  Function — the Supabase **service_role** key is used **server-side only**,
  never in the browser, and the function verifies the caller is an admin first.
  Setup: `docs/ADMIN_CREATE_MEMBER.md`.

## 29. Member Self Check-In (NEW in v10)

- **Where:** `pages/attendance.html`.
- **Admin:** for a selected rehearsal, set a **check-in code** and click **Open
  check-in** (a "Generate" button creates a random code). Close it anytime.
- **Member:** selects the rehearsal, enters the code, and taps **Check In** to
  mark **their own** attendance as present. Enforced by RLS (members can only
  write their own attendance row) and by code + open-window validation.

## 30. Event RSVP (NEW in v10)

- **Where:** `pages/events.html`.
- **Members** RSVP to each upcoming event: **Going / Maybe / No** (one response,
  changeable). Each card shows live **going/maybe counts**.
- **Admins** can **View RSVPs** to see exactly who responded in each category —
  useful for planning logistics and follow-up.

---

## 31. Rich Member Profiles & Self-Completion (NEW in v11)

- **Where:** `pages/profile.html` · **Access:** all members.
- Members now store: **phone, WhatsApp, birthday (month + day only — no year, for
  privacy), gender, occupation, parish, drama unit, home address**, and **social
  links** (Facebook, Instagram, TikTok, X/Twitter).
- **Self-completion flow:** when an admin creates an account (with just name +
  email), the member signs in and **completes the rest themselves** — including
  adding/*changing their email*, occupation, address, socials, etc.
- A **Profile Completion meter** shows progress and encourages members to finish.

## 32. Automatic Birthday Celebrations (NEW in v11)

- **Birthdays page** (`pages/birthdays.html`): today's celebrants + a by-month
  list; admins send one-tap **WhatsApp/Email** greetings (free).
- **Fully automatic bot** (`supabase/functions/birthday-bot`, optional, free):
  every morning it posts a birthday greeting to the celebrant's **Inbox**, a
  **department-wide** celebration, and (optionally) an **email** — once per day,
  guarded against duplicates. Setup: `docs/BIRTHDAY_BOT.md`.
- Privacy-conscious: only **month + day** are collected, never the birth year.

## 33. Bulk CSV Account Creation (NEW in v11)

- **Where:** `pages/members.html` → "Bulk Create Logins (CSV)" · **Admin only.**
- Upload a CSV (`full_name,email,phone,parish`) to create **many login accounts
  at once**; each gets an auto-generated password. A **credential sheet** CSV is
  downloaded for you to distribute. Uses the same secure Edge Function.

## 34. Attendance Analytics (NEW in v11)

- **Where:** `pages/analytics.html`.
- Per-member **attendance rate %**, present/excused/absent counts, KPIs (sessions,
  average, best attendee), a **bar chart** of the top attendees, and **Excel
  export** — for supervision and recognition.

## 35. Printable Member ID Cards (NEW in v11)

- **Where:** `pages/idcard.html` · **Access:** all members.
- A branded RCCG LP 25 Drama **membership card** with the member's name, role,
  unit, contact, a short ID, and a **QR code** (encodes name + ID for quick
  verification). **Print or Save as PDF** in one click.

## 36. Profile Photo Uploads (NEW in v12)

- **Where:** `pages/profile.html` → "Upload Photo" · **Access:** all members.
- Photos are stored free in **Supabase Storage** (a public `avatars` bucket
  created automatically by `repair_and_upgrade.sql`). Each member can upload,
  replace or remove **only their own** photo (enforced by storage RLS, scoped to
  `avatars/<user-id>/…`).
- The photo appears automatically on the **digital ID card**, the **Member
  Directory**, and the **Members** table (initials shown as a fallback).
- Setup details + fallback: `docs/PHOTO_UPLOADS.md`. No AI/paid API — plain file
  storage on the free tier.

## 37. Member Directory (NEW in v12)

- **Where:** `pages/directory.html` · **Access:** all members.
- A photo-rich, searchable card grid of the department: search by name, unit or
  occupation, filter by **drama unit**, and reach anyone via one-tap **WhatsApp,
  Email**, or their **social links** (Facebook, Instagram, TikTok, X).

## 38. Emergency / Next-of-Kin Contact (NEW in v12)

- **Where:** `pages/profile.html`.
- Members record an **emergency contact name, phone and relationship** —
  essential safeguarding information for rehearsals, events and travel.

## 39. Help & FAQ (NEW in v12)

- **Where:** `pages/help.html` · **Access:** all members.
- A searchable list of common how-tos (photos, ID card, check-in, RSVP,
  messaging, birthdays, install, password reset) plus a **"Message an Admin"**
  shortcut — smoothing onboarding for new members.

## 40. Photo Cropping (NEW in v13)

- **Where:** profile photo upload + gallery upload (`assets/js/crop.js`).
- Before any photo is uploaded, a built‑in **square cropper** opens: drag to
  reposition, use the slider to zoom, then "Use Photo". It outputs a clean
  square JPEG (512px avatars / 800px gallery). Pure canvas — **no external
  library, no API**, works on touch and mouse.

## 41. Unit-Leader Permissions (NEW in v13)

- **Where:** Members page → "Unit Lead" button (admin only) sets/clears the role.
- **Unit Leaders** are trusted members who can:
  - **update profiles of members in their own unit** (e.g. fix details, set unit),
  - **upload to the Photo Gallery**.
- They **cannot** grant admin rights or manage other units. Enforced at the
  database with a `is_unit_leader_of(unit)` security‑definer function and RLS, so
  the limits hold even outside the UI. This delegates day‑to‑day coordination
  without giving away full admin access.

## 42. Org-Wide Photo Gallery (NEW in v13)

- **Where:** `pages/gallery.html` · **View:** all · **Upload:** admins + unit
  leaders.
- Organise photos into **albums** (e.g. "Easter Play 2026"), filter by album,
  and view any image in a **fullscreen lightbox**. Images are stored free in a
  public Supabase Storage `gallery` bucket (auto‑created by the SQL).

## 43. Suggestion Box (NEW in v13)

- **Where:** `pages/suggestions.html` · **Submit:** all members · **Manage:**
  admins.
- Members submit ideas/feedback, optionally **anonymously**. Admins triage each
  with a status (**new → reviewed → actioned → closed**). A simple, powerful way
  to capture grassroots input.

---

## Free‑Tools / No‑AI Commitment

Every capability above is delivered with **free, open tooling** and **no paid AI
API**. Charts, exports, PDF generation, and offline support all run **client‑side
in the browser**, so there is **no server compute cost**. Supabase's free tier
handles the database and authentication.
