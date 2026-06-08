/**
 * ============================================================================
 * PWA Install Prompt
 * - Captures the browser's `beforeinstallprompt` (Chrome/Edge/Android) and
 *   shows a friendly "Install app" banner with a real install button.
 * - On iOS Safari (which has no such event) shows manual "Add to Home Screen"
 *   instructions instead.
 * - Respects a "dismissed" flag so we don't nag the user repeatedly.
 * ============================================================================
 */
(function () {
    const DISMISS_KEY = 'dc-install-dismissed';
    const DISMISS_DAYS = 14;

    function dismissedRecently() {
        try {
            const t = localStorage.getItem(DISMISS_KEY);
            if (!t) return false;
            return (Date.now() - Number(t)) < DISMISS_DAYS * 86400000;
        } catch (e) { return false; }
    }
    function setDismissed() { try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch (e) {} }

    function isStandalone() {
        return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    }
    function isIos() {
        return /iphone|ipad|ipod/i.test(window.navigator.userAgent) && !window.MSStream;
    }

    let deferredPrompt = null;

    function banner(innerHtml) {
        if (document.getElementById('install-banner')) return;
        const el = document.createElement('div');
        el.id = 'install-banner';
        el.className = 'fixed bottom-4 left-1/2 -translate-x-1/2 z-[9995] w-[92%] max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 p-4 flex items-center gap-3 animate-fade-in no-print';
        el.innerHTML = innerHtml;
        document.body.appendChild(el);
        return el;
    }
    function close() { const el = document.getElementById('install-banner'); if (el) el.remove(); }

    function showInstallBanner() {
        const el = banner(`
            <img src="${assetPrefix()}assets/icons/icon-192.png" alt="" class="h-11 w-11 rounded-xl">
            <div class="flex-1 min-w-0">
                <p class="text-sm font-bold text-slate-800">Install DramaConnect</p>
                <p class="text-xs text-slate-500">Add it to your device for quick, app-like access.</p>
            </div>
            <button id="ib-install" class="dc-btn dc-btn-primary text-sm py-2 px-4">Install</button>
            <button id="ib-close" class="text-slate-400 hover:text-slate-600 text-lg px-1" aria-label="Dismiss">&times;</button>
        `);
        if (!el) return;
        el.querySelector('#ib-close').onclick = () => { setDismissed(); close(); };
        el.querySelector('#ib-install').onclick = async () => {
            if (!deferredPrompt) { close(); return; }
            deferredPrompt.prompt();
            try { await deferredPrompt.userChoice; } catch (e) {}
            deferredPrompt = null;
            setDismissed();
            close();
        };
    }

    function showIosBanner() {
        const el = banner(`
            <img src="${assetPrefix()}assets/icons/icon-192.png" alt="" class="h-11 w-11 rounded-xl">
            <div class="flex-1 min-w-0">
                <p class="text-sm font-bold text-slate-800">Install DramaConnect</p>
                <p class="text-xs text-slate-500">Tap <i class="fas fa-arrow-up-from-bracket mx-1"></i>Share, then "Add to Home Screen".</p>
            </div>
            <button id="ib-close" class="text-slate-400 hover:text-slate-600 text-lg px-1" aria-label="Dismiss">&times;</button>
        `);
        if (!el) return;
        el.querySelector('#ib-close').onclick = () => { setDismissed(); close(); };
    }

    // Works whether we're at site root or inside /pages/
    function assetPrefix() {
        return window.location.pathname.includes('/pages/') ? '../' : '';
    }

    if (isStandalone() || dismissedRecently()) return;

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        // Small delay so it doesn't appear instantly on load.
        setTimeout(showInstallBanner, 2500);
    });

    window.addEventListener('appinstalled', () => { setDismissed(); close(); if (window.UI) UI.toast('App installed. 🎉', 'success'); });

    // iOS fallback (no beforeinstallprompt event there).
    if (isIos()) setTimeout(showIosBanner, 3000);
})();
