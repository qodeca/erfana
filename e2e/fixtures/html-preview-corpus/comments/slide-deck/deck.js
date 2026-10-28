// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
// A small JS-built deck for HTML Preview comments (E-005, F-001): five slides
// built into <main id="deck"> by this script, so every element inside a slide
// is script-built. Hash routing #1–#5 shows one slide and hides the others
// (`hidden`); slide 3 carries twenty points to comment on and an inner
// scroller. The build is deterministic, so a reload rebuilds the same tree.
;(function () {
  var deck = document.getElementById('deck')
  for (var s = 1; s <= 5; s += 1) {
    var slide = document.createElement('section')
    slide.className = 'slide'
    slide.id = 'slide-' + s
    var title = document.createElement('h2')
    title.id = 's' + s + '-title'
    title.textContent = 'Slide ' + s
    slide.appendChild(title)
    var count = s === 3 ? 20 : 2
    for (var i = 1; i <= count; i += 1) {
      var point = document.createElement('p')
      point.className = 'point'
      point.id = 's' + s + '-p' + i
      point.textContent = 'Slide ' + s + ', point ' + i
      slide.appendChild(point)
    }
    if (s === 3) {
      var scroller = document.createElement('div')
      scroller.className = 'scroller'
      scroller.id = 's3-scroller'
      var inner = document.createElement('p')
      inner.id = 's3-inner'
      inner.textContent = 'Scroll me'
      scroller.appendChild(inner)
      slide.appendChild(scroller)
    }
    deck.appendChild(slide)
  }
  function show() {
    var n = Number((location.hash || '#1').slice(1)) || 1
    for (var k = 1; k <= 5; k += 1) document.getElementById('slide-' + k).hidden = k !== n
    document.body.dataset.slide = String(n)
  }
  window.addEventListener('hashchange', show)
  show()
})()
