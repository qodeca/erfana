// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for {@link usePreviewCoveredStore} (HTML Preview comments §10.6).
 *
 * The overlay guard subscribes to this store and reads it per panel, so what
 * matters is that one panel's flag never touches another's, and that a
 * repeated write does not make the guard recompute.
 *
 * @see usePreviewCoveredStore.ts
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { usePreviewCoveredStore } from './usePreviewCoveredStore'

const store = (): ReturnType<typeof usePreviewCoveredStore.getState> => usePreviewCoveredStore.getState()

afterEach(() => {
  usePreviewCoveredStore.setState({ covered: new Set() })
})

describe('usePreviewCoveredStore', () => {
  it('starts with no panel covered', () => {
    expect(store().isCovered('preview-1')).toBe(false)
  })

  it('sets and clears one panel without touching another', () => {
    store().setCovered('preview-1')
    store().setCovered('preview-2')
    store().clearCovered('preview-1')

    expect(store().isCovered('preview-1')).toBe(false)
    expect(store().isCovered('preview-2')).toBe(true)
  })

  it('does not notify on an identical write', () => {
    const listener = vi.fn()
    const unsubscribe = usePreviewCoveredStore.subscribe(listener)

    store().setCovered('preview-1')
    store().setCovered('preview-1')
    store().clearCovered('preview-1')
    store().clearCovered('preview-1')

    // One notification for the set, one for the clear – the repeats are silent.
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
  })

  it('replaces the set on a change, so a snapshot taken earlier stays as it was', () => {
    const before = store().covered
    store().setCovered('preview-1')

    expect(before.has('preview-1')).toBe(false)
    expect(store().covered).not.toBe(before)
  })
})
