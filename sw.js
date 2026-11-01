// Yatzy zu zweit: service worker. It keeps the app on the phone so it also opens without a
// connection (the paper sheet then works fully offline), and it shows the push notifications
// the server sends. The server's live data itself is never cached.

const CACHE = 'yatzy-v6';
const SHELL = ['./', 'index.html', 'game.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png',
  'fonts/familjen-grotesk.woff2', 'fonts/kalam-400.woff2', 'fonts/kalam-700.woff2'];
// How long the page waits for the network before it starts from the saved copy.
const PATIENCE = 3000;

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
  // The page: the newest one, unless the network takes longer than PATIENCE (weak signal).
  if (req.mode === 'navigate') return e.respondWith(fresh(e, req.url, 'index.html'));
  // Fonts, icons and the rules file with its version number (game.js?r=…) don't change
  // under the same address: straight from the phone, refreshed in the background.
  if (/\/(fonts\/|icon|apple-touch|manifest)/.test(url.pathname) || (url.pathname.endsWith('/game.js') && url.searchParams.has('r')))
    return e.respondWith(stored(e, req));
  e.respondWith(fresh(e, req, req));
});

// Network first, but with a time limit; the saved copy when it is too slow or offline.
function fresh(e, req, key){
  const net = fetch(req, {cache: 'no-cache'}).then(async res => {
    if (res.ok) await (await caches.open(CACHE)).put(key, res.clone());
    return res;
  });
  e.waitUntil(net.catch(() => {}));
  const late = new Promise(ok => setTimeout(ok, PATIENCE)).then(() => saved(key)).then(hit => hit || net);
  return Promise.race([net, late]).catch(() => saved(key).then(hit => hit || Response.error()));
}
// The saved copy of exactly this address at once, and a fresh one for next time. A new
// address (a new rules version) comes from the network; only offline any older copy.
function stored(e, req){
  const net = fetch(req).then(async res => {
    if (res.ok) await (await caches.open(CACHE)).put(req, res.clone());
    return res;
  });
  e.waitUntil(net.catch(() => {}));
  return caches.match(req).then(hit => hit || net.catch(() => saved(req).then(old => old || Response.error())));
}
// Exactly this file if it was saved; only then any saved version of it (better than nothing).
function saved(key){
  return caches.match(key).then(hit => hit || caches.match(key, {ignoreSearch: true}));
}

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
