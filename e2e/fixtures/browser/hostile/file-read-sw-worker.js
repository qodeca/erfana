// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
// Service worker of hostile/file-read-sw.html: fetches every target it is
// sent and posts back [{ url, ok, text }] to the page.
self.addEventListener('install', function () {
  self.skipWaiting()
})
self.addEventListener('message', function (event) {
  var targets = event.data
  Promise.all(
    targets.map(function (url) {
      return fetch(url)
        .then(function (r) { return r.text() })
        .then(
          function (text) { return { url: url, ok: true, text: text.slice(0, 200) } },
          function (error) { return { url: url, ok: false, text: String(error) } }
        )
    })
  ).then(function (results) {
    event.source.postMessage(results)
  })
})
