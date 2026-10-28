// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
//
// The main-process test projects, shared by the two configs that run them:
// `vitest.config.ts` (every project – `npm test`, `npm run test:ci`) and
// `vitest.main.config.ts` (these two alone, with main's coverage floors –
// `npm run test:main`, `npm run test:cov`, the CI Coverage job).
//
// `main-perf` holds the timing-budget suites, the `*.perf.test.*` files (owner
// decision 2026-10-27, "run speed tests alone"). Their budgets are main-thread
// busy time and event-loop stalls, and every other test file running beside
// them only adds to both: commentFileJobs.perf.test.ts's 60 ms stall budget
// measured 106–137 ms four times on 2026-10-27 while other files ran, and passes
// alone. So `main-perf` runs one file at a time (`fileParallelism: false`) and
// starts only when every other file of the run has finished
// (`sequence.groupOrder: 1` – vitest runs project groups lowest first, each
// after the one before it has settled). Their budgets, sample counts and
// assertions are unchanged.
//
// Each project stands alone (`extends: false`), so it is the same project in
// both configs whatever the declaring config holds.
import path from 'node:path'
import type { TestProjectInlineConfiguration } from 'vitest/config'
import { maxWorkers } from './vitest.workers'

type ProjectTestOptions = NonNullable<TestProjectInlineConfiguration['test']>

/** The main-process tests: the main process, the shared code and the build scripts. */
const MAIN_INCLUDE = ['src/main/**/*.test.{ts,tsx}', 'src/shared/**/*.test.{ts,tsx}', 'scripts/**/*.test.{js,mjs,ts}']
const MAIN_EXCLUDE = ['node_modules', 'dist', 'out', 'e2e', 'tests/fixtures']

/** A timing-budget suite says so in its file name. */
export const PERF_TEST_PATTERN = '**/*.perf.test.*'

/** The timing-budget suites among the main-process tests: {@link MAIN_INCLUDE}, `*.perf.test.*` only. */
const PERF_INCLUDE = MAIN_INCLUDE.map((glob) => glob.replace('*.test.', '*.perf.test.'))

/** What both projects share: Node, the main setup file, the `@main` / `@shared` aliases. */
function mainProcessProject(test: ProjectTestOptions): TestProjectInlineConfiguration {
  return {
    extends: false,
    resolve: {
      alias: {
        '@main': path.resolve(__dirname, 'src/main'),
        '@shared': path.resolve(__dirname, 'src/shared'),
      },
    },
    test: {
      environment: 'node',
      globals: true,
      setupFiles: ['tests/setup/setupTests.main.ts'],
      ...test,
    },
  }
}

/** `main`: every main-process test but the timing-budget suites. */
export const mainProject = mainProcessProject({
  name: 'main',
  // Worker cap (issue #171). vitest sizes each group's pool from its projects'
  // own value and refuses a group whose projects disagree, so `main` carries
  // the same cap as `preload` and `renderer`, which run in the same group.
  maxWorkers,
  include: MAIN_INCLUDE,
  exclude: [...MAIN_EXCLUDE, PERF_TEST_PATTERN],
})

/** `main-perf`: the timing-budget suites, one file at a time, after every other file of the run. */
export const mainPerfProject = mainProcessProject({
  name: 'main-perf',
  include: PERF_INCLUDE,
  exclude: MAIN_EXCLUDE,
  // One worker. Note: a VITEST_MAX_WORKERS set by hand overrides this too –
  // vitest applies it to every project after reading the configs.
  fileParallelism: false,
  sequence: { groupOrder: 1 },
})

/** Both main-process projects, in run order. */
export const mainProjects = [mainProject, mainPerfProject]
