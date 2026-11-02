// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
// Local files the file-read pages aim at. A test adds its own canary file with
// ?path=<absolute path> (a file it wrote, holding a known string).
;(function () {
  'use strict'
  var targets = ['file:///etc/hosts', 'file:///etc/passwd', 'file:///C:/Windows/win.ini', 'file:///']
  var extra = new URLSearchParams(location.search).get('path')
  if (extra) targets.unshift(extra.indexOf('file:') === 0 ? extra : 'file://' + (extra.charAt(0) === '/' ? '' : '/') + extra.replace(/\\/g, '/'))
  window.__fileTargets = targets
})()
