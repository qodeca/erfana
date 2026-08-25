// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * PreviewHostBlockNotifier tests (Issue #74, work item 24).
 *
 * Covers the distinct-host toast budget (3 by default), per-host dedupe, and
 * per-project / global clearing.
 */
import { describe, expect, it } from 'vitest'
import { PreviewHostBlockNotifier } from './PreviewHostBlockNotifier'

const PROJECT = '/home/user/project'

describe('PreviewHostBlockNotifier', () => {
  describe('budget', () => {
    it('toasts the first 3 distinct hosts and badges the 4th', () => {
      const notifier = new PreviewHostBlockNotifier()
      expect(notifier.shouldNotify(PROJECT, 'a.example')).toBe(true)
      expect(notifier.shouldNotify(PROJECT, 'b.example')).toBe(true)
      expect(notifier.shouldNotify(PROJECT, 'c.example')).toBe(true)
      // 4th distinct host is over budget -> badge-only.
      expect(notifier.shouldNotify(PROJECT, 'd.example')).toBe(false)
      expect(notifier.shouldNotify(PROJECT, 'e.example')).toBe(false)
    })

    it('honours a custom budget', () => {
      const notifier = new PreviewHostBlockNotifier({ maxHostToasts: 1 })
      expect(notifier.shouldNotify(PROJECT, 'a.example')).toBe(true)
      expect(notifier.shouldNotify(PROJECT, 'b.example')).toBe(false)
    })

    it('tracks budget independently per project', () => {
      const notifier = new PreviewHostBlockNotifier({ maxHostToasts: 1 })
      expect(notifier.shouldNotify('/p1', 'a.example')).toBe(true)
      expect(notifier.shouldNotify('/p2', 'a.example')).toBe(true)
      expect(notifier.shouldNotify('/p1', 'b.example')).toBe(false)
    })
  })

  describe('dedupe', () => {
    it('toasts a given host only once', () => {
      const notifier = new PreviewHostBlockNotifier()
      expect(notifier.shouldNotify(PROJECT, 'a.example')).toBe(true)
      expect(notifier.shouldNotify(PROJECT, 'a.example')).toBe(false)
      expect(notifier.shouldNotify(PROJECT, 'a.example')).toBe(false)
    })

    it('does not consume a budget slot for a repeated host', () => {
      const notifier = new PreviewHostBlockNotifier()
      notifier.shouldNotify(PROJECT, 'a.example')
      notifier.shouldNotify(PROJECT, 'a.example') // repeat, badge-only
      // Two more distinct hosts still fit within the budget of 3.
      expect(notifier.shouldNotify(PROJECT, 'b.example')).toBe(true)
      expect(notifier.shouldNotify(PROJECT, 'c.example')).toBe(true)
      expect(notifier.shouldNotify(PROJECT, 'd.example')).toBe(false)
    })
  })

  describe('clear', () => {
    it('clears one project, leaving others intact', () => {
      const notifier = new PreviewHostBlockNotifier({ maxHostToasts: 1 })
      notifier.shouldNotify('/p1', 'a.example')
      notifier.shouldNotify('/p2', 'a.example')

      notifier.clear('/p1')

      // /p1 budget + dedupe reset; /p2 still exhausted.
      expect(notifier.shouldNotify('/p1', 'a.example')).toBe(true)
      expect(notifier.shouldNotify('/p2', 'b.example')).toBe(false)
    })

    it('clears all projects when called without an argument', () => {
      const notifier = new PreviewHostBlockNotifier({ maxHostToasts: 1 })
      notifier.shouldNotify('/p1', 'a.example')
      notifier.shouldNotify('/p2', 'a.example')

      notifier.clear()

      expect(notifier.shouldNotify('/p1', 'a.example')).toBe(true)
      expect(notifier.shouldNotify('/p2', 'a.example')).toBe(true)
    })
  })
})
