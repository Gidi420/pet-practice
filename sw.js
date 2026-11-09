// sw.js — offline app shell + runtime caching of /lib (pdf.js engine, cMaps, fonts).
// Bump CACHE_VERSION to force clients to pick up an update.

const CACHE_VERSION = 'v9';
const CACHE = `pet-cache-${CACHE_VERSION}`;

// Core shell: everything needed to boot the app offline, incl. the pdf.js engine.
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/config.js',
  './js/db.js',
  './js/ui.js',
  './js/timer.js',
  './js/scoring.js',
  './js/tests.js',
  './js/pdfview.js',
  './js/question.js',
  './js/stats.js',
  './js/statsview.js',
  './js/backup.js',
  './js/settings.js',
  './js/modes/practice.js',
  './js/modes/timedQuestion.js',
  './js/modes/simulation.js',
  './js/modes/review.js',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './lib/pdfjs/pdf.mjs',
  './lib/pdfjs/pdf.worker.mjs',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // add individually so one failure doesn't abort the whole install
    await Promise.all(APP_SHELL.map((url) => cache.add(url).catch((e) => console.warn('precache miss', url, e))));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('pet-cache-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isVendored = url.pathname.includes('/lib/') || url.pathname.includes('/icons/');
  const isAppCode = !isVendored && /\.(?:js|mjs|css|webmanifest)$/.test(url.pathname);

  // Navigations + the app's own code: network-first so updates reach the device
  // as soon as it's online; fall back to cache when offline.
  if (req.mode === 'navigate' || isAppCode) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const key = req.mode === 'navigate' ? './index.html' : req;
      try {
        const res = await fetch(req);
        if (res && res.ok) cache.put(key, res.clone());
        return res;
      } catch {
        const cached = await cache.match(key);
        return cached || new Response('Offline', { status: 503 });
      }
    })());
    return;
  }

  // Vendored assets (pdf.js, cMaps, fonts, icons): cache-first (immutable).
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    } catch (e) {
      return cached || new Response('', { status: 504 });
    }
  })());
});
