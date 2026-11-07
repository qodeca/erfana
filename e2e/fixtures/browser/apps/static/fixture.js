// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
//
// Main-world helper shared by the static fixture pages: `window.__fixture`.
// A test reads and drives a page only through it (page.evaluate), so a page's
// state changes when the test says so, never on a wall-clock wait.
//
//   __fixture.log            every recorded event, oldest first: { type, detail, seq }
//   __fixture.record(t, d)   append one; also rendered into #log when the page has one
//   __fixture.count(t)       how many of type t were recorded
//   __fixture.clear()        empty the log
//   __fixture.viewport()     { innerWidth, innerHeight, devicePixelRatio, scrollX, scrollY }
//
// Pages add their own hooks (advance, tick, openMany, …) to the same object.
// <html data-fixture-ready="true"> marks a page whose own script has run.
;(function () {
  'use strict'
  var entries = []
  var fixture = {
    log: entries,
    record: function (type, detail) {
      var entry = { type: type, detail: detail === undefined ? '' : String(detail), seq: entries.length }
      entries.push(entry)
      var list = document.getElementById('log')
      if (list) {
        var item = document.createElement('li')
        item.textContent = entry.detail ? type + ' ' + entry.detail : type
        list.appendChild(item)
      }
      return entry
    },
    count: function (type) {
      return entries.filter(function (e) {
        return e.type === type
      }).length
    },
    clear: function () {
      entries.length = 0
      var list = document.getElementById('log')
      if (list) list.textContent = ''
    },
    viewport: function () {
      return {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
        scrollX: window.scrollX,
        scrollY: window.scrollY
      }
    },
    param: function (name) {
      return new URLSearchParams(location.search).get(name)
    }
  }
  window.__fixture = fixture
  window.addEventListener('load', function () {
    document.documentElement.dataset.fixtureReady = 'true'
  })
})()
