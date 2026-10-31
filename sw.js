// Yatzy zu zweit: service worker. It keeps the app on the phone so it also opens without a
// connection (the paper sheet then works fully offline). Firebase itself is never cached.

const CACHE = 'yatzy-v1';
const SHELL = ['./', 'index.html', 'game.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
const FONTS = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
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
  const own = url.origin === self.location.origin;
  if (!own && !FONTS.includes(url.origin)) return;
  // Our own files: the newest version when online (index.html and game.js must match),
  // the saved one when offline.
  if (own){
    const key = req.mode === 'navigate' ? 'index.html' : req;
    e.respondWith(fetch(req)
      .then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(key, copy)); } return res; })
      .catch(() => caches.match(key, {ignoreSearch: true})));
    return;
  }
  // Fonts: answer from the cache at once and refresh it in the background.
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(req);
    const net = fetch(req).then(res => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; });
    if (hit){ e.waitUntil(net.catch(() => {})); return hit; }
    return net;
  }));
});
