# DramaConnect v13.2 — Architecture, Feature, Security, Resilience, Backup, Defect, and Remediation Report

**Audit completed:** 21 August 2026  
**Application:** RCCG LP 25 Drama Department — DramaConnect Enterprise  
**DramaConnect live site reviewed:** <https://rccglp25-dramaconnect.vercel.app/>  
**DramaConnect source reviewed:** <https://github.com/hmgconcepts/lp25-dramaconnect>  
**GOSA reference site:** <https://gosaportal.vercel.app/>  
**GOSA reference source:** <https://github.com/hmgconcepts/gosaportal> at `b4df0713c712dbfc96eeecf03771c64d6cd2c8a1`  
**Original DramaConnect commit:** `f97f5a58c0a5e94bb07f3c0e4b19092b334788f0`  
**Maintained fixed release:** `v13.2`

---

## 1. Executive summary

The project is a substantial, static-hosted departmental management application.
It has broad operational coverage and a sensible low-cost architecture: vanilla
browser code and static HTML use Supabase for authentication, PostgreSQL, Row
Level Security (RLS), Storage, and optional Edge Functions.

The original commit was **not safe to redeploy unchanged**. Its most serious
problem was authorization at the data boundary. A signed-in user could update
all columns of their own profile, including `role` and `status`; a unit leader
could similarly update unrestricted columns of profiles in their unit. This
made privilege escalation possible despite role checks in the interface. Broad
read policies also disclosed full personnel records to every authenticated
account. Two service-role automation functions accepted unauthenticated
requests, and the optional approval-mail function could be used as an
unauthenticated email relay. These are server-side issues; hiding buttons in the
browser does not mitigate them.

The v13.1 remediation introduced a second, mandatory hardening migration, safe
data projections, column-level authorization triggers, server-authoritative
RPCs, restricted Storage paths, and authenticated/secret-protected Edge
Functions. It also repaired account deletion, approval handling, recovery URLs,
email synchronization, unsafe rendering/URL handling, gallery uploads, PWA
behavior, and contradictory deployment documentation.

The v13.2 enhancement then deeply compared GOSA's deployed application and
source with DramaConnect and implemented every relevant free-tier protection
and Google Drive layer in DramaConnect, without modifying GOSA. DramaConnect
now adds source-aware database heartbeats, multiple independent schedulers,
paused-project recovery guidance/automation, server-owned backup settings and
global leases, verified 22-table portable archives, least-privilege Google
Drive sync, an administrator-only Supabase vault, version-matched encrypted
public/Auth backups, optional encrypted Storage-byte backups, remote read-back
verification, guarded restore tools, retention, incident response, and recovery
rehearsal procedures. Safeguards beyond the reference include strict manifests,
SHA-256 sealing, pagination, size bounds, no-popup scheduling, pre-write
filesystem validation, bucket-conflict confirmation, remote object hashing, and
two-catalog database recovery that avoids cleaning Supabase-managed Auth
schemas.

### Outcome

| Area | Original assessment | Fixed-release assessment |
| :-- | :-- | :-- |
| Authentication gate | Could fail open; admin role bypassed approval | Fails closed; every role must be approved |
| Database authorization | Critical privilege escalation and broad disclosure | Approval-gated RLS plus triggers and RPCs |
| Private personnel data | Full profiles readable by all authenticated users | Full rows self/admin only; safe directory view for members |
| Scheduled Edge Functions | Public service-role endpoints | POST plus `CRON_SECRET`, with concurrency claims |
| Approval-email function | Unauthenticated mail relay | Approved-admin JWT or webhook secret |
| Account removal | Deleted only profile and could orphan Auth login | Permanent Auth deletion in approved-admin Edge Function |
| Poll/RSVP privacy | Raw voter/attendee identities broadly readable | Aggregate results; raw RSVP self/admin only |
| Browser rendering | Several unsafe dynamic HTML/URL boundaries | Escaping, DOM text rendering, validators, safer event binding |
| PWA | Coercive install and fragile/stale cache behavior | Optional install, seven-day dismissal, backend-safe caching |
| Supabase free-tier continuity | No coordinated, observable multi-source protection | Browser/manual, GitHub, Edge, Vercel, Apps Script, cron-job.org and optional `pg_cron` layers, plus paused-project recovery |
| Portable/Drive backup | Shallow client export; no verified Drive lifecycle | Paginated 22-table SHA-256 archive, least-privilege `drive.file`, vault, leases, retention, and guarded restore |
| Disaster recovery | No encrypted Auth/Storage set or executable recovery path | Matching-version public/Auth catalogs, optional Storage bytes, GPG, checksums, remote verification, and guarded restore tools |
| Deployment guidance | Incomplete and contradictory | Mandatory three-migration order, secured functions, resilience setup, backup runbook, and incident response |

**Important:** deploying only the static HTML/JavaScript does not apply the
server-side fixes. Run all three database migrations in the documented order,
then redeploy/reconfigure the Edge Functions, heartbeat layers, workflows, and
backup destinations.

---

## 2. Scope and evidence

### Included

- Public live deployment behavior and reachable static resources.
- All 80 files tracked at the original Git commit.
- The root sign-in document and all 32 HTML documents under `pages/`.
- Ten shared browser JavaScript files and the service worker.
- Database schema, original RLS, Storage policies, triggers, and functions.
- Five Supabase Edge Functions, including the protected public heartbeat.
- Vercel heartbeat endpoint/cron, three GitHub Actions workflows, optional
  `pg_cron`, Drive/portable/vault browser modules, Storage export/restore, and
  database recovery tooling.
- The root deployment/user guides, all files under `docs/`, README, manifest,
  assets, and deployment configuration.
- A read-only deep comparison of the GOSA reference deployment and source;
  **no GOSA file was modified** and no nonexistent DramaConnect generator was
  introduced.
- Administrator and member browser states through a mocked Supabase/CDN smoke
  harness, plus focused resilience/settings browser interactions.
- PostgreSQL-compatible migration, policy, trigger, view, and RPC behavior in
  PGlite PostgreSQL 17.5, plus a disposable PostgreSQL 17 real custom-format
  database/Auth recovery rehearsal.

### Excluded or constrained

- No production credentials were provided. The audit did **not** read, alter, or
  delete live Supabase records and did not send live email.
- Edge Functions were bundled statically but were not deployed to or invoked
  against the production Supabase project.
- Browser smoke tests mocked Supabase and third-party CDN libraries; they verify
  page initialization and focused backup/settings behavior, not production
  network health.
- The PostgreSQL recovery rehearsal used real matching PostgreSQL 17 custom
  catalogs and a disposable local source/target, not Supabase's current managed
  Auth schema. Production recovery still requires a staging rehearsal against
  the exact source/target Supabase generation.
- Google OAuth/Drive, GitHub Actions, rclone, email, cron monitors, and Storage
  were not exercised with production credentials. Their client/API logic was
  statically checked or run through controlled mocks.
- A deep penetration test of Supabase infrastructure, Google, GitHub, Resend,
  Vercel, or other third-party platforms is outside the repository audit.

### Preservation

The untouched archive was produced directly from Git `HEAD`, not from the
modified working tree. It contains the original 80 tracked files under a single
`lp25-dramaconnect-original/` directory. The corrected archive is produced from
the remediated tree under `lp25-dramaconnect-fixed/`.

---

## 3. System architecture

### 3.1 Runtime layers

1. **Static presentation layer** — one root sign-in/registration page and 31
   authenticated application pages plus `pages/reset.html`; Tailwind utility
   styling, local CSS, and vanilla JavaScript.
2. **Shared client layer** — `config.js`, `auth.js`, `db.js`, `ui.js`,
   `utils.js`, `layout.js`, `install.js`, `i18n.js`, `boot.js`, and `crop.js`.
3. **Supabase Auth** — registration, email/password login, session storage,
   password recovery, Auth email changes, and administrator-created users.
4. **PostgreSQL/PostgREST** — departmental data, constraints, RLS, safe views,
   triggers, and security-definer RPCs.
5. **Supabase Storage** — public-read `avatars` and `gallery` buckets with
   restricted write paths. Public read means sensitive imagery must not be used.
6. **Edge Functions** — secure account administration, optional approval mail,
   birthday automation, and scheduled reminders.
7. **PWA layer** — manifest, optional install prompt, and same-origin shell
   caching. Supabase/API and cross-origin traffic remains network-only.
8. **Third-party browser libraries** — Supabase JS, Tailwind, Font Awesome,
   Chart.js, SheetJS, jsPDF, QR generation, and QR scanning, loaded from CDNs.
9. **Resilience control plane** — `dc_keep_alive`, source throttling, health
   views, protected Edge/Vercel entry points, browser/manual heartbeats,
   GitHub/Apps Script/external-monitor schedules, optional `pg_cron`, and a
   Management API recovery watchdog.
10. **Portable backup plane** — deterministic pagination over all 22 app/config
    tables, strict manifests, per-table SHA-256, archive seal, local download,
    CSV, private Supabase vault, and verified merge/degraded restoration.
11. **Google Drive plane** — Google Identity Services token flow with only
    `drive.file`, a dedicated marked folder, in-memory tokens, verified file
    metadata/content, visit-triggered due checks without surprise OAuth popups,
    global database leases, run history, and retention after verification.
12. **Disaster-recovery plane** — matching PostgreSQL client containers,
    separate public and data-only Auth custom catalogs, optional Storage byte
    export, AES-256 GPG, SHA-256 sidecars, rclone copy/check, post-verification
    retention, and guarded database/Storage restoration.

### 3.2 Trust boundaries

- The browser and its `anon` key are untrusted. Authorization is enforced in
  PostgreSQL RLS/triggers/RPCs and again in Edge Functions.
- `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `NOTIFY_WEBHOOK_SECRET`, and email
  provider keys are server secrets and must never appear in static files.
- An Auth JWT proves identity, not authorization. Role and approval state are
  checked against the authoritative profile row.
- Values stored in the database can later become untrusted UI content. Text is
  escaped or assigned through `textContent`; URLs, colors, and image/embed
  values pass narrow validators.
- Google access tokens remain in memory and the browser receives only the
  least-privilege `drive.file` scope; OAuth client IDs are public identifiers,
  not secrets.
- Database URLs, service-role keys, Management API tokens, rclone configuration,
  and backup passphrases exist only in protected server/workflow environments.
- Portable archives contain application data but no Auth password hashes,
  sessions, or Storage bytes. Encrypted unattended sets separately protect the
  narrowly allowed Auth identity data and optional Storage object bytes.

### 3.3 Corrected authorization model

| Actor | Effective access |
| :-- | :-- |
| Anonymous | Sign-in/registration shell and intentionally public static media only |
| Pending/rejected account | May read/update permitted fields on its own profile so status can be evaluated; no operational application data or features |
| Approved member | Own full profile, approved-member directory projection, normal member features, own votes/RSVP/task actions |
| Approved unit leader | Member access plus unit coordination UI and management of their own gallery uploads; no profile/role/status editing authority |
| Approved administrator | Full administrative data and management features, including raw RSVP identities and account operations |
| Scheduler/webhook | Only the specific Edge Function whose configured secret is supplied |
| Service role | Server-side functions only; never exposed to browser code |

### 3.4 Key data protections

The v13.1 hardening migration contains 146 statements. After all three
migrations, the validated v13.2 test database contains **54 public policies, 12
Storage policies, 21 public functions, and 2 public views**.

- `member_directory` omits address, emergency contact, costume measurements,
  and other full-profile-only fields.
- `rehearsal_schedule` omits the check-in secret.
- `guard_profile_update()` prevents self-promotion, self-approval, unit changes,
  leader-flag changes, ID changes, and profile/Auth email desynchronization.
- `self_check_in()`, `cast_poll_vote()`, `set_task_status()`,
  `poll_results()`, and `event_rsvp_results()` move security decisions to the
  database.
- Inbox and activity triggers replace caller-supplied identity fields with the
  authenticated identity and prevent member broadcasts.

### 3.5 GOSA understudy and DramaConnect coverage

The GOSA reference was treated as a design/operational baseline, not as a tree
to edit. DramaConnect implements the relevant layers in its existing static
pages/shared modules and adds stricter verification and recovery controls.

| Capability layer | DramaConnect v13.2 implementation |
| :-- | :-- |
| Browser activity | One source-aware `site-visit` heartbeat per local visit window, plus an administrator manual heartbeat; database throttling remains authoritative |
| GitHub scheduled keep-alive | Twice-weekly verified RPC response with retries, least repository permissions, concurrency, and a preservation commit only after 30 days without repository activity |
| Public monitor endpoint | Secretless Edge `ping` and Vercel `/api/keep-alive` call the safe throttled RPC; GET/POST/CORS, timeouts, and response verification are bounded |
| Independent schedulers | Supabase schedule/optional `pg_cron`, Vercel Cron, Apps Script, cron-job.org/uptime monitor guidance, and staggered sources avoid a single scheduler dependency |
| Paused-project recovery | GitHub Management API watchdog detects inactivity/paused status and requests restore with tightly scoped repository secrets |
| Health/administration | Administrator-only health, source timestamps/counts, server-owned Drive settings, run history, manual ping, and migration warnings |
| Portable archive | Stable pagination of all 22 app/config tables; exact ordered manifest, row counts, per-table SHA-256, canonical full seal, timestamp/version/type checks, and 100 MB browser bound |
| Local/CSV/vault | Verified JSON download, per-table CSV, private `dramaconnect-backups` vault, administrator RLS, 50 MB vault bound, and full verification before restore writes |
| Google Drive | GIS token client, exact `drive.file` scope, dedicated application-marked folder, in-memory token, verified upload/list/download, retention, global lease, and no-popup automatic due checks |
| Portable restore | Strict verification first; normal identity-aware merge or explicitly degraded mode; per-table reporting; no claim of deleting newer data or being a database transaction |
| Unattended database backup | Server-major detection, matching PostgreSQL image, separate custom public and data-only `auth.users`/`auth.identities` catalogs, list validation, AES-256 GPG, SHA-256 sidecars |
| Storage bytes | Optional recursive non-vault export with safe names, streaming/local read-back hash verification, strict manifest/limits, encrypted tar, and guarded restore with remote read-back hashes |
| Remote transfer/retention | rclone copy then `check`; include filters are timestamp-specific; retention executes only after verification and covers encrypted payloads/sidecars |
| Database recovery | Checksums, decryption, actual custom-catalog allowlists, source/producer/client/target major checks, empty-Auth guard, Auth data restore without schema cleaning, public-only catalog clean, and orphan checks |
| Incident operations | Supabase protection guide, backup/recovery guide, resilience runbook, deployment/setup checklists, restoration gates, post-restore checks, and credential-rotation instructions |

---

## 4. Complete feature inventory and operation

The feature-level reference is also maintained in `docs/FEATURES.md`. The list
below explains the complete functional surface in audit-oriented form.

### 4.1 Access, identity, and people

1. **Authentication and accounts** — email/password registration and sign-in
   use Supabase Auth. Registration creates a `pending` profile; pending and
   rejected users are signed out and blocked until an administrator approves
   them. Password recovery opens `pages/reset.html`.
2. **Approval workflow** — administrators review pending/rejected profiles,
   approve or reject them, and can notify an approved member through generated
   WhatsApp/email actions. Rejection retains the account in a blocked state.
3. **Secure administrator-created accounts** — single or bulk CSV onboarding
   invokes `admin-create-member`; the function validates an approved admin,
   creates Auth and profile records, rolls Auth back if profile creation fails,
   and returns initial credentials.
4. **Permanent account removal** — an approved administrator invokes the same
   Edge Function with `action: delete`. It validates the UUID, blocks
   self-deletion, deletes the Auth user, relies on cascades, and writes an
   authoritative removal audit record.
5. **My Profile** — members maintain allowed personal, contact, birthday,
   emergency, measurement, and social fields. Role, approval, leader status,
   and drama unit remain administrator-managed. Email changes go through Auth.
6. **Profile completion** — the profile page measures completed member fields
   and shows progress without granting access to managed authorization fields.
7. **Photo upload and cropping** — approved owners crop and upload validated
   profile images to `avatars/<auth-user-id>/...`; the current avatar appears in
   layout, directory, members, and ID cards.
8. **Member administration** — administrators search, approve/reject, assign
   units, set leader status, change role, inspect full records, create accounts,
   and permanently remove accounts.
9. **Member directory** — approved members search a card-based directory backed
   by `member_directory`, with non-sensitive identity/contact/social fields.
10. **Digital ID card** — builds a branded, printable member card and QR payload
    from the caller's approved profile.
11. **Drama units** — `My Unit` groups approved directory entries by assigned
    unit. Unit leaders coordinate their unit but cannot edit another profile.
12. **Birthdays** — the page shows birthday information available in the safe
    directory and offers greeting actions. Optional automation sends a personal
    inbox item, a departmental broadcast, and optional email once per UTC day.

### 4.2 Productions, rehearsals, and attendance

13. **Productions and scripts** — administrators maintain productions,
    performance dates, status, descriptions, and validated HTTP(S) script links;
    members can review schedules and scripts.
14. **Casting** — administrators assign approved members to production roles;
    members view cast lists resolved through safe directory data.
15. **Rehearsals** — administrators create rehearsal dates/notes and control a
    short-lived check-in code/window. Members receive the safe schedule without
    the secret code.
16. **Attendance workspace** — administrators mark and edit attendance across
    members and rehearsals.
17. **Self check-in** — an approved member submits a rehearsal and code; the
    database RPC validates caller, open window, and code, then upserts only the
    caller's attendance.
18. **QR-assisted check-in** — browser QR tooling can capture a check-in value;
    the same server-side validation remains authoritative.
19. **Attendance analytics** — charts and per-member/session calculations show
    attendance rates. Access to detailed administrative datasets remains RLS
    controlled.

### 4.3 Communication and engagement

20. **Announcements** — administrators publish and manage department notices;
    approved members read them on dedicated and dashboard surfaces.
21. **Events calendar** — administrators maintain dated events and locations;
    approved members review upcoming activity.
22. **Event RSVP** — members choose `going`, `maybe`, or `no`. Ordinary members
    receive aggregate counts and only their own choice; administrators may view
    raw RSVP identities for event management.
23. **In-platform inbox** — approved users receive direct messages and
    authorized broadcasts. Recipient/administrator visibility is RLS enforced;
    sender identity is normalized by a trigger.
24. **Messaging center** — administrators compose recipient lists and generate
    encoded WhatsApp/email actions while logging external outreach metadata.
    The application does not pretend to send free WhatsApp messages itself.
25. **Notification bell** — combines direct unread inbox items with upcoming
    tasks/events and other actionable information; dynamic text and navigation
    tokens are escaped/validated.
26. **Tasks and assignments** — administrators create and assign tasks; an
    assignee can change only their own task status through a bounded RPC.
27. **Scheduled reminders** — administrators configure one-off/daily/weekly/
    monthly reminders and can send immediately. Optional server automation uses
    a secret-protected scheduled function and conditional claims to avoid
    duplicate processing.
28. **Polls and voting** — administrators create/open/close polls; approved
    members vote through a database RPC that validates the poll and option
    bounds. Results are aggregated without exposing other voter identities.
29. **Suggestion box** — approved members submit suggestions; administrative
    review/management remains protected by RLS.

### 4.4 Assets, operations, and management

30. **Organization gallery** — administrators and approved unit leaders upload
    bounded image types to owner-scoped paths; validated YouTube and external
    media can be displayed. Owners/managers can remove permitted records and
    bucket objects.
31. **Resource library** — administrators curate categorized HTTP(S) resources;
    approved members browse/search and open them safely.
32. **Finance ledger** — authorized users view income/expense transactions and
    treasury totals; administrators manage entries and exports.
33. **Budgets** — administrators maintain production/category budget lines and
    compare planned amounts with spending.
34. **Inventory** — tracks props, costumes, equipment, quantity, condition,
    location, and notes. Writes are administrator-only in the corrected model.
35. **Command Center** — the enterprise dashboard presents personnel,
    production, treasury, attendance, cash-flow, announcement, and upcoming
    activity summaries, with administrative detail restricted by RLS.
36. **Personalized home** — member-facing home surfaces profile completion,
    personal tasks, upcoming events, announcements, resources, and shortcuts.
37. **Reports and exports** — report pages aggregate personnel, finance,
    attendance, and operations and offer CSV/Excel/PDF/print workflows where
    supported by the relevant browser library.
38. **Activity log** — administrators review audit entries. Browser-originated
    identity is normalized, and permanent deletion is logged by the
    authoritative server function.
39. **Verified backup/import/export** — administrators can build/verify a
    sealed 22-table archive, download JSON, export a table to CSV, create a
    private vault copy, connect a least-privilege dedicated Drive folder,
    configure scheduled due checks/retention, inspect run history, and perform a
    reported merge/degraded restore. Unattended encrypted database/Auth/Storage
    workflows and guarded command-line recovery cover disaster scenarios beyond
    browser portability; all writes remain subject to constraints and RLS.
40. **Tenant branding/settings** — administrators store organization/app name,
    validated logo URL, and six-digit theme color in `tenant_settings`; layout
    applies these values consistently.

### 4.5 Cross-cutting experience

41. **Localization, dark mode, responsive layout** — shared layout supports
    language controls, remembered theme, desktop sidebar, mobile navigation,
    accessible toasts/modals, and responsive cards/tables.
42. **Optional PWA installation** — supported browsers may show an install
    invitation; browser use remains fully allowed, and dismissal is remembered
    for seven days.
43. **Limited offline shell** — the service worker caches same-origin shell
    files independently, uses network-first navigation, refreshes static files
    in the background, removes old caches, and never caches Supabase/API or
    cross-origin requests. Live data operations still require a network.
44. **Help and developer information** — Help/FAQ documents common workflows;
    the portfolio/developer page records HMG Concepts attribution and related
    links.
45. **Free-tier continuity and recovery** — staggered database heartbeats from
    independent browser/server/workflow/monitor sources make project activity
    observable and reduce pause risk; the runbook correctly notes that internal
    `pg_cron` cannot wake an already-paused database and documents Management API
    recovery.
46. **Backup concurrency and evidence** — globally serialized server leases
    prevent backup/restore destinations from racing, every run records its
    trigger/status/hash/size/count/error metadata, and abandoned leases expire.
47. **Recovery operations** — encrypted off-site sets, strict preflight tools,
    read-back verification, explicit destructive confirmations, retention only
    after successful comparison, and post-incident checklists provide a guarded
    route from backup artifact to a reviewed replacement deployment.

---

## 5. Findings and remediation

Severity describes the original commit. Every item marked **Fixed** has a code,
database, function, or documentation change in this corrected release.

### 5.1 Critical findings

| ID | Finding and impact | Resolution | Status |
| :-- | :-- | :-- | :-- |
| DC-01 | Profile self-update RLS checked only row ownership, not columns. A member could write `role='admin'` or `status='approved'`; a unit leader could update unrestricted columns of profiles in their unit. This enabled direct privilege escalation. | Added approval-aware helpers, replaced policies, and added `guard_profile_update()` to reject managed-column changes. Removed member unit writes and broad unit-leader profile management. | Fixed |
| DC-02 | `birthday-bot` and `run-reminders` accepted unauthenticated requests while using the service role. Anyone discovering the endpoints could trigger privileged jobs, duplicate broadcasts, and provider usage. | Enforced POST plus constant-time `X-Cron-Secret` verification, documented Vault-backed scheduler headers, added bounded conditional claims and failure rollback. | Fixed |
| DC-03 | Broad `SELECT` policies exposed every full profile to authenticated users, including address, emergency contact, measurements, and administrative fields. | Limited `profiles` to self/admin and introduced approval-gated `member_directory`; changed member-facing joins and pages to use the projection. | Fixed |

### 5.2 High findings

| ID | Finding and impact | Resolution | Status |
| :-- | :-- | :-- | :-- |
| DC-04 | Broad authenticated-read policies did not require approved status, so pending/rejected sessions could query operational data directly even if the UI redirected. | Operational policies now require approval; profiles are self/admin restricted with managed-column guards, and UI/Auth helpers fail closed for all roles. | Fixed |
| DC-05 | `notify-approval` had no caller authentication and could send arbitrary email through the configured provider. | Requires an approved-admin JWT or constant-time webhook secret; validates method, email, URL, payload bounds, and approval transition; returns sanitized errors. | Fixed |
| DC-06 | Members could read rehearsal check-in codes and write their own attendance directly, making the code ineffective. | Added `rehearsal_schedule` without the secret, restricted the base table, removed direct member writes, and added `self_check_in()` RPC. | Fixed |
| DC-07 | Poll queries exposed voter IDs, RSVP rows exposed attendee identities, and direct writes did not validate active poll/option semantics server-side. | Added bounded vote RPC and aggregate result RPCs; raw votes/RSVPs are self/admin restricted; pages consume aggregate results. | Fixed |
| DC-08 | Any authenticated user could insert an inbox broadcast or spoof sender metadata. | Approval-gated inbox policy plus trigger restricts broadcasts to admins and replaces sender ID/name with the authenticated profile. | Fixed |
| DC-09 | Task assignees had generic row update access and could change fields beyond status. | Removed generic assignee updates and introduced `set_task_status()` with caller/task/status checks. | Fixed |
| DC-10 | Browser-side member deletion removed only the profile, potentially orphaning a working Auth account, and rejection was destructive. | Rejection now stores `rejected`; permanent removal goes through `auth.admin.deleteUser()`, blocks self-removal, uses cascades, and logs server-side. | Fixed |
| DC-11 | Administrator-created Auth users were not rolled back if profile upsert failed, leaving partial accounts. Caller approval was not checked. | Function now requires an approved admin, validates/bounds input, deletes a just-created Auth user if profile creation fails, and sanitizes failures. | Fixed |
| DC-12 | Avatar/gallery Storage writes were broadly authenticated and did not consistently enforce approved owner/manager paths, MIME types, or size. | Replaced Storage policies with approval and owner/manager checks; browser uploads use caller-prefixed paths, type/size validation, and cleanup on metadata failure. | Fixed |

### 5.3 Medium findings

| ID | Finding and impact | Resolution | Status |
| :-- | :-- | :-- | :-- |
| DC-13 | Toasts, confirmations, inline event attributes, headers, and page templates mixed untrusted strings with HTML, creating stored/reflected DOM injection opportunities. | Reworked toast/confirm to DOM text nodes, escaped rendered data, replaced vulnerable inline interpolation with looked-up IDs/event listeners, and documented the trusted-modal boundary. | Fixed |
| DC-14 | Social, script, resource, gallery, logo, color, YouTube, Drive, mail, and image values had inconsistent URL/scheme validation. | Centralized URL/image/color/YouTube validators; added host/scheme checks, safe relative paths, encoded IDs, `noopener noreferrer`, and SQL constraints. | Fixed |
| DC-15 | Profile lookup errors fell back to the raw Auth user, and missing status could be treated as approved; an admin role could bypass approval. | Profile verification now throws on error/missing row, every role requires exactly `approved`, and failures sign out/redirect. | Fixed |
| DC-16 | Password reset constructed `reset.html` relative to the root page, but the file is under `pages/`. | Recovery now targets an absolute same-origin `pages/reset.html` URL. | Fixed |
| DC-17 | Profile editing wrote email to the profile first and silently ignored Auth update failure, causing login/profile desynchronization. | Auth is authoritative; email changes use `auth.updateUser()`, profile email is trigger-synchronized, and pending confirmation is explained. | Fixed |
| DC-18 | Members could edit drama unit despite it being an authorization/grouping field, while admin UI lacked a clear assignment control. | Unit is read-only on profile; administrators receive bounded assign/change/clear controls; trigger protects the column. | Fixed |
| DC-19 | Member detail rendering used stale next-of-kin/skills fields inconsistent with the schema. | Updated detail labels and values to current birthday, unit, emergency, and measurement columns. | Fixed |
| DC-20 | Mandatory-install messaging blocked/coerced browser users and overstated offline/security benefits. Dismissal was not durably remembered. | Installation is optional, browser continuation is first-class, dismissal lasts seven days, and documentation states live-data network limits. | Fixed |
| DC-21 | Service-worker precaching included cross-origin dependencies in one `addAll`, so one CDN failure could abort installation; cache/version text was stale and navigation could stay old. | Same-origin files cache independently with `Promise.allSettled`; navigation is network-first; old caches are deleted; API/CDN traffic is network-only; maintained cache is `dramaconnect-v13.2`. | Fixed |
| DC-22 | Scheduled jobs could process the same item concurrently, and birthday automation selected pending/rejected profiles. | Conditional claims, day/run markers, approved-member selection, bounded batches, and rollback reduce duplicate/incorrect processing. | Fixed |
| DC-23 | Gallery upload trusted filename extensions, lacked robust size/type checks, and could leave an object when row creation failed or after deletion. | MIME allowlist, 10 MB bound, owner path, metadata, insert rollback, and best-effort delete cleanup added. | Fixed |
| DC-24 | Raw error messages from privileged functions could expose provider/database internals. | Functions log server-side detail while returning bounded, generic client errors. | Fixed |

### 5.4 Low/documentation and consistency findings

| ID | Finding and impact | Resolution | Status |
| :-- | :-- | :-- | :-- |
| DC-25 | Version/cache labels disagreed (`v13`, `v16`, and other historical text), complicating release support. | Maintained release and cache identifiers are aligned at v13.2; historical feature-origin labels remain clearly historical. | Fixed |
| DC-26 | Setup instructions omitted the hardening migration and first-admin bootstrap details in some files. | All deployment/setup/photo guides require `repair_and_upgrade.sql`, `security_hardening.sql`, then `resilience_and_backup.sql`, with controlled first-administrator bootstrap. | Fixed |
| DC-27 | Scheduler and email guides recommended insecure/unauthenticated deployment without explaining compensating function checks or secrets. | Rewritten around explicit function-local authorization, Vault/header configuration, webhook transition setup, and troubleshooting. | Fixed |
| DC-28 | Documentation overstated unit-leader powers, offline capability, mandatory installation, free-tier limits, and deletion/rejection behavior. | README, feature guide, user guide, deployment guide, checklist, and troubleshooting guide reconciled with the implemented model. | Fixed |

### 5.5 Resilience, backup, Drive, and recovery findings

| ID | Finding and impact | Resolution | Status |
| :-- | :-- | :-- | :-- |
| DC-29 | DramaConnect had no coordinated, source-observable strategy to reduce Supabase free-tier pause risk or detect/recover a paused project. A single visit or scheduler was an unmeasured dependency. | Added throttled source heartbeats, browser/manual activity, GitHub, public Edge, Vercel, Apps Script/external-monitor, optional `pg_cron`, administrator health, schedule-preservation commits, and a Management API recovery watchdog. | Fixed |
| DC-30 | The client backup path was not a deterministic, complete, independently verifiable representation of all application/config tables. Truncation, mutation, malformed table lists, or partial exports could be accepted. | Added paginated 22-table export, exact ordered manifest/counts, canonical SHA-256 per table/full seal, strict parser/type/timestamp/version checks, 100 MB limit, independent CLI verifier, and tamper tests. | Fixed |
| DC-31 | DramaConnect lacked GOSA-equivalent Google Drive backup/sync and had no least-privilege folder lifecycle, automatic due check, retention, or verified Drive restore. | Added GIS token flow with exact `drive.file`, in-memory tokens, dedicated marked folder, server-owned settings, due/overdue state, popup-free scheduled checks, verified archive upload/download, retention, and guarded restore preflight. | Fixed |
| DC-32 | Backups could race across tabs/destinations and client-local scheduling/settings were not authoritative or auditable. | Added administrator-only settings RPC, globally serialized expiring leases, run history, success/failure metadata, stale-run reclamation, and RLS-isolated views/policies. | Fixed |
| DC-33 | Browser portability alone did not preserve password hashes/Auth identities or Storage object bytes and was not a full disaster-recovery strategy. | Added weekly matching-version custom public and data-only Auth catalogs, intentional session/token exclusion, optional recursive Storage bytes, GPG AES-256, sidecars, rclone remote comparison, retention-after-verification, and recovery documentation. | Fixed |
| DC-34 | The first unattended-transfer design used an invalid three-argument `rclone copy` pattern and did not establish a safely restorable two-catalog boundary. | Replaced it with one source/one destination plus exact include filters; split public schema and data-only Auth catalogs; validated Docker positional quoting; rehearsed optional/no-Storage workflow branches and remote sidecars. | Fixed |
| DC-35 | Storage export/restore needed stronger duplicate, retry, path, symlink, size, target-bucket conflict, and successful-upload verification defenses. | Export now streams bounded objects into a fresh private tree, rejects unsafe/duplicate API listings and verifies disk bytes. Restore strictly preflights every manifest/file/symlink/hash before target access, requires explicit conflicting-bucket reconciliation, retries transient failures, and hashes remote read-back bytes. | Fixed |
| DC-36 | The database restore catalog-version parser matched a simplified mock header but not real `pg_restore --list` output, whose metadata has indentation and a colon; production recovery would stop before restore. | Generalized the anchored parser for real and mocked headers, then completed a matching PostgreSQL 17 encrypted custom-catalog recovery rehearsal that preserved managed Auth schema objects and validated restored relationships. | Fixed |
| DC-37 | Settings used the shared `.admin-only { display:none }` class but did not reveal those sections after `requireAdmin()`, leaving the new administrator resilience/backup controls invisible despite successful initialization. | Explicitly reveal settings' administrator sections only after the server-backed administrator guard succeeds; focused Chromium interaction now covers the visible form, archive, vault, and no-popup schedule behavior. | Fixed |
| DC-38 | Browser archive/vault/Drive operations could otherwise consume excessive memory or accept weak Drive metadata/content assumptions. | Added 100 MB portable serialization/restore, 50 MB vault upload, exact Drive MIME/app-marker/trashed/size checks, strict content verification, and clear warnings that portable restore is merge/upsert rather than transactional replacement. | Fixed |

---

## 6. Resolution approach

The remediation was performed from the data boundary outward:

1. **Preserve evidence** — clone the exact source commit and generate an
   untouched `git archive` before making changes.
2. **Inventory the full surface** — map pages, shared scripts, DB methods,
   tables, RLS, Storage, PWA assets, functions, docs, and live public behavior.
3. **Define authorization invariants** — exact approval, admin, member,
   unit-leader, ownership, privacy, and server-secret rules.
4. **Harden PostgreSQL** — add constraints, safe views, authorization helpers,
   column guards, RPCs, normalized identity triggers, indexes, and replacement
   RLS/Storage policies in an idempotent second migration.
5. **Adapt the client** — consume safe projections/aggregate RPCs, remove direct
   privileged writes, fail closed, validate URLs/media, and make dangerous
   account actions explicit.
6. **Harden privileged functions** — method/auth/secret checks, input bounds,
   rollback, concurrency claims, approved-recipient filtering, and safe errors.
7. **Fix PWA/runtime behavior** — optional installation, durable dismissal,
   independent shell precaching, network-first navigation, backend-safe routing,
   and synchronized release labels.
8. **Reconcile documentation** — make migration order, bootstrap, secrets,
   deployment modes, permissions, account lifecycle, and offline behavior match
   the code.
9. **Understudy GOSA without changing it** — map every keep-alive, Drive,
   portability, vault, scheduling, retention, and recovery layer to
   DramaConnect's actual static/shared-module architecture.
10. **Build defense in depth** — place throttling/settings/leases/audit at the
    database boundary; keep tokens in memory; make archives deterministic and
    self-verifying; separate convenience portability from encrypted disaster
    recovery; require preflight and explicit confirmations.
11. **Validate repeatedly** — parse scripts, execute all migrations and
    authorization scenarios, bundle functions/tools, load every page in both
    supported role states, exercise focused settings/backup interactions,
    tamper archives, simulate Storage failures, rehearse workflow shell paths,
    and restore real custom PostgreSQL catalogs to a disposable target.
12. **Package reproducibly** — archive original and fixed trees separately,
    inspect their roots/file lists, independently extract/check them, and
    publish SHA-256 digests.

---

## 7. Verification performed

### 7.1 Database and authorization

- PostgreSQL-compatible parse/execution in order of
  `repair_and_upgrade.sql`, `security_hardening.sql`, and
  `resilience_and_backup.sql`; the latter two were rerun successfully to check
  idempotence.
- Verified v13.2 object inventory: **54 public policies, 12 Storage policies, 21
  public functions, and 2 public views**.
- Tested pending/rejected/member/administrator gates, safe directory output,
  role anti-escalation, RSVP privacy and administrator cross-user restoration,
  self check-in, poll bounds, task ownership, member-broadcast denial, sender
  normalization, heartbeat source normalization/throttling, administrator-only
  backup settings, invalid Google client rejection, lease contention/tokens,
  run-history isolation, and vault Storage policies.

### 7.2 Static, module, and browser behavior

- Every one of the 33 HTML documents contains exactly one `config.js`,
  `resilience.js`, `data-portability.js`, and `drive-sync.js` in dependency
  order; every local script/link target resolves and all 33 inline scripts
  parse.
- esbuild parsed/bundled all **19** browser, service-worker, API, and operational
  JavaScript entries with the correct browser/Node target.
- Mocked Chromium loaded every HTML document as approved administrator and
  approved member: **66 page/state combinations, zero failures**.
- A focused settings Chromium test verified visible administrator controls,
  exact 22-table module inventory, `drive.file` scope, v13.2 metadata,
  zero-hour grace preservation, server settings RPC payload, verified local and
  private-vault archive paths, and no OAuth script/popup during automatic
  overdue checks.
- `git diff --check` and `bash -n` checks passed after remediation.

### 7.3 Archive, Storage, workflow, and recovery behavior

- Portable archive integration passed 501-row pagination, all 22 tables,
  browser and independent CLI verification, payload mutation detection,
  self-resealed malformed-manifest rejection, and 100 MB size enforcement.
- Storage integration passed recursive two-bucket export, exact manifest/local
  bytes, pre-write tamper rejection, intentional bucket reconciliation, upload,
  and remote byte verification. Focused edge tests additionally passed duplicate
  buckets/objects, transient 429/503 retries, lexical traversal, intermediate
  symlink escape, existing-output refusal, unsafe API names, target bucket
  conflict refusal, and corrupted remote read-back rejection.
- All three workflow YAML files parsed and every `run: |` block passed shell
  syntax. The extracted weekly backup step executed under strict mocks in both
  optional-Storage and no-Storage modes; Docker positional quoting, two dump
  names, GPG, sidecars, exact rclone include arguments, remote check, retention
  ordering, and heartbeat response verification completed. Both rehearsed
  remote sets passed independent `sha256sum --check`.
- Real PostgreSQL 17 source/target servers produced matching custom public and
  data-only Auth catalogs. The encrypted restore tool validated actual
  `pg_restore --list` metadata, restored one user/identity/profile/event,
  preserved an Auth sessions table, removed no managed Auth schema, and found no
  profile/identity orphan. This rehearsal exposed and fixed the real catalog
  header parser incompatibility.

These checks are regression evidence, not a claim that production credentials,
SMTP delivery, Google OAuth/Drive, GitHub-hosted runners, live Supabase Storage,
or production Supabase configuration were integration-tested.

---

## 8. Deployment procedure for the fixed release

1. Preserve a current database/Auth/Storage backup and rehearse rollback in a
   non-production project.
2. In Supabase SQL Editor, run, in order and in full:
   `database/repair_and_upgrade.sql`,
   `database/security_hardening.sql`, then
   `database/resilience_and_backup.sql`.
3. Bootstrap/verify the first approved administrator using the controlled SQL
   in `docs/DEPLOYMENT.md`; test the new health/settings RPCs as that account and
   confirm a member cannot read/update backup settings, runs, leases, or vault.
4. Configure `assets/js/config.js` with only the project URL, public `anon` key,
   and public app identifiers. Never add service role, database URL, Management
   API token, rclone configuration, or passphrase to browser code.
5. Deploy the five Edge Functions with the exact gateway/function-local auth
   modes documented. Configure `CRON_SECRET`, notification/provider values, and
   allowed origins where applicable.
6. Deploy the static site and protected Vercel endpoint/configuration. Hard
   refresh once and confirm `CONFIG.APP_VERSION`, service-worker cache, and
   displayed system version are `v13.2`.
7. Configure at least two independent heartbeat paths, then verify source rows
   in Settings. Add optional `pg_cron` only as another activity source; it cannot
   wake a paused project. Configure and test the Management API recovery
   watchdog separately.
8. Configure Google OAuth redirect/origin settings and the public Web Client ID;
   connect Drive manually as an administrator, create a backup, verify it, list
   it, download/verify it, and confirm the dedicated folder marker/retention.
9. Configure GitHub backup secrets and a restricted rclone remote. Run the
   weekly workflow manually, independently verify every remote encrypted file
   and sidecar, decrypt/list catalogs in a protected environment, and complete a
   disposable restore rehearsal before enabling unattended production use.
10. Execute `docs/SETUP_CHECKLIST.md` across anonymous, pending, rejected,
    member, unit-leader, and administrator roles. Confirm RLS with direct API
    tests and complete the backup/recovery and incident-runbook checks.

Detailed setup and operational gates are in `docs/DEPLOYMENT.md`,
`docs/SETUP_CHECKLIST.md`, `docs/SUPABASE_FREE_TIER_PROTECTION.md`,
`docs/BACKUP_AND_RECOVERY.md`, and `docs/RESILIENCE_RUNBOOK.md`.

---

## 9. Residual risks and recommendations

1. **All three migrations are mandatory.** Until the security and resilience
   migrations are applied, static v13.2 code cannot provide the server-side
   authorization, heartbeat, settings, lease, run-history, or vault guarantees.
2. **Existing bad data is not silently rewritten.** Some checks are installed as
   `NOT VALID` so an existing deployment is not bricked. Audit/clean historical
   rows and explicitly validate constraints.
3. **No production-provider integration occurred.** Rehearse SMTP/webhooks,
   cron headers, Auth redirects, CORS, Google OAuth/Drive, GitHub secrets,
   rclone, Management API restoration, and live Supabase Storage in staging.
4. **The real database rehearsal was representative, not Supabase-managed.** It
   used matching PostgreSQL 17 custom catalogs and verified the recovery logic,
   but Supabase Auth tables can evolve. Rehearse against the exact source/target
   Supabase generation and contact support rather than disabling constraints.
5. **Public restore cleaning is catalog-scoped.** `pg_restore --clean` removes
   and recreates source-catalog objects in `public`; target-only public objects
   can remain. Recover to a fresh project and inventory unexpected public
   objects before reopening access. Auth schemas are intentionally never
   cleaned by the tool.
6. **Portable restore is not full disaster recovery.** It is verified
   merge/upsert, not one transaction, does not delete newer rows, omits Auth
   credentials/sessions and Storage bytes, and depends on RLS/constraints. Keep
   encrypted database/Auth/Storage sets and rehearse them.
7. **Scheduled workflow continuity is not guaranteed by GitHub alone.** Public
   repository schedules may be disabled after prolonged inactivity. Monitor
   workflow runs and use independent heartbeat sources; preservation commits
   require write permission and branch rules that allow the bot.
8. **Public media is public.** Avatar/gallery buckets intentionally permit
   public reads. Do not store sensitive imagery; migrate to private signed URLs
   if privacy requirements change.
9. **CDN supply/availability remains a dependency.** Major UI libraries are
   remotely loaded without repository-pinned production bundles/SRI. A future
   release should self-host pinned assets and deploy a tested Content Security
   Policy.
10. **Backups are sensitive.** Portable JSON/CSV and decrypted database/Auth or
    Storage sets may contain personal data and password hashes. Enforce access,
    retention, malware-safe storage, encryption, secure temporary deletion, and
    legal/privacy requirements.
11. **Secret rotation and off-site independence remain operational duties.** Use
    separate protected accounts/locations, MFA, least privilege, restore-tested
    passphrase escrow, and rotation for cron/webhook/provider/database/service
    role/Management API/rclone credentials.
12. **Administrator power is intentionally broad.** Require MFA where available,
    unique passwords, minimal administrator count, rapid offboarding, role
    reviews, and monitored backup/restore activity.
13. **Observability needs an external alert path.** Alert on stale heartbeat
    sources, failed/abandoned runs, GitHub schedule disablement, Edge/Vercel
    failures, Drive overdue state, remote backup verification, and restore
    watchdog failures; dashboards inside a paused project are insufficient.
14. **Repository-native regression CI should grow.** Promote the PGlite policy
    harness, archive/Storage tamper suites, parser/reference checks, function
    bundles, browser matrix, workflow rehearsal, and a disposable matching
    PostgreSQL restore into pinned CI jobs.
15. **Manual accessibility/device testing remains advisable.** Perform keyboard,
    screen-reader, low-bandwidth, Android/iOS, printing, camera, OAuth popup,
    large-archive memory, and responsive-table testing on real devices.

---

## 10. Deliverable manifest

### 10.1 Preserved and corrected trees

- **Untouched original archive:** `dramaconnect-original.zip` — the 80 original
  tracked files under the single preserved root
  `lp25-dramaconnect-original/`.
- **Corrected source archive:** `dramaconnect-fixed.zip` — the complete 102-file
  corrected tree under the single preserved root
  `lp25-dramaconnect-fixed/`.
- **Audit record:** `AUDIT_AND_REMEDIATION_REPORT.md` — architecture, full
  feature inventory, DC-01 through DC-38, fixes, evidence, deployment gates,
  and residual risks.

The ZIP digests, byte sizes, entry/file counts, and independent extraction
results are supplied with the final handover. The corrected ZIP digest is not
embedded here because changing this report would necessarily change that ZIP's
digest.

### 10.2 Database and browser resilience/backup implementation

- `database/security_hardening.sql`
- `database/resilience_and_backup.sql`
- `assets/js/resilience.js`
- `assets/js/data-portability.js`
- `assets/js/drive-sync.js`
- Updated shared browser modules, service worker, all 33 HTML documents, and
  administrator settings interface.

### 10.3 Protected server and scheduler implementation

- `supabase/functions/ping/index.ts`
- `supabase/functions/ping/README.md`
- `api/keep-alive.js`
- `vercel.json`
- `.github/workflows/keep-alive.yml`
- `.github/workflows/auto-restore.yml`
- `.github/workflows/database-backup.yml`
- `scripts/google-apps-script-keep-alive.gs`
- `scripts/check-resilience.mjs`

### 10.4 Verification and recovery tools

- `scripts/verify-portable-archive.mjs`
- `scripts/export-storage.mjs`
- `scripts/restore-storage.mjs`
- `scripts/restore-database-dump.sh`

### 10.5 Operator and user documentation

- `docs/SUPABASE_FREE_TIER_PROTECTION.md`
- `docs/BACKUP_AND_RECOVERY.md`
- `docs/RESILIENCE_RUNBOOK.md`
- Updated `README.md`, deployment guides/checklists, feature/user guides, and
  issue-specific operational documentation.

---

## 11. Final conclusion

The original DramaConnect commit combined a broad and useful feature set with
critical server-side authorization defects, privacy overexposure, unsafe
privileged automation boundaries, inconsistent client handling, and no complete
continuity/backup/recovery control plane. It should not be redeployed unchanged.

The corrected v13.2 tree resolves all documented findings **DC-01 through
DC-38**. It implements every relevant Supabase free-tier protection and Google
Drive Backup & Sync layer identified in the GOSA reference while retaining
DramaConnect's existing folder/page architecture. It also exceeds that baseline
with deterministic all-table archives, independent tamper verification,
server-owned leases/settings/history, encrypted separate public/Auth catalogs,
optional verified Storage-byte recovery, remote read-back checks, guarded
restore tools, explicit reconciliation, workflow continuity controls, and
staged incident procedures. No GOSA file was modified, and no DramaConnect
generator was invented.

The current tree passed database authorization/resilience tests, static
33-document inspection, JavaScript bundling/parsing, 66 administrator/member
browser cases, focused settings/backup browser interactions, archive tamper and
size tests, adversarial Storage tests, workflow YAML/shell checks and mocked
execution, and a real PostgreSQL 17 encrypted two-catalog recovery rehearsal.
Those results establish strong repository-level evidence, not proof of an
unconfigured production environment.

The fixed release is therefore **ready for controlled staging deployment**, not
blind production replacement. Production acceptance remains conditional on the
three migrations running in order, secrets and providers being configured
outside browser code, live RLS/Edge/OAuth/Drive/Storage/workflow checks,
independent backup verification, and a restore rehearsal into a fresh isolated
recovery target followed by object and relationship audits. Multi-source
heartbeat protection materially reduces and detects free-tier pause risk but
cannot guarantee third-party availability; portable Drive archives complement,
not replace, encrypted database/Auth/Storage disaster-recovery sets.
