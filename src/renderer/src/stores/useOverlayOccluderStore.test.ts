// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for useOverlayOccluderStore (Issue #74, item 61).
 *
 * @see useOverlayOccluderStore.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useOverlayOccluderStore } from './useOverlayOccluderStore'

/** Awaits one microtask turn so the store's coalesced flush runs. */
const flushMicrotasks = (): Promise<void> => Promise.resolve()

describe('useOverlayOccluderStore', () => {
  beforeEach(() => {
    useOverlayOccluderStore.getState().reset()
  })

  describe('counts and isOccluded', () => {
    it('is not occluded initially', () => {
      expect(useOverlayOccluderStore.getState().isOccluded()).toBe(false)
    })

    it('becomes occluded after a register and reports live', () => {
      useOverlayOccluderStore.getState().register('dialog')
      // isOccluded reads LIVE counts — true synchronously, before any flush.
      expect(useOverlayOccluderStore.getState().isOccluded()).toBe(true)
    })

    it('tracks counts per kind independently', async () => {
      const { register, unregister } = useOverlayOccluderStore.getState()
      register('dialog')
      register('toast')
      await flushMicrotasks()
      expect(useOverlayOccluderStore.getState().counts).toEqual({ dialog: 1, toast: 1 })

      unregister('dialog')
      await flushMicrotasks()
      // dialog dropped to 0 → removed; toast remains → still occluded.
      expect(useOverlayOccluderStore.getState().counts).toEqual({ toast: 1 })
      expect(useOverlayOccluderStore.getState().isOccluded()).toBe(true)
    })

    it('nests the same kind and only clears at zero', async () => {
      const { register, unregister } = useOverlayOccluderStore.getState()
      register('menu')
      register('menu')
      unregister('menu')
      expect(useOverlayOccluderStore.getState().isOccluded()).toBe(true)
      unregister('menu')
      expect(useOverlayOccluderStore.getState().isOccluded()).toBe(false)
      await flushMicrotasks()
      expect(useOverlayOccluderStore.getState().counts).toEqual({})
    })

    it('clamps unregister below zero', async () => {
      useOverlayOccluderStore.getState().unregister('drag')
      expect(useOverlayOccluderStore.getState().isOccluded()).toBe(false)
      await flushMicrotasks()
      expect(useOverlayOccluderStore.getState().counts).toEqual({})
    })
  })

  describe('microtask coalescing', () => {
    it('notifies subscribers once per tick, not per mutation', async () => {
      const spy = vi.fn()
      const unsub = useOverlayOccluderStore.subscribe(spy)

      const { register } = useOverlayOccluderStore.getState()
      register('dialog')
      register('toast')
      register('menu')

      // No notification yet — the publish is deferred to a microtask.
      expect(spy).not.toHaveBeenCalled()

      await flushMicrotasks()
      expect(spy).toHaveBeenCalledTimes(1)
      unsub()
    })

    it('collapses a sync unregister→register into ONE notification with no 0-flap', async () => {
      // Arrange: an already-registered dialog, published.
      useOverlayOccluderStore.getState().register('dialog')
      await flushMicrotasks()

      const observed: boolean[] = []
      const unsub = useOverlayOccluderStore.subscribe(() => {
        // Record what a subscriber sees at notification time.
        observed.push(useOverlayOccluderStore.getState().isOccluded())
      })

      // Act: the BaseDialog zIndex-change shape — cleanup then body in one tick.
      const { register, unregister } = useOverlayOccluderStore.getState()
      unregister('dialog')
      register('dialog')

      await flushMicrotasks()

      // Assert: exactly one notification, and it never carried the transient 0.
      expect(observed).toEqual([true])
      unsub()
    })
  })

  describe('reset', () => {
    it('clears live and published counts', async () => {
      useOverlayOccluderStore.getState().register('overlay')
      await flushMicrotasks()
      expect(useOverlayOccluderStore.getState().isOccluded()).toBe(true)

      useOverlayOccluderStore.getState().reset()
      expect(useOverlayOccluderStore.getState().isOccluded()).toBe(false)
      expect(useOverlayOccluderStore.getState().counts).toEqual({})
    })
  })
})
