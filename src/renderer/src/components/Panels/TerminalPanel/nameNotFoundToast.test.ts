// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const toasts = vi.hoisted(() => ({ showInfoToast: vi.fn(), showWarningToast: vi.fn() }))
vi.mock('../../../utils/toastHelpers', () => toasts)

import { showNameNotFoundToast } from './nameNotFoundToast'

beforeEach(() => {
  toasts.showInfoToast.mockReset()
  toasts.showWarningToast.mockReset()
})

describe('showNameNotFoundToast (#320 review, round 4, item 2)', () => {
  it('says the file was not found when the search finished', () => {
    showNameNotFoundToast('Card.tsx', false)
    expect(toasts.showInfoToast).toHaveBeenCalledWith('File not found', 'No file named "Card.tsx" was found in the project.')
    expect(toasts.showWarningToast).not.toHaveBeenCalled()
  })

  it('never says "not found" when the search was cut short', () => {
    showNameNotFoundToast('Card.tsx', true)
    expect(toasts.showWarningToast).toHaveBeenCalledWith(
      'Search not finished',
      'Could not finish searching the project for "Card.tsx".'
    )
    expect(toasts.showInfoToast).not.toHaveBeenCalled()
  })
})
