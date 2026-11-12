// Beast Brawl! — service worker : le jeu reste jouable hors ligne une fois chargé.
// Code (html, js, css) : réseau d'abord, pour recevoir les mises à jour tout de suite ; cache si hors ligne.
// Images, sons, polices : cache d'abord (ils changent rarement), réseau sinon.
const VERSION = 'bb-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;      // le serveur en ligne ne passe jamais par le cache
  if (req.headers.has('range')) return;                                    // lecture audio par morceaux : on laisse faire le navigateur
  const isAsset = /\/(assets|icons)\//.test(url.pathname);
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    if (isAsset) {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.status === 200) cache.put(req, res.clone());
      return res;
    }
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (res.ok && res.status === 200) cache.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      throw err;
    }
  })());
});
