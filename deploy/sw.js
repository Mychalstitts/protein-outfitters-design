/* ============================================================
   Protein Outfitters Service Worker
   ----------------------------------------------------------------
   What it does:
   • Precaches the app shell so the site loads instantly + works
     offline (the Reserve page, /discover, /account, /map).
   • Network-first for HTML so updates ship immediately when a
     new deploy lands.
   • Cache-first for static assets (CSS, JS, images, fonts).
   • Bypasses /api/* entirely — those are dynamic and must hit the
     network with current auth cookies.

   Versioning: bump SHELL_VERSION on every deploy that changes the
   app shell. Old caches are purged on activate.
============================================================ */

// Bump SHELL_VERSION on every deploy that ships new po-shell.js / theme.css to
// invalidate the previous cached shell. Otherwise users keep getting the old
// JavaScript even after a deploy lands.
const SHELL_VERSION = 'po-shell-v12';
const STATIC_VERSION = 'po-static-v12';

// Files that change frequently and MUST be network-first so deploys propagate
// without waiting for cache eviction. Anything else gets cache-first behavior.
const NETWORK_FIRST_PATHS = new Set([
  '/po-shell.js',
  '/po-shell.css',
  '/po-api.js',
  '/theme.css',
  '/manifest.webmanifest',
]);

// Pages we want available offline. Light list — anything we genuinely
// expect the user to land on after first visit.
const APP_SHELL = [
  '/',
  '/discover',
  '/account',
  '/map',
  '/hardware',
  '/faq',
  '/po-shell.css',
  '/po-shell.js',
  '/theme.css',
  '/icons.svg',
  '/brand/favicon.svg',
  '/brand/po-icon-192.png',
  '/brand/po-icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_VERSION).then(cache => cache.addAll(APP_SHELL).catch(() => {/* ignore individual asset failures */}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== SHELL_VERSION && k !== STATIC_VERSION)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Bypass API + auth + Stripe + tracker calls — must hit network always.
  if (
    url.pathname.startsWith('/api/') ||
    url.hostname.includes('stripe.com') ||
    url.hostname.includes('clarity.ms') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('vercel-insights.com')
  ) return;

  // Network-first for HTML AND for our app shell scripts (so deploys propagate fast).
  const accept = req.headers.get('accept') || '';
  const isAppShellScript = url.hostname === self.location.hostname && NETWORK_FIRST_PATHS.has(url.pathname);
  if (req.mode === 'navigate' || accept.includes('text/html') || isAppShellScript) {
    event.respondWith(
      fetch(req)
        .then(res => {
          // Stash a copy for offline fallback
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL_VERSION).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then(hit => hit || caches.match('/')))
    );
    return;
  }

  // Cache-first for static assets.
  event.respondWith(
    caches.match(req).then(hit => {
      if (hit) return hit;
      return fetch(req).then(res => {
        if (res.ok && (req.url.endsWith('.css') || req.url.endsWith('.js') || req.url.endsWith('.svg') || req.url.endsWith('.png') || req.url.endsWith('.jpg') || req.url.endsWith('.webp') || req.url.endsWith('.woff2'))) {
          const copy = res.clone();
          caches.open(STATIC_VERSION).then(c => c.put(req, copy));
        }
        return res;
      });
    })
  );
});

// ============================================================
//   Web Push handler — data-less pattern
// ----------------------------------------------------------------
//   We send pushes from /api/_lib/push.js as bodyless POSTs (signed with
//   a VAPID JWT). The browser delivers a `push` event with no payload,
//   and we fetch the most recent unread notification from /api/notifications
//   to show. Keeps server-side crypto down to just VAPID signing (no ECE
//   payload encryption to maintain).
//
//   If event.data IS present (we may add encrypted payloads later),
//   it's parsed as JSON and displayed directly.
// ============================================================
self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let notif = null;
    try {
      // Direct payload path (future-proof — we don't send these today).
      if (event.data) {
        try { notif = event.data.json(); } catch { notif = { title: 'Protein Outfitters', body: event.data.text() }; }
      }
      // Data-less path: fetch the latest unread notification with the SW's
      // cookies. credentials:'include' is required for the session cookie
      // to flow through.
      if (!notif) {
        const r = await fetch('/api/notifications?limit=1&unread=1', { credentials: 'include' });
        if (r.ok) {
          const data = await r.json();
          const row = (data.notifications || [])[0];
          if (row) {
            notif = {
              title: row.title || 'Protein Outfitters',
              body: row.body || '',
              link: row.link_url || '/notifications',
              tag: row.dedup_key || row.id,
            };
          }
        }
      }
    } catch { /* fall through to a generic shell */ }

    if (!notif) {
      notif = { title: 'Protein Outfitters', body: 'You have a new notification.', link: '/notifications' };
    }

    await self.registration.showNotification(notif.title, {
      body: notif.body,
      icon: '/brand/po-icon-192.png',
      badge: '/brand/po-icon-192.png',
      tag: notif.tag || 'po-notif',
      data: { link: notif.link || '/notifications' },
    });
  })());
});

// Tap on the notification → focus an open tab if we have one, else open it.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/notifications';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      try {
        const u = new URL(c.url);
        if (u.pathname === link) { c.focus(); return; }
      } catch { /* malformed url, ignore */ }
    }
    await self.clients.openWindow(link);
  })());
});
