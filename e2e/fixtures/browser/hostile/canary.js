// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
//
// Canary for the hostile pages (025-NFR-001, 025-AC-046). Each page runs its
// attacks through `__canary.attempt(name, fn)`:
//
//   fn returns (or resolves to) something truthy  -> "leaked"  (the page got something)
//   fn returns falsy, throws or rejects            -> "blocked"
//   __canary.note(name, 'attempted', detail)      -> the page cannot tell; the test checks
//                                                    Erfana's side (terminal, external-open spy, …)
//
// Results land in the DOM, so a test reads them without trusting page script:
//   <output id="result" data-status="pending|blocked|leaked" data-done="true|false">
//   <ol id="attempts"> one <li data-name data-outcome> per attempt
// and in window.__canary.results. `data-done` turns "true" once every attempt
// has settled. An attempt that never answers (a blocked frame that fires no
// event) stays pending until the test calls `__canary.finish()`, which settles
// it as "blocked" with the detail "no answer" – no timer decides it.
;(function () {
  'use strict'
  var results = []
  var pending = 0
  var started = false

  function ensureDom() {
    var result = document.getElementById('result')
    if (!result) {
      result = document.createElement('output')
      result.id = 'result'
      document.body.appendChild(result)
    }
    var list = document.getElementById('attempts')
    if (!list) {
      list = document.createElement('ol')
      list.id = 'attempts'
      document.body.appendChild(list)
    }
    return { result: result, list: list }
  }

  function summary() {
    var leaked = results.filter(function (r) { return r.outcome === 'leaked' })
    return leaked.length > 0 ? 'leaked' : 'blocked'
  }

  function render() {
    var dom = ensureDom()
    var status = started ? summary() : 'pending'
    dom.result.dataset.status = status
    dom.result.dataset.done = String(started && pending === 0)
    var leaked = results.filter(function (r) { return r.outcome === 'leaked' }).map(function (r) { return r.name })
    dom.result.textContent = status + (leaked.length ? ': ' + leaked.join(', ') : '')
    document.documentElement.dataset.canary = status
  }

  function note(name, outcome, detail) {
    var entry = { name: name, outcome: outcome, detail: detail === undefined ? '' : String(detail).slice(0, 300) }
    results.push(entry)
    var item = document.createElement('li')
    item.dataset.name = name
    item.dataset.outcome = outcome
    item.textContent = name + ': ' + outcome + (entry.detail ? ' – ' + entry.detail : '')
    ensureDom().list.appendChild(item)
    render()
    return entry
  }

  var unsettled = []

  function attempt(name, fn) {
    started = true
    pending += 1
    var settled = false
    function settle(outcome, detail) {
      if (settled) return
      settled = true
      pending -= 1
      note(name, outcome, detail)
    }
    unsettled.push(function () { settle('blocked', 'no answer') })
    var value
    try {
      value = fn()
    } catch (error) {
      settle('blocked', error && error.name ? error.name + ': ' + error.message : String(error))
      return Promise.resolve()
    }
    return Promise.resolve(value).then(
      function (v) { settle(v ? 'leaked' : 'blocked', v ? describe(v) : 'nothing') },
      function (error) { settle('blocked', error && error.name ? error.name + ': ' + error.message : String(error)) }
    )
  }

  function describe(value) {
    if (typeof value === 'string') return value
    try {
      return JSON.stringify(value)
    } catch (error) {
      return Object.prototype.toString.call(value)
    }
  }

  window.__canary = {
    results: results,
    attempt: attempt,
    note: function (name, outcome, detail) {
      started = true
      return note(name, outcome, detail)
    },
    finish: function () {
      unsettled.splice(0).forEach(function (settleAsBlocked) { settleAsBlocked() })
      started = true
      render()
      return summary()
    },
    status: function () { return started ? summary() : 'pending' },
    param: function (name) { return new URLSearchParams(location.search).get(name) }
  }
  if (document.body) render()
  else document.addEventListener('DOMContentLoaded', render)
})()
