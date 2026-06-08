/**
 * ============================================================================
 * UI Toolkit — toasts, modals, loaders, confirm dialogs, dark mode.
 * Pure vanilla JS + Tailwind classes. No external UI dependencies.
 * ============================================================================
 */
const UI = {
    /* ---- Toast notifications (replaces native alert) ---- */
    toast(message, type = 'info', duration = 4000) {
        let host = document.getElementById('toast-host');
        if (!host) {
            host = document.createElement('div');
            host.id = 'toast-host';
            host.className = 'fixed top-5 right-5 z-[9999] space-y-3 max-w-sm';
            document.body.appendChild(host);
        }
        const colors = {
            success: 'bg-green-600',
            error: 'bg-red-600',
            warning: 'bg-yellow-500',
            info: 'bg-blue-600'
        };
        const icons = {
            success: 'fa-circle-check',
            error: 'fa-circle-exclamation',
            warning: 'fa-triangle-exclamation',
            info: 'fa-circle-info'
        };
        const el = document.createElement('div');
        el.className = `toast-item ${colors[type] || colors.info} text-white px-4 py-3 rounded-xl shadow-lg flex items-start gap-3 animate-fade-in`;
        el.innerHTML = `<i class="fas ${icons[type] || icons.info} mt-0.5"></i><span class="text-sm font-semibold flex-1">${message}</span>`;
        host.appendChild(el);
        setTimeout(() => {
            el.style.transition = 'opacity .3s, transform .3s';
            el.style.opacity = '0';
            el.style.transform = 'translateX(20px)';
            setTimeout(() => el.remove(), 300);
        }, duration);
    },

    /* ---- Full-screen blocking loader ---- */
    showLoader(text = 'Loading…') {
        let l = document.getElementById('global-loader');
        if (!l) {
            l = document.createElement('div');
            l.id = 'global-loader';
            l.className = 'fixed inset-0 z-[9998] bg-white/70 backdrop-blur-sm flex flex-col items-center justify-center gap-4';
            l.innerHTML = `<div class="h-12 w-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
                           <p id="global-loader-text" class="text-slate-600 font-semibold"></p>`;
            document.body.appendChild(l);
        }
        document.getElementById('global-loader-text').innerText = text;
        l.style.display = 'flex';
    },
    hideLoader() {
        const l = document.getElementById('global-loader');
        if (l) l.style.display = 'none';
    },

    /* ---- Promise-based confirm dialog ---- */
    confirm(message, title = 'Please Confirm') {
        return new Promise(resolve => {
            const overlay = document.createElement('div');
            overlay.className = 'fixed inset-0 z-[9999] bg-black/50 flex items-center justify-center p-4 animate-fade-in';
            overlay.innerHTML = `
                <div class="bg-white rounded-3xl shadow-2xl max-w-sm w-full p-6">
                    <h3 class="text-lg font-bold text-slate-800 mb-2">${title}</h3>
                    <p class="text-slate-600 text-sm mb-6">${message}</p>
                    <div class="flex gap-3 justify-end">
                        <button data-x="0" class="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold hover:bg-slate-200">Cancel</button>
                        <button data-x="1" class="px-4 py-2 rounded-xl bg-red-600 text-white font-bold hover:bg-red-700">Confirm</button>
                    </div>
                </div>`;
            overlay.querySelectorAll('button').forEach(b => b.onclick = () => {
                resolve(b.dataset.x === '1');
                overlay.remove();
            });
            document.body.appendChild(overlay);
        });
    },

    /* ---- Generic modal (returns the overlay element) ---- */
    modal(innerHtml, maxWidth = 'max-w-lg') {
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 z-[9999] bg-black/50 flex items-center justify-center p-4 animate-fade-in';
        overlay.innerHTML = `<div class="bg-white rounded-3xl shadow-2xl ${maxWidth} w-full max-h-[90vh] overflow-y-auto">${innerHtml}</div>`;
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);
        return overlay;
    },

    /* ---- Dark mode (persisted in localStorage) ---- */
    initTheme() {
        const saved = localStorage.getItem('dc-theme');
        if (saved === 'dark') document.documentElement.classList.add('dark');
    },
    toggleTheme() {
        const isDark = document.documentElement.classList.toggle('dark');
        localStorage.setItem('dc-theme', isDark ? 'dark' : 'light');
        return isDark;
    },

    /* ---- Escape user-supplied strings before injecting into HTML ---- */
    esc(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
};

// Apply theme as early as possible.
UI.initTheme();
window.UI = UI;
