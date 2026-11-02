// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
// Shows the signed-in user from GET /api/me in every #session element.
// <html data-session="signed-in|signed-out"> is the machine-readable state.
;(function () {
  'use strict'
  function show(user) {
    document.documentElement.dataset.session = user ? 'signed-in' : 'signed-out'
    document.querySelectorAll('#session').forEach(function (el) {
      el.textContent = user ? 'Signed in as ' + user : 'Signed out'
    })
  }
  window.refreshSession = function () {
    return fetch('/api/me', { cache: 'no-store' })
      .then(function (r) { return r.json() })
      .then(function (body) { show(body.user); return body.user })
  }
  window.addEventListener('DOMContentLoaded', window.refreshSession)
})()
