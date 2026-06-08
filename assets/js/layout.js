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
            { id: 'dashboard',     href: 'dashboard.html',     icon: 'fa-th-large',       label: 'Dashboard' },
            { id: 'members',       href: 'members.html',       icon: 'fa-users',          label: 'Members' },
            { id: 'productions',   href: 'productions.html',   icon: 'fa-book-open',      label: 'Productions' },
            { id: 'casting',       href: 'casting.html',       icon: 'fa-masks-theater',  label: 'Casting' },
            { id: 'rehearsals',    href: 'rehearsals.html',    icon: 'fa-calendar-check', label: 'Rehearsals' },
            { id: 'attendance',    href: 'attendance.html',    icon: 'fa-user-check',     label: 'Attendance' },
            { id: 'finance',       href: 'finance.html',       icon: 'fa-wallet',         label: 'Finance' },
            { id: 'budgets',       href: 'budgets.html',       icon: 'fa-scale-balanced', label: 'Budgets' }
        ]},
        { group: 'Engagement', items: [
            { id: 'announcements', href: 'announcements.html', icon: 'fa-bullhorn',       label: 'Announcements' },
            { id: 'events',        href: 'events.html',        icon: 'fa-calendar-days',  label: 'Events' },
            { id: 'reports',       href: 'reports.html',       icon: 'fa-file-export',    label: 'Reports' }
        ]},
        { group: 'Administration', items: [
            { id: 'activity',      href: 'activity.html',      icon: 'fa-clock-rotate-left', label: 'Activity Log', adminOnly: true }
        ]},
        { group: 'Workspace', items: [
            { id: 'profile',       href: 'profile.html',       icon: 'fa-user-circle',    label: 'My Profile' },
            { id: 'portfolio',     href: 'portfolio.html',     icon: 'fa-rocket',         label: 'Developer Bio', accent: true }
        ]}
    ],

    _buildNav(active, isAdmin) {
        return this.nav.map(g => {
            const items = g.items.filter(i => !i.adminOnly || isAdmin);
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
        const navHtml = this._buildNav(active, isAdmin);

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
                <button id="theme-btn" class="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-slate-300 hover:bg-slate-800 transition text-sm">
                    <i class="fas fa-moon w-5 text-center"></i> <span id="theme-label">Dark Mode</span>
                </button>
                <button id="logout-btn" class="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-red-400 hover:bg-red-900/20 transition text-sm">
                    <i class="fas fa-sign-out-alt w-5 text-center"></i> Sign Out
                </button>
            </div>`;

        const html = `
        <aside class="w-64 bg-slate-900 text-white h-screen sticky top-0 hidden md:flex flex-col no-print">${sidebarInner}</aside>
        <!-- Mobile drawer -->
        <div id="mobile-drawer" class="fixed inset-0 z-[9990] hidden md:hidden">
            <div id="drawer-overlay" class="absolute inset-0 bg-black/50"></div>
            <aside class="absolute left-0 top-0 w-64 bg-slate-900 text-white h-full flex flex-col animate-fade-in">${sidebarInner.replace(/id="theme-btn"/, 'id="theme-btn-m"').replace(/id="theme-label"/, 'id="theme-label-m"').replace(/id="logout-btn"/, 'id="logout-btn-m"')}</aside>
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

        const overlay = document.getElementById('drawer-overlay');
        if (overlay) overlay.onclick = () => this.closeDrawer();
    },

    openDrawer() { const d = document.getElementById('mobile-drawer'); if (d) d.classList.remove('hidden'); },
    closeDrawer() { const d = document.getElementById('mobile-drawer'); if (d) d.classList.add('hidden'); },

    renderHeader(title, subtitle) {
        return `
        <header class="flex justify-between items-center mb-8 no-print gap-4">
            <div class="flex items-center gap-3">
                <button class="md:hidden text-slate-600 text-xl" onclick="Layout.openDrawer()"><i class="fas fa-bars"></i></button>
                <div>
                    <h1 class="text-2xl md:text-3xl font-extrabold text-slate-800 dark-text">${title}</h1>
                    <p class="text-slate-500 text-sm">${subtitle || ''}</p>
                </div>
            </div>
            <div class="flex items-center gap-4">
                <div class="text-right hidden sm:block">
                    <p id="current-date" class="text-sm font-bold text-slate-700 dark-text"></p>
                    <p class="text-xs text-slate-400 uppercase tracking-widest">Province ${CONFIG.PROVINCE}</p>
                </div>
                <img src="../assets/img/rccg_logo.png" alt="Logo" class="h-11 w-11 rounded-full border-2 border-white shadow-md bg-white">
            </div>
        </header>`;
    },

    setDate() {
        const el = document.getElementById('current-date');
        if (el) el.innerText = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
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
