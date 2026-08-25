// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * PreviewFailureLog tests (Issue #74, work item 15).
 *
 * Covers ring-buffer eviction + `truncated` latching, Cf/Cc stripping of
 * page-authored `resourceUrlOrHost`, and coalesced emission (<= 1 emit per
 * window, always trailing the latest snapshot) under fake timers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PreviewFailureLog } from './PreviewFailureLog'
import { ErrorCode } from '../../../shared/errors'
import type { PreviewFailureInput } from '../../../shared/ipc/preview-types'

function input(overrides: Partial<PreviewFailureInput> = {}): PreviewFailureInput {
  return {
    type: 'blocked-host',
    resourceUrlOrHost: 'evil.example',
    reasonCode: ErrorCode.UNKNOWN_ERROR,
    ...overrides
  }
}

describe('PreviewFailureLog', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('record + Cf/Cc stripping', () => {
    it('stamps a timestamp and strips bidi/zero-width/control chars', () => {
      const onEmit = vi.fn()
      const log = new PreviewFailureLog({ onEmit, now: () => 1234 })

      // Bidi override (U+202E, Cf), zero-width space (U+200B, Cf), NUL
      // (U+0000, Cc) and a C1 control NEL (U+0085, Cc) between legible chars.
      const dirty = 'a\u202Eb\u200Bc\u0000d\u0085.example'
      log.record(input({ resourceUrlOrHost: dirty }))

      const [entry] = log.list()
      expect(entry.resourceUrlOrHost).toBe('abcd.example')
      expect(entry.timestamp).toBe(1234)
      expect(entry.type).toBe('blocked-host')
    })

    it('leaves ordinary hostnames untouched', () => {
      const log = new PreviewFailureLog({ onEmit: vi.fn() })
      log.record(input({ resourceUrlOrHost: 'cdn.jsdelivr.net' }))
      expect(log.list()[0].resourceUrlOrHost).toBe('cdn.jsdelivr.net')
    })
  })

  describe('ring buffer', () => {
    it('evicts the oldest entry at capacity and latches truncated', () => {
      const onEmit = vi.fn()
      const log = new PreviewFailureLog({ onEmit, capacity: 3 })

      for (let i = 0; i < 5; i++) {
        log.record(input({ resourceUrlOrHost: `h${i}.example` }))
      }

      const entries = log.list()
      expect(entries).toHaveLength(3)
      // Oldest (h0, h1) evicted; newest three retained in order.
      expect(entries.map((e) => e.resourceUrlOrHost)).toEqual([
        'h2.example',
        'h3.example',
        'h4.example'
      ])

      vi.runAllTimers()
      expect(onEmit).toHaveBeenLastCalledWith(expect.any(Array), true)
    })

    it('does not latch truncated below capacity', () => {
      const onEmit = vi.fn()
      const log = new PreviewFailureLog({ onEmit, capacity: 3 })
      log.record(input())
      log.record(input())
      vi.runAllTimers()
      expect(onEmit).toHaveBeenLastCalledWith(expect.any(Array), false)
    })
  })

  describe('coalesced emission', () => {
    it('emits at most once per window with a trailing snapshot', () => {
      const onEmit = vi.fn()
      const log = new PreviewFailureLog({ onEmit, coalesceMs: 250 })

      log.record(input({ resourceUrlOrHost: 'a.example' }))
      log.record(input({ resourceUrlOrHost: 'b.example' }))
      log.record(input({ resourceUrlOrHost: 'c.example' }))

      // Nothing emitted synchronously (coalescing).
      expect(onEmit).not.toHaveBeenCalled()

      vi.advanceTimersByTime(249)
      expect(onEmit).not.toHaveBeenCalled()

      vi.advanceTimersByTime(1)
      // Exactly one trailing emit with all three entries.
      expect(onEmit).toHaveBeenCalledTimes(1)
      const [failures] = onEmit.mock.calls[0]
      expect(failures).toHaveLength(3)
      expect(failures.map((f: { resourceUrlOrHost: string }) => f.resourceUrlOrHost)).toEqual([
        'a.example',
        'b.example',
        'c.example'
      ])
    })

    it('opens a fresh window for records after a flush', () => {
      const onEmit = vi.fn()
      const log = new PreviewFailureLog({ onEmit, coalesceMs: 250 })

      log.record(input())
      vi.advanceTimersByTime(250)
      expect(onEmit).toHaveBeenCalledTimes(1)

      log.record(input())
      expect(onEmit).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(250)
      expect(onEmit).toHaveBeenCalledTimes(2)
    })
  })

  describe('clear', () => {
    it('empties the buffer and emits an empty snapshot immediately', () => {
      const onEmit = vi.fn()
      const log = new PreviewFailureLog({ onEmit })
      log.record(input())
      onEmit.mockClear()

      log.clear()

      expect(log.list()).toHaveLength(0)
      expect(onEmit).toHaveBeenCalledTimes(1)
      expect(onEmit).toHaveBeenCalledWith([], false)

      // The pending coalesced emit was cancelled — no second call fires.
      vi.runAllTimers()
      expect(onEmit).toHaveBeenCalledTimes(1)
    })
  })

  describe('drop', () => {
    it('empties without emitting and cancels the pending emit', () => {
      const onEmit = vi.fn()
      const log = new PreviewFailureLog({ onEmit })
      log.record(input())

      log.drop()

      expect(log.list()).toHaveLength(0)
      vi.runAllTimers()
      expect(onEmit).not.toHaveBeenCalled()
    })
  })
})
