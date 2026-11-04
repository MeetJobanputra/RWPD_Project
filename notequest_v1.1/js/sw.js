/* ==========================================================
   sw.js — service worker for offline use.
   On first visit it saves (caches) every app file. After that, the
   app loads from the cache even with no internet.
   IMPORTANT: when you change any file, bump CACHE_NAME (v1 -> v2)
   so browsers download the new files.
   ========================================================== */
const CACHE_NAME = 'focusos-v1';
const FILES = [
  './',
  'index.html',
  'manifest.json',
  'css/style.css',
  'assets/vendor/bootstrap.min.css',
  'assets/icon.svg',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'js/storage.js',
  'js/ui.js',
  'js/quiz.js',
  'js/notes.js',
  'js/draw.js',
  'js/mindmap.js',
  'js/arena.js',
  'js/leaderboard.js',
  'js/settings.js',
  'js/app.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  // Remove caches from older versions
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;        // only handle our own files

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).catch(() => {
        // Offline and not cached: for page loads, fall back to the app shell
        if (event.request.mode === 'navigate') return caches.match('index.html');
        return new Response('', { status: 504, statusText: 'Offline' });
      });
    })
  );
});
