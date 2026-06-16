// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const handlers: Record<string, (...args: any[]) => any> = {}

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn((ch: string, cb: any) => { handlers[ch] = cb }) } }))

const getDepth = vi.fn(async () => 3)
const setDepth = vi.fn(async (_d: number | null) => {})
vi.mock('../services/SettingsService', () => ({ settingsService: { getDirectoryWatchDepth: getDepth, setDirectoryWatchDepth: setDepth } }))

describe('settings directory watch depth handlers', () => {
  beforeEach(async () => {
    Object.keys(handlers).forEach((k) => delete handlers[k])
    const mod = await import('./settings-handlers')
    mod.registerSettingsHandlers()
  })

  it('returns depth from settings', async () => {
    const res = await handlers['settings:getDirectoryWatchDepth']()
    expect(res).toEqual({ success: true, depth: 3 })
  })

  it('sets depth in settings', async () => {
    const res = await handlers['settings:setDirectoryWatchDepth'](null, 2)
    expect(setDepth).toHaveBeenCalledWith(2)
    expect(res).toEqual({ success: true })
  })
})

