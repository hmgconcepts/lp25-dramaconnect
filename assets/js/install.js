/**
 * ============================================================================
 * Strict PWA Install Enforcement
 * - Forces the user to install the PWA for the platform to be fully functional.
 * - This provides the best app-like experience and security required by the 
 *   HMG Concepts Ecosystem standards.
 * ============================================================================
 */
(function () {
    function isStandalone() {
        return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    }
    
    function isIos() {
        return /iphone|ipad|ipod/i.test(window.navigator.userAgent) && !window.MSStream;
    }

    let deferredPrompt = null;

    // Detect if we are on the login page (index.html) or a dashboard page
    const isRoot = !window.location.pathname.includes('/pages/');

    function enforceInstall() {
        // If the user is already using the installed standalone app, do nothing
        if (isStandalone()) {
            const overlay = document.getElementById('pwa-strict-overlay');
            if (overlay) overlay.classList.add('hidden');
            return;
        }

        // If not installed, we enforce it by showing a massive overlay on the root/login page
        if (isRoot) {
            const overlay = document.getElementById('pwa-strict-overlay');
            if (!overlay) return; // fail gracefully if overlay HTML is missing
            
            overlay.classList.remove('hidden');
            
            // Wire up the bypass fallback
            const bypass = document.getElementById('pwa-bypass-btn');
            if (bypass) bypass.onclick = () => overlay.classList.add('hidden');
            
            if (isIos()) {
                document.getElementById('pwa-ios-instructions').classList.remove('hidden');
                document.getElementById('pwa-force-install-btn').classList.add('hidden');
            } else {
                const btn = document.getElementById('pwa-force-install-btn');
                btn.onclick = async () => {
                    if (!deferredPrompt) {
                        alert('Your browser does not support automatic installation. Please use Chrome/Edge and look for the install icon in the address bar.');
                        return;
                    }
                    deferredPrompt.prompt();
                    const { outcome } = await deferredPrompt.userChoice;
                    if (outcome === 'accepted') {
                        deferredPrompt = null;
                        overlay.classList.add('hidden');
                    }
                };
            }
        }
    }

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
    });

    window.addEventListener('appinstalled', () => { 
        if (window.UI) UI.toast('App installed successfully. 🎉', 'success'); 
        const overlay = document.getElementById('pwa-strict-overlay');
        if (overlay) overlay.classList.add('hidden');
    });

    // Run enforcement immediately on load
    document.addEventListener('DOMContentLoaded', enforceInstall);
    // Also run if standard execution applies
    enforceInstall();
})();
