// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for withWatcherPause Higher-Order Function
 *
 * Tests the watcher pause/resume logic wrapper that prevents false-positive
 * refresh events during internal file operations.
 *
 * Covers:
 * - Success path: pause → operation → resume
 * - Error handling: resume even on operation failure
 * - Edge cases: null projectPath, async operations, ref state
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { withWatcherPause } from './withWatcherPause'

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn()
  }
}))

vi.mock('../../utils/logger', () => ({ logger: mockLogger }))

// Mock window.api
const mockWindowApi = {
  directoryWatch: {
    pause: vi.fn().mockResolvedValue({ success: true }),
    resume: vi.fn().mockResolvedValue({ success: true })
  }
}

global.window = {
  ...global.window,
  api: mockWindowApi
} as unknown as Window & typeof globalThis

describe('withWatcherPause', () => {
  let isInternalOperationRef: React.MutableRefObject<boolean>
  let setLoading: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    isInternalOperationRef = { current: false }
    setLoading = vi.fn()
  })

  describe('Success path', () => {
    it('should pause watcher before operation', async () => {
      const operation = vi.fn().mockResolvedValue('result')

      await withWatcherPause('/test/project', isInternalOperationRef, setLoading, operation)

      expect(mockWindowApi.directoryWatch.pause).toHaveBeenCalledWith('/test/project')
      expect(mockWindowApi.directoryWatch.pause).toHaveBeenCalled()
    })

    it('should execute operation and return result', async () => {
      const operation = vi.fn().mockResolvedValue('test-result')

      const result = await withWatcherPause('/test/project', isInternalOperationRef, setLoading, operation)

      expect(operation).toHaveBeenCalled()
      expect(result).toBe('test-result')
    })

    it('should resume watcher after operation', async () => {
      const operation = vi.fn().mockResolvedValue('result')

      await withWatcherPause('/test/project', isInternalOperationRef, setLoading, operation)

      expect(mockWindowApi.directoryWatch.resume).toHaveBeenCalledWith('/test/project')
    })

    it('should set loading states correctly (true → false)', async () => {
      const operation = vi.fn().mockResolvedValue('result')

      await withWatcherPause('/test/project', isInternalOperationRef, setLoading, operation)

      // Should be called twice: once with true, once with false
      expect(setLoading).toHaveBeenCalledTimes(2)
      expect(setLoading).toHaveBeenNthCalledWith(1, true)
      expect(setLoading).toHaveBeenNthCalledWith(2, false)
    })
  })

  describe('Error handling', () => {
    it('should resume watcher even when operation throws', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Operation failed'))

      await expect(
        withWatcherPause('/test/project', isInternalOperationRef, setLoading, operation)
      ).rejects.toThrow('Operation failed')

      expect(mockWindowApi.directoryWatch.resume).toHaveBeenCalledWith('/test/project')
    })

    it('should re-throw original error after cleanup', async () => {
      const testError = new Error('Test error')
      const operation = vi.fn().mockRejectedValue(testError)

      await expect(
        withWatcherPause('/test/project', isInternalOperationRef, setLoading, operation)
      ).rejects.toThrow('Test error')
    })

    it('should set loading to false even on error', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Error'))

      await expect(
        withWatcherPause('/test/project', isInternalOperationRef, setLoading, operation)
      ).rejects.toThrow()

      // Should still set loading to false in finally block
      expect(setLoading).toHaveBeenLastCalledWith(false)
    })

    it('should handle resume failure gracefully when operation fails', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Operation failed'))
      mockWindowApi.directoryWatch.resume.mockRejectedValueOnce(new Error('Resume failed'))

      mockLogger.error.mockClear()

      await expect(
        withWatcherPause('/test/project', isInternalOperationRef, setLoading, operation)
      ).rejects.toThrow('Operation failed')

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to resume directory watcher', expect.any(Error))
    })
  })

  describe('Edge cases', () => {
    it('should work when projectPath is null', async () => {
      const operation = vi.fn().mockResolvedValue('result')

      const result = await withWatcherPause(null, isInternalOperationRef, setLoading, operation)

      expect(result).toBe('result')
      expect(operation).toHaveBeenCalled()
    })

    it('should not call pause/resume when projectPath is null', async () => {
      const operation = vi.fn().mockResolvedValue('result')

      await withWatcherPause(null, isInternalOperationRef, setLoading, operation)

      expect(mockWindowApi.directoryWatch.pause).not.toHaveBeenCalled()
      expect(mockWindowApi.directoryWatch.resume).not.toHaveBeenCalled()
    })

    it('should handle async operations correctly', async () => {
      const operation = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return 'async-result'
      })

      const result = await withWatcherPause('/test/project', isInternalOperationRef, setLoading, operation)

      expect(result).toBe('async-result')
      expect(mockWindowApi.directoryWatch.pause).toHaveBeenCalled()
      expect(mockWindowApi.directoryWatch.resume).toHaveBeenCalled()
    })

    it('should preserve isInternalOperation state on error', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Error'))

      expect(isInternalOperationRef.current).toBe(false)

      await expect(
        withWatcherPause('/test/project', isInternalOperationRef, setLoading, operation)
      ).rejects.toThrow()

      // Should be reset to false even after error
      expect(isInternalOperationRef.current).toBe(false)
    })
  })

  describe('Ref mutations', () => {
    it('should set isInternalOperation to true before operation', async () => {
      const operation = vi.fn().mockImplementation(() => {
        // Check ref state during operation
        expect(isInternalOperationRef.current).toBe(true)
        return 'result'
      })

      await withWatcherPause('/test/project', isInternalOperationRef, setLoading, operation)
    })

    it('should reset isInternalOperation to false after success', async () => {
      const operation = vi.fn().mockResolvedValue('result')

      expect(isInternalOperationRef.current).toBe(false)

      await withWatcherPause('/test/project', isInternalOperationRef, setLoading, operation)

      expect(isInternalOperationRef.current).toBe(false)
    })

    it('should reset isInternalOperation to false after error', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Error'))

      expect(isInternalOperationRef.current).toBe(false)

      await expect(
        withWatcherPause('/test/project', isInternalOperationRef, setLoading, operation)
      ).rejects.toThrow()

      expect(isInternalOperationRef.current).toBe(false)
    })
  })

  describe('Call order verification', () => {
    it('should execute in correct order: setLoading(true) → pause → operation → resume → setLoading(false)', async () => {
      const callOrder: string[] = []

      setLoading.mockImplementation((loading) => {
        callOrder.push(`setLoading(${loading})`)
      })

      mockWindowApi.directoryWatch.pause.mockImplementation(async () => {
        callOrder.push('pause')
        return { success: true }
      })

      mockWindowApi.directoryWatch.resume.mockImplementation(async () => {
        callOrder.push('resume')
        return { success: true }
      })

      const operation = vi.fn().mockImplementation(() => {
        callOrder.push('operation')
        return 'result'
      })

      await withWatcherPause('/test/project', isInternalOperationRef, setLoading, operation)

      expect(callOrder).toEqual([
        'setLoading(true)',
        'pause',
        'operation',
        'resume',
        'setLoading(false)'
      ])
    })

    it('resets isInternalOperationRef to false BEFORE calling resume (AC-010)', async () => {
      let refValueWhenResumeWasCalled: boolean | undefined

      mockWindowApi.directoryWatch.resume.mockImplementation(async () => {
        // Capture the ref value at the moment resume is called
        refValueWhenResumeWasCalled = isInternalOperationRef.current
        return { success: true }
      })

      const operation = vi.fn().mockResolvedValue('result')

      await withWatcherPause('/test/project', isInternalOperationRef, setLoading, operation)

      // The ref must be false BEFORE resume is called
      // This prevents a race where watcher events fire between resume and ref reset
      expect(refValueWhenResumeWasCalled).toBe(false)
    })
  })
})
