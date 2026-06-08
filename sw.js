/**
 * DramaConnect Service Worker — offline shell caching.
 * Strategy: cache-first for static assets, network-first for everything else.
 * Supabase API calls always go to the network (never cached).
 */
const CACHE = 'dramaconnect-v6';
const ASSETS = [
  './',
  './index.html',
  './assets/css/style.css',
  './assets/js/config.js',
  './assets/js/ui.js',
  './assets/js/auth.js',
  './assets/js/db.js',
  './assets/js/utils.js',
  './assets/js/layout.js',
  './assets/js/install.js',
  './assets/img/rccg_logo.png',
  './assets/img/developer.jpg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Never cache API / auth traffic.
  if (url.hostname.includes('supabase.co') || url.protocol === 'chrome-extension:') return;
  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(resp => {
        if (resp && resp.status === 200 && url.origin === self.location.origin) {
          const copy = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return resp;
      }).catch(() => cached);
    })
  );
});
