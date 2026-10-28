// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
//
// Regression guard for the owner decision of 2026-10-27, "run speed tests
// alone": the timing-budget suites (`*.perf.test.*`) run in their own vitest
// project, `main-perf`, one file at a time and only after every other file of
// the run – in `npm test` / `npm run test:ci` (vitest.config.ts) and in
// `npm run test:main`, `npm run test:cov` and the CI Coverage job
// (vitest.main.config.ts). Their budgets are main-thread and event-loop time,
// which every test file running beside them only adds to.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import rootConfig from '../vitest.config.ts'
import mainConfig from '../vitest.main.config.ts'
import { mainPerfProject, mainProject, PERF_TEST_PATTERN } from '../vitest.main.projects.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('main-perf runs the timing-budget suites alone (owner decision 2026-10-27)', () => {
  it('takes the *.perf.test.* files out of main, and nothing else', () => {
    expect(mainProject.test.exclude).toContain(PERF_TEST_PATTERN)
    expect(mainPerfProject.test.include).toEqual(
      mainProject.test.include.map((glob) => glob.replace('*.test.', '*.perf.test.'))
    )
  })

  it('runs one file at a time, in a group after every other project', () => {
    expect(mainPerfProject.test.fileParallelism).toBe(false)
    expect(mainPerfProject.test.sequence.groupOrder).toBeGreaterThan(0)
    // Every other project stays in vitest's first group (groupOrder 0).
    expect(mainProject.test.sequence).toBeUndefined()
    for (const file of ['vitest.preload.config.ts', 'vitest.renderer.config.ts']) {
      expect(readFileSync(join(root, file), 'utf8'), file).not.toMatch(/groupOrder/)
    }
  })

  it('is part of every run that runs main', () => {
    expect(rootConfig.test.projects).toEqual(expect.arrayContaining([mainProject, mainPerfProject]))
    expect(mainConfig.test.projects).toEqual([mainProject, mainPerfProject])
  })
})
