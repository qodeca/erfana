// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { GitEventCoalescer, classifyGitPath, type GitEventType } from './GitEventCoalescer'

describe('GitEventCoalescer', () => {
  let coalescer: GitEventCoalescer
  let callbackSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    callbackSpy = vi.fn()
    coalescer = new GitEventCoalescer(callbackSpy, 150)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('classifyGitPath', () => {
    it('should classify .git/index path', () => {
      expect(classifyGitPath('/project/.git/index')).toBe('index')
      expect(classifyGitPath('C:\\project\\.git\\index')).toBe('index')
    })

    it('should classify .git/HEAD path', () => {
      expect(classifyGitPath('/project/.git/HEAD')).toBe('head')
      expect(classifyGitPath('C:\\project\\.git\\HEAD')).toBe('head')
    })

    it('should classify .git/refs/heads/* path', () => {
      expect(classifyGitPath('/project/.git/refs/heads/main')).toBe('refs')
      expect(classifyGitPath('/project/.git/refs/heads/feature/branch')).toBe('refs')
      expect(classifyGitPath('C:\\project\\.git\\refs\\heads\\develop')).toBe('refs')
    })

    it('should classify .git/FETCH_HEAD path', () => {
      expect(classifyGitPath('/project/.git/FETCH_HEAD')).toBe('fetch')
      expect(classifyGitPath('C:\\project\\.git\\FETCH_HEAD')).toBe('fetch')
    })

    it('should classify .git/stash path', () => {
      expect(classifyGitPath('/project/.git/stash')).toBe('stash')
      expect(classifyGitPath('C:\\project\\.git\\stash')).toBe('stash')
    })

    it('should return null for unrecognized paths', () => {
      expect(classifyGitPath('/project/.git/config')).toBeNull()
      expect(classifyGitPath('/project/README.md')).toBeNull()
      expect(classifyGitPath('/project/.git/objects/abc')).toBeNull()
    })
  })

  describe('event coalescing', () => {
    it('should queue events without calling callback immediately', () => {
      coalescer.queueEvent('index')
      expect(callbackSpy).not.toHaveBeenCalled()
      expect(coalescer.hasPendingEvents()).toBe(true)
      expect(coalescer.getPendingCount()).toBe(1)
    })

    it('should coalesce events within 150ms window', () => {
      coalescer.queueEvent('index')
      vi.advanceTimersByTime(100)
      coalescer.queueEvent('head')
      vi.advanceTimersByTime(100)
      coalescer.queueEvent('refs')

      expect(callbackSpy).not.toHaveBeenCalled()

      // Advance past the window
      vi.advanceTimersByTime(150)

      expect(callbackSpy).toHaveBeenCalledTimes(1)
      expect(callbackSpy).toHaveBeenCalledWith(['index', 'head', 'refs'])
    })

    it('should deduplicate event types within window', () => {
      coalescer.queueEvent('index')
      coalescer.queueEvent('index')
      coalescer.queueEvent('index')

      vi.advanceTimersByTime(150)

      expect(callbackSpy).toHaveBeenCalledTimes(1)
      expect(callbackSpy).toHaveBeenCalledWith(['index'])
    })

    it('should emit separate events after window closes', () => {
      coalescer.queueEvent('index')
      vi.advanceTimersByTime(150)

      expect(callbackSpy).toHaveBeenCalledTimes(1)
      expect(callbackSpy).toHaveBeenCalledWith(['index'])

      callbackSpy.mockClear()

      coalescer.queueEvent('head')
      vi.advanceTimersByTime(150)

      expect(callbackSpy).toHaveBeenCalledTimes(1)
      expect(callbackSpy).toHaveBeenCalledWith(['head'])
    })

    it('should reset window on each new event (debounce pattern)', () => {
      coalescer.queueEvent('index')
      vi.advanceTimersByTime(100)

      coalescer.queueEvent('head')
      vi.advanceTimersByTime(100)

      coalescer.queueEvent('refs')
      vi.advanceTimersByTime(100)

      // Still no callback, window keeps resetting
      expect(callbackSpy).not.toHaveBeenCalled()

      // Now wait the full window
      vi.advanceTimersByTime(150)

      expect(callbackSpy).toHaveBeenCalledTimes(1)
      expect(callbackSpy).toHaveBeenCalledWith(['index', 'head', 'refs'])
    })
  })

  describe('flush', () => {
    it('should flush pending events immediately', () => {
      coalescer.queueEvent('index')
      coalescer.queueEvent('head')

      coalescer.flush()

      expect(callbackSpy).toHaveBeenCalledTimes(1)
      expect(callbackSpy).toHaveBeenCalledWith(['index', 'head'])
      expect(coalescer.hasPendingEvents()).toBe(false)
    })

    it('should clear timer when flushed', () => {
      coalescer.queueEvent('index')
      coalescer.flush()

      callbackSpy.mockClear()

      // Advance timers - should not trigger callback again
      vi.advanceTimersByTime(150)

      expect(callbackSpy).not.toHaveBeenCalled()
    })

    it('should do nothing if no pending events', () => {
      coalescer.flush()

      expect(callbackSpy).not.toHaveBeenCalled()
    })

    it('should handle callback errors gracefully', () => {
      const errorCallback = vi.fn().mockImplementation(() => {
        throw new Error('Callback error')
      })
      const errorCoalescer = new GitEventCoalescer(errorCallback, 150)

      errorCoalescer.queueEvent('index')

      // Should not throw
      expect(() => errorCoalescer.flush()).not.toThrow()
    })
  })

  describe('clear', () => {
    it('should clear pending events without calling callback', () => {
      coalescer.queueEvent('index')
      coalescer.queueEvent('head')

      coalescer.clear()

      expect(callbackSpy).not.toHaveBeenCalled()
      expect(coalescer.hasPendingEvents()).toBe(false)
      expect(coalescer.getPendingCount()).toBe(0)
    })

    it('should clear timer', () => {
      coalescer.queueEvent('index')
      coalescer.clear()

      vi.advanceTimersByTime(150)

      expect(callbackSpy).not.toHaveBeenCalled()
    })
  })

  describe('dispose', () => {
    it('should clear all state and prevent further events', () => {
      coalescer.queueEvent('index')
      coalescer.dispose()

      expect(coalescer.hasPendingEvents()).toBe(false)

      // Should not queue new events after dispose
      coalescer.queueEvent('head')

      vi.advanceTimersByTime(150)

      expect(callbackSpy).not.toHaveBeenCalled()
      expect(coalescer.hasPendingEvents()).toBe(false)
    })

    it('should prevent flush after dispose', () => {
      coalescer.queueEvent('index')
      coalescer.dispose()

      coalescer.flush()

      expect(callbackSpy).not.toHaveBeenCalled()
    })
  })

  describe('hasPendingEvents and getPendingCount', () => {
    it('should track pending state correctly', () => {
      expect(coalescer.hasPendingEvents()).toBe(false)
      expect(coalescer.getPendingCount()).toBe(0)

      coalescer.queueEvent('index')

      expect(coalescer.hasPendingEvents()).toBe(true)
      expect(coalescer.getPendingCount()).toBe(1)

      coalescer.queueEvent('head')

      expect(coalescer.getPendingCount()).toBe(2)

      coalescer.flush()

      expect(coalescer.hasPendingEvents()).toBe(false)
      expect(coalescer.getPendingCount()).toBe(0)
    })
  })

  describe('custom window duration', () => {
    it('should respect custom coalescing window', () => {
      const customCoalescer = new GitEventCoalescer(callbackSpy, 300)

      customCoalescer.queueEvent('index')
      vi.advanceTimersByTime(150)

      expect(callbackSpy).not.toHaveBeenCalled()

      vi.advanceTimersByTime(150)

      expect(callbackSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe('all event types', () => {
    it('should handle all 5 event types', () => {
      const eventTypes: GitEventType[] = ['index', 'head', 'refs', 'fetch', 'stash']

      eventTypes.forEach((type) => coalescer.queueEvent(type))

      vi.advanceTimersByTime(150)

      expect(callbackSpy).toHaveBeenCalledTimes(1)
      expect(callbackSpy).toHaveBeenCalledWith(eventTypes)
    })
  })
})
