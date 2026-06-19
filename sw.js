/**
 * Service worker for TQE PWA.
 *
 * Two responsibilities:
 * 1. COOP/COEP header injection on all fetch responses (required for SharedArrayBuffer)
 * 2. App shell caching for offline support
 */

const CACHE_NAME = 'tqe-pwa-v8';

const APP_SHELL = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/processor.js',
  './js/storage-web.js',
  './manifest.json',
  './lib/ffmpeg/ffmpeg.js',
  './lib/ffmpeg/814.ffmpeg.js',
  './lib/ffmpeg/ffmpeg-core.js',
  './lib/ffmpeg/ffmpeg-core.wasm',
  // Shared modules imported by app.js and processor.js
  '../src/shared/key-validator.js',
  '../src/shared/video-params.js',
  '../src/shared/mp4-itsscale.js',
  '../src/shared/constants.js',
];

// Install: cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// Activate: clean old caches, take control immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: inject COOP/COEP headers + serve from cache with network fallback
self.addEventListener('fetch', (event) => {
  // Only handle same-origin requests
  if (event.request.url.startsWith(self.location.origin)) {
    event.respondWith(handleFetch(event.request));
  }
});

async function handleFetch(request) {
  let response;

  // Try cache first for app shell resources
  const cached = await caches.match(request);
  if (cached) {
    response = cached;
  } else {
    try {
      response = await fetch(request);
      // Cache successful GET responses
      if (response.ok && request.method === 'GET') {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, response.clone());
      }
    } catch {
      return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
    }
  }

  // Inject COOP/COEP headers for SharedArrayBuffer support
  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
