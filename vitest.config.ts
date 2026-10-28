// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
//
// Root config for runs started without `--config` (`npm test`, `npm run
// test:ci`, a bare `npx vitest run <file>`). It lists the projects (vitest 4
// replaced the separate `vitest.workspace.ts` with `test.projects`) and carries
// the worker cap (issue #171) – without it every such run used one worker per
// core minus one; vitest.workers.ts says where else it is set. It declares no
// tests of its own.
//
// The two main-process projects come from vitest.main.projects.ts, shared with
// vitest.main.config.ts (which holds main's coverage floors, read only when a
// run starts there). `main-perf`, the timing-budget suites, runs last: one file
// at a time, after every file of `main`, `preload` and `renderer` has finished.
import { defineConfig } from 'vitest/config'
import { mainProjects } from './vitest.main.projects'
import { maxWorkers } from './vitest.workers'

export default defineConfig({
  test: {
    maxWorkers,
    projects: [...mainProjects, 'vitest.preload.config.ts', 'vitest.renderer.config.ts'],
  },
})
