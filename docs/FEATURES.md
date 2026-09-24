# 📖 DramaConnect Enterprise v14.0 — Detailed Feature Guide

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
  with role `member` and status **`pending`**. Rejected requests are retained with status
  **`rejected`** so they remain blocked but can be approved later; only permanent
  removal deletes the Auth account/profile and cascade-linked data.
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
  - **Remove members (admin):** permanently delete the member's Supabase Auth
    account, profile, and cascade-linked dependent records through the secured
    Edge Function. Self-deletion is blocked and the server attempts the audit log.

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
- **What:** edit permitted personal fields and change the password. Email changes
  go through Supabase Auth and are synchronized back to the profile. Role,
  approval status, Drama Unit, and unit-leader state are administrator-managed.

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
  reappear for **seven days**, and never shows once installed. Installation is
  optional: **Continue in browser** always keeps the web app usable.

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

## 16. Settings (admin only) — the front door, not a second copy

- **Where:** `pages/settings.html` · **Access:** approved administrators only,
  enforced in the UI and by database/Storage authorization.
- **What Settings owns:** the **Administration control plane** (live status tiles
  that route into every high-risk workspace), **Global App Branding** (application
  name, organisation, logo, theme colour), **Device Profile & Appearance** and
  **System Information**.
- **One owner per function.** Settings deliberately does **not** re-implement any
  high-risk operation. Backup, restore, Google Drive, the vault, heartbeats,
  retention, approvals and licensing each live on exactly one page, and Settings
  links to them. This removes the earlier duplication in which two pages could
  perform the same destructive operation.
- **Live control-plane status.** Each tile shows real evidence pulled from the owning
  page's own API — last verified backup, fresh heartbeat source count (with a
  single-point-of-failure warning), storage percentage against quota, and pending
  approvals — so an administrator can see where to go before clicking.
- **Ownership map:** Admin Data (archives, Drive, vault, recovery), Storage Manager
  (quota, inventory, retention), Platform Health (heartbeats, resilience, security),
  Roles & Status (approvals, roles, units), Site License (entitlement), Activity Log
  (audit trail).
- **Where the old features went:** portable archive, restore, lease protection,
  Google Drive backup and the private vault are documented under §44 (Admin Data).
  Security state and the login/access audit are under §45 (Platform Health).
- **Unattended recovery:** GitHub creates encrypted public-schema and Auth data
  dumps and optionally exports actual Storage bytes to rclone/Drive with remote
  verification and post-verification retention.
- **Limit:** portable archives exclude Auth credentials/sessions and Storage
  object bytes; use the encrypted recovery set for full incident recovery.
- **Bulk Member CSV and appearance:** roster import and dark/light system
  information remain available through their existing administrative surfaces.

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
- **Manual versus automatic:** the one-click **Send now** workflow requires no
  scheduler. Optional automation uses the included secret-protected Supabase
  scheduled Edge Function. Availability and quotas depend on the current project
  plan; check the Supabase dashboard before relying on it operationally.

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
  and see aggregate **live result bars** plus their own selected choice. Other
  voter identities are not returned to ordinary members. Admins can close/reopen or
  delete polls. Great for picking rehearsal dates, roles, themes, etc.

## 27. Fully-Automatic Reminders (NEW in v9 — optional)

- The included **scheduled** Edge Function `supabase/functions/run-reminders`
  (with Supabase Cron) posts **due** reminders to everyone's Inbox automatically
  and reschedules them — **no admin action** after secure deployment. Hosting and
  execution remain subject to the current Supabase plan and quotas.
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
  changeable). Each card uses an aggregate RPC for counts plus only the caller's
  own choice; other member identities are not returned.
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
  changing email through Supabase Auth, plus occupation, address and social links.
  Drama Unit remains administrator-managed and read-only to the member.
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
  created by `repair_and_upgrade.sql`, with final least-privilege policies from
  `security_hardening.sql`). Each approved member can upload,
  replace or remove **only their own** photo (enforced by storage RLS, scoped to
  `avatars/<user-id>/…`).
- The photo appears automatically on the **digital ID card**, the **Member
  Directory**, and the **Members** table (initials shown as a fallback).
- Setup details + fallback: `docs/PHOTO_UPLOADS.md`. No AI/paid API — plain file
  storage on the free tier.

## 37. Member Directory (NEW in v12)

- **Where:** `pages/directory.html` · **Access:** approved members.
- Uses the restricted `member_directory` projection: home address, emergency
  contacts, costume measurements and other private profile fields are omitted.
  A photo-rich, searchable card grid supports search by name, unit or
  occupation, filter by **drama unit**, and reach anyone via one-tap **WhatsApp,
  Email**, or their **social links** (Facebook, Instagram, TikTok, X).

## 38. Emergency / Next-of-Kin Contact (NEW in v12)

- **Where:** `pages/profile.html`.
- Members record an **emergency contact name, phone and relationship** —
  essential safeguarding information for rehearsals, events and travel.

## 39. Help Centre, Page Guides and the Assistant (expanded, all members)

- **Where:** `pages/help.html` · **Access:** all members.
- **Help Centre.** Five panels — **Page guides**, **Getting started**, **FAQ**,
  **Troubleshooting** and **Which page owns what?** — behind one search box that
  spans all of them and switches panels to wherever the first hit lives. The page
  guide panel is generated from the shared registry, so it can never fall behind
  the application.
- **A description for every page.** `assets/js/page-guide.js` holds one
  authoritative entry per page — **37 pages, 37 entries** — each with icon,
  category, intended roles, a one-line summary, what it is, what it does, who uses
  it, numbered how-to steps, why it works that way, the benefit to the department
  and tips, plus cross-links to related pages.
- **Page guide button.** Every page mounts a **❓ Page guide** button (bottom-left)
  and binds the **`?`** key. Either opens a modal with that page's full guide and
  its related pages, without leaving the page.
- **Header descriptions.** Page descriptions are taken from the same registry, so
  the line under a page title is always the maintained description rather than a
  hand-copied string that drifts.
- **The Assistant** (`assets/js/assistant.js`, the 💬 button on every page). A
  rules-based, **fully offline** assistant: no AI API, no network call, no paid
  service, and no data leaves the browser — consistent with the standing
  free-tools-only constraint.
- **Assistant depth.** Three layers, in order of specificity:
  1. **Per-page depth** — every page can be explained in full from the registry.
  2. **Curated topics** — 22 scored knowledge entries covering backup, restore,
     disaster recovery, re-linking, Google Drive, anti-pause, quorum, licensing,
     approvals, roles, attendance, casting, storage, retention, audit, sign-in,
     install, export, notifications, appearance, "finding things" and human help.
     Entries are **scored**, so the best match wins rather than the first.
  3. **Full-text fallback** — if nothing matches, the assistant searches every page
     guide and offers the most relevant pages instead of dead-ending.
- **Conversation continuity.** History persists for the session across page
  navigations, the current page is named in the header, follow-up suggestion chips
  are offered after each answer, and the conversation can be cleared.
- **Shortcuts.** **Ctrl/Cmd + K** opens the assistant with a page finder; **`/`**
  jumps to the input; **`?`** opens the page guide; **Esc** closes either.
- **Honest precedence.** A question that merely mentions a page ("why did
  attendance lose names after recovery") is answered with the *topic*, not with
  that page's description; a question that is *about* a page ("explain
  attendance") gets the full page guide. This deliberately avoids the common bot
  failure of hijacking every sentence that contains a module name.
- **Coverage is machine-checked.** `tools/test-assistant.mjs` (part of `npm test`)
  asserts that all 37 pages have a complete guide, that every guide is reachable
  from the Help Centre index, that no guide is an empty or stub description, that
  every guide renders, that all 37 pages are explainable by name, that 23 headline
  topics all resolve, that scoring beats first-match on known traps, and that
  unknown input still returns guidance. **556 checks.**

## 40. Photo Cropping (NEW in v13)

- **Where:** profile photo upload + gallery upload (`assets/js/crop.js`).
- Before any photo is uploaded, a built‑in **square cropper** opens: drag to
  reposition, use the slider to zoom, then "Use Photo". It outputs a clean
  square JPEG (512px avatars / 800px gallery). Pure canvas — **no external
  library, no API**, works on touch and mouse.

## 41. Unit-Leader Permissions (NEW in v13)

- **Where:** Members page → "Unit Lead" button (admin only) sets/clears the role.
- **Unit Leaders** are approved members who can upload Photo Gallery media and
  delete only their own uploads.
- Profile edits, unit assignment, approval, role/leader changes, and account
  deletion remain administrator-only (apart from each member editing permitted
  fields on their own profile). The scope is enforced by RLS/storage ownership,
  not merely by hidden controls.

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

The application uses no paid AI API. Charts, exports, PDF generation, and the
limited offline shell run client-side; authentication, data, Storage, and optional
automation use Supabase server resources. The project may fit within free
allowances at modest usage, but provider quotas and pricing must be verified.

---

# 🛡️ Part II — The v14 Administration Control Plane

Part I (sections 1–43) documents the member-facing application. This part documents the
**six dedicated administration workspaces** introduced in v14.0. Each is reachable from the
sidebar and each is additionally gated in the browser by `Auth.isAdmin()`, which mirrors the
SQL helper `is_admin()` — so hiding a link never becomes the security control.

> **Server-side truth:** the browser gate is UX only. Every one of these surfaces is
> ultimately protected by Row Level Security policies of the form
> `USING is_admin()`, and by `SECURITY DEFINER` RPCs that re-check `is_admin()` inside the
> database. An administrator is `status = 'approved' AND role = 'admin'`.

## 44. Admin Data — Portability, Backup & Recovery (`pages/admin-data.html`)

The single workspace for moving data in and out of the platform. It is deliberately split
into four independent mechanisms so that the failure of one never leaves you without a
route to your data.

**44.1 Export a verified archive.** `DataPortability.downloadLocal()` serialises the
portability table set to JSON. Before the file is offered for download it is passed through
`DataPortability.verifyArchive()`, which recomputes a checksum over the payload. A file that
does not verify is never presented as a good backup. This is the difference between "we have
a backup" and "we have a backup that restores".

**44.2 Archive preflight.** `verifyArchive()` is also exposed on its own so an operator can
check an archive received from someone else *without* restoring it. Preflight reports
schema version, table coverage and row counts, and tells you whether the archive came from
the same release as the site you are restoring into.

**44.3 Verify or restore.** `restoreVerifiedArchive()` will refuse to write anything unless
verification has passed. Restoration is therefore all-or-nothing at the archive level rather
than partially applied.

**44.4 Table CSV export.** `downloadTableCsv()` exports a single table for spreadsheet work.
This is the everyday operational export; the verified archive is the disaster-recovery
artefact. They are not substitutes.

**44.5 Google Drive connection and backup policy.** `DriveSync.connect()` initiates OAuth
using the **Web client ID** configured on **Admin Data → Drive**. The generator never asks for a client
secret, and the static site cannot keep one. `getSettings()` / `saveBackupSettings` control
the folder, cadence and grace period; `backup()` performs an upload and `listBackups()`
lists what is already in Drive. `download()` and `restore()` close the loop. Backups track
**leases and history**, so two administrators cannot unknowingly overwrite each other.

**44.6 The private Supabase vault.** `uploadVault()` / `listVault()` / `downloadVault()` /
`restoreVault()` store an encrypted archive inside Supabase Storage itself. This exists
because Drive depends on a Google account that an organisation may lose control of; the
vault keeps a second copy under the database's own credentials.

## 45. Platform Health (`pages/platform-health.html`)

The operational dashboard for Supabase's free tier.

**45.1 Heartbeat.** Supabase pauses projects after roughly seven days of inactivity.
`PlatformManagement.platformHealth()` reports when external activity was last received, so
you can see a project approaching the pause threshold *before* it happens. Four independent
keep-alive paths exist — browser, GitHub Actions, the Supabase Edge `ping` function, and an
optional external cron — so no single provider outage silences the heartbeat.

**45.2 Database space.** Reports database size against the free-tier ceiling, with the
storage meter carried over from the Storage Manager.

**45.3 Security state.** Displays the protection layers currently active: RLS coverage,
the profile-guard trigger that blocks self-promotion and approval bypass, and the login
audit trail.

**45.4 Login & access audit.** `listAudit()` surfaces recent authentication and
authorisation events, recorded by `dc_record_login_event()`. This is the record you consult
when investigating "who did this and when".

**45.5 Protection layers and settings.** `getPlatformSettings()` /
`savePlatformSettings()` govern the idle sign-out and the emergency lockdown — the
security state. **Retention is not set here:** `dc_retention_preview()` and
`dc_apply_retention()` read `login_audit_days` from `dc_retention_settings`, which is
edited on the **Storage Manager**. Platform Health displays that value read-only and
links to its owner, and `dc_update_platform_settings()` mirrors any value it is given
into `dc_retention_settings` so the two tables can never silently disagree.

## 46. Site License (`pages/site-license.html`)

Displays and administers the entitlement state of this deployment.

**46.1 Deployment ownership (read-only for everyone).** Shows model, status, plan, licensed
organisation, start/expiry, grace period and the public message. Every member can see the
state of the system they depend on.

**46.2 License administration (admin only).** `getLicense()` / `saveLicense()` edit model,
status, plan name, licensed organisation, dates, grace days, renewal URL, support email and
an optional external entitlement registry.

**46.3 Why enforcement is honestly labelled.** A static browser application cannot keep a
private signing secret — anything shipped to the browser is readable by the browser. So
client-side expiry logic is documented as **operational access control, not tamper-proof
commercial enforcement**. Where stronger authority is genuinely required, the
`registry_url` field points at a trusted server you control, which becomes the source of
truth. LP25's own deployment uses lifetime ownership and therefore needs no registry.

## 47. Storage Manager (`pages/storage-manager.html`)

Free-tier storage is a hard ceiling, so it is treated as a managed resource rather than an
afterthought.

**47.1 Usage overview.** `storageOverview()` reports bucket-level and database-level usage
with a posture indicator, so growth is visible before it becomes a failure.

**47.2 Object browser.** `listStorage()` enumerates objects in a bucket, and
`deleteStorageObject()` removes individual files — the routine cleanup path.

**47.3 Retention policy.** `getRetentionSettings()` / `saveRetentionSettings()` /
`retentionPreview()` / `applyRetention()` define and apply how long different classes of
artefact are kept. The **preview** step is the important one: it shows exactly what a policy
will delete before anything is removed. Retention is a data-destroying operation and must
never be a single opaque click.

## 48. Roles & Status (`pages/roles-status.html`)

The member access registry — approval, role, unit and access version in one table.

**48.1 Registry.** `listMemberAccess()` lists every member with status, role, unit and unit-leader
flag, with live counts for all / approved / pending / admin. This is the onboarding queue.

**48.2 Editing access.** `updateMemberAccess()` changes status, role and unit. The
`access_version` column is the important subtlety: incrementing a member's access version
invalidates their cached authorisation state, so a demotion takes effect immediately rather
than at the member's next session.

**48.3 Server-side guard.** Role and status changes are additionally constrained by a
column-level trigger on `profiles` (see section 15.5). The UI cannot grant more than the
database permits.

## 49. Activity Log (`pages/activity.html`)

The audit trail. Records who changed what and when across the platform. Covered in section
13 for the member view; as an administration surface it is the companion to the login audit
in Platform Health — Platform Health answers "who signed in", Activity Log answers "what did
they do".

## 50. The Deployment Generator — the SaaS layer (`dramaconnect-generator/`)

This is the component that turns the application from a single deployment into a product
that can be issued to many organisations.

**50.1 What it is.** A standalone, browser-only application. No backend, no build server,
no account. You open `index.html` over HTTP(S), complete five steps, and it produces a
deployment ZIP.

**50.2 How it stays trustworthy.** `templates/dramaconnect/_template-manifest.json` records
every canonical file's path, byte count and SHA-256 digest. At generation time the browser
fetches each file and re-computes its hash. A missing file, a size mismatch or a hash
mismatch **stops generation** — you can never receive a partial or tampered site.

**50.3 How branding works.** The canonical template is **brand-neutral**. At template build
time every deployment-specific literal is rewritten into a sentinel token
(`__DC_APP_NAME__`, `__DC_ORG_NAME__`, `__DC_PROVINCE__`, `__DC_CURRENCY__`,
`__DC_PRIMARY_COLOR__`, `__DC_KEYWORDS__`, `__SUPABASE_URL__`, `__SUPABASE_ANON_KEY__`),
and the build **fails** if any residual brand string survives. At generation time each token
is replaced with the operator's value. Because substitution is token-based rather than
"search for the old organisation's name", a value can never be partially rewritten and the
template never carries another organisation's identity.

**50.4 Credential safety.** `validateSupabaseKey()` rejects `service_role` keys,
`sb_secret_…` keys and any JWT whose role is not `anon`. The generator never asks for a
database password or an OAuth client secret — the static app cannot protect them.

**50.5 What you receive.** A ZIP preserving the full directory structure under a folder name
you choose, containing all 37 application pages, the six administration surfaces, the
cumulative `database/complete-schema.sql`, and `generated-site.json` plus `START_HERE.txt`
as a generation receipt and next-steps pointer.

## 51. Full-stack and SaaS assessment — an honest answer

| Question | Answer |
|----------|--------|
| **Is it full-stack?** | Yes, in the sense that matters: a Postgres database with RLS, RPCs, triggers and views; Edge Functions for server-side work the browser cannot do; and a static front end. There is no custom application server to operate, which is what keeps it free. |
| **Is it SaaS?** | The **generator** is the SaaS enabler: it issues an isolated deployment per organisation, each with its own database, branding and entitlement state. It is multi-tenant by *isolation*, not by shared tables — which is the correct choice for RLS and for data sovereignty. |
| **What is deliberately not included?** | Centralised billing, a tenant-provisioning API, and server-side licence signing. All three require a paid control plane. They are the natural next step when the product outgrows free tooling, and the generator's receipt format is designed so that a provisioning service can be added later without changing the output contract. |
| **What is the honest limitation?** | Browser-hosted licence enforcement is alterable by a determined operator. This is stated in the product, not hidden. Use `registry_url` when tamper-resistance matters. |

