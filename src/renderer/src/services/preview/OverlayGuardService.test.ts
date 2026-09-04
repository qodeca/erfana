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
import type { PreviewChromeGateReason } from '../../stores/usePreviewChromeGateStore'
import { createOverlayGuard, type OverlayGuardDeps } from './OverlayGuardService'

/** A mutable fake environment plus the constructed guard. */
function makeGuard(overrides: Partial<OverlayGuardDeps> = {}): {
  guard: ReturnType<typeof createOverlayGuard>
  setVisibility: ReturnType<typeof vi.fn>
  state: { occluded: boolean; livePanelId: string | null }
  fireOccluded: () => void
  firePreview: () => void
  fireGate: () => void
} {
  const state = {
    occluded: false,
    livePanelIds: ['preview-1'] as readonly string[],
    /** Per-panel gate reasons. Absent means the page may be shown. */
    gates: new Map<string, PreviewChromeGateReason>()
  }
  const setVisibility = vi.fn()
  let occludedListener: () => void = () => {}
  let previewListener: () => void = () => {}
  let gateListener: () => void = () => {}

  const deps: OverlayGuardDeps = {
    isOccluded: () => state.occluded,
    subscribeOccluded: (l) => {
      occludedListener = l
      return () => {}
    },
    getLivePreviewPanelIds: () => state.livePanelIds,
    subscribePreview: (l) => {
      previewListener = l
      return () => {}
    },
    getPanelGate: (panelId) => state.gates.get(panelId) ?? null,
    subscribeGate: (l) => {
      gateListener = l
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
    firePreview: () => previewListener(),
    fireGate: () => gateListener()
  }
}

describe('OverlayGuardService — reconciling with what main actually did', () => {
  /**
   * The guard writes `lastVisible` at SEND time and re-sends only on a change,
   * so a send main drops is permanent — the panel is black and stays black until
   * some unrelated transition. A reported fault looked exactly like that. Main
   * already reports what it applied; the guard now listens.
   */
  it('re-sends when main reports the opposite of what was sent', () => {
    let applied: (panelId: string, visible: boolean) => void = () => {}
    const { guard, setVisibility } = makeGuard({
      subscribeVisibilityApplied: (l) => {
        applied = l
        return () => {}
      }
    })

    guard.sync('preview-1')
    expect(setVisibility).toHaveBeenCalledWith('preview-1', true, expect.any(String))
    setVisibility.mockClear()

    // Main says the view is hidden. The guard believed it was visible, so its
    // belief is wrong and the next recompute must speak again.
    applied('preview-1', false)

    expect(setVisibility).toHaveBeenCalledWith('preview-1', true, expect.any(String))
  })

  it('stays quiet when main agrees', () => {
    // Reconciliation must not turn every confirmation into another message.
    let applied: (panelId: string, visible: boolean) => void = () => {}
    const { guard, setVisibility } = makeGuard({
      subscribeVisibilityApplied: (l) => {
        applied = l
        return () => {}
      }
    })

    guard.sync('preview-1')
    setVisibility.mockClear()

    applied('preview-1', true)

    expect(setVisibility).not.toHaveBeenCalled()
  })
})

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
    state.livePanelIds = []
    guard.sync('preview-1')
    expect(setVisibility).not.toHaveBeenCalled()

    // A preview opens under the active tab id → store change → show.
    state.livePanelIds = ['preview-1']
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
    state.livePanelIds = []
    firePreview()
    expect(setVisibility).not.toHaveBeenCalled()
  })

  it('detaches its store subscriptions on dispose', () => {
    const unsubOccluded = vi.fn()
    const unsubPreview = vi.fn()
    const unsubGate = vi.fn()
    const { guard } = makeGuard({
      subscribeOccluded: () => unsubOccluded,
      subscribePreview: () => unsubPreview,
      subscribeGate: () => unsubGate
    })

    guard.dispose()

    expect(unsubOccluded).toHaveBeenCalledTimes(1)
    expect(unsubPreview).toHaveBeenCalledTimes(1)
    expect(unsubGate).toHaveBeenCalledTimes(1)
  })

  it('hides ONLY the gated panel, not its sibling in a split view', () => {
    // The reason this gate is per-panel state and not the global occluder store.
    // A permission band waiting for one page to prove it moved must not blank a
    // second preview that has nothing to do with it.
    const { guard, setVisibility, state, fireGate } = makeGuard()
    state.livePanelIds = ['preview-1', 'preview-2']
    guard.sync('preview-1')
    setVisibility.mockClear()

    state.gates.set('preview-1', 'unconfirmed')
    fireGate()

    expect(setVisibility).toHaveBeenCalledTimes(1)
    expect(setVisibility).toHaveBeenCalledWith('preview-1', false, 'chrome-unconfirmed')
  })

  it('names the too-short fail-safe distinctly from occlusion', () => {
    const { guard, setVisibility, state, fireGate } = makeGuard()
    guard.sync('preview-1')
    setVisibility.mockClear()

    state.gates.set('preview-1', 'too-short')
    fireGate()

    expect(setVisibility).toHaveBeenCalledWith('preview-1', false, 'chrome-too-short')
  })
})

describe('OverlayGuardService — several live previews (sd-074b §4.8)', () => {
  it('shows only the active tab and hides the other live previews', () => {
    const { guard, setVisibility, state } = makeGuard()
    state.livePanelIds = ['preview-1', 'preview-2', 'preview-3']

    guard.sync('preview-2')

    expect(setVisibility).toHaveBeenCalledWith('preview-2', true, 'active-tab')
    expect(setVisibility).toHaveBeenCalledWith('preview-1', false, 'inactive-tab')
    expect(setVisibility).toHaveBeenCalledWith('preview-3', false, 'inactive-tab')
  })

  it('hides every live preview while an overlay occludes them', () => {
    const { guard, setVisibility, state, fireOccluded } = makeGuard()
    state.livePanelIds = ['preview-1', 'preview-2']
    guard.sync('preview-1')
    setVisibility.mockClear()

    state.occluded = true
    fireOccluded()

    expect(setVisibility).toHaveBeenCalledWith('preview-1', false, 'occluded')
    // preview-2 was already hidden, so no redundant send for it.
    expect(setVisibility).toHaveBeenCalledTimes(1)
  })

  it('treats a re-opened panel as new rather than reusing its stale visibility', () => {
    const { guard, setVisibility, state, firePreview } = makeGuard()
    state.livePanelIds = ['preview-1']
    guard.sync('preview-1')
    setVisibility.mockClear()

    // Suspended: main destroyed the view, so the panel leaves the live set.
    state.livePanelIds = []
    firePreview()
    expect(setVisibility).not.toHaveBeenCalled()

    // Re-opened under the same active tab: the cached `true` must not suppress
    // the send, or the fresh view would never be shown.
    state.livePanelIds = ['preview-1']
    firePreview()
    expect(setVisibility).toHaveBeenCalledWith('preview-1', true, 'active-tab')
  })
})
