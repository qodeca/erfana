// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * True when the suite runs headless on Linux inside the Docker image driven by
 * `npm run test:e2e:linux` (`scripts/e2e-linux.sh` sets the variable). Use it to
 * skip or adapt a test that cannot run there:
 *
 * `test.skip(IS_LINUX_CONTAINER, 'reason')`
 *
 * It is a test-only switch: no app code reads it.
 */
export const IS_LINUX_CONTAINER =
  process.platform === 'linux' && process.env.ERFANA_E2E_LINUX_CONTAINER === '1'
