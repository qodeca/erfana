// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The "Words changed" pair search stays linear in its prefix's hits
 * (comments-v2 C-06; security review L-3). A timing budget, so it runs in the
 * `main-perf` project, one file at a time.
 */
import { describe, expect, it } from 'vitest'
import { wordsBetween } from './commentListChange'

describe('C-06 wordsBetween under load', () => {
  it('L-3 20,000 prefix hits stay linear: a missing suffix, a suffix only before them, and one past the gap', () => {
    const hits = 'a'.repeat(20_000)
    const cases = [
      { text: hits, suffix: 'zz' },
      { text: `zz${hits}`, suffix: 'zz' },
      { text: `${hits}${'b'.repeat(60_000)}zz`, suffix: 'zz' }
    ]
    // Warm the engine on the same shapes, then time them.
    for (const { text, suffix } of cases) wordsBetween(text, { exact: 'x', prefix: 'a', suffix })
    const started = performance.now()
    for (const { text, suffix } of cases) expect(wordsBetween(text, { exact: 'x', prefix: 'a', suffix })).toBeUndefined()
    // About 8 ms on the dev machine; the quadratic search took about 130 ms on the same shapes (the padded one most).
    expect(performance.now() - started).toBeLessThan(40)
  })
})
