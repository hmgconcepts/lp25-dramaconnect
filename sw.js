/**
 * DramaConnect service worker.
 * - Precaches same-origin application shell files independently.
 * - Never caches Supabase/API or cross-origin CDN traffic.
 * - Uses network-first navigation so deployments are not pinned to stale HTML.
 */
const CACHE = 'dramaconnect-v13.2';
const CORE = [
  './',
  './index.html',
  './manifest.json',
  './assets/css/style.css',
  './assets/css/fallback.css',
  './assets/js/boot.js',
  './assets/js/config.js',
  './assets/js/resilience.js',
  './assets/js/data-portability.js',
  './assets/js/drive-sync.js',
  './assets/js/i18n.js',
  './assets/js/ui.js',
  './assets/js/auth.js',
  './assets/js/db.js',
  './assets/js/utils.js',
  './assets/js/layout.js',
  './assets/js/install.js',
  './assets/js/crop.js',
  './assets/img/rccg_logo.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // A missing optional asset must not prevent all other shell files caching.
    await Promise.allSettled(CORE.map(asset => cache.add(asset)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Cross-origin libraries and every backend/auth request remain network-only.
  const backendPath = url.pathname.startsWith('/api/') || /\/(auth|rest|storage|functions)\/v1\//.test(url.pathname);
  if (url.origin !== self.location.origin || url.hostname.endsWith('.supabase.co') || backendPath) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirstWithRefresh(request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') await cache.put(request, response.clone());
    return response;
  } catch (_error) {
    return (await cache.match(request)) || (await cache.match('./index.html')) || Response.error();
  }
}

async function cacheFirstWithRefresh(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const network = fetch(request).then(async response => {
    if (response.ok && response.type === 'basic' && !/no-store/i.test(response.headers.get('cache-control') || '')) {
      await cache.put(request, response.clone());
    }
    return response;
  });
  if (cached) {
    // Refresh in the background without delaying this response.
    network.catch(() => undefined);
    return cached;
  }
  try { return await network; } catch (_error) { return Response.error(); }
}
