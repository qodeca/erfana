// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
//
// Root config for runs started without `--config` (`npm test`, `npm run
// test:ci`, a bare `npx vitest run <file>`). It lists the three projects
// (vitest 4 replaced the separate `vitest.workspace.ts` with `test.projects`)
// and carries the worker cap (issue #171): vitest sizes its pool from the root
// config, and without one every such run used one worker per core minus one.
// It declares no tests of its own.
import { defineConfig } from 'vitest/config'
import { maxWorkers } from './vitest.workers'

export default defineConfig({
  test: {
    maxWorkers,
    projects: ['vitest.main.config.ts', 'vitest.preload.config.ts', 'vitest.renderer.config.ts'],
  },
})
