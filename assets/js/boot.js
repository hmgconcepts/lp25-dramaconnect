/**
 * ============================================================================
 * boot.js — CDN resilience guard. Load this in <head> AFTER the Tailwind CDN
 * <script> tag and the stylesheet links.
 *
 * It checks (after the page settles) whether the Tailwind CDN actually loaded.
 * If not (slow/blocked connection, common on budget devices), it adds the
 * `no-tailwind` class to <html> so fallback.css can keep the app usable, and
 * shows a small non-blocking notice. The app's own navigation/cards already
 * use local CSS (style.css), so the core experience never breaks.
 *
 * v14.1: it also links assets/css/tailwind-offline.css — a pinned, locally
 * built Tailwind 3.4 stylesheet covering every class the app uses (generated
 * by `npm run build:css`). Because the CDN <script> is synchronous and sits
 * before this file, its outcome is already known when boot.js runs, so the
 * offline sheet is linked immediately (no flash of an unstyled page). The
 * delayed re-check stays as a safety net.
 * ============================================================================
 */
(function () {
    var script = document.currentScript;
    var base = '';
    try { base = new URL('../css/', script && script.src ? script.src : window.location.href).href; } catch (e) { base = ''; }

    function tailwindLoaded() {
        // The Play CDN defines a global `tailwind` object once executed.
        return typeof window.tailwind !== 'undefined';
    }

    function linkOfflineCss() {
        if (!base || document.getElementById('tailwind-offline-css')) return;
        var link = document.createElement('link');
        link.id = 'tailwind-offline-css';
        link.rel = 'stylesheet';
        link.href = base + 'tailwind-offline.css';
        // Insert before style.css so the app's own rules keep priority.
        var own = document.querySelector('link[href*="style.css"]');
        var head = document.head || document.documentElement;
        if (own && own.parentNode) own.parentNode.insertBefore(link, own);
        else head.appendChild(link);
    }

    if (!tailwindLoaded()) linkOfflineCss();

    function applyFallback() {
        if (tailwindLoaded()) return;
        linkOfflineCss();
        document.documentElement.classList.add('no-tailwind');
        if (!document.getElementById('cdn-warning')) {
            var b = document.createElement('div');
            b.id = 'cdn-warning';
            b.className = 'no-print';
            b.textContent = 'Running in low-bandwidth mode — some styling is simplified, but all features work.';
            (document.body || document.documentElement).appendChild(b);
        }
    }

    // Give the CDN a fair chance, then verify.
    if (document.readyState === 'complete') {
        setTimeout(applyFallback, 1500);
    } else {
        window.addEventListener('load', function () { setTimeout(applyFallback, 1500); });
    }
})();
