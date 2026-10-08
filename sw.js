/* Офлайн-кеш читалки. Отдаём из кеша сразу, следом тихо обновляем:
   свежая версия подхватится при следующем запуске, офлайн не ломается. */
const CACHE = 'reader-v4';
const V = '4';
const ASSETS = ['./','./index.html','./styles.css?v='+V,'./app.js?v='+V,'./parsers.js?v='+V,'./vendor/jszip.min.js?v='+V,'./manifest.webmanifest?v='+V];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.match(req).then(hit => {
    const net = fetch(req).then(r => {
      if (r && r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {}); }
      return r;
    }).catch(() => hit || caches.match('./index.html'));
    return hit || net;
  }));
});
