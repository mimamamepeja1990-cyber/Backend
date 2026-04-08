const CACHE_PREFIX = 'distriar-admin-pwa';
const CACHE_VERSION = 'v1';
const STATIC_CACHE = `${CACHE_PREFIX}-${CACHE_VERSION}`;

const APP_SHELL = [
  '/admin/index.html',
  '/admin/app.js',
  '/admin/styles.css',
  '/admin/icon.png',
  '/admin/manifest.webmanifest',
];

const STATIC_EXT_RE = /\.(?:html|css|js|png|jpg|jpeg|webp|svg|gif|ico|json|webmanifest)$/i;

function isSameOrigin(url) {
  try {
    return url.origin === self.location.origin;
  } catch (_) {
    return false;
  }
}

function isAdminStaticAsset(url) {
  if (!isSameOrigin(url)) return false;
  const path = String(url.pathname || '');
  if (!path.startsWith('/admin/')) return false;
  return STATIC_EXT_RE.test(path);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(APP_SHELL)).catch(() => null)
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== STATIC_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

async function networkFirstNavigation(request) {
  try {
    const networkResp = await fetch(request);
    return networkResp;
  } catch (_) {
    const cached = await caches.match('/admin/index.html');
    if (cached) return cached;
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  const networkPromise = fetch(request)
    .then((resp) => {
      if (resp && resp.ok) {
        cache.put(request, resp.clone()).catch(() => null);
      }
      return resp;
    })
    .catch(() => cached || null);

  if (cached) {
    return cached;
  }
  const networkResp = await networkPromise;
  if (networkResp) return networkResp;
  return new Response('Offline', { status: 503, statusText: 'Offline' });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (!request || request.method !== 'GET') return;
  const url = new URL(request.url);
  if (!isSameOrigin(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (!isAdminStaticAsset(url)) return;
  event.respondWith(staleWhileRevalidate(request));
});
