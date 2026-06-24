/**
 * ============================================================================
 * Shared Layout — sidebar, header, dark-mode toggle, mobile drawer.
 * Renders consistent chrome across every authenticated page.
 * Usage:
 *   <div id="app-sidebar"></div>   (first child of body)
 *   <div id="page-header"></div>   (top of main)
 *   Layout.renderSidebar('members'); Layout.renderHeader(...); Layout.setDate();
 * ============================================================================
 */
const Layout = {
    nav: [
        { group: 'Core Management', items: [
            { id: 'home',          href: 'home.html',          icon: 'fa-house',          label: 'My Dashboard' },
            { id: 'dashboard',     href: 'dashboard.html',     icon: 'fa-th-large',       label: 'Command Center' },
            { id: 'members',       href: 'members.html',       icon: 'fa-users',          label: 'Members' },
            { id: 'directory',     href: 'directory.html',     icon: 'fa-address-book',   label: 'Directory' },
            { id: 'productions',   href: 'productions.html',   icon: 'fa-book-open',      label: 'Productions' },
            { id: 'casting',       href: 'casting.html',       icon: 'fa-masks-theater',  label: 'Casting' },
            { id: 'rehearsals',    href: 'rehearsals.html',    icon: 'fa-calendar-check', label: 'Rehearsals' },
            { id: 'attendance',    href: 'attendance.html',    icon: 'fa-user-check',     label: 'Attendance' },
            { id: 'analytics',     href: 'analytics.html',     icon: 'fa-chart-line',     label: 'Attendance Analytics' },
            { id: 'myunit',        href: 'myunit.html',        icon: 'fa-people-group',   label: 'My Unit', leaderOnly: true },
            { id: 'finance',       href: 'finance.html',       icon: 'fa-wallet',         label: 'Finance' },
            { id: 'budgets',       href: 'budgets.html',       icon: 'fa-scale-balanced', label: 'Budgets' }
        ]},
        { group: 'Communication', items: [
            { id: 'inbox',         href: 'inbox.html',         icon: 'fa-inbox',          label: 'Inbox' },
            { id: 'announcements', href: 'announcements.html', icon: 'fa-bullhorn',       label: 'Announcements' },
            { id: 'tasks',         href: 'tasks.html',         icon: 'fa-list-check',     label: 'Tasks' },
            { id: 'messaging',     href: 'messaging.html',     icon: 'fa-paper-plane',    label: 'WhatsApp/Email', adminOnly: true },
            { id: 'events',        href: 'events.html',        icon: 'fa-calendar-days',  label: 'Events' },
            { id: 'birthdays',     href: 'birthdays.html',     icon: 'fa-cake-candles',   label: 'Birthdays' },
            { id: 'gallery',       href: 'gallery.html',       icon: 'fa-images',         label: 'Photo Gallery' },
            { id: 'polls',         href: 'polls.html',         icon: 'fa-square-poll-vertical', label: 'Polls' },
            { id: 'suggestions',   href: 'suggestions.html',   icon: 'fa-lightbulb',      label: 'Suggestion Box' },
            { id: 'resources',     href: 'resources.html',     icon: 'fa-folder-open',    label: 'Resources' },
            { id: 'inventory',     href: 'inventory.html',     icon: 'fa-boxes-packing',  label: 'Inventory', adminOnly: false },
            { id: 'reports',       href: 'reports.html',       icon: 'fa-file-export',    label: 'Reports' }
        ]},
        { group: 'Administration', items: [
            { id: 'reminders',     href: 'reminders.html',     icon: 'fa-bell',             label: 'Scheduled Reminders', adminOnly: true },
            { id: 'activity',      href: 'activity.html',      icon: 'fa-clock-rotate-left', label: 'Activity Log', adminOnly: true },
            { id: 'settings',      href: 'settings.html',      icon: 'fa-gear',             label: 'Settings & Backup', adminOnly: true }
        ]},
        { group: 'Workspace', items: [
            { id: 'profile',       href: 'profile.html',       icon: 'fa-user-circle',    label: 'My Profile' },
            { id: 'idcard',        href: 'idcard.html',        icon: 'fa-id-card',        label: 'My ID Card' },
            { id: 'help',          href: 'help.html',          icon: 'fa-circle-question', label: 'Help & FAQ' },
            { id: 'portfolio',     href: 'portfolio.html',     icon: 'fa-rocket',         label: 'Developer Bio', accent: true }
        ]}
    ],

    _buildNav(active, isAdmin, isLeader) {
        return this.nav.map(g => {
            const items = g.items.filter(i => (!i.adminOnly || isAdmin) && (!i.leaderOnly || isLeader || isAdmin));
            if (!items.length) return '';
            return `
            <div class="pt-1">
                <p class="text-[10px] text-slate-500 uppercase font-bold px-4 mb-2 mt-4">${g.group}</p>
                ${items.map(i => `
                    <a href="${i.href}" class="sidebar-link ${i.id === active ? 'active' : ''} ${i.accent ? 'accent' : ''}">
                        <i class="fas ${i.icon} w-5 text-center"></i> ${i.label}
                    </a>`).join('')}
            </div>`;
        }).join('');
    },

    renderSidebar(active, user) {
        const isAdmin = Auth.isAdmin(user);
        const isLeader = Auth.isUnitLeader(user);
        const navHtml = this._buildNav(active, isAdmin, isLeader);

        const sidebarInner = `
            <div class="p-6 flex items-center gap-3 border-b border-slate-800">
                <img src="../assets/img/rccg_logo.png" alt="RCCG Logo" class="h-10 w-10 bg-white rounded-full p-1">
                <div>
                    <span class="font-bold text-base tracking-tight block leading-tight">DramaConnect</span>
                    <span class="text-[10px] text-slate-400 uppercase tracking-widest">${CONFIG.PROVINCE} • Drama</span>
                </div>
            </div>
            <nav class="flex-1 p-4 space-y-1 overflow-y-auto">${navHtml}</nav>
            <div class="p-4 border-t border-slate-800 space-y-2">
                <select id="lang-sel" class="w-full px-3 py-2 rounded-xl bg-slate-800 text-slate-200 text-sm border-none outline-none">
                    <option value="en">🌐 English</option>
                    <option value="yo">🌐 Yorùbá</option>
                </select>
                <button id="theme-btn" class="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-slate-300 hover:bg-slate-800 transition text-sm">
                    <i class="fas fa-moon w-5 text-center"></i> <span id="theme-label">Dark Mode</span>
                </button>
                <button id="logout-btn" class="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-red-400 hover:bg-red-900/20 transition text-sm">
                    <i class="fas fa-sign-out-alt w-5 text-center"></i> Sign Out
                </button>
                <a href="https://hmgconcepts.pages.dev" target="_blank" rel="noopener" class="block text-center pt-2 mt-1 border-t border-slate-800">
                    <span class="text-[10px] text-slate-500 uppercase tracking-widest">Powered by</span>
                    <span class="block text-xs font-extrabold text-blue-400">HMG Concepts</span>
                    <span class="block text-[9px] text-slate-500">EdTech · DataTech · FaithTech</span>
                </a>
            </div>`;

        const html = `
        <aside class="app-sidebar no-print">${sidebarInner}</aside>
        <!-- Mobile / tablet drawer (driven by local CSS, not the Tailwind CDN) -->
        <div id="mobile-drawer" class="app-drawer no-print">
            <div id="drawer-overlay" class="app-drawer-overlay"></div>
            <aside class="app-drawer-panel animate-fade-in">${sidebarInner.replace(/id="theme-btn"/, 'id="theme-btn-m"').replace(/id="theme-label"/, 'id="theme-label-m"').replace(/id="logout-btn"/, 'id="logout-btn-m"')}</aside>
        </div>`;

        const mount = document.getElementById('app-sidebar');
        if (mount) mount.innerHTML = html;

        const wireLogout = id => { const b = document.getElementById(id); if (b) b.onclick = () => Auth.signOut(); };
        wireLogout('logout-btn'); wireLogout('logout-btn-m');

        const wireTheme = (btnId, labelId) => {
            const b = document.getElementById(btnId);
            if (!b) return;
            const sync = () => {
                const dark = document.documentElement.classList.contains('dark');
                const lbl = document.getElementById(labelId);
                if (lbl) lbl.innerText = dark ? 'Light Mode' : 'Dark Mode';
                b.querySelector('i').className = `fas ${dark ? 'fa-sun' : 'fa-moon'} w-5 text-center`;
            };
            b.onclick = () => { UI.toggleTheme(); sync(); };
            sync();
        };
        wireTheme('theme-btn', 'theme-label'); wireTheme('theme-btn-m', 'theme-label-m');

        // Language selector (if i18n is loaded)
        const ls = document.getElementById('lang-sel');
        if (ls && window.I18n) {
            ls.value = I18n.lang;
            ls.onchange = () => { I18n.set(ls.value); };
            I18n.apply();
        }

        const overlay = document.getElementById('drawer-overlay');
        if (overlay) overlay.onclick = () => this.closeDrawer();

        // Show unread inbox badge (best-effort; never blocks rendering).
        if (window.DB && DB.getUnreadCount) {
            DB.getUnreadCount(user).then(n => {
                if (!n) return;
                document.querySelectorAll('a[href="inbox.html"]').forEach(a => {
                    if (a.querySelector('.inbox-badge')) return;
                    const b = document.createElement('span');
                    b.className = 'inbox-badge';
                    b.style.cssText = 'margin-left:auto;background:#dc2626;color:#fff;border-radius:9999px;font-size:10px;font-weight:700;padding:1px 7px;';
                    b.textContent = n > 9 ? '9+' : n;
                    a.appendChild(b);
                });
            }).catch(() => {});
        }
    },

    openDrawer() { const d = document.getElementById('mobile-drawer'); if (d) d.classList.add('open'); },
    closeDrawer() { const d = document.getElementById('mobile-drawer'); if (d) d.classList.remove('open'); },

    renderHeader(title, subtitle) {
        return `
        <header class="flex justify-between items-center mb-8 no-print gap-4">
            <div class="flex items-center gap-3">
                <button class="nav-toggle" onclick="Layout.openDrawer()" aria-label="Open menu">&#9776;</button>
                <div>
                    <h1 class="text-2xl md:text-3xl font-extrabold text-slate-800 dark-text">${title}</h1>
                    <p class="text-slate-500 text-sm">${subtitle || ''}</p>
                </div>
            </div>
            <div class="flex items-center gap-4">
                <div class="relative">
                    <button id="notif-bell" onclick="Layout.toggleNotif()" class="relative w-11 h-11 rounded-full bg-white border border-slate-200 shadow-sm flex items-center justify-center text-slate-600 hover:text-blue-600" aria-label="Notifications">
                        <i class="fas fa-bell"></i>
                        <span id="notif-count" class="hidden" style="position:absolute;top:-2px;right:-2px;background:#dc2626;color:#fff;border-radius:9999px;font-size:10px;font-weight:700;padding:1px 6px;"></span>
                    </button>
                    <div id="notif-panel" class="hidden" style="position:absolute;right:0;top:52px;width:320px;max-height:420px;overflow-y:auto;background:var(--card-bg,#fff);border:1px solid var(--card-border,#e2e8f0);border-radius:1rem;box-shadow:0 10px 30px rgba(0,0,0,.15);z-index:9994;">
                        <div style="padding:12px 16px;border-bottom:1px solid var(--card-border,#e2e8f0);font-weight:700;" class="text-slate-800 dark-text">Notifications</div>
                        <div id="notif-list" style="padding:8px;"><p class="text-slate-400 text-sm" style="padding:12px;">Loading…</p></div>
                    </div>
                </div>
                <div class="text-right hidden sm:block">
                    <p id="current-date" class="text-sm font-bold text-slate-700 dark-text"></p>
                    <p class="text-xs text-slate-400 uppercase tracking-widest app-org-name">Province ${CONFIG.PROVINCE}</p>
                </div>
                <img src="../assets/img/rccg_logo.png" alt="Logo" class="h-11 w-11 rounded-full border-2 border-white shadow-md bg-white app-logo-img">
            </div>
        </header>`;
    },

    /** Load the notifications feed into the bell. Call after renderHeader. */
    async loadNotifications(user) {
        if (!window.DB || !DB.getNotifications) return;
        try {
            const items = await DB.getNotifications(user);
            const countEl = document.getElementById('notif-count');
            if (countEl && items.length) { countEl.textContent = items.length > 9 ? '9+' : items.length; countEl.classList.remove('hidden'); }
            const list = document.getElementById('notif-list');
            if (!list) return;
            if (!items.length) { list.innerHTML = '<p class="text-slate-400 text-sm" style="padding:12px;">You\'re all caught up. 🎉</p>'; return; }
            const esc = (window.UI && UI.esc) ? UI.esc : (s => s);
            list.innerHTML = items.map(n => `
                <a href="${n.href}" style="display:flex;gap:10px;padding:10px 12px;border-radius:10px;text-decoration:none;" class="hover:bg-slate-50">
                    <i class="fas ${n.icon}" style="color:${n.color};margin-top:3px;"></i>
                    <span class="text-slate-700 dark-text" style="font-size:13px;flex:1;">${esc(n.text)}</span>
                </a>`).join('');
        } catch (e) {}
    },
    toggleNotif() { const p = document.getElementById('notif-panel'); if (p) p.classList.toggle('hidden'); },

    setDate() {
        const el = document.getElementById('current-date');
        if (el) el.innerText = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    },

    async loadSaaSBranding() {
        if (!window.DB || !DB.getTenantSettings) return;
        try {
            const tenant = await DB.getTenantSettings();
            if (tenant) {
                if (tenant.app_name) {
                    document.title = document.title.replace('DramaConnect Enterprise', tenant.app_name).replace('DramaConnect', tenant.app_name);
                    document.querySelectorAll('.app-brand-name').forEach(el => el.innerText = tenant.app_name);
                }
                if (tenant.org_name) {
                    document.querySelectorAll('.app-org-name').forEach(el => el.innerText = tenant.org_name);
                }
                if (tenant.logo_url) {
                    document.querySelectorAll('.app-logo-img').forEach(el => el.src = tenant.logo_url);
                }
                if (tenant.primary_color) {
                    const style = document.createElement('style');
                    style.innerHTML = `:root { --rccg-blue: ${tenant.primary_color}; } .rccg-blue { background-color: ${tenant.primary_color} !important; }`;
                    document.head.appendChild(style);
                }
            }
        } catch(e) {}
    },

    /** Standard admin-only banner for read-only viewers. */
    isAdmin(user) { return Auth.isAdmin(user); },

    /** Register the service worker for PWA/offline support. */
    registerPWA() {
        if (CONFIG.FEATURES.pwa && 'serviceWorker' in navigator) {
            const swPath = window.location.pathname.includes('/pages/') ? '../sw.js' : 'sw.js';
            navigator.serviceWorker.register(swPath).catch(() => {});
        }
    }
};
window.Layout = Layout;
