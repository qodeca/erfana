// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
// A service worker that answers `/__sw-probe` itself (025-AC-016, S-12): a
// profile set aside as untrusted must never run it again, so in the fresh
// profile the same request reaches the server (404) instead.
self.addEventListener('install', function () {
  self.skipWaiting()
})
self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim())
})
self.addEventListener('fetch', function (event) {
  if (new URL(event.request.url).pathname === '/__sw-probe') {
    event.respondWith(new Response('from-old-service-worker', { headers: { 'Content-Type': 'text/plain' } }))
  }
})
