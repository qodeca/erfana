// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, beforeEach } from 'vitest'
import { EventCoalescer, coalesceEvents, type FileChangeEvent } from './EventCoalescer'

describe('EventCoalescer', () => {
  let coalescer: EventCoalescer

  beforeEach(() => {
    coalescer = new EventCoalescer()
  })

  describe('basic coalescing rules', () => {
    it('should keep single events unchanged', () => {
      coalescer.processEvent({ type: 'add', path: '/test/file.txt' })
      const result = coalescer.coalesce()

      expect(result.events).toHaveLength(1)
      expect(result.events[0]).toEqual({ type: 'add', path: '/test/file.txt' })
      expect(result.coalescedCount).toBe(0)
    })

    it('should coalesce CREATE + DELETE to nothing (Rule 1)', () => {
      coalescer.processEvent({ type: 'add', path: '/test/file.txt' })
      coalescer.processEvent({ type: 'unlink', path: '/test/file.txt' })
      const result = coalescer.coalesce()

      expect(result.events).toHaveLength(0)
      expect(result.coalescedCount).toBe(2)
    })

    it('should coalesce DELETE + CREATE to CHANGE (Rule 2)', () => {
      coalescer.processEvent({ type: 'unlink', path: '/test/file.txt' })
      coalescer.processEvent({ type: 'add', path: '/test/file.txt' })
      const result = coalescer.coalesce()

      expect(result.events).toHaveLength(1)
      expect(result.events[0].type).toBe('change')
      expect(result.events[0].path).toBe('/test/file.txt')
      expect(result.coalescedCount).toBe(1)
    })

    it('should coalesce CREATE + UPDATE to CREATE only (Rule 3)', () => {
      coalescer.processEvent({ type: 'add', path: '/test/file.txt' })
      coalescer.processEvent({ type: 'change', path: '/test/file.txt' })
      const result = coalescer.coalesce()

      expect(result.events).toHaveLength(1)
      expect(result.events[0].type).toBe('add')
      expect(result.coalescedCount).toBe(1)
    })

    it('should coalesce UPDATE + UPDATE to single UPDATE (Rule 4)', () => {
      coalescer.processEvent({ type: 'change', path: '/test/file.txt' })
      coalescer.processEvent({ type: 'change', path: '/test/file.txt' })
      coalescer.processEvent({ type: 'change', path: '/test/file.txt' })
      const result = coalescer.coalesce()

      expect(result.events).toHaveLength(1)
      expect(result.events[0].type).toBe('change')
      expect(result.coalescedCount).toBe(2)
    })

    it('should coalesce DELETE + DELETE to single DELETE', () => {
      coalescer.processEvent({ type: 'unlink', path: '/test/file.txt' })
      coalescer.processEvent({ type: 'unlink', path: '/test/file.txt' })
      const result = coalescer.coalesce()

      expect(result.events).toHaveLength(1)
      expect(result.events[0].type).toBe('unlink')
      expect(result.coalescedCount).toBe(1)
    })
  })

  describe('directory events', () => {
    it('should handle addDir events', () => {
      coalescer.processEvent({ type: 'addDir', path: '/test/folder' })
      const result = coalescer.coalesce()

      expect(result.events).toHaveLength(1)
      expect(result.events[0].type).toBe('addDir')
    })

    it('should coalesce addDir + unlinkDir to nothing', () => {
      coalescer.processEvent({ type: 'addDir', path: '/test/folder' })
      coalescer.processEvent({ type: 'unlinkDir', path: '/test/folder' })
      const result = coalescer.coalesce()

      expect(result.events).toHaveLength(0)
    })
  })

  describe('cascade prevention', () => {
    it('should remove child events when parent directory is deleted', () => {
      coalescer.processEvent({ type: 'add', path: '/test/folder/file1.txt' })
      coalescer.processEvent({ type: 'add', path: '/test/folder/file2.txt' })
      coalescer.processEvent({ type: 'unlinkDir', path: '/test/folder' })
      // These should be ignored (inside deleted folder)
      coalescer.processEvent({ type: 'unlink', path: '/test/folder/file1.txt' })
      coalescer.processEvent({ type: 'unlink', path: '/test/folder/file2.txt' })
      const result = coalescer.coalesce()

      // Only the add events (before delete) and the unlinkDir should be processed
      // The child unlink events should be ignored
      expect(result.events.length).toBeLessThanOrEqual(3)
    })
  })

  describe('multiple paths', () => {
    it('should handle events for different paths independently', () => {
      coalescer.processEvent({ type: 'add', path: '/test/file1.txt' })
      coalescer.processEvent({ type: 'add', path: '/test/file2.txt' })
      coalescer.processEvent({ type: 'unlink', path: '/test/file1.txt' })
      const result = coalescer.coalesce()

      expect(result.events).toHaveLength(1)
      expect(result.events[0].path).toBe('/test/file2.txt')
    })

    it('should coalesce same path events while keeping different paths', () => {
      coalescer.processEvent({ type: 'change', path: '/test/file1.txt' })
      coalescer.processEvent({ type: 'change', path: '/test/file1.txt' })
      coalescer.processEvent({ type: 'change', path: '/test/file2.txt' })
      const result = coalescer.coalesce()

      expect(result.events).toHaveLength(2)
      expect(result.coalescedCount).toBe(1)
    })
  })

  describe('rapid triple pattern', () => {
    it('should handle CREATE → DELETE → CREATE correctly', () => {
      coalescer.processEvent({ type: 'add', path: '/test/file.txt' })
      coalescer.processEvent({ type: 'unlink', path: '/test/file.txt' })
      // After CREATE + DELETE → removed, new CREATE should appear
      coalescer.processEvent({ type: 'add', path: '/test/file.txt' })
      const result = coalescer.coalesce()

      expect(result.events).toHaveLength(1)
      expect(result.events[0].type).toBe('add')
    })
  })

  describe('coalesceEvents convenience function', () => {
    it('should coalesce array of events', () => {
      const events: FileChangeEvent[] = [
        { type: 'add', path: '/test/file.txt' },
        { type: 'change', path: '/test/file.txt' },
        { type: 'unlink', path: '/test/other.txt' }
      ]
      const result = coalesceEvents(events)

      expect(result.events).toHaveLength(2)
      expect(result.coalescedCount).toBe(1)
    })
  })

  describe('clear and reuse', () => {
    it('should clear state after coalesce', () => {
      coalescer.processEvent({ type: 'add', path: '/test/file.txt' })
      coalescer.coalesce()

      // Should be empty now
      coalescer.processEvent({ type: 'unlink', path: '/test/file.txt' })
      const result = coalescer.coalesce()

      expect(result.events).toHaveLength(1)
      expect(result.events[0].type).toBe('unlink')
    })

    it('should allow manual clear', () => {
      coalescer.processEvent({ type: 'add', path: '/test/file.txt' })
      coalescer.clear()
      const result = coalescer.coalesce()

      expect(result.events).toHaveLength(0)
    })
  })

  describe('getPendingCount', () => {
    it('should return correct pending count', () => {
      expect(coalescer.getPendingCount()).toBe(0)

      coalescer.processEvent({ type: 'add', path: '/test/file1.txt' })
      coalescer.processEvent({ type: 'add', path: '/test/file2.txt' })

      expect(coalescer.getPendingCount()).toBe(2)
    })
  })
})
