const CACHE_PREFIX = 'distriar-admin-pwa';
const CACHE_VERSION = '__PWA_BUILD_VERSION__';
const STATIC_CACHE = `${CACHE_PREFIX}-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `${CACHE_PREFIX}-dyn-${CACHE_VERSION}`;

const FIREBASE_WEB_CONFIG = (() => {
  try {
    const cfg = __FIREBASE_WEB_CONFIG__;
    return cfg && typeof cfg === 'object' ? cfg : {};
  } catch (_) {
    return {};
  }
})();

const APP_SHELL = [
  '/admin/index.html',
  '/admin/app.js',
  '/admin/styles.css',
  '/admin/icon.png',
  '/admin/icon-192-v2.png',
  '/admin/icon-512-v2.png',
  '/admin/manifest.webmanifest',
];

const STATIC_EXT_RE = /\.(?:html|css|js|png|jpg|jpeg|webp|svg|gif|ico|json|webmanifest)$/i;
const DYNAMIC_PATH_RE = /^\/(?:admin\/(?:resumen-ejecutivo|resumen-semanal-pwa|operations\/overview|sales\/stats|driver-insights|locations)|orders|products|api\/consumos|promotions)/i;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function toCacheKey(request) {
  try {
    const url = new URL(request.url);
    return new Request(url.pathname, { method: 'GET' });
  } catch (_) {
    return request;
  }
}

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

function isDynamicData(url) {
  if (!isSameOrigin(url)) return false;
  return DYNAMIC_PATH_RE.test(String(url.pathname || ''));
}

function offlineHtmlResponse() {
  const html = `
<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sin conexión</title>
    <style>
      body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f7f8fb;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;color:#0f172a}
      .card{max-width:420px;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:20px 22px;box-shadow:0 10px 30px rgba(15,23,42,.08)}
      h1{font-size:20px;margin:0 0 10px}
      p{margin:0;color:#475569;line-height:1.5}
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Sin conexión</h1>
      <p>No pudimos cargar el panel en este momento. Reintentá cuando vuelva la conexión.</p>
    </div>
  </body>
</html>`;
  return new Response(html, {
    status: 503,
    statusText: 'Offline',
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

async function putIfValid(cacheName, request, response) {
  if (!response || !response.ok) return;
  const cache = await caches.open(cacheName);
  const key = toCacheKey(request);
  await cache.put(key, response.clone());
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
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== STATIC_CACHE && key !== DYNAMIC_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

async function networkFirstNavigation(request) {
  try {
    const networkResp = await fetch(request, { cache: 'no-store' });
    await putIfValid(STATIC_CACHE, '/admin/index.html', networkResp);
    return networkResp;
  } catch (_) {
    // Short retry helps on cold starts (e.g. free-tier spin-up) before falling back.
    try {
      await sleep(900);
      const retryResp = await fetch(request, { cache: 'no-store' });
      await putIfValid(STATIC_CACHE, '/admin/index.html', retryResp);
      return retryResp;
    } catch (_) {}
    const cached = await caches.match('/admin/index.html', { ignoreSearch: true });
    if (cached) return cached;
    return offlineHtmlResponse();
  }
}

async function networkFirstDynamic(request) {
  const key = toCacheKey(request);
  try {
    const networkResp = await fetch(request, { cache: 'no-store' });
    await putIfValid(DYNAMIC_CACHE, key, networkResp);
    return networkResp;
  } catch (_) {
    const cached = await caches.match(key, { ignoreSearch: true });
    if (cached) return cached;
    // Avoid synthetic 503s that break UX/noise console in flaky mobile networks.
    return new Response(JSON.stringify({ offline: true, source: 'sw-fallback' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}

async function cacheFirstStatic(request) {
  const key = toCacheKey(request);
  const cached = await caches.match(key, { ignoreSearch: true });
  if (cached) return cached;
  try {
    const networkResp = await fetch(request);
    await putIfValid(STATIC_CACHE, key, networkResp);
    return networkResp;
  } catch (_) {
    // Return an empty 204 instead of 503 to prevent noisy resource errors.
    return new Response('', { status: 204, statusText: 'No Content' });
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (!request || request.method !== 'GET') return;
  let url;
  try {
    url = new URL(request.url);
  } catch (_) {
    return;
  }
  if (!isSameOrigin(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (isDynamicData(url)) {
    event.respondWith(networkFirstDynamic(request));
    return;
  }

  if (isAdminStaticAsset(url)) {
    event.respondWith(cacheFirstStatic(request));
  }
});

self.addEventListener('message', (event) => {
  const data = event && event.data ? event.data : {};
  if (data && data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

try {
  importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js');
  if (FIREBASE_WEB_CONFIG && FIREBASE_WEB_CONFIG.apiKey && FIREBASE_WEB_CONFIG.messagingSenderId && FIREBASE_WEB_CONFIG.appId) {
    firebase.initializeApp(FIREBASE_WEB_CONFIG);
    const messaging = firebase.messaging();
    messaging.onBackgroundMessage((payload) => {
      const data = payload && payload.data ? payload.data : {};
      const note = payload && payload.notification ? payload.notification : {};
      const title = String(note.title || data.title || 'Actualización operativa');
      const body = String(note.body || data.body || 'Hay novedades en el panel.');
      const targetUrl = String(data.url || '/admin/index.html');
      self.registration.showNotification(title, {
        body,
        icon: '/admin/icon-192-v2.png',
        badge: '/admin/icon-192-v2.png',
        data: {
          url: targetUrl,
          order_id: data.order_id || '',
          open_section: data.open_section || '',
        },
      });
    });
  }
} catch (_) {
  // firebase is optional; PWA must continue working without push.
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event && event.notification ? (event.notification.data || {}) : {};
  const targetUrl = String(data.url || '/admin/index.html');
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        try {
          const currentUrl = String(client.url || '');
          if (currentUrl.includes('/admin/')) {
            client.focus();
            client.navigate(targetUrl);
            return client;
          }
        } catch (_) {}
      }
      return clients.openWindow(targetUrl);
    })
  );
});
