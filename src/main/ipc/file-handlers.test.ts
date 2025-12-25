import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mocks for electron BrowserWindow
const sends: Array<{ idx: number; channel: string; payload: unknown }> = []

vi.mock('electron', () => {
  const mkWin = (idx: number, destroyed = false) => ({
    isDestroyed: () => destroyed,
    webContents: {
      send: (channel: string, payload: unknown) => {
        sends.push({ idx, channel, payload })
      }
    }
  })
  return {
    BrowserWindow: {
      getAllWindows: vi.fn(() => [mkWin(0), mkWin(1), mkWin(2, true)])
    }
  }
})

// Mock electron-store used by SettingsService to avoid projectName error
vi.mock('electron-store', () => {
  class MockStore {
    constructor(_opts?: any) {}
    get(_key: string, _def?: any): any { return null }
    set(_key: string, _val: any): void {}
    delete(_key: string): void {}
  }
  return { default: MockStore }
})

// Mock ProjectLockService to avoid app.getPath dependency
vi.mock('../services/ProjectLockService', () => ({
  projectLockService: {
    acquireLock: vi.fn(async () => ({ status: 'acquired' })),
    releaseLock: vi.fn(async () => {}),
    checkLock: vi.fn(async () => ({ status: 'unlocked' })),
    requestFocus: vi.fn(async () => true),
    cleanupStaleLocks: vi.fn(async () => 0),
    dispose: vi.fn(async () => {})
  }
}))

describe('broadcastProjectChanged', () => {
  beforeEach(() => {
    sends.length = 0
  })
  afterEach(() => {
    vi.resetModules()
  })

  it('sends project:changed to all non-destroyed windows', async () => {
    const { broadcastProjectChanged } = await import('./file-handlers')

    const payload = { oldPath: '/old', newPath: '/new' }
    broadcastProjectChanged(payload)

    // Should send to window 0 and 1, skip 2 (destroyed)
    expect(sends).toHaveLength(2)
    expect(sends[0]).toMatchObject({ idx: 0, channel: 'project:changed', payload })
    expect(sends[1]).toMatchObject({ idx: 1, channel: 'project:changed', payload })
  })
})
