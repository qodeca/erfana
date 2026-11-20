// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The renderer's shared file-watch constants.
 *
 * @module constants/fileWatch.test
 */

import { describe, it, expect } from 'vitest'

import { INDICATOR_DURATION_MS } from './fileWatch'

describe('INDICATOR_DURATION_MS', () => {
  it('is the shared 1 s UX contract both refresh surfaces use', () => {
    expect(INDICATOR_DURATION_MS).toBe(1000)
  })
})
