// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
//
// Regression guard for issue #171: every vitest entry point caps its workers at
// a share of the cores. Without the cap each run took one worker per core minus
// one, and parallel agent runs drove a 10-core machine to a load above 120.

import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { resolveMaxWorkers } from '../vitest.workers.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('resolveMaxWorkers (issue #171)', () => {
  it('defaults to half the cores', () => {
    expect(resolveMaxWorkers({}, 10)).toBe(5)
    expect(resolveMaxWorkers({}, 16)).toBe(8)
  })

  it('keeps at least two workers on a small runner, never more than the cores', () => {
    expect(resolveMaxWorkers({}, 4)).toBe(2)
    expect(resolveMaxWorkers({}, 3)).toBe(2)
    expect(resolveMaxWorkers({}, 1)).toBe(1)
  })

  it('lets VITEST_MAX_WORKERS raise or lower the cap, as a count or a percentage', () => {
    expect(resolveMaxWorkers({ VITEST_MAX_WORKERS: '9' }, 10)).toBe(9)
    expect(resolveMaxWorkers({ VITEST_MAX_WORKERS: '1' }, 10)).toBe(1)
    expect(resolveMaxWorkers({ VITEST_MAX_WORKERS: '80%' }, 10)).toBe(8)
    expect(resolveMaxWorkers({ VITEST_MAX_WORKERS: ' 100% ' }, 10)).toBe(10)
  })

  it('ignores a malformed override with a warning instead of uncapping', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      for (const bad of ['0', '-3', 'lots', '150%', '0%', '2.5']) {
        expect(resolveMaxWorkers({ VITEST_MAX_WORKERS: bad }, 10), bad).toBe(5)
      }
      expect(warn).toHaveBeenCalledTimes(6)
    } finally {
      warn.mockRestore()
    }
  })
})

describe('vitest configs carry the cap (issue #171)', () => {
  // vitest 3 sizes its pool from the root config only, so every file a run can
  // start from must set it: the root config and each per-project `--config`.
  for (const file of ['vitest.config.ts', 'vitest.main.ts', 'vitest.preload.ts', 'vitest.renderer.ts']) {
    it(`${file} sets maxWorkers from vitest.workers`, () => {
      const source = readFileSync(join(root, file), 'utf8')
      expect(source).toMatch(/import \{ maxWorkers \} from '\.\/vitest\.workers'/)
      expect(source).toMatch(/^\s+maxWorkers,$/m)
    })
  }
})
