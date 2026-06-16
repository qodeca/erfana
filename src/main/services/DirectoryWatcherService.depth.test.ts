// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Intercept chokidar options
const watchCalls: any[] = []

vi.mock('chokidar', () => ({
  default: {
    watch: (path: string, opts: any) => {
      watchCalls.push({ path, opts })
      return { on: vi.fn(), close: vi.fn(async () => {}) }
    }
  },
  watch: (path: string, opts: any) => { watchCalls.push({ path, opts }); return ({ on: vi.fn(), close: vi.fn(async () => {}) }) }
}))

// Mock electron windows
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: vi.fn(() => []) } }))

// Mock settings to return a fixed depth
vi.mock('./SettingsService', () => ({ settingsService: { getDirectoryWatchDepth: vi.fn(async () => 2) } }))

describe('DirectoryWatcherService depth setting', () => {
  beforeEach(() => { watchCalls.length = 0 })

  it('passes depth from settings into chokidar options', async () => {
    const mod = await import('./DirectoryWatcherService')
    const svc: any = mod.directoryWatcherService
    // mock webContents
    const wc: any = { id: 1 }
    await svc.watchDirectory('/proj', wc)
    expect(watchCalls[0]?.opts?.depth).toBe(2)
  })
})
