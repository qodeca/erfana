// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import { SubscriberCounter } from './SubscriberCounter'

describe('SubscriberCounter', () => {
  describe('add', () => {
    it('starts a webContents at one subscription', () => {
      const counter = new SubscriberCounter()

      expect(counter.add(1)).toBe(1)
      expect(counter.has(1)).toBe(true)
      expect(counter.size).toBe(1)
    })

    it('increments repeat subscriptions for the same webContents', () => {
      const counter = new SubscriberCounter()

      counter.add(1)

      expect(counter.add(1)).toBe(2)
      // Still ONE window, but two consumers inside it
      expect(counter.size).toBe(1)
      expect(counter.countFor(1)).toBe(2)
      expect(counter.totalSubscriptions).toBe(2)
    })
  })

  describe('release', () => {
    it('keeps the watch alive while a second consumer in the same window remains', () => {
      // Issue #70 / D3: the defect the counter exists to prevent
      const counter = new SubscriberCounter()
      counter.add(1)
      counter.add(1)

      const remaining = counter.release(1)

      expect(remaining).toBe(1)
      expect(counter.has(1)).toBe(true)
      expect(counter.countFor(1)).toBe(1)
    })

    it('drops the webContents when its last subscription is released', () => {
      const counter = new SubscriberCounter()
      counter.add(1)

      const remaining = counter.release(1)

      expect(remaining).toBe(0)
      expect(counter.has(1)).toBe(false)
      expect(counter.countFor(1)).toBe(0)
    })

    it('reports the remaining webContents when other windows still subscribe', () => {
      const counter = SubscriberCounter.from([1, 2])

      expect(counter.release(1)).toBe(1)
      expect(counter.ids()).toEqual([2])
    })

    it('is a no-op for an unknown webContents', () => {
      const counter = SubscriberCounter.from([1])

      expect(counter.release(99)).toBe(1)
      expect(counter.size).toBe(1)
    })

    it('never goes negative when released more often than added', () => {
      const counter = new SubscriberCounter()
      counter.add(1)

      counter.release(1)
      counter.release(1)

      expect(counter.size).toBe(0)
      expect(counter.countFor(1)).toBe(0)
      expect(counter.totalSubscriptions).toBe(0)
    })
  })

  describe('removeAll', () => {
    it('drops a webContents regardless of how many subscriptions it holds', () => {
      const counter = new SubscriberCounter()
      counter.add(1)
      counter.add(1)
      counter.add(1)

      const remaining = counter.removeAll(1)

      expect(remaining).toBe(0)
      expect(counter.has(1)).toBe(false)
    })

    it('leaves other webContents untouched', () => {
      const counter = SubscriberCounter.from([1, 1, 2, 3])

      counter.removeAll(2)

      expect(counter.ids().sort()).toEqual([1, 3])
      expect(counter.countFor(1)).toBe(2)
    })

    it('is a no-op for an unknown webContents', () => {
      const counter = SubscriberCounter.from([1])

      expect(counter.removeAll(99)).toBe(1)
    })
  })

  describe('from', () => {
    it('builds one subscription per listed id', () => {
      const counter = SubscriberCounter.from([1, 2, 3])

      expect(counter.size).toBe(3)
      expect(counter.totalSubscriptions).toBe(3)
      expect(counter.ids()).toEqual([1, 2, 3])
    })

    it('counts repeated ids as repeated subscriptions', () => {
      const counter = SubscriberCounter.from([1, 1])

      expect(counter.size).toBe(1)
      expect(counter.countFor(1)).toBe(2)
    })

    it('produces an empty counter for an empty list', () => {
      const counter = SubscriberCounter.from([])

      expect(counter.size).toBe(0)
      expect(counter.ids()).toEqual([])
    })
  })
})
