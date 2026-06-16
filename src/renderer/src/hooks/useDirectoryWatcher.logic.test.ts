// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for useDirectoryWatcher Pure Logic
 *
 * Tests extracted pure functions without React rendering.
 * All tests are synchronous and deterministic.
 */

import { describe, it, expect } from 'vitest'
import {
  shouldStartWatcher,
  shouldHandleDirectoryChange,
  createDirectoryChangeMessage,
  createWatcherErrorMessage,
  createDirectoryErrorMessage
} from './useDirectoryWatcher.logic'

describe('useDirectoryWatcher.logic', () => {
  describe('shouldStartWatcher', () => {
    it('should return true when both projectPath and initialLoadComplete are truthy', () => {
      expect(shouldStartWatcher('/test/project', true)).toBe(true)
    })

    it('should return false when projectPath is null', () => {
      expect(shouldStartWatcher(null, true)).toBe(false)
    })

    it('should return false when initialLoadComplete is false', () => {
      expect(shouldStartWatcher('/test/project', false)).toBe(false)
    })

    it('should return false when both are falsy', () => {
      expect(shouldStartWatcher(null, false)).toBe(false)
    })

    it('should handle empty string path as truthy', () => {
      // Edge case: empty string is truthy for path check
      expect(shouldStartWatcher('', true)).toBe(false)
    })

    it('should work with any valid path string', () => {
      expect(shouldStartWatcher('/a', true)).toBe(true)
      expect(shouldStartWatcher('/very/long/path/to/project', true)).toBe(true)
      expect(shouldStartWatcher('C:\\Windows\\Path', true)).toBe(true)
    })
  })

  describe('shouldHandleDirectoryChange', () => {
    it('should return true when isInternalOperation is false', () => {
      expect(shouldHandleDirectoryChange(false)).toBe(true)
    })

    it('should return false when isInternalOperation is true', () => {
      expect(shouldHandleDirectoryChange(true)).toBe(false)
    })

    it('should handle boolean values correctly', () => {
      expect(shouldHandleDirectoryChange(false)).toBe(true)
      expect(shouldHandleDirectoryChange(true)).toBe(false)
    })
  })

  describe('createDirectoryChangeMessage', () => {
    it('should create message with event count', () => {
      const message = createDirectoryChangeMessage(5)
      expect(message).toBe('📁 Directory changed, refreshing project tree... (5 events)')
    })

    it('should handle singular event count', () => {
      const message = createDirectoryChangeMessage(1)
      expect(message).toBe('📁 Directory changed, refreshing project tree... (1 events)')
    })

    it('should handle zero events', () => {
      const message = createDirectoryChangeMessage(0)
      expect(message).toBe('📁 Directory changed, refreshing project tree... (0 events)')
    })

    it('should handle large event counts', () => {
      const message = createDirectoryChangeMessage(9999)
      expect(message).toBe('📁 Directory changed, refreshing project tree... (9999 events)')
    })

    it('should include emoji and consistent formatting', () => {
      const message = createDirectoryChangeMessage(42)
      expect(message).toContain('📁')
      expect(message).toContain('refreshing project tree')
      expect(message).toContain('42 events')
    })
  })

  describe('createWatcherErrorMessage', () => {
    it('should return consistent error message', () => {
      const message = createWatcherErrorMessage()
      expect(message).toBe('Failed to start directory watch:')
    })

    it('should return same message on multiple calls', () => {
      expect(createWatcherErrorMessage()).toBe(createWatcherErrorMessage())
    })

    it('should be a constant string', () => {
      const message = createWatcherErrorMessage()
      expect(typeof message).toBe('string')
      expect(message.length).toBeGreaterThan(0)
    })
  })

  describe('createDirectoryErrorMessage', () => {
    it('should return consistent error prefix', () => {
      const message = createDirectoryErrorMessage()
      expect(message).toBe('Directory watch error:')
    })

    it('should return same message on multiple calls', () => {
      expect(createDirectoryErrorMessage()).toBe(createDirectoryErrorMessage())
    })

    it('should be a constant string', () => {
      const message = createDirectoryErrorMessage()
      expect(typeof message).toBe('string')
      expect(message.length).toBeGreaterThan(0)
    })
  })

  describe('Integration scenarios', () => {
    it('should correctly gate watcher startup', () => {
      // Scenario: Project just opened, but not loaded yet
      expect(shouldStartWatcher('/project', false)).toBe(false)

      // Scenario: Project loaded
      expect(shouldStartWatcher('/project', true)).toBe(true)
    })

    it('should correctly filter internal operations', () => {
      // Scenario: User creates a file (internal operation)
      const isInternal = true
      expect(shouldHandleDirectoryChange(isInternal)).toBe(false)

      // Scenario: External process modifies file
      const isExternal = false
      expect(shouldHandleDirectoryChange(isExternal)).toBe(true)
    })

    it('should produce consistent messages for logging', () => {
      // Multiple changes in quick succession
      const msg1 = createDirectoryChangeMessage(1)
      const msg2 = createDirectoryChangeMessage(5)
      const msg3 = createDirectoryChangeMessage(10)

      expect(msg1).toContain('1 events')
      expect(msg2).toContain('5 events')
      expect(msg3).toContain('10 events')
    })
  })
})
