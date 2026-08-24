// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.

// Corpus case 2 script.
// Sets the title sentinel "-OK-2" ONLY after BOTH conditions hold:
//   1. styles.css applied  (resolved --page-bg is non-empty)
//   2. logo.svg loaded      (the <img> reports complete + non-zero size)
// This is the AC25 sentinel 2 gate: "-OK-2 only after CSS AND image land".

const BASE_TITLE = 'Multi-file corpus page'

function cssApplied() {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue('--page-bg')
    .trim()
  return value.length > 0
}

function imageLoaded(img) {
  return Boolean(img) && img.complete && img.naturalWidth > 0
}

function confirmWhenReady() {
  const img = document.getElementById('logo')
  const status = document.getElementById('status')

  if (!cssApplied() || !imageLoaded(img)) {
    return false
  }

  status.classList.remove('pending')
  status.textContent =
    'CSS and image confirmed — stylesheet applied and logo.svg loaded.'
  document.title = BASE_TITLE + ' -OK-2'
  return true
}

window.addEventListener('DOMContentLoaded', () => {
  if (confirmWhenReady()) {
    return
  }
  // The image may still be decoding; re-check once it finishes.
  const img = document.getElementById('logo')
  if (img) {
    img.addEventListener('load', confirmWhenReady, { once: true })
  }
})
