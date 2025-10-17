import { describe, it, expect, vi, beforeEach } from 'vitest'

// Capture sends
const sends: Array<{ id: number; channel: string; payload: any }> = []

vi.mock('electron', () => {
  const mkWin = (id: number) => ({
    isDestroyed: () => false,
    webContents: { id, send: (ch: string, p: any) => sends.push({ id, channel: ch, payload: p }) }
  })
  return {
    BrowserWindow: {
      getAllWindows: vi.fn(() => [mkWin(1)])
    }
  }
})

describe('FileWatcherService session token guards', () => {
  beforeEach(() => {
    sends.length = 0
  })

  it('drops notifications from previous sessions', async () => {
    const mod = await import('./FileWatcherService')
    const svc: any = mod.fileWatcherService

    // Seed watched file with old version 0
    const fakeWatcher = { close: vi.fn(async () => {}) }
    svc.watchedFiles.set('/proj/readme.md', {
      filePath: '/proj/readme.md',
      watcher: fakeWatcher,
      webContentsIds: new Set([1]),
      isPaused: false,
      debounceTimer: null,
      version: 0
    })

    // Simulate project switch bumping session
    svc.switchVersion = 1

    // Attempt to notify via private API; should be ignored due to version mismatch
    svc.notifyWebContents('/proj/readme.md', 'file-watch:changed', { filePath: '/proj/readme.md' })

    expect(sends.length).toBe(0)
  })
})

