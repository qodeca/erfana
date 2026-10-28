// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for {@link usePreviewCollapsedStore} (issue #124, part 1 §1.4, C2).
 *
 * The overlay guard subscribes to this store and the bounds hook writes it from
 * a per-frame loop, so the property that matters most is that a repeated write
 * does not notify.
 *
 * @see usePreviewCollapsedStore.ts
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { usePreviewCollapsedStore } from './usePreviewCollapsedStore'

const store = (): ReturnType<typeof usePreviewCollapsedStore.getState> => usePreviewCollapsedStore.getState()

afterEach(() => {
  usePreviewCollapsedStore.setState({ collapsed: new Set() })
})

describe('usePreviewCollapsedStore', () => {
  it('starts with no panel collapsed', () => {
    expect(store().isCollapsed('preview-1')).toBe(false)
  })

  it('sets and clears one panel without touching another', () => {
    store().setCollapsed('preview-1')
    store().setCollapsed('preview-2')
    store().clearCollapsed('preview-1')

    expect(store().isCollapsed('preview-1')).toBe(false)
    expect(store().isCollapsed('preview-2')).toBe(true)
  })

  it('does not notify on an identical write, so a per-frame writer cannot spin the guard', () => {
    const listener = vi.fn()
    const unsubscribe = usePreviewCollapsedStore.subscribe(listener)

    store().setCollapsed('preview-1')
    store().setCollapsed('preview-1')
    store().clearCollapsed('preview-1')
    store().clearCollapsed('preview-1')

    // One notification for the set, one for the clear – the repeats are silent.
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
  })

  it('replaces the set on a change, so a snapshot taken earlier stays as it was', () => {
    const before = store().collapsed
    store().setCollapsed('preview-1')

    expect(before.has('preview-1')).toBe(false)
    expect(store().collapsed).not.toBe(before)
  })
})
