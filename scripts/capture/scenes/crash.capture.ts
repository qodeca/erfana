// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Scene `crash`: the crash screen, forced with the existing
 * ERFANA_E2E_FORCE_CRASH hook (unpackaged builds only). Guide page:
 * reference/troubleshooting.md.
 */

import { expect, test } from '@playwright/test'
import { TEST_IDS } from '../../../src/renderer/src/constants/testids'
import { launch } from '../lib/app'
import { anySelected, shot } from '../lib/shots'

const ROWS = ['troubleshooting/crash-screen']

test('crash', async () => {
  test.skip(!anySelected(ROWS), 'no row of this scene selected')
  const cap = await launch({ extraEnv: { ERFANA_E2E_FORCE_CRASH: '1' }, readyTestId: TEST_IDS.ROOT_ERROR_BOUNDARY })
  const { page } = cap
  try {
    await expect(page.getByTestId(TEST_IDS.ROOT_ERROR_BOUNDARY)).toBeVisible()
    await shot(cap, 'troubleshooting/crash-screen')
  } finally {
    await cap.close()
  }
})
