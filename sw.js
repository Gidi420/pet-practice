// sw.js — offline app shell + runtime caching of /lib (pdf.js engine, cMaps, fonts).
// Bump CACHE_VERSION to force clients to pick up an update.

const CACHE_VERSION = 'v4';
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

  // Navigations: serve the app shell (SPA), fall back to network.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const shell = await cache.match('./index.html');
      if (shell) {
        // revalidate in background
        fetch(req).then((res) => { if (res.ok) cache.put('./index.html', res.clone()); }).catch(() => {});
        return shell;
      }
      try { return await fetch(req); } catch { return new Response('Offline', { status: 503 }); }
    })());
    return;
  }

  // Everything else (app files, lib, cMaps, fonts, icons): cache-first.
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
