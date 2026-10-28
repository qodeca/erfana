// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { AtomicSaveDetector } from './AtomicSaveDetector'
import { UNREADABLE_RECHECK_MS } from './pathPresence'
import * as fs from 'fs'
import * as fsPromises from 'fs/promises'

// Mock fs modules
vi.mock('fs', () => ({
  existsSync: vi.fn()
}))

vi.mock('fs/promises', () => ({
  stat: vi.fn()
}))

/** A `stat` failure the way Node reports it: the errno name in `code`. */
const errno = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code })

const hostPlatform = process.platform

/** Play another host: the Windows delete-pending rule reads the platform per call. */
function stubPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value, configurable: true })
}

function restorePlatform(): void {
  Object.defineProperty(process, 'platform', { value: hostPlatform, configurable: true })
}

describe('AtomicSaveDetector', () => {
  let detector: AtomicSaveDetector

  beforeEach(() => {
    vi.useFakeTimers()
    detector = new AtomicSaveDetector()
    vi.clearAllMocks()
  })

  afterEach(() => {
    detector.dispose()
    restorePlatform()
    vi.useRealTimers()
  })

  describe('atomic save detection', () => {
    it('should detect atomic save when file reappears', async () => {
      const callback = vi.fn()

      // File will exist after 100ms (atomic save pattern)
      vi.mocked(fsPromises.stat).mockResolvedValue({} as any)

      detector.registerDelete('/test/file.txt', callback)

      expect(callback).not.toHaveBeenCalled()

      // Advance past 100ms delay
      await vi.advanceTimersByTimeAsync(110)

      expect(callback).toHaveBeenCalledWith('/test/file.txt', true)
    })

    it('should detect actual delete when file does not reappear', async () => {
      const callback = vi.fn()

      // File will not exist (actual delete)
      vi.mocked(fsPromises.stat).mockRejectedValue(errno('ENOENT'))
      vi.mocked(fs.existsSync).mockReturnValue(false)

      detector.registerDelete('/test/file.txt', callback)

      await vi.advanceTimersByTimeAsync(110)

      expect(callback).toHaveBeenCalledWith('/test/file.txt', false)
    })
  })

  describe('pending management', () => {
    it('should track pending deletes', () => {
      const callback = vi.fn()

      expect(detector.hasPending('/test/file.txt')).toBe(false)

      detector.registerDelete('/test/file.txt', callback)

      expect(detector.hasPending('/test/file.txt')).toBe(true)
    })

    it('should return correct pending count', () => {
      const callback = vi.fn()

      expect(detector.getPendingCount()).toBe(0)

      detector.registerDelete('/test/file1.txt', callback)
      detector.registerDelete('/test/file2.txt', callback)

      expect(detector.getPendingCount()).toBe(2)
    })

    it('should cancel pending delete', async () => {
      const callback = vi.fn()
      vi.mocked(fsPromises.stat).mockResolvedValue({} as any)

      detector.registerDelete('/test/file.txt', callback)
      detector.cancelPending('/test/file.txt')

      await vi.advanceTimersByTimeAsync(110)

      expect(callback).not.toHaveBeenCalled()
      expect(detector.hasPending('/test/file.txt')).toBe(false)
    })

    it('should cancel all pending deletes', async () => {
      const callback = vi.fn()
      vi.mocked(fsPromises.stat).mockResolvedValue({} as any)

      detector.registerDelete('/test/file1.txt', callback)
      detector.registerDelete('/test/file2.txt', callback)
      detector.cancelAll()

      await vi.advanceTimersByTimeAsync(110)

      expect(callback).not.toHaveBeenCalled()
      expect(detector.getPendingCount()).toBe(0)
    })
  })

  describe('replace pending', () => {
    it('should replace existing pending delete for same path', async () => {
      const callback1 = vi.fn()
      const callback2 = vi.fn()
      vi.mocked(fsPromises.stat).mockResolvedValue({} as any)

      detector.registerDelete('/test/file.txt', callback1)
      detector.registerDelete('/test/file.txt', callback2)

      await vi.advanceTimersByTimeAsync(110)

      // Only second callback should be called
      expect(callback1).not.toHaveBeenCalled()
      expect(callback2).toHaveBeenCalledWith('/test/file.txt', true)
    })
  })

  describe('dispose', () => {
    it('should not call callbacks after dispose', async () => {
      const callback = vi.fn()
      vi.mocked(fsPromises.stat).mockResolvedValue({} as any)

      detector.registerDelete('/test/file.txt', callback)
      detector.dispose()

      await vi.advanceTimersByTimeAsync(110)

      expect(callback).not.toHaveBeenCalled()
    })

    it('should not accept new deletes after dispose', async () => {
      const callback = vi.fn()
      vi.mocked(fsPromises.stat).mockResolvedValue({} as any)

      detector.dispose()
      detector.registerDelete('/test/file.txt', callback)

      await vi.advanceTimersByTimeAsync(110)

      expect(callback).not.toHaveBeenCalled()
      expect(detector.getPendingCount()).toBe(0)
    })
  })

  describe('no sync fallback', () => {
    it('treats a missing file as a delete without a sync existsSync on the main thread', async () => {
      const callback = vi.fn()

      // async stat says gone; the old code then asked existsSync, which answered true
      vi.mocked(fsPromises.stat).mockRejectedValue(errno('ENOENT'))
      vi.mocked(fs.existsSync).mockReturnValue(true)

      detector.registerDelete('/test/file.txt', callback)

      await vi.advanceTimersByTimeAsync(110)

      expect(callback).toHaveBeenCalledWith('/test/file.txt', false)
      expect(fs.existsSync).not.toHaveBeenCalled()
    })
  })

  // A stat that fails without saying the file is gone means the file is there
  // (#252) - except on Windows, where EPERM or EBUSY is asked once more: a file
  // locked for a moment comes back, one deleted while another process holds it
  // open keeps answering that way and is a delete
  describe('a stat that fails without saying the file is gone', () => {
    describe('on Windows', () => {
      beforeEach(() => stubPlatform('win32'))

      it.each(['EPERM', 'EBUSY'])('counts %s that clears on the second look as an atomic save', async (code) => {
        const callback = vi.fn()
        vi.mocked(fsPromises.stat).mockRejectedValueOnce(errno(code)).mockResolvedValue({} as never)

        detector.registerDelete('/test/file.txt', callback)
        await vi.advanceTimersByTimeAsync(110)
        expect(callback).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(UNREADABLE_RECHECK_MS)

        expect(callback).toHaveBeenCalledWith('/test/file.txt', true)
      })

      it.each(['EPERM', 'EBUSY'])('counts %s that is still there on the second look as a delete', async (code) => {
        const callback = vi.fn()
        vi.mocked(fsPromises.stat).mockRejectedValue(errno(code))

        detector.registerDelete('/test/file.txt', callback)
        await vi.advanceTimersByTimeAsync(110 + UNREADABLE_RECHECK_MS)

        expect(callback).toHaveBeenCalledWith('/test/file.txt', false)
        expect(fsPromises.stat).toHaveBeenCalledTimes(2)
      })

      it.each(['EACCES', 'EIO'])('counts %s as an atomic save without a second look', async (code) => {
        const callback = vi.fn()
        vi.mocked(fsPromises.stat).mockRejectedValue(errno(code))

        detector.registerDelete('/test/file.txt', callback)
        await vi.advanceTimersByTimeAsync(110)

        expect(callback).toHaveBeenCalledWith('/test/file.txt', true)
        expect(fsPromises.stat).toHaveBeenCalledTimes(1)
      })
    })

    describe.each(['darwin', 'linux'] as const)('on %s', (platform) => {
      beforeEach(() => stubPlatform(platform))

      it.each(['EPERM', 'EBUSY', 'EACCES', 'EIO'])('counts %s as an atomic save without a second look', async (code) => {
        const callback = vi.fn()
        vi.mocked(fsPromises.stat).mockRejectedValue(errno(code))

        detector.registerDelete('/test/file.txt', callback)
        await vi.advanceTimersByTimeAsync(110)

        expect(callback).toHaveBeenCalledWith('/test/file.txt', true)
        expect(fsPromises.stat).toHaveBeenCalledTimes(1)
      })
    })

    it('counts ENOTDIR (a folder on the way is now a file) as gone', async () => {
      const callback = vi.fn()
      vi.mocked(fsPromises.stat).mockRejectedValue(errno('ENOTDIR'))

      detector.registerDelete('/test/file.txt', callback)
      await vi.advanceTimersByTimeAsync(110)

      expect(callback).toHaveBeenCalledWith('/test/file.txt', false)
    })
  })

  // The check itself can wait for a second look, so whatever ends a pending
  // delete must also reach one whose check is already running: its late
  // verdict would re-arm or delete a watch that is no longer the one it was
  // about (#252 review)
  describe('a check still waiting for its second look', () => {
    beforeEach(() => {
      stubPlatform('win32')
      // First look: a possible delete pending, so the check waits; second: back
      vi.mocked(fsPromises.stat).mockRejectedValueOnce(errno('EPERM')).mockResolvedValue({} as never)
    })

    it('is still pending, so a consumer joining now can resolve it', async () => {
      detector.registerDelete('/test/file.txt', vi.fn())
      await vi.advanceTimersByTimeAsync(110)

      expect(detector.hasPending('/test/file.txt')).toBe(true)
      expect(detector.getPendingCount()).toBe(1)
    })

    it('reports nothing once cancelled', async () => {
      const callback = vi.fn()
      detector.registerDelete('/test/file.txt', callback)
      await vi.advanceTimersByTimeAsync(110)

      detector.cancelPending('/test/file.txt')
      await vi.advanceTimersByTimeAsync(UNREADABLE_RECHECK_MS)

      expect(callback).not.toHaveBeenCalled()
      expect(detector.getPendingCount()).toBe(0)
    })

    it('reports nothing once every check is cancelled', async () => {
      const callback = vi.fn()
      detector.registerDelete('/test/file.txt', callback)
      await vi.advanceTimersByTimeAsync(110)

      detector.cancelAll()
      await vi.advanceTimersByTimeAsync(UNREADABLE_RECHECK_MS)

      expect(callback).not.toHaveBeenCalled()
    })

    it('reports nothing once the detector is disposed', async () => {
      const callback = vi.fn()
      detector.registerDelete('/test/file.txt', callback)
      await vi.advanceTimersByTimeAsync(110)

      detector.dispose()
      await vi.advanceTimersByTimeAsync(UNREADABLE_RECHECK_MS)

      expect(callback).not.toHaveBeenCalled()
    })

    it('gives way to a newer delete of the same path', async () => {
      const stale = vi.fn()
      const fresh = vi.fn()
      detector.registerDelete('/test/file.txt', stale)
      await vi.advanceTimersByTimeAsync(110)

      detector.registerDelete('/test/file.txt', fresh)
      await vi.advanceTimersByTimeAsync(110 + UNREADABLE_RECHECK_MS)

      expect(stale).not.toHaveBeenCalled()
      expect(fresh).toHaveBeenCalledTimes(1)
      expect(fresh).toHaveBeenCalledWith('/test/file.txt', true)
      expect(detector.getPendingCount()).toBe(0)
    })
  })
})
