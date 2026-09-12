# DramaConnect v14 — Implementation, Defect, Security, Backup, Generator, and Remediation Report

**Report date:** 25 August 2026  
**Primary target:** RCCG LP 25 Drama Department — DramaConnect Enterprise  
**Maintained release:** `14.0`  
**Generator:** DramaConnect Deployment Generator `1.0`  
**Original LP25 commit preserved:** `f97f5a58c0a5e94bb07f3c0e4b19092b334788f0`

## 1. Executive conclusion

DramaConnect v14 is implemented in both requested targets:

1. the corrected LP25 DramaConnect source; and
2. a standalone, same-origin browser generator that emits branded deployable ZIP files.

The release retains the earlier authorization, privacy, Edge Function, Storage, resilience, and disaster-recovery corrections and adds the v14 management control plane, six dedicated administration pages, 25-table verified portability, expanded Google Drive Backup & Sync, lifetime/subscription entitlement handling, quota/retention controls, and a deterministic cumulative database installer.

`database/complete-schema.sql` is the **only production SQL installer**. It was built deterministically from maintained components and executed twice in one disposable Supabase-compatible PostgreSQL database. A separate regression also removed `public.tenant_settings` and then executed `database/security_hardening.sql`; the component recreated the missing relation and completed without `42P01`.

The generator verifies the exact byte count and SHA-256 digest of every canonical template file before producing output. It rejects privileged browser credentials, preserves the selected root folder, converts uploaded branding to four PNG sizes, applies constrained configuration, and emits transparent licensing/backup seed state. It does not upload the configuration and does not claim client-hosted licensing is tamper-proof.

Repository-level and mocked-browser validation passed. Production acceptance still requires deployment-specific RLS checks, Google OAuth/Drive testing, provider-secret configuration, backup destination verification, and a rehearsed restoration against the actual Supabase project generation.

---

## 2. Scope and preservation

### Modified targets

- `lp25-dramaconnect/`
- `dramaconnect-generator/`

### Read-only references

The following were reviewed but not modified:

| Reference | Evidence used |
| :-- | :-- |
| SchoolConnect site | `https://hmgschoolconnect.vercel.app/` and its browser builder |
| SchoolConnect source | `https://github.com/hmgconcepts/schoolconnect` at `a6d9419aae44a246a610353de9d9b1107319a394` |
| GOSA site | `https://gosaportal.vercel.app/` |
| GOSA source | `https://github.com/hmgconcepts/gosaportal` at `a0467a7ad06417dc217e70edeb4541c38f6a81bf` |
| SchoolConnect Demo | `https://schoolconnectdemo.vercel.app` |
| SchoolConnect Demo source | `https://github.com/hmgconcepts/schoolconnectdemo` at `222152f32f9f0bacb6abd255aef6f55078d14a28` |

### Preservation model

- The untouched LP25 archive is generated from Git commit `f97f5a58…`, not from the modified working tree.
- The corrected archive is generated from the validated v14 tree.
- Each ZIP has one explicit root directory and preserves all paths beneath it.
- The generator is packaged separately with its canonical template, local JSZip runtime, tests, and documentation.
- Archive digests and inventories are recorded in the separate release checksum manifest, avoiding a self-referential checksum inside the corrected ZIP.

---

## 3. Reference understudy and improvements

### 3.1 What was retained from the references

SchoolConnect demonstrated a browser wizard that packages configurable static portals. GOSA demonstrated practical management surfaces for health, status, storage, licensing, free-tier activity, and Drive backup. Relevant patterns retained in DramaConnect include:

- a guided browser configuration flow;
- branded static output with a stable folder structure;
- Supabase public configuration and controlled license options;
- independent heartbeat sources and operational health visibility;
- Google Identity Services and Drive browser integration;
- scheduled/due backup checks, list/download/restore/delete operations, and retention;
- storage, roles/status, health, and licensing administration surfaces.

### 3.2 Deliberate improvements over the references

DramaConnect v14 adds or strengthens:

- SHA-256 plus byte-count verification of every generator template source file;
- no reuse of LP25’s hosted Supabase project in generated deployments;
- explicit rejection of service-role/secret keys and non-anon legacy JWTs;
- exact `drive.file` scope, in-memory access tokens, dedicated app-marked folders, and no unsolicited OAuth popup;
- stable, paginated, 25-table archives with per-table hashes and a full archive seal;
- database-backed global leases, run history, stale-run handling, read-back verification, retention only after verified success, and guarded restore;
- a private Supabase backup vault plus encrypted unattended database/Auth/Storage recovery tooling;
- database-owned platform settings, quotas, retention, lockdown, login audit, and entitlement state;
- a deliberately accessible license/recovery page when member access is restricted;
- transparent wording that source/browser-controlled subscription checks are operational controls, not tamper-proof commercial licensing;
- a sole cumulative SQL installer, deterministic build manifests, two-pass execution tests, and a direct regression for missing `tenant_settings`;
- generated singleton seeds that apply only while `updated_by IS NULL`, so rerunning setup does not overwrite later administrator changes.

---

## 4. v14 implementation inventory

### 4.1 Cumulative database authority

`database/complete-schema.sql` contains, in dependency order:

1. repaired base schema and safe upgrades;
2. authorization/security hardening;
3. resilience, heartbeat, backup settings, leases, history, and vault controls;
4. platform management, retention, login audit, lockdown, role/status, storage, and licensing controls.

The build script records component SHA-256 values in the generated header. Component SQL remains available as maintainable source, but deployment documentation consistently instructs operators to run only `database/complete-schema.sql`.

Validated inventory:

- **31** public tables;
- **73** public RLS policies;
- **32** public functions;
- safe rerun in the same database;
- no automatic “first visitor becomes admin” behavior;
- no blanket approval backfill.

### 4.2 Six dedicated administration surfaces

| Page | Primary behavior |
| :-- | :-- |
| `pages/settings.html` | Tenant branding, profile/configuration, resilience, heartbeat, archive, Drive, vault, retention, and links to the dedicated control-plane pages |
| `pages/admin-data.html` | Verified export/restore operations, archive inventory, database/vault workflow entry points, and explicit destructive-operation boundaries |
| `pages/storage-manager.html` | Storage/database usage visibility, quota thresholds, retention controls, bucket/object administration, and safe cleanup workflow |
| `pages/platform-health.html` | Heartbeat source freshness, database/Drive/license/lockdown state, backup history, login audit, health warnings, and operational actions |
| `pages/roles-status.html` | Server-authoritative approval, role, unit-leader, and account-status review/update flow with audit integration |
| `pages/site-license.html` | Lifetime/subscription state, expiry/grace, renewal/support, external registry, transparent enforcement notice, and restricted-session recovery access |

All six pages are in navigation, linked from Settings, parser-tested, and included in the v14 service-worker shell.

### 4.3 Platform access and licensing

- LP25 seeds **lifetime ownership** by default.
- Generated deployments may choose lifetime or subscription state.
- Ordinary pages call the server-authoritative access-state RPC.
- Lockdown and non-active subscription states can redirect users to Site License.
- Site License calls `Auth.checkSession({ allowRestricted: true })`, allowing an approved restricted member to review entitlement and recovery details.
- Administrators can update state through bounded RPCs; singleton changes are audited.
- Expiry and grace are explicit; HTTPS renewal/registry URLs and support email are validated.
- The browser and database provide operational access enforcement, while documentation correctly states that a deployment owner with source/database control can alter local checks.

### 4.4 Supabase free-tier resilience and protection

The implementation provides defense in depth rather than promising that any single scheduler can prevent pausing:

- source-aware browser/manual heartbeat with authoritative throttling;
- GitHub scheduled keep-alive with bounded retries and minimal permissions;
- secret-protected Edge and Vercel entry points;
- Apps Script and external-monitor setup paths;
- optional internal Supabase schedule/`pg_cron` as an additional active-project source;
- Management API recovery watchdog guidance for a genuinely paused project;
- source timestamps/counts, external heartbeat state, and stale-source warnings;
- repository-schedule continuity controls;
- database/storage warning and critical thresholds;
- retention settings and cleanup RPCs;
- login-event audit and idle-session timeout;
- emergency lockdown with an administrator/recovery path;
- RLS, server-authoritative roles/status, approval gating, safe projections, bounded RPCs, and constrained Storage paths;
- service worker that keeps Supabase, cross-origin, Auth, REST, Storage, Functions, and `/api/` traffic network-only.

Internal `pg_cron` is not described as an independent wake-up mechanism because it cannot run after its own database has paused.

### 4.5 Google Drive Backup & Sync

The browser Drive layer includes:

- Google Identity Services token flow using only `https://www.googleapis.com/auth/drive.file`;
- public OAuth Web client ID only—never a client secret;
- tokens retained in memory with explicit reconnect;
- a dedicated application-marked Drive folder;
- portable archive creation through the same 25-table verifier used by local/vault workflows;
- verified upload metadata and subsequent content verification;
- list, verified download, restore preflight, explicit restore, and delete;
- global database backup/restore leases and run records;
- due/overdue scheduling on active browser visits without surprise sign-in popups;
- retry/backoff state and bounded client memory;
- retention only after a successful verified backup;
- visible account, destination, last-run, next-due, failure, and connection state.

Portable archives intentionally omit Auth passwords/sessions and Storage bytes. The encrypted unattended workflow covers separate public/Auth catalogs and optional Storage bytes for disaster recovery.

### 4.6 Portable data coverage

Schema `14.0` archives exactly these 25 application/configuration tables, in restore dependency order:

`profiles`, `productions`, `rehearsals`, `events`, `polls`, `finances`, `announcements`, `messages`, `reminders`, `resources`, `inventory`, `tenant_settings`, `dc_platform_settings`, `dc_retention_settings`, `dc_site_license`, `activity_log`, `budgets`, `cast_list`, `attendance`, `inbox`, `tasks`, `poll_votes`, `event_rsvps`, `gallery`, and `suggestions`.

Resilience run history and live leases are intentionally excluded to avoid recursive operational backups.

### 4.7 Standalone browser generator

The generator provides a five-step responsive wizard:

1. application/organization/folder identity;
2. colour and optional PNG/JPEG/WebP branding;
3. Supabase public configuration and optional Drive Web client ID;
4. lifetime/subscription settings;
5. review, acknowledgement, preview, validation, and ZIP generation.

Security and integrity behavior:

- all processing occurs in the browser;
- local JSZip is included—generation does not depend on a CDN;
- the canonical app template uses `_template-manifest.json`; LP25’s PWA `manifest.json` remains untouched;
- all 109 canonical entries are checked for safe paths, exact bytes, and SHA-256 before use;
- the template contains sentinels rather than LP25’s project URL/key;
- generated receipts exclude Supabase keys, Drive client IDs, and secrets;
- logo input is size/type bounded and converted to 1024, 512, 192, and 180 pixel PNG files;
- output includes `generated-site.json` and `START_HERE.txt` under the selected root;
- the cumulative SQL receives branding, Drive, and entitlement seed state;
- only public anon/publishable keys are accepted.

The template manifest is an integrity manifest, not a digital signature. A hostile party that can replace both files and manifest on the same host can bypass that local check; trustworthy hosting and release checksums remain necessary.

---

## 5. Defect, conflict, and remediation register

### 5.1 v14 findings

| ID | Defect/conflict/error | Remediation | Status |
| :-- | :-- | :-- | :-- |
| DC14-01 | `security_hardening.sql` referenced `public.tenant_settings` when that relation might not yet exist, producing `ERROR 42P01`. | Added an idempotent guarded `tenant_settings` table/seed before dependent hardening and a regression that drops the table, runs the component, and verifies recreation. | Fixed/tested |
| DC14-02 | Production setup required multiple SQL files and documentation could drift on ordering. | Added deterministic `complete-schema.sql`; all active setup guides use it as the sole installer. | Fixed/tested twice |
| DC14-03 | Settings was partially corrupted during integration, leaving malformed JavaScript. | Restored the valid baseline page, reapplied v14 integration, and parser-tested all inline scripts. | Fixed |
| DC14-04 | The six requested management concerns were mixed into Settings or absent as dedicated workflows. | Implemented and linked Settings, Admin Data, Storage Manager, Platform Health, Roles & Status, and Site License. | Fixed |
| DC14-05 | Management actions risked relying on hidden buttons/client role labels. | Added server-authoritative RPC/RLS checks, exact approval, audit hooks, and client guards as secondary controls. | Fixed |
| DC14-06 | Portable backup metadata and table coverage were still v13.2/22-table in places. | Raised archive schema to `14.0`, froze 25 definitions, updated implementation/tests/docs, and removed stale 22-table claims. | Fixed |
| DC14-07 | License handling could either overclaim security or lock administrators out of recovery. | Added transparent lifetime/subscription state, database/browser checks, external registry option, and restricted-session Site License access. | Fixed/browser-tested |
| DC14-08 | LP25’s intended ownership model could be changed inadvertently by generator work. | LP25 defaults to lifetime ownership; configurable subscriptions are confined to generated deployments unless an LP25 administrator deliberately changes state. | Fixed |
| DC14-09 | Storage/database growth lacked unified thresholds and retention administration. | Added retention/quota singleton settings, warning/critical thresholds, usage views/RPCs, cleanup actions, and Storage Manager. | Fixed |
| DC14-10 | Backup/restore jobs could race across tabs/destinations. | Retained and integrated database-backed global leases, stale expiry, run metadata, and status reporting across local/vault/Drive operations. | Fixed |
| DC14-11 | Automatic Drive checks could trigger unsolicited OAuth or treat local scheduling as authoritative. | Scheduling only operates with an existing usable token; server settings/runs remain authoritative and OAuth is explicit. | Fixed |
| DC14-12 | Generator output could leak/reuse LP25’s Supabase endpoint/key. | Template build sanitizes both values to sentinels; tests scan for the LP25 project reference/key and require replacement. | Fixed/tested |
| DC14-13 | A generator metadata file named `manifest.json` overwrote LP25’s PWA manifest, causing generated output/test corruption. | Renamed generator metadata to `_template-manifest.json` everywhere and rebuilt all entries. | Fixed/tested |
| DC14-14 | jsdom did not expose `TextDecoder`/`TextEncoder`, causing the first generator integration run to fail. | Injected Node utility globals into the test window while retaining native browser APIs in production. | Fixed |
| DC14-15 | Secret/service-role credentials could be entered into static output. | Rejects `sb_secret_*`, service-role strings/JWTs, non-anon legacy JWTs, client-secret patterns, and malformed hosted origins. | Fixed/tested |
| DC14-16 | Generated seed SQL could overwrite later administrator changes on every installer rerun. | Seed updates require `updated_by IS NULL`; subsequent operator-managed rows are preserved. | Fixed/two-pass tested |
| DC14-17 | Arbitrary ZIP paths/names could permit traversal or broken root structure. | Folder slug is constrained; manifest paths reject absolute/traversal entries; one selected root contains all output. | Fixed/tested |
| DC14-18 | Uploaded branding could be oversized, unsupported, or inconsistently shaped. | Type/size validation plus canvas-based aspect-fit PNG conversion to four exact square dimensions. | Fixed/fixture-tested |
| DC14-19 | “Signed template manifest” wording overstated an unhashed metadata file. | Changed wording to “template integrity manifest” and documented its trust boundary. | Fixed |
| DC14-20 | The service worker did not include the new management code/surfaces or v14 cache identity. | Updated cache to `dramaconnect-v14.0` and precached control-plane JavaScript and all six administration pages. | Fixed/tested |
| DC14-21 | Documentation still contained stale 22-table and multi-migration instructions. | Reconciled README, deployment, backup, features, setup, and generator guidance with 25 tables and the sole cumulative installer. | Fixed/audited |
| DC14-22 | Static-only tests did not prove actual browser download behavior. | Added Playwright Chromium tests for generator navigation, preview, generated download inspection, and LP25 restricted-license recovery. | Fixed/passed |
| DC14-23 | Subscription and lifetime paths plus custom PNGs needed explicit output evidence. | Generated both fixture ZIPs, verified root paths and four PNG dimensions, checked sanitized config/receipt/licensing/Drive seeds, and executed each schema twice. | Fixed/passed |
| DC14-24 | Local links, conflict markers, template hashes, and cross-target credential isolation needed one release-wide audit. | Scanned both trees, 650+ local references, exact conflict markers, key patterns, JWT roles, template entries, and known LP25 credential isolation. | Fixed/passed |

### 5.2 Inherited security defects retained as fixed

The earlier remediation findings remain enforced in v14. They include:

- prevention of profile self-promotion/status manipulation;
- approval-aware RLS and safe member-directory projections;
- protected service-role Edge Functions and approval-mail authorization;
- secret rehearsal/check-in and poll/RSVP identity protection;
- task/inbox ownership and sender normalization;
- server-authoritative Auth deletion and partial-account rollback;
- constrained Storage paths, file types, sizes, and owner/manager policies;
- fail-closed profile/session verification;
- bounded URL/media rendering and XSS-safe DOM handling;
- optional PWA installation and network-safe service-worker behavior;
- source-aware heartbeats, independent schedulers, pause recovery, and health observability;
- sealed portable archives, Drive lifecycle, vault, leases, run history, encrypted database/Auth/Storage backup, remote verification, and guarded restore.

These controls were not replaced by weaker reference implementations.

---

## 6. Verification evidence

### 6.1 LP25 aggregate validation

`npm test` performs a deterministic schema rebuild, executes the resulting installer twice, and validates browser modules/pages.

Result:

- complete schema pass 1: OK;
- complete schema pass 2: OK;
- 31 public tables;
- 73 public policies;
- 32 public functions;
- standalone missing-`tenant_settings` security-hardening repair: PASS;
- 14 browser scripts parsed with VM and esbuild;
- 38 HTML documents and 38 inline scripts parsed;
- platform-management dependency ordering verified;
- all six dedicated administration surfaces verified.

`npm run test:browser` used Chromium with a controlled Supabase mock and proved that an approved member with an expired subscription remains on Site License, sees the renewal message, cannot see administrator-only navigation/editor controls, and is not redirected away from the recovery surface.

### 6.2 Generator validation

`npm test` result:

- 109 canonical template files;
- 1,681,687 canonical bytes after final documentation synchronization;
- exact byte/SHA-256 verification;
- browser API parsing and validation;
- generated ZIP root/configuration/licensing checks;
- customized `complete-schema.sql` executed twice;
- branding, Drive, tenant, and subscription seed state verified.

`npm run test:browser` result:

- five-step Chromium flow completed;
- template loaded and validated;
- preview rendered;
- a real `dramaconnect-v14.0.zip` browser download was captured;
- ZIP structure, configuration, Site License, receipt, and cumulative SQL were inspected.

`npm run test:fixtures` result:

- generated explicit lifetime and subscription ZIPs;
- uploaded a custom PNG through the production browser path;
- verified 1024/512/192/180 PNG output;
- verified the exact selected root and all six administration pages;
- verified no LP25 project sentinel/host leakage;
- verified receipt exclusion of public configuration identifiers;
- executed both generated cumulative schemas twice and asserted branding, Drive, and entitlement rows.

### 6.3 Release-wide audit

The final release audit passed:

- LP25 and generator text/file scans;
- hundreds of local HTML/CSS/Markdown references;
- exact merge-conflict markers;
- private-key/AWS/service-role JWT signatures;
- LP25 project/key isolation from the canonical generator template;
- all canonical template paths, byte counts, and SHA-256 digests.

### 6.4 What was not claimed

No production Supabase data was read or changed during this work. Production Google OAuth/Drive, GitHub Actions, Vercel Cron, Apps Script, SMTP/Resend, rclone, Storage bytes, Management API restore, and external monitors were not invoked with production secrets. Browser tests use controlled mocks where production accounts are unnecessary.

---

## 7. Deployment and acceptance gates

1. Preserve and independently verify current database/Auth/Storage backups.
2. In Supabase SQL Editor run **all of `database/complete-schema.sql` once**. Do not follow historical component-migration instructions.
3. Sign up the intended first administrator, then promote only that exact email through the trusted SQL Editor command in `docs/DEPLOYMENT.md`.
4. Configure only the hosted Supabase URL and anon/publishable key in browser code. Never add a service-role key, database password, personal access token, cron secret, backup passphrase, rclone credential, or OAuth client secret.
5. Deploy static files over HTTPS; clear the previous service-worker cache once during the v14 rollout.
6. Test anonymous, pending, rejected, approved member, unit leader, administrator, lockdown, expired subscription, and lifetime states against the real RLS/RPC deployment.
7. Configure at least two independent heartbeat paths and separately monitor the recovery watchdog.
8. Configure a Google OAuth Web client with exact production origins, connect Drive explicitly as an administrator, and test upload/list/verified download/restore/delete/retention in staging.
9. Configure encrypted off-site database/Auth/Storage backup and complete a fresh-project restore rehearsal before relying on it.
10. Set realistic quotas/retention and alert on stale heartbeats, failed/abandoned runs, overdue Drive backups, login anomalies, and critical storage growth.

---

## 8. Residual risks

1. **Third-party availability and quotas:** no collection of heartbeats can guarantee that Supabase, Google, GitHub, Vercel, or another provider remains available or keeps the same free-tier rules.
2. **Client-hosted licensing:** a deployment owner can change source/database state. Use contracts and an independently controlled signed entitlement service where commercial enforcement is required.
3. **Portable archive limits:** browser archives omit Auth secrets/sessions and Storage bytes and are merge/upsert oriented, not a complete transactional disaster-recovery image.
4. **Browser memory:** large organizations should rely on the unattended encrypted workflow rather than pushing the 100 MiB portable browser limit.
5. **CDN dependencies:** UI libraries remain externally hosted. Local fallback CSS preserves core navigation, but future work should self-host pinned libraries and deploy a tested CSP/SRI policy.
6. **Public media:** current avatar/gallery public-read behavior is unsuitable for sensitive imagery; private signed URLs require a deliberate migration.
7. **Operational secrets:** backup and scheduler guarantees depend on correct secret scope, MFA, rotation, off-site independence, retention, and monitoring.
8. **Production schema evolution:** restore tooling must be rehearsed against the exact PostgreSQL/Supabase source and target generation.
9. **Accessibility/device coverage:** repository tests do not replace keyboard, screen-reader, mobile, low-bandwidth, print, camera, OAuth-popup, and large-archive tests on real devices.
10. **Integrity-manifest trust:** same-host SHA-256 detects accidental/mismatched template files, not a server compromise that replaces both file and manifest.

---

## 9. Deliverables

- Untouched original LP25 ZIP from Git `f97f5a58…`.
- Corrected LP25 DramaConnect v14 ZIP.
- Standalone DramaConnect browser generator ZIP.
- Lifetime and subscription QA fixture ZIPs with custom PNG branding.
- Release checksum/inventory manifest.
- This implementation and remediation report.

The release checksum manifest records final filenames, roots, entry counts, sizes, and SHA-256 values after archive construction and independent extraction checks.

---

## 10. Final assessment

DramaConnect v14 is ready for **controlled staging deployment**. The required source implementation, cumulative schema, six administration surfaces, free-tier resilience controls, Drive Backup & Sync, transparent licensing, generator, documentation, regression tests, browser tests, and release audits are complete.

Production approval remains conditional on real-project RLS/RPC testing, correct provider origins/secrets, a verified Drive lifecycle, independent encrypted backups, and a successful restoration rehearsal. Within those explicit boundaries, the corrected release is materially safer, more observable, more portable, and more operationally complete than the reviewed reference patterns.
