// Yatzy zu zweit: service worker. It keeps the app on the phone so it also opens without a
// connection (the paper sheet then works fully offline), and it shows the push notifications
// the server sends. The server's live data itself is never cached.

const CACHE = 'yatzy-v4';
const SHELL = ['./', 'index.html', 'game.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png',
  'fonts/familjen-grotesk.woff2', 'fonts/kalam-400.woff2', 'fonts/kalam-700.woff2'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, {cache: 'reload'})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Our own files: the newest version when online (index.html and game.js must match, so the
  // browser's own cache is always asked to check with the server), the saved one when offline.
  const key = req.mode === 'navigate' ? 'index.html' : req;
  e.respondWith(fetch(req.mode === 'navigate' ? req.url : req, {cache: 'no-cache'})
    .then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(key, copy)); } return res; })
    .catch(() => caches.match(key, {ignoreSearch: true})));
});

// A notification from the server (see server/src/logic.js, pushMessages).
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) {}
  e.waitUntil(Promise.all([
    self.registration.showNotification(d.title || 'Yatzy', {
      body: d.body || 'Es gibt Neuigkeiten an eurem Tisch.',
      tag: d.tag || 'yatzy',
      renotify: true,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      data: {url: d.url || './'}
    }),
    self.navigator.setAppBadge ? self.navigator.setAppBadge(1).catch(() => {}) : null
  ]));
});

// Tapping it opens the table: in the app if it is already open, otherwise in a new window.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(e.notification.data && e.notification.data.url || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(list => {
    for (const c of list){
      if (c.url.startsWith(self.registration.scope)) return c.focus().then(w => (w && w.url !== url && w.navigate ? w.navigate(url) : w));
    }
    return self.clients.openWindow(url);
  }));
});
