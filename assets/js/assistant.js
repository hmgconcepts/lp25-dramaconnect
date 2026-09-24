/**
 * ============================================================================
 * assistant.js — DramaConnect Assistant
 * ----------------------------------------------------------------------------
 * A rules-based, fully offline help assistant. No AI API, no network call,
 * no paid service, no data leaving the browser.
 *
 * It is deliberately deeper than a keyword bot:
 *   1. Per-page depth  — it knows every page from PAGE_GUIDE (purpose, what it
 *                        does, who uses it, steps, advantages, benefit, tips).
 *   2. Topic depth     — a curated knowledge base for cross-cutting questions
 *                        (backup, pause, licence, roles, attendance...).
 *   3. Full-text fallback — if nothing matches, it searches every page guide
 *                        and offers the best pages instead of giving up.
 *   4. Role awareness  — answers note what the signed-in person may do.
 *   5. Memory          — conversation persists across pages in the session.
 * ============================================================================
 */
(() => {
  'use strict';

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const md = s => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');

  const STORE = 'dc_assistant_history_v1';

  /* -------------------------------------------------------------------------
   * Curated topic knowledge base.
   *   m     = match keywords (scored; longer phrases score higher)
   *   t     = short title
   *   r     = reply (supports **bold** and \n)
   *   p     = related page id or doc
   *   chips = suggested follow-up questions
   * ---------------------------------------------------------------------- */
  const KB = [
    {
      m: ['backup', 'back up', 'export data', 'save data', 'make a backup', 'archive'],
      t: 'Backing up',
      r: '**Backups live on one page: Admin Data.**\n\n' +
         '1. Open **Admin Data → Local** and click **Export verified archive** — that gives you a sealed file on your device.\n' +
         '2. For automatic off-site copies, open the **Drive** tab, paste your Google OAuth Client ID, press **Connect**, then **Backup now**.\n' +
         '3. Set **interval 7 days** and **keep 12** archives for about three months of history.\n\n' +
         'Every archive carries a SHA-256 seal. It is checked before upload, checked again after upload, and checked before any restore — so a corrupt backup can never overwrite good data.',
      p: 'admin-data', chips: ['How do I restore?', 'How do I set up Google Drive?', 'What is a verified archive?']
    },
    {
      m: ['restore', 'recover', 'import data', 'put back', 'undo a mistake'],
      t: 'Restoring',
      r: '**Restoring is on Admin Data.**\n\n' +
         '• **Merge/upsert** — for the same database. Updates and re-inserts rows; nothing is deleted. Use this for routine recovery.\n' +
         '• **Disaster recovery** — for a **fresh** database. Keeps every operational row and defers only member links, which you rebuild afterwards with the re-link manifest.\n' +
         '• **Legacy degraded** — do not use it; it discards whole tables.\n\n' +
         'A restore refuses to start until the archive seal verifies, so a damaged file can never harm your data.',
      p: 'admin-data', chips: ['How do I restore onto a new database?', 'What is the re-link manifest?', 'How do I back up?']
    },
    {
      m: ['disaster recovery', 'fresh database', 'new database', 'project deleted', 'lost everything', 'wizard'],
      t: 'Disaster recovery',
      r: '**Use the 🚑 wizard when the project is gone — not when it is merely paused.**\n\n' +
         'If the project is only *paused*, restore it at supabase.com instead, then press **💓 Test heartbeat**. Use the wizard only for genuine, permanent loss.\n\n' +
         'The wizard: verifies the seal before the first write, keeps every attendance, casting, task, poll, RSVP and inbox row, defers only member links, and retries row-by-row so one bad row cannot sink the rest.\n\n' +
         'Afterwards, download the **re-link manifest**, let people re-register with the same email, then upload that manifest on the Local tab to rebuild every link.\n\n' +
         'The full, printable procedure is in `docs/DISASTER-RECOVERY-RUNBOOK.md`.',
      p: 'admin-data', chips: ['What is the re-link manifest?', 'My project is paused', 'How do I back up?']
    },
    {
      m: ['re-link', 'relink', 'manifest', 'member link', 'links lost', 'orphaned rows',
          'lost names', 'missing names', 'names are gone', 'blank names', 'unknown person',
          'after restore', 'after recovery', 'broken reference', 'broken links', 'unlinked',
          'attendance lost', 'names disappeared', 'rebuild links', 'link manifest'],
      t: 'Re-linking members',
      r: '**This is what makes a DramaConnect recovery better than an ordinary restore.**\n\n' +
         'Login accounts cannot be copied, so a recovery cannot keep the old person IDs. Instead of throwing the links away, DramaConnect records each one in a **ledger** (table, row, column, old ID, email).\n\n' +
         'When members re-register they get a new ID but the **same email**, so email acts as a bridge. Upload the manifest on **Admin Data → Local → Re-link manifest** and every link is rebuilt — 412 attendance rows, 61 casting rows, and so on.\n\n' +
         'It is safe to re-run: rows already linked simply match again, and anything still unmatched belongs to people who have not registered yet.',
      p: 'admin-data', chips: ['How do I restore onto a new database?', 'Why did attendance lose names?']
    },
    {
      m: ['google drive', 'drive', 'oauth', 'client id', 'connect drive', 'drive sync'],
      t: 'Google Drive setup',
      r: '**One-time setup, about 20 minutes, entirely free.**\n\n' +
         '1. Create a Google Cloud project.\n' +
         '2. Enable the **Google Drive API** (not Drive Activity, not Picker).\n' +
         '3. Configure the consent screen, add the scope `.../auth/drive.file`, and add every administrator as a **test user**.\n' +
         '4. Create an **OAuth Client ID → Web application** and add your site URL to both authorised origins and redirects.\n' +
         '5. Paste the Client ID into **Admin Data → Drive** and press **Backup now**.\n\n' +
         'The `drive.file` scope is the least-privilege Drive scope that exists: the app can touch only the files it created, never your other Drive content.\n\n' +
         'Full screenshots and the exact errors table are in `docs/GOOGLE-DRIVE-SYNC-GUIDE.md`.',
      p: 'admin-data', chips: ['The Drive popup was blocked', 'It says access blocked', 'How do I back up?']
    },
    {
      m: ['heartbeat', 'keep alive', 'keep-alive', 'pause', 'paused', 'pausing', 'inactive', 'suspend',
          'free tier', 'free plan', 'supabase', 'project paused', 'project inactive', 'weekly pause',
          'stop the pause', 'stop it pausing', 'keep it awake', 'keep the project awake', 'goes to sleep'],
      t: 'Staying awake',
      r: '**Supabase pauses a free project after 7 days with no activity.** DramaConnect protects against this with **twelve layers**, and the Platform Health page tells you which are working.\n\n' +
         'The rule of two: **at least two independent external sources must be fresh.** One source is a single point of failure — if it dies, the database still looks healthy and you find out only when it pauses.\n\n' +
         'That is what the quorum banner is for: it names the source that has gone quiet (for example a GitHub Action whose secret expired) while you can still fix it.\n\n' +
         'Press **💓 Test heartbeat** on Platform Health to send a ping right now — do it weekly in long holidays.',
      p: 'platform-health', chips: ['My project is paused', 'What is the quorum banner?', 'Single point of failure']
    },
    {
      m: ['single point of failure', 'quorum', 'gone quiet', 'silent', 'one source',
          'scheduler', 'cron', 'github actions', 'dead scheduler', 'only one source', 'workflow stopped'],
      t: 'Quorum',
      r: '**Quorum means at least two heartbeat sources are fresh.**\n\n' +
         'Thresholds: fresh ≤ 72h, warning ≤ 120h, critical < 168h, paused at 168h. An individual source is only flagged silent after 192h — deliberately longer than the pause window, so a weekly scheduler is never falsely accused.\n\n' +
         'If the banner says **single point of failure**, only one source is working. Add a second: GitHub Actions and Vercel Cron together is the usual pair, and both are free.',
      p: 'platform-health', chips: ['Staying awake', 'How do I add a heartbeat source?']
    },
    {
      m: ['license', 'licence', 'ownership', 'entitlement', 'renewal', 'expire', 'cost', 'price', 'payment',
          'subscription', 'subscribe', 'monthly', 'annual', 'yearly', 'per month', 'per year',
          'do we pay', 'have to pay', 'paying', 'paid', 'free', 'how much', 'billing', 'invoice',
          'one time', 'one-time', 'lifetime', 'own it', 'seat', 'trial', 'upgrade fee'],
      t: 'Licensing',
      r: '**DramaConnect is lifetime ownership by default** — one-time, no subscription, no per-seat fee.\n\n' +
         'The **Site License** page is the single source of truth: it shows the licence class, the entitlement state, the licensed organisation, activation and renewal details, and the full licence event history.\n\n' +
         'Platform Health shows a one-line licence summary for health purposes only; the detail — and any change to it — lives on the Site License page.',
      p: 'site-license', chips: ['Where do I see the licence on other pages?', 'Who owns our data?']
    },
    {
      m: ['approve', 'approval', 'pending', 'new account', 'sign up', 'signup', 'register', 'join'],
      t: 'Approvals',
      r: '**Nobody sees anything until an administrator approves them.** A stranger who signs up lands on an empty platform.\n\n' +
         'Administrators: open **Roles & Status → Pending Review** and approve only people you recognise. Approving also makes the person visible in the directory and the register.\n\n' +
         'Reject — do not ignore — anyone you do not know, so the counters stay meaningful.',
      p: 'roles-status', chips: ['How do I change someone role?', 'Someone cannot sign in']
    },
    {
      m: ['role', 'permission', 'access', 'least privilege', 'admin rights', 'make someone admin'],
      t: 'Roles',
      r: '**Roles & Status owns roles — nothing else does.**\n\n' +
         'Give each person the least privilege they need. Roles are enforced in the database (PostgreSQL row-level security) as well as on screen, so hiding a button on one page does not grant access elsewhere.\n\n' +
         'To remove access temporarily, **suspend** rather than delete — deletion would also destroy that person\'s attendance, casting and task history.',
      p: 'roles-status', chips: ['How do I approve someone?', 'What can a unit leader see?']
    },
    {
      m: ['attendance', 'mark attendance', 'check in', 'check-in', 'absent', 'present'],
      t: 'Attendance',
      r: '**Attendance is marked against a real rehearsal session.**\n\n' +
         'Create the session on **Rehearsals** first, then open **Attendance**, choose the session and mark everyone PRESENT in one click and correct the exceptions.\n\n' +
         'You can also share the session **check-in code** so a room full of people self-registers.\n\n' +
         '**Excused** is deliberately separate from **absent**, so your statistics stay honest. Then read the trend on **Attendance Analytics**.',
      p: 'attendance', chips: ['How do I see attendance trends?', 'How do I create a rehearsal?']
    },
    {
      m: ['casting', 'cast', 'character', 'role in a play', 'assign a part'],
      t: 'Casting',
      r: '**Casting is per production.**\n\n' +
         'Create the production on **Productions**, then open **Casting**, pick that production and assign members to character or crew roles.\n\n' +
         'Each assignment has a state — **offered / confirmed / declined** — which ends the "I never agreed" arguments.\n\n' +
         'Assign understudies as their own roles so cover is explicit. The cast list exports from **Reports**.',
      p: 'casting', chips: ['How do I create a production?', 'How do I export the cast list?']
    },
    {
      m: ['storage', 'quota', 'space', 'running out', 'too big', 'disk', 'megabyte', 'mb'],
      t: 'Storage',
      r: '**Storage Manager owns quota and retention.**\n\n' +
         'It shows database and file usage against your quota with warning and critical thresholds, lists stored objects so you can find the big ones, and owns the retention policy (activity-log days, backup-run days, heartbeat days, login-audit days).\n\n' +
         'Purging is **backup-gated**: the platform refuses to purge data that has no fresh backup, so cleaning up can never become data loss.\n\n' +
         'Photos and videos are almost always the fastest-growing item — check the meters monthly.',
      p: 'storage-manager', chips: ['How do I purge old logs?', 'How do I back up?']
    },
    {
      m: ['purge', 'retention', 'delete old', 'clean up', 'old logs'],
      t: 'Retention',
      r: '**Retention is set on the Storage Manager, and nowhere else.**\n\n' +
         'Set how many days to keep activity-log entries, backup runs, heartbeats and login-audit rows, then save. Safe minimums are enforced so you cannot zero out a trail by accident.\n\n' +
         'Purging is backup-gated — if there is no fresh backup, the platform will not purge. Export first from **Admin Data** if you want an offline copy. The **Activity Log** itself is deliberately read-only.',
      p: 'storage-manager', chips: ['Where is the audit trail?', 'How do I back up?']
    },
    {
      m: ['audit', 'activity log', 'who did', 'history of changes', 'trail'],
      t: 'Audit trail',
      r: '**The Activity Log is a read-only audit trail.**\n\n' +
         'Every create, update, delete, import and login is recorded automatically — who, what, when. Nobody can type an entry in by hand, and administrators cannot rewrite history.\n\n' +
         'Filter by actor, action or date range, and export the slice you need for an enquiry.\n\n' +
         'How long entries are kept is controlled on the **Storage Manager** — this page never purges.',
      p: 'activity', chips: ['How do I purge old logs?', 'How do I change someone role?']
    },
    {
      m: ['password', 'reset', 'forgot', 'cannot sign in', 'cant login', 'locked out'],
      t: 'Signing in',
      r: '**Password reset is self-service.**\n\n' +
         'On the sign-in screen click **Forgot password?** and a reset link is emailed to you. Open `reset.html` from that link and set a new password.\n\n' +
         'If you never received the email, check spam — and confirm you are using the address you registered with.\n\n' +
         'If your account is stuck at *pending*, no password will help: an administrator must approve you on **Roles & Status** first.',
      p: 'roles-status', chips: ['How do I approve someone?', 'How do I change my details?']
    },
    {
      m: ['install', 'app', 'offline', 'home screen', 'pwa', 'add to home'],
      t: 'Installing',
      r: '**DramaConnect installs like an app, for free.**\n\n' +
         'Accept the **Install DramaConnect** banner when it appears, or use your browser menu → **Add to Home Screen**.\n\n' +
         'Once installed it opens in one tap, works offline for browsing pages you have already visited, and looks and feels like a native app. Nothing is downloaded from an app store and there is no fee.',
      p: 'home', chips: ['Does it work offline?', 'How do I get my ID card?']
    },
    {
      m: ['print', 'pdf', 'export', 'csv', 'download', 'report'],
      t: 'Exporting',
      r: '**Reports owns exporting.**\n\n' +
         'Choose a report type (members, attendance, cast list, finance, inventory), set the scope by production or date range, then **export CSV** for spreadsheets or **print to PDF** for leadership.\n\n' +
         'CSV is for analysis; PDF is for leadership. Export both if a report is leaving the department.\n\n' +
         'Members and inventory pages also have their own CSV export for day-to-day use.',
      p: 'reports', chips: ['How do I export the cast list?', 'How do I back up everything?']
    },
    {
      m: ['notification', 'bell', 'remind', 'reminder', 'alert', 'not getting messages'],
      t: 'Notifications',
      r: '**Two notification channels, and they are different.**\n\n' +
         '• The **🔔 bell** (top right) — automatic system notifications: new tasks, attendance prompts, poll openings, backup warnings.\n' +
         '• The **Inbox** — private messages from real people.\n\n' +
         'Scheduled, recurring reminders are configured on **Scheduled Reminders** (administrators). If you are not receiving something, check the bell first — system notices never land in the inbox.',
      p: 'reminders', chips: ['How do I message an admin?', 'How do I create a task?']
    },
    {
      m: ['dark mode', 'theme', 'language', 'branding', 'logo', 'colour', 'color', 'rename'],
      t: 'Appearance',
      r: '**Settings owns appearance.**\n\n' +
         '• **Dark mode** and **language** — the toggles at the bottom of the sidebar, on every page.\n' +
         '• **Branding** (application name, logo, organisation, province, primary colour) — **Settings → Global App Branding**, then **Apply Branding**.\n\n' +
         'Everything operational now lives on its own page; Settings launches into those workspaces rather than duplicating them.',
      p: 'settings', chips: ['Where did the backup controls go?', 'What does Settings still own?']
    },
    {
      m: ['where did', 'moved', 'cannot find', 'missing', 'used to be', 'gone'],
      t: 'Finding things',
      r: '**Every high-risk function now lives on exactly one page.**\n\n' +
         '• Archives, Google Drive, vault, restore, disaster recovery → **Admin Data**\n' +
         '• Heartbeat, anti-pause layers, security controls → **Platform Health**\n' +
         '• Quota, object inventory, retention and purging → **Storage Manager**\n' +
         '• Approvals, roles, suspension → **Roles & Status**\n' +
         '• Licence and entitlement → **Site License**\n' +
         '• Audit trail (read-only) → **Activity Log**\n' +
         '• Branding, device profile, appearance → **Settings**\n\n' +
         'Settings is the front door: its **Administration control plane** shows live status for each and links straight through. Press **Ctrl+K** to jump to any page.',
      p: 'settings', chips: ['What does Settings still own?', 'Show me every page']
    },
    {
      m: ['support', 'contact', 'human', 'help me', 'talk to someone', 'developer'],
      t: 'Getting human help',
      r: '**Three ways, all free.**\n\n' +
         '1. This assistant — ask about any page or topic.\n' +
         '2. The **Help Centre** — every page guide, the full FAQ and troubleshooting.\n' +
         '3. **Message an Admin** — from the bottom of the Help Centre, or your **Inbox**.\n\n' +
         'For platform ownership and pricing philosophy, see **Developer Bio**.',
      p: 'help', chips: ['Show me every page', 'How do I message an admin?']
    }
  ];

  /* ------------------------------------------------------------------------- */

  const Assistant = {
    open: false,
    history: [],
    QUICK: ['Explain this page', 'How do I back up?', 'Staying awake', 'Approvals', 'Show me every page', 'Finding things'],

    /* ---------------- lifecycle ---------------- */
    init() {
      if (this._init) return;
      this._init = true;
      this.restore();
      this.mount();
      this.bindKeys();
      if (!this.history.length) this.greet();
      else this.render();
    },

    restore() {
      try {
        const raw = sessionStorage.getItem(STORE);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) this.history = parsed.slice(-40);
        }
      } catch (e) { /* storage unavailable — harmless */ }
    },

    persist() {
      try { sessionStorage.setItem(STORE, JSON.stringify(this.history.slice(-40))); } catch (e) { /* ignore */ }
    },

    greet() {
      const page = (window.PageGuide && PageGuide.get(PageGuide.currentId())) || null;
      const name = page ? page.summary.split(/[.•]/)[0] : 'the platform';
      this.push('bot',
        'Hello! 👋 I am the **DramaConnect Assistant**.\n\n' +
        'You are on the page whose job is: ' + (page ? page.summary : 'the page you are viewing') + '\n\n' +
        'I can explain **any page** in depth, walk you through backups and recovery, explain the anti-pause safeguards, ' +
        'or tell you exactly which page owns a control. Try **"explain this page"**, or tap a suggestion below.',
        ['Explain this page', 'How do I back up?', 'Staying awake', 'Finding things']);
    },

    /* ---------------- ui ---------------- */
    mount() {
      if (document.getElementById('dc-assistant')) return;
      const wrap = document.createElement('div');
      wrap.id = 'dc-assistant';
      wrap.innerHTML =
        '<button id="dc-assistant-fab" type="button" title="Ask the assistant" aria-label="Ask the assistant"' +
        ' style="position:fixed;right:18px;bottom:18px;z-index:9998;width:56px;height:56px;border-radius:50%;border:none;' +
        'cursor:pointer;background:linear-gradient(135deg,#2563eb,#7c3aed);color:#fff;font-size:22px;' +
        'box-shadow:0 12px 28px rgba(37,99,235,.4)">💬</button>' +
        '<div id="dc-assistant-win" role="dialog" aria-label="DramaConnect Assistant"' +
        ' style="display:none;position:fixed;right:18px;bottom:84px;z-index:9999;width:360px;max-width:94vw;' +
        'height:min(520px,78vh);background:#fff;border-radius:18px;box-shadow:0 24px 60px rgba(15,23,42,.32);' +
        'flex-direction:column;overflow:hidden">' +
          '<div style="background:linear-gradient(135deg,#2563eb,#7c3aed);color:#fff;padding:13px 15px;' +
          'display:flex;align-items:center;justify-content:space-between">' +
            '<div><strong style="font-size:14px">DramaConnect Assistant</strong>' +
            '<div id="dc-assistant-ctx" style="font-size:11px;opacity:.85"></div></div>' +
            '<div style="display:flex;gap:4px">' +
              '<button id="dc-assistant-clear" type="button" title="Clear conversation"' +
              ' style="background:rgba(255,255,255,.16);border:none;color:#fff;width:26px;height:26px;' +
              'border-radius:8px;cursor:pointer;font-size:12px">⟳</button>' +
              '<button id="dc-assistant-x" type="button" aria-label="Close"' +
              ' style="background:rgba(255,255,255,.16);border:none;color:#fff;width:26px;height:26px;' +
              'border-radius:8px;cursor:pointer;font-size:15px">×</button>' +
            '</div>' +
          '</div>' +
          '<div id="dc-assistant-msgs" style="flex:1;overflow-y:auto;padding:14px;background:#f8fafc;font-size:13.5px"></div>' +
          '<div id="dc-assistant-chips" style="display:flex;flex-wrap:wrap;gap:6px;padding:8px 12px 0"></div>' +
          '<div style="display:flex;gap:6px;padding:10px;border-top:1px solid #e2e8f0">' +
            '<input id="dc-assistant-in" type="text" placeholder="Ask about backups, roles, casting…" aria-label="Your question"' +
            ' style="flex:1;padding:9px 12px;border:1px solid #cbd5e1;border-radius:10px;font-size:13px;outline:none">' +
            '<button id="dc-assistant-send" type="button" aria-label="Send"' +
            ' style="background:#2563eb;color:#fff;border:none;border-radius:10px;padding:0 14px;cursor:pointer;font-size:14px">➤</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(wrap);

      document.getElementById('dc-assistant-fab').onclick = () => this.toggle();
      document.getElementById('dc-assistant-x').onclick = () => this.toggle(false);
      document.getElementById('dc-assistant-send').onclick = () => this.send();
      document.getElementById('dc-assistant-clear').onclick = () => { this.history = []; this.persist(); this.greet(); };
      const input = document.getElementById('dc-assistant-in');
      input.addEventListener('keydown', ev => { if (ev.key === 'Enter') this.send(); });
      this.renderContext();
    },

    renderContext() {
      const el = document.getElementById('dc-assistant-ctx');
      if (!el || !window.PageGuide) return;
      const g = PageGuide.get(PageGuide.currentId());
      el.textContent = g ? ('On: ' + PageGuide.currentId().replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())) : '';
    },

    bindKeys() {
      document.addEventListener('keydown', ev => {
        const t = ev.target || {};
        const tag = String(t.tagName || '').toLowerCase();
        const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable;
        // Ctrl/Cmd + K  -> quick page jump
        if ((ev.ctrlKey || ev.metaKey) && String(ev.key).toLowerCase() === 'k') {
          ev.preventDefault(); this.toggle(true); this.showPageFinder(); return;
        }
        if (typing) return;
        if (ev.key === '/') { ev.preventDefault(); this.toggle(true); const i = document.getElementById('dc-assistant-in'); if (i) i.focus(); }
      });
    },

    toggle(force) {
      const w = document.getElementById('dc-assistant-win');
      if (!w) return;
      this.open = force === undefined ? !this.open : !!force;
      w.style.display = this.open ? 'flex' : 'none';
      if (this.open) { this.render(); const i = document.getElementById('dc-assistant-in'); if (i) i.focus(); }
    },

    /* ---------------- conversation ---------------- */
    push(from, msg, chips) {
      this.history.push({ from: from, msg: msg, chips: chips || null });
      this.persist();
      this.render();
    },

    send() {
      const i = document.getElementById('dc-assistant-in');
      if (!i) return;
      const text = String(i.value || '').trim();
      if (!text) return;
      i.value = '';
      this.history.push({ from: 'user', msg: text });
      this.persist();
      this.render();
      const self = this;
      setTimeout(() => {
        const a = self.answer(text);
        self.history.push({ from: 'bot', msg: a.r, chips: a.chips });
        self.persist();
        self.render();
      }, 200);
    },

    ask(text) { const i = document.getElementById('dc-assistant-in'); if (i) i.value = text; this.send(); },

    /* ---------------- rendering ---------------- */
    render() {
      const list = document.getElementById('dc-assistant-msgs');
      if (!list) return;
      list.innerHTML = this.history.map(m =>
        '<div style="margin-bottom:10px;display:flex;justify-content:' + (m.from === 'user' ? 'flex-end' : 'flex-start') + '">' +
          '<div style="max-width:86%;padding:9px 12px;border-radius:14px;line-height:1.55;' +
          (m.from === 'user'
            ? 'background:#2563eb;color:#fff;border-bottom-right-radius:4px'
            : 'background:#fff;color:#0f172a;border:1px solid #e2e8f0;border-bottom-left-radius:4px') + '">' +
            md(m.msg) +
          '</div>' +
        '</div>').join('');
      list.scrollTop = list.scrollHeight;
      this.renderChips();
    },

    renderChips() {
      const host = document.getElementById('dc-assistant-chips');
      if (!host) return;
      let chips = null;
      for (let i = this.history.length - 1; i >= 0; i--) {
        if (this.history[i].from === 'bot' && this.history[i].chips) { chips = this.history[i].chips; break; }
      }
      if (!chips || !chips.length) { host.innerHTML = ''; return; }
      const self = this;
      host.innerHTML = '';
      chips.slice(0, 6).forEach(c => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = c;
        b.style.cssText = 'padding:5px 10px;border:1px solid #cbd5e1;background:#fff;color:#334155;' +
          'border-radius:999px;font-size:11.5px;cursor:pointer';
        b.onclick = () => self.ask(c);
        host.appendChild(b);
      });
    },

    showPageFinder() {
      const self = this;
      if (!window.PageGuide) return;
      const groups = PageGuide.groups();
      let html = '**Jump to a page** — or just ask me about it:\n';
      groups.forEach(([g, ids]) => { html += '\n**' + g + ':** ' + ids.join(', '); });
      this.push('bot', html, ['Explain this page', 'Finding things']);
    },

    /* ---------------- answering ---------------- */
    pageId() { return window.PageGuide ? PageGuide.currentId() : ''; },

    answer(raw) {
      const q = String(raw || '');
      const l = ' ' + q.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/-/g, ' ') + ' ';

      /* 1. Explicit page explanation requests */
      if (/\b(explain|describe|about|what is|whats|help with|tell me about)\b.*\b(this|the current|current)\b.*\b(page|screen|section)\b/.test(l) ||
          /^\s*(explain|about)\s*(this|page)\s*$/.test(l) || /^\s*this page\s*$/.test(l)) {
        return this.pageAnswer(this.pageId());
      }

      /* 2. A named page — but ONLY when the question is genuinely ABOUT that page.
         "explain attendance" is a request for the page; "why did attendance lose
         names after recovery" is a support question that merely mentions it, and
         the curated topic below is the better answer. */
      const named = this.findNamedPage(l);
      const asksAboutPage =
        /\b(explain|describe|about|what is|whats|help with|tell me about|open|go to|show me|take me to|navigate)\b/.test(l) ||
        /\b(page|screen|section)\b/.test(l);
      const isBareName = named && q_words(l).length <= 3 &&
        !/\b(why|how|when|where|who|lost|missing|broken|error|fail|wrong|stopped|cant|can't|after)\b/.test(l);
      if (named && (asksAboutPage || isBareName)) return this.pageAnswer(named);

      /* 3. Curated topics, scored so the BEST entry wins, not the first */
      let best = null, bestScore = 0;
      for (const e of KB) {
        let score = 0;
        for (const k of e.m) {
          const needle = ' ' + k.replace(/-/g, ' ') + ' ';
          if (l.indexOf(needle) !== -1) score += 3 + k.split(' ').length + k.length / 12;
          else if (l.indexOf(k.replace(/-/g, ' ')) !== -1) score += 1 + k.length / 20;
        }
        if (score > bestScore) { bestScore = score; best = e; }
      }
      if (best && bestScore >= 2) {
        return { r: best.r + (best.p ? this.linkLine(best.p) : ''), chips: best.chips };
      }

      /* 3b. No curated topic matched, but the question did name a page.
         Explaining that page beats dumping a list of guesses. */
      if (named) return this.pageAnswer(named);

      /* 4. Full-text fallback across EVERY page guide — never a dead end */
      if (window.PageGuide) {
        const hits = this.searchGuides(q);
        if (hits.length) {
          const top = hits.slice(0, 4).map(h =>
            '• **' + this.label(h.id) + '** — ' + h.snippet);
          return {
            r: 'I do not have a dedicated answer for that, but these pages look relevant:\n\n' + top.join('\n') +
               '\n\nAsk me **"explain ' + this.label(hits[0].id).toLowerCase() + '"** for the full walkthrough, or open the Help Centre.',
            chips: hits.slice(0, 4).map(h => 'Explain ' + this.label(h.id).toLowerCase())
          };
        }
      }

      /* 5. Polite fallbacks */
      if (/\b(thanks|thank you|ta|cheers)\b/.test(l)) return { r: 'You are welcome! 🎉 Anything else?', chips: this.QUICK };
      if (/\b(hi|hello|hey|good morning|good afternoon|good evening)\b/.test(l))
        return { r: 'Hello! 👋 What can I help you with?', chips: this.QUICK };
      if (/\b(bye|goodbye|see you)\b/.test(l)) return { r: 'Goodbye! 👋 Reopen me anytime from the 💬 button.' };

      return {
        r: 'I am not certain about that one. I *do* know every page in depth, plus backups, recovery, ' +
           'anti-pause safeguards, roles, licensing, storage and reporting.\n\n' +
           'Try **"explain this page"**, **"how do I back up?"**, or **"finding things"** — or open the Help Centre for the full index.',
        chips: this.QUICK
      };
    },

    findNamedPage(l) {
      if (!window.PageGuide) return null;
      const ids = PageGuide.ids();
      let hit = null, hitLen = 0;
      ids.forEach(id => {
        const words = id.split('-');
        const spaced = ' ' + words.join(' ') + ' ';
        const joined = ' ' + words.join('') + ' ';
        if (l.indexOf(spaced) !== -1 || l.indexOf(joined) !== -1) {
          if (id.length > hitLen) { hit = id; hitLen = id.length; }
        }
      });
      // Also match the friendly title, e.g. "storage manager" -> storage-manager
      if (!hit && window.PageGuide) {
        PageGuide.ids().forEach(id => {
          const g = PageGuide.get(id);
          if (!g) return;
          const summary = g.summary.toLowerCase();
          const words = q_words(l);
          let score = 0;
          words.forEach(w => { if (w.length > 3 && summary.indexOf(w) !== -1) score++; });
          if (score >= 2 && id.length > hitLen) { hit = id; hitLen = id.length; }
        });
      }
      return hit;
    },

    pageAnswer(id) {
      if (!window.PageGuide || !PageGuide.get(id)) {
        return { r: 'This is the **' + esc(id) + '** workspace. Use the sidebar to reach related pages, or open the Help Centre for the full index.', chips: ['Show me every page'] };
      }
      const g = PageGuide.get(id);
      const steps = (g.steps || []).map((s, i) => (i + 1) + '. ' + s).join('\n');
      const adv = (g.advantages || []).map(a => '• ' + a).join('\n');
      const tips = (g.tips || []).length ? '\n\n**Tips:** ' + (g.tips || []).map(t => '• ' + t).join('  ') : '';
      const rel = (g.related || []).filter(r => r !== id);
      return {
        r: '📖 **' + this.label(id) + '**\n\n' +
           g.summary + '\n\n' +
           '**What it is:** ' + g.purpose + '\n\n' +
           '**What it does:** ' + g.does + '\n\n' +
           '**Who uses it:** ' + g.who + '\n\n' +
           (steps ? '**How to use it:**\n' + steps + '\n\n' : '') +
           (adv ? '**Why it works this way:**\n' + adv + '\n\n' : '') +
           '**Benefit:** ' + g.benefit + tips +
           (rel.length ? '\n\n**Related:** ' + rel.map(r => this.label(r)).join(', ') : ''),
        chips: (rel.slice(0, 3).map(r => 'Explain ' + this.label(r).toLowerCase())).concat(['Back up data', 'Finding things'])
      };
    },

    label(id) {
      return String(id || '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    },

    linkLine(pageId) {
      return '\n\n_Go to_ **' + this.label(pageId) + '** _from the sidebar, or read the full guide in the Help Centre._';
    },

    /** Score every guide against a free-text query; return [{id, score, snippet}]. */
    searchGuides(query) {
      const words = q_words(' ' + String(query).toLowerCase() + ' ');
      const out = [];
      (window.PageGuide ? PageGuide.ids() : []).forEach(id => {
        const g = PageGuide.get(id);
        if (!g) return;
        const name = id.replace(/-/g, ' ');
        const lead = (name + ' ' + (g.summary || '') + ' ' + (g.purpose || '')).toLowerCase();
        const body = ((g.does || '') + ' ' + (g.who || '') + ' ' +
                      (g.steps || []).join(' ') + ' ' + (g.advantages || []).join(' ') + ' ' +
                      (g.benefit || '') + ' ' + (g.tips || []).join(' ')).toLowerCase();
        let score = 0;
        words.forEach(w => {
          if (w.length < 3) return;
          if (name.indexOf(w) !== -1) score += 4;        // the page's own name: strongest
          else if (lead.indexOf(w) !== -1) score += 2;   // its summary or purpose
          else if (body.indexOf(w) !== -1) score += 1;   // a passing mention deeper in
        });
        const clean = String(query).toLowerCase().replace(/-/g, ' ').replace(/[^a-z0-9 ]/g, '').trim();
        if (clean === name) score += 20;
        else if (name.indexOf(clean) !== -1) score += 5;
        if (score > 0) out.push({ id: id, score: score, snippet: g.summary.split(/[.;]/)[0] });
      });
      return out.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    }
  };

  function q_words(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/-/g, ' ')
      .split(/\s+/).filter(w => w.length > 2 &&
        !['the', 'and', 'for', 'you', 'your', 'are', 'how', 'what', 'can', 'with', 'this', 'that', 'from', 'does', 'do'].includes(w));
  }

  window.Assistant = Assistant;
  window.DramaConnectAssistant = Assistant;

  const boot = () => { try { Assistant.init(); } catch (e) { /* never break a page */ } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
