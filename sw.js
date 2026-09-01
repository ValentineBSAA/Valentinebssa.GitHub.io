/**
 * Keeps the app shell available with no connection.
 *
 * API traffic is never touched — those calls must always go to the network,
 * and a cached reply would be worse than no reply.
 */

const VERSION = 'companion-v1';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/css/app.css',
  './assets/js/app.js',
  './assets/js/ai.js',
  './assets/js/chat.js',
  './assets/js/settings.js',
  './assets/js/store.js',
  './assets/js/ui.js',
  './assets/js/voice.js',
  './assets/js/games/index.js',
  './assets/js/games/tictactoe.js',
  './assets/js/games/twenty.js',
  './assets/js/games/wordguess.js',
  './assets/js/games/trivia.js',
  './assets/js/games/story.js',
  './assets/js/vendor/anthropic-sdk.esm.js',
  './assets/icons/icon.svg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      // addAll is all-or-nothing; one 404 would leave the app with no cache at all.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;   // API and anything else: straight to the network

  // Navigations: try the network, fall back to the cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('./index.html').then((r) => r || Response.error())),
    );
    return;
  }

  // Assets: serve from cache immediately, refresh in the background.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
