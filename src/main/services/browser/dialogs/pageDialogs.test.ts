// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Native page dialogs in v1 (025-FR-058, Q6): the `Page` domain goes on so
 * dialog events pause the hang probe; a refusal is logged, never thrown.
 */
import { describe, expect, it, vi } from 'vitest'

const { mockLogger } = vi.hoisted(() => ({ mockLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../../LoggingService', () => ({ logger: mockLogger }))

import { enablePageDialogEvents } from './pageDialogs'

describe('enablePageDialogEvents', () => {
  it('turns the Page domain on', async () => {
    const send = vi.fn(async () => ({}))
    await enablePageDialogEvents({ send })
    expect(send).toHaveBeenCalledExactlyOnceWith('Page.enable')
  })

  it('logs a refusal and resolves', async () => {
    await expect(enablePageDialogEvents({ send: vi.fn(async () => Promise.reject(new Error('refused'))) })).resolves.toBeUndefined()
    await enablePageDialogEvents({ send: vi.fn(async () => Promise.reject('detached')) })
    expect(mockLogger.warn).toHaveBeenCalledWith('Page dialog events could not be turned on', { error: 'refused' })
    expect(mockLogger.warn).toHaveBeenCalledWith('Page dialog events could not be turned on', { error: 'detached' })
  })
})
