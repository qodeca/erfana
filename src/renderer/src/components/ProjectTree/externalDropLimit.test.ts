// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { showGlobalToast } = vi.hoisted(() => ({ showGlobalToast: vi.fn() }))

vi.mock('../Toast/toastService', () => ({ showGlobalToast }))

import { EXTERNAL_DROP_MAX, refuseOversizedDrop } from './externalDropLimit'

describe('refuseOversizedDrop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lets a drop up to the limit through without a toast', () => {
    expect(refuseOversizedDrop(1)).toBe(false)
    expect(refuseOversizedDrop(EXTERNAL_DROP_MAX)).toBe(false)
    expect(showGlobalToast).not.toHaveBeenCalled()
  })

  it('refuses a larger drop with the Too many files toast', () => {
    expect(refuseOversizedDrop(EXTERNAL_DROP_MAX + 1)).toBe(true)
    expect(showGlobalToast).toHaveBeenCalledTimes(1)
    expect(showGlobalToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Too many files',
        message: `Cannot add more than ${EXTERNAL_DROP_MAX} files at once. Please drop fewer files.`,
        type: 'error'
      })
    )
  })
})
