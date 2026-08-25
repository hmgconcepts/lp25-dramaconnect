const UI = {
    showLoader(text = 'Working…') {
        let el = document.getElementById('global-loader');
        if (!el) {
            el = document.createElement('div');
            el.id = 'global-loader';
            el.className = 'fixed inset-0 z-[9999] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center';
            el.innerHTML = `
                <div class="bg-white rounded-2xl p-7 flex flex-col items-center gap-4 shadow-2xl">
                    <div class="spinner"></div>
                    <p class="text-slate-600 font-semibold" data-loader-text></p>
                </div>`;
            document.body.appendChild(el);
        }
        const label = el.querySelector('[data-loader-text]');
        if (label) label.textContent = String(text);
        el.classList.remove('hidden');
    },

    hideLoader() {
        const el = document.getElementById('global-loader');
        if (el) el.classList.add('hidden');
    },

    /**
     * Text-only notification. User/database values are never interpreted as HTML.
     * Use modal() only for intentionally-authored, trusted application markup.
     */
    toast(message, type = 'success', duration = 3500) {
        const colors = {
            success: 'bg-green-600',
            error: 'bg-red-600',
            warning: 'bg-amber-500',
            info: 'bg-blue-600'
        };
        const icons = {
            success: 'fa-check-circle', error: 'fa-exclamation-circle',
            warning: 'fa-triangle-exclamation', info: 'fa-circle-info'
        };
        let box = document.getElementById('toast-container');
        if (!box) {
            box = document.createElement('div');
            box.id = 'toast-container';
            box.className = 'fixed top-5 right-5 z-[10000] space-y-3 w-[min(92vw,380px)]';
            box.setAttribute('aria-live', 'polite');
            document.body.appendChild(box);
        }
        const item = document.createElement('div');
        item.className = `${colors[type] || colors.info} text-white px-5 py-4 rounded-xl shadow-xl flex items-start gap-3 animate-slide-in`;
        item.setAttribute('role', type === 'error' ? 'alert' : 'status');

        const icon = document.createElement('i');
        icon.className = `fas ${icons[type] || icons.info} mt-0.5`;
        icon.setAttribute('aria-hidden', 'true');
        const text = document.createElement('span');
        text.className = 'text-sm font-medium flex-1';
        text.textContent = String(message == null ? '' : message);
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'ml-auto opacity-80 hover:opacity-100';
        close.setAttribute('aria-label', 'Dismiss notification');
        close.innerHTML = '<i class="fas fa-times" aria-hidden="true"></i>';
        close.addEventListener('click', () => item.remove());

        item.append(icon, text, close);
        box.appendChild(item);
        setTimeout(() => item.remove(), duration);
    },

    /** Safely escape text for the limited legacy template-string renderers. */
    esc(v) {
        if (v === null || v === undefined) return '';
        return String(v).replace(/[&<>'"]/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        }[c]));
    },

    /**
     * Application-owned trusted markup modal. Do not pass raw user/database values
     * unless each value has first been escaped with UI.esc().
     */
    modal(html, maxWidth = 'max-w-lg') {
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 z-[9998] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4';
        overlay.innerHTML = `<div class="bg-white rounded-2xl shadow-2xl w-full ${maxWidth} animate-fade-in max-h-[90vh] overflow-y-auto">${html}</div>`;
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);
        return overlay;
    },

    /** Text-safe confirm dialog. */
    confirm(message, title = 'Confirm Action') {
        return new Promise(resolve => {
            const overlay = document.createElement('div');
            overlay.className = 'fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4';

            const panel = document.createElement('div');
            panel.className = 'bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 animate-fade-in';
            const heading = document.createElement('h3');
            heading.className = 'text-lg font-bold text-slate-800 mb-2';
            heading.textContent = String(title);
            const body = document.createElement('p');
            body.className = 'text-slate-500 text-sm mb-6';
            body.textContent = String(message);
            const actions = document.createElement('div');
            actions.className = 'flex justify-end gap-3';
            const cancel = document.createElement('button');
            cancel.type = 'button'; cancel.className = 'dc-btn bg-slate-100 text-slate-700'; cancel.textContent = 'Cancel';
            const ok = document.createElement('button');
            ok.type = 'button'; ok.className = 'dc-btn dc-btn-danger'; ok.textContent = 'Confirm';
            actions.append(cancel, ok); panel.append(heading, body, actions); overlay.appendChild(panel);
            document.body.appendChild(overlay);

            const finish = value => { overlay.remove(); resolve(value); };
            cancel.addEventListener('click', () => finish(false));
            ok.addEventListener('click', () => finish(true));
            overlay.addEventListener('click', e => { if (e.target === overlay) finish(false); });
            ok.focus();
        });
    },

    applyStoredTheme() {
        if (localStorage.getItem('dc_theme') === 'dark') document.documentElement.classList.add('dark');
    },

    toggleTheme() {
        document.documentElement.classList.toggle('dark');
        localStorage.setItem('dc_theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light');
    }
};
UI.applyStoredTheme();
window.UI = UI;
