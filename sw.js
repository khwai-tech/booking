// Housie Pro — service worker
// IMPORTANT: this app is live booking data over Supabase. Caching API responses could
// show staff stale ticket availability and cause real double-bookings, so this worker
// ONLY caches the static app shell (HTML/CSS/JS/icons) and never touches Supabase calls
// or any cross-origin request. It's also network-first (not cache-first) for the shell,
// so app updates reach everyone quickly — the cache is purely an offline fallback.

const CACHE_NAME = 'housie-pro-shell-v1';
const SHELL_FILES = [
  './',
  './index.html',
  './style.css',
  './app-core.js',
  './pos-booking.js',
  './supabase-client.js',
  './manifest.json',
  './favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never intercept anything cross-origin (Supabase, CDN libraries) or non-GET requests —
  // those must always hit the network live.
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});