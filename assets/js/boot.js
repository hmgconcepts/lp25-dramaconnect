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
 * ============================================================================
 */
(function () {
    function tailwindLoaded() {
        // The Play CDN defines a global `tailwind` object once executed.
        return typeof window.tailwind !== 'undefined';
    }

    function applyFallback() {
        if (tailwindLoaded()) return;
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
