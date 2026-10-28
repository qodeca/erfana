// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the shared path digest (issue #124, QG-7 S3).
 *
 * Main and the renderer both run this one module – the renderer through the
 * re-export in `fileUtils.ts` – so one panel's digest is the same in a main log
 * line and in a renderer log line. The pinned vectors keep it that way: they
 * fail if the algorithm, a seed or the output format drifts. This file runs in
 * the main (node) project; `fileUtils.test.ts` covers the re-export in the
 * renderer (jsdom) project.
 *
 * @see stablePathDigest.ts
 */
import { describe, expect, it } from 'vitest'

import { stablePathDigest } from './stablePathDigest'

describe('stablePathDigest', () => {
  it('returns 16 lowercase hex characters', () => {
    expect(stablePathDigest('/proj/a.html')).toMatch(/^[0-9a-f]{16}$/)
    expect(stablePathDigest('')).toMatch(/^[0-9a-f]{16}$/)
  })

  it('is deterministic', () => {
    expect(stablePathDigest('/proj/a.html')).toBe(stablePathDigest('/proj/a.html'))
  })

  it('is case-sensitive', () => {
    expect(stablePathDigest('/proj/Icon.svg')).not.toBe(stablePathDigest('/proj/icon.svg'))
  })

  // Computed with the renderer's implementation before it moved here; the first
  // row is the path `fileUtils.test.ts` checks. A change to any value breaks the
  // main ↔ renderer correlation of log lines and changes every long-path
  // panel id. The empty string yields the two seeds; the last row pins the
  // UTF-16 code-unit reading (non-ASCII letters and a surrogate pair).
  it.each([
    ['/proj/a.html', '0e379b04476970ae'],
    ['/proj/Icon.svg', 'b439fd2bd56fb6b5'],
    ['/proj/icon.svg', 'ad2c0f4bc57ed615'],
    ['', '811c9dc5050c5d1f'],
    ['C:\\Users\\Name\\proj\\index.html', 'f77f0c91893437eb'],
    ['/proj/zażółć \u{1F600}.html', 'e4916a0d24722a1f']
  ])('pins %j to %s', (path, digest) => {
    expect(stablePathDigest(path)).toBe(digest)
  })
})
