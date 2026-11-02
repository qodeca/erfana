// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
// The attacks a popup or frame runs against its opener, parent and top, shared
// by popup-escape-child.html and frame-escape-child.html. Each result is posted
// to `report` as { attack, outcome, detail } and recorded on this page's canary.
;(function () {
  'use strict'
  function run(report) {
    function attempt(name, fn) {
      return window.__canary.attempt(name, fn).then(function () {
        var mine = window.__canary.results.filter(function (r) { return r.name === name })
        var last = mine[mine.length - 1]
        if (report && last) report.postMessage({ attack: name, outcome: last.outcome, detail: last.detail }, '*')
      })
    }
    var related = { opener: window.opener, parent: window.parent !== window ? window.parent : null, top: window.top !== window ? window.top : null }
    attempt('own window.electron', function () { return window.electron || window.api || null })
    Object.keys(related).forEach(function (key) {
      var other = related[key]
      if (!other) return
      attempt(key + '.document', function () { return other.document && other.document.title })
      attempt(key + '.electron', function () { return other.electron || other.api || null })
    })
    attempt('window.open javascript:', function () { return window.open('javascript:document.title="ERFANA-HOSTILE-ESCAPE-7f3a"') && null })
    attempt('window.open chrome://gpu', function () { return window.open('chrome://gpu') && null })
    attempt('moveTo and resizeTo off the work area', function () {
      window.moveTo(-10000, -10000)
      window.resizeTo(99999, 99999)
      return window.screenX < -5000 ? 'moved to ' + window.screenX : null
    })
  }
  // Navigations of another window end the attack, so the test triggers them one at a time.
  function navigate(targetName, url) {
    var target = targetName === 'opener' ? window.opener : targetName === 'parent' ? window.parent : window.top
    window.__canary.note(targetName + '.location = ' + url, 'attempted')
    try {
      target.location = url
    } catch (error) {
      window.__canary.note(targetName + '.location = ' + url, 'blocked', error.name)
    }
  }
  window.__escape = { run: run, navigate: navigate }
})()
