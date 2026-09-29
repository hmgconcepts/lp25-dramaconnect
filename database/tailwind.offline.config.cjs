/**
 * Offline Tailwind build — used ONLY when the Tailwind Play CDN cannot load
 * (blocked network, captive portal, very slow mobile data). boot.js detects
 * the failure and links assets/css/tailwind-offline.css instead, so every page
 * keeps its real layout. The app uses no custom Tailwind theme, so this plain
 * v3.4 build matches what the CDN generates.
 *
 * Regenerate after changing classes:  npm run build:css
 * (npm test runs it first, and tools/test-codes.mjs checks coverage.)
 */
module.exports = {
  content: [
    './*.html',
    './pages/**/*.html',
    './assets/js/**/*.js',
    '!./assets/js/vendor/**'
  ],
  theme: { extend: {} },
  plugins: []
};
