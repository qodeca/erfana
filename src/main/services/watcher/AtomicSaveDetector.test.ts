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

describe('AtomicSaveDetector', () => {
  let detector: AtomicSaveDetector

  beforeEach(() => {
    vi.useFakeTimers()
    detector = new AtomicSaveDetector()
    vi.clearAllMocks()
  })

  afterEach(() => {
    detector.dispose()
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

  // A stat that fails without saying the file is gone is asked once more (#252):
  // a file locked for a moment comes back, one still unreadable - on Windows,
  // deleted while another process held it open - is a delete
  describe('a stat that fails without saying the file is gone', () => {
    it.each(['EPERM', 'EBUSY', 'EACCES'])('counts %s that clears on the second look as an atomic save', async (code) => {
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

    it('counts ENOTDIR (a folder on the way is now a file) as gone', async () => {
      const callback = vi.fn()
      vi.mocked(fsPromises.stat).mockRejectedValue(errno('ENOTDIR'))

      detector.registerDelete('/test/file.txt', callback)
      await vi.advanceTimersByTimeAsync(110)

      expect(callback).toHaveBeenCalledWith('/test/file.txt', false)
    })
  })
})
