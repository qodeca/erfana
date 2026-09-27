// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
//
// Root config for runs started without `--config` (`npm test`, `npm run
// test:ci`, a bare `npx vitest run <file>`). It exists only to carry the worker
// cap (issue #171): vitest 3 sizes its pool from the root config, and without a
// root config every such run used one worker per core minus one. It declares no
// tests of its own; the projects still come from `vitest.workspace.ts`.
import { defineConfig } from 'vitest/config'
import { maxWorkers } from './vitest.workers'

export default defineConfig({
  test: {
    maxWorkers,
  },
})
