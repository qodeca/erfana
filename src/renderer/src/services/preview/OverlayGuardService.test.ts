// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the overlay guard (Issue #74, item 69).
 *
 * One case per trigger (design item 17): the guard sends `setVisibility` for the
 * live preview panel iff it is the active tab AND nothing occludes it, sends
 * ONLY on a change, and `sync()` recomputes on active-tab change. All fakes —
 * no real `window.api` or zustand store is touched.
 */
import { describe, it, expect, vi } from 'vitest'
import { createOverlayGuard, type OverlayGuardDeps } from './OverlayGuardService'

/** A mutable fake environment plus the constructed guard. */
function makeGuard(overrides: Partial<OverlayGuardDeps> = {}): {
  guard: ReturnType<typeof createOverlayGuard>
  setVisibility: ReturnType<typeof vi.fn>
  state: { occluded: boolean; livePanelId: string | null }
  fireOccluded: () => void
  firePreview: () => void
} {
  const state = { occluded: false, livePanelId: 'preview-1' as string | null }
  const setVisibility = vi.fn()
  let occludedListener: () => void = () => {}
  let previewListener: () => void = () => {}

  const deps: OverlayGuardDeps = {
    isOccluded: () => state.occluded,
    subscribeOccluded: (l) => {
      occludedListener = l
      return () => {}
    },
    getLivePreviewPanelId: () => state.livePanelId,
    subscribePreview: (l) => {
      previewListener = l
      return () => {}
    },
    setVisibility,
    ...overrides
  }

  const guard = createOverlayGuard(deps)
  return {
    guard,
    setVisibility,
    state,
    fireOccluded: () => occludedListener(),
    firePreview: () => previewListener()
  }
}

describe('OverlayGuardService (item 69)', () => {
  it('shows the preview when it is the active tab and not occluded', () => {
    const { guard, setVisibility } = makeGuard()

    guard.sync('preview-1')

    expect(setVisibility).toHaveBeenCalledTimes(1)
    expect(setVisibility).toHaveBeenLastCalledWith('preview-1', true, 'active-tab')
  })

  it('sends setVisibility only on a change', () => {
    const { guard, setVisibility } = makeGuard()

    guard.sync('preview-1')
    guard.sync('preview-1')
    guard.sync('preview-1')

    // Three syncs, one actual visibility change.
    expect(setVisibility).toHaveBeenCalledTimes(1)
  })

  it('hides the preview when another tab is active (inactive-tab)', () => {
    const { guard, setVisibility } = makeGuard()

    guard.sync('preview-1') // visible
    guard.sync('editor-2') // switch away → hide

    expect(setVisibility).toHaveBeenCalledTimes(2)
    expect(setVisibility).toHaveBeenLastCalledWith('preview-1', false, 'inactive-tab')
  })

  it('hides the preview when an overlay occludes it (occluded)', () => {
    const { guard, setVisibility, state, fireOccluded } = makeGuard()

    guard.sync('preview-1') // visible
    state.occluded = true
    fireOccluded() // occluder store change recomputes

    expect(setVisibility).toHaveBeenCalledTimes(2)
    expect(setVisibility).toHaveBeenLastCalledWith('preview-1', false, 'occluded')
  })

  it('shows again once the overlay clears', () => {
    const { guard, setVisibility, state, fireOccluded } = makeGuard()

    guard.sync('preview-1')
    state.occluded = true
    fireOccluded()
    state.occluded = false
    fireOccluded()

    expect(setVisibility).toHaveBeenLastCalledWith('preview-1', true, 'active-tab')
  })

  it('recomputes on a preview-store change (a preview becomes live)', () => {
    const { guard, setVisibility, state, firePreview } = makeGuard()

    // No live preview yet: nothing to send even if a tab is "active".
    state.livePanelId = null
    guard.sync('preview-1')
    expect(setVisibility).not.toHaveBeenCalled()

    // A preview opens under the active tab id → store change → show.
    state.livePanelId = 'preview-1'
    firePreview()
    expect(setVisibility).toHaveBeenCalledTimes(1)
    expect(setVisibility).toHaveBeenLastCalledWith('preview-1', true, 'active-tab')
  })

  it('does not send for a stale panel once it stops being live', () => {
    const { guard, setVisibility, state, firePreview } = makeGuard()

    guard.sync('preview-1') // visible
    setVisibility.mockClear()

    // The preview closes: no live panel remains, nothing to hide (main already
    // destroyed the view on close).
    state.livePanelId = null
    firePreview()
    expect(setVisibility).not.toHaveBeenCalled()
  })

  it('detaches its store subscriptions on dispose', () => {
    const unsubOccluded = vi.fn()
    const unsubPreview = vi.fn()
    const { guard } = makeGuard({
      subscribeOccluded: () => unsubOccluded,
      subscribePreview: () => unsubPreview
    })

    guard.dispose()

    expect(unsubOccluded).toHaveBeenCalledTimes(1)
    expect(unsubPreview).toHaveBeenCalledTimes(1)
  })
})
