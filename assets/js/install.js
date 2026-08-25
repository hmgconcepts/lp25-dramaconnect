/**
 * PWA install invitation. The web app always remains usable; dismissing the
 * invitation is remembered for seven days instead of blocking every visit.
 */
(function () {
    const DISMISS_KEY = 'dc-pwa-web-dismissed';
    const DISMISS_MS = 7 * 24 * 60 * 60 * 1000;
    let deferredPrompt = null;

    function isStandalone() {
        return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    }
    function isIos() {
        return /iphone|ipad|ipod/i.test(window.navigator.userAgent) && !window.MSStream;
    }
    function isRootPage() {
        return !window.location.pathname.includes('/pages/');
    }
    function recentlyDismissed() {
        try {
            const at = Number(localStorage.getItem(DISMISS_KEY) || 0);
            return at > 0 && Date.now() - at < DISMISS_MS;
        } catch (_error) { return false; }
    }
    function dismiss(overlay, remember) {
        if (overlay) overlay.classList.add('hidden');
        if (remember) {
            try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch (_error) {}
        }
    }
    function notify(message) {
        if (window.UI && UI.toast) UI.toast(message, 'info', 7000);
        else console.info('[DramaConnect]', message);
    }

    function renderInvitation() {
        const overlay = document.getElementById('pwa-strict-overlay');
        if (!overlay || !isRootPage() || isStandalone() || recentlyDismissed()) {
            dismiss(overlay, false);
            return;
        }

        overlay.classList.remove('hidden');
        const bypass = document.getElementById('pwa-bypass-btn');
        const install = document.getElementById('pwa-force-install-btn');
        const ios = document.getElementById('pwa-ios-instructions');
        if (bypass) bypass.onclick = () => dismiss(overlay, true);

        if (isIos()) {
            if (ios) ios.classList.remove('hidden');
            if (install) install.classList.add('hidden');
            return;
        }

        if (ios) ios.classList.add('hidden');
        if (install) {
            install.classList.remove('hidden');
            install.onclick = async () => {
                if (!deferredPrompt) {
                    notify('Use your browser menu or address-bar install icon to install DramaConnect. You can also continue in the browser.');
                    return;
                }
                deferredPrompt.prompt();
                const choice = await deferredPrompt.userChoice;
                deferredPrompt = null;
                if (choice && choice.outcome === 'accepted') dismiss(overlay, false);
            };
        }
    }

    window.addEventListener('beforeinstallprompt', event => {
        event.preventDefault();
        deferredPrompt = event;
        renderInvitation();
    });

    window.addEventListener('appinstalled', () => {
        try { localStorage.removeItem(DISMISS_KEY); } catch (_error) {}
        dismiss(document.getElementById('pwa-strict-overlay'), false);
        if (window.UI && UI.toast) UI.toast('App installed successfully. 🎉', 'success');
    });

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderInvitation, { once: true });
    else renderInvitation();
})();
