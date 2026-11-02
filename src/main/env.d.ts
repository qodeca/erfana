// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.

/**
 * `true` only in an e2e build (`electron-vite build --mode e2e`), `false` in
 * every other build; inlined by `define` in electron.vite.config.ts and the
 * vitest main projects. Read it only in `src/main/testHooks/loadTestHooks.ts`.
 */
declare const __ERFANA_TEST_HOOKS__: boolean
