// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the native-view guard's browser tab kind (spec 025, ADR 0011
 * decision 2, commit 16): the guard that owns preview show/hide owns browser
 * views the same way, and the two kinds share the active tab and occlusion.
 *
 * The preview-only behaviour is pinned, unchanged, by
 * `OverlayGuardService.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoundsRequest } from '../../../../shared/ipc/browser-tab-schema'
import { useOverlayOccluderStore } from '../../stores/useOverlayOccluderStore'
import { usePreviewCollapsedStore } from '../../stores/usePreviewCollapsedStore'
import { usePreviewStore } from '../../stores/usePreviewStore'
import { browserViewBounds, createBrowserViewBounds } from '../browser/browserViewBounds'
import { createBrowserViewKind } from './nativeViewKinds'
import { createOverlayGuard, getOverlayGuard, resetOverlayGuard } from './OverlayGuardService'

const TAB = 'browser-tab-1'
const PANEL = 'browser-panel-1'
const PREVIEW = 'preview-1'
const PLACEMENT = {
  bounds: { x: 0, y: 30, width: 800, height: 500 },
  clip: { x: 0, y: 30, width: 800, height: 500 }
}

/** A guard over one fake preview kind and a real browser kind with a recording sender. */
function makeGuard(): {
  guard: ReturnType<typeof createOverlayGuard>
  views: ReturnType<typeof createBrowserViewBounds>
  sent: BoundsRequest[]
  previewSent: Array<[string, boolean, string]>
  state: { occluded: boolean; collapsed: Set<string>; livePreviews: string[] }
  fireOccluded: () => void
  fireGate: () => void
} {
  const sent: BoundsRequest[] = []
  const previewSent: Array<[string, boolean, string]> = []
  const state = { occluded: false, collapsed: new Set<string>(), livePreviews: [] as string[] }
  const views = createBrowserViewBounds((request) => sent.push(request))
  let occludedListener = (): void => {}
  const gateListeners = new Set<() => void>()
  const guard = createOverlayGuard({
    isOccluded: () => state.occluded,
    subscribeOccluded: (listener) => {
      occludedListener = listener
      return () => {
        occludedListener = () => {}
      }
    },
    getLivePreviewPanelIds: () => state.livePreviews,
    subscribePreview: () => () => {},
    getPanelGate: () => null,
    subscribeGate: () => () => {},
    setVisibility: (panelId, visible, reason) => previewSent.push([panelId, visible, reason]),
    otherKinds: [
      createBrowserViewKind(views, {
        isCollapsed: (panelId) => state.collapsed.has(panelId),
        subscribe: (listener) => {
          gateListeners.add(listener)
          return () => gateListeners.delete(listener)
        }
      })
    ]
  })
  views.register(TAB, PANEL)
  views.place(TAB, PLACEMENT)
  return {
    guard,
    views,
    sent,
    previewSent,
    state,
    fireOccluded: () => occludedListener(),
    fireGate: () => {
      for (const listener of [...gateListeners]) listener()
    }
  }
}

const visibilities = (sent: readonly BoundsRequest[]): boolean[] => sent.map((request) => request.visible)

describe('native-view guard – browser tab views', () => {
  it('shows the page when its panel is the active tab and nothing occludes it', () => {
    const { guard, sent } = makeGuard()
    expect(sent).toEqual([])
    guard.sync(PANEL)
    expect(sent).toEqual([{ tabId: TAB, ...PLACEMENT, seq: 0, ack: true, visible: true }])
  })

  it('hides the page under an overlay and shows it once the overlay clears', () => {
    const { guard, sent, state, fireOccluded } = makeGuard()
    guard.sync(PANEL)

    state.occluded = true
    fireOccluded()
    state.occluded = false
    fireOccluded()

    expect(visibilities(sent)).toEqual([true, false, true])
  })

  it('hides the page when another tab becomes active', () => {
    const { guard, sent } = makeGuard()
    guard.sync(PANEL)
    guard.sync('editor-1')
    expect(visibilities(sent)).toEqual([true, false])
  })

  it('hides a collapsed panel’s page, and shows it once the flag clears', () => {
    const { guard, sent, state, fireGate } = makeGuard()
    guard.sync(PANEL)

    state.collapsed.add(PANEL)
    fireGate()
    expect(visibilities(sent)).toEqual([true, false])

    state.collapsed.delete(PANEL)
    fireGate()
    expect(visibilities(sent)).toEqual([true, false, true])
  })

  it('swaps a preview and a browser view on a tab switch, never showing both', () => {
    const { guard, sent, previewSent, state } = makeGuard()
    state.livePreviews = [PREVIEW]

    guard.sync(PREVIEW)
    expect(previewSent).toEqual([[PREVIEW, true, 'active-tab']])
    expect(sent).toEqual([])

    guard.sync(PANEL)
    expect(previewSent.at(-1)).toEqual([PREVIEW, false, 'inactive-tab'])
    expect(visibilities(sent)).toEqual([true])
  })

  it('reports the shown browser panel as the visible panel, for the drag freeze', () => {
    const { guard, state, fireOccluded } = makeGuard()
    expect(guard.visiblePanelId()).toBeNull()
    guard.sync(PANEL)
    expect(guard.visiblePanelId()).toBe(PANEL)

    state.occluded = true
    fireOccluded()
    expect(guard.visiblePanelId()).toBeNull()
  })

  it('treats a re-registered tab as new rather than reusing its stale visibility', () => {
    const { guard, views, sent } = makeGuard()
    guard.sync(PANEL)

    views.unregister(TAB)
    views.register(TAB, PANEL)
    views.place(TAB, PLACEMENT)
    expect(visibilities(sent)).toEqual([true, true])
  })

  it('re-sends when main reports it did the opposite of what was sent, and stays quiet when main agrees', () => {
    const { guard, views, sent } = makeGuard()
    guard.sync(PANEL)

    views.reportApplied(TAB, true)
    expect(visibilities(sent)).toEqual([true])

    views.reportApplied(TAB, false)
    expect(visibilities(sent)).toEqual([true, true])
    expect(guard.visiblePanelId()).toBe(PANEL)
  })

  it('sends nothing for the browser kind after dispose', () => {
    const { guard, views, sent, state, fireOccluded, fireGate } = makeGuard()
    guard.sync(PANEL)
    guard.dispose()

    views.register('browser-tab-2', 'browser-panel-2')
    state.occluded = true
    fireOccluded()
    fireGate()
    expect(sent).toHaveLength(1)
  })
})

describe('native-view guard – production wiring of browser views', () => {
  const setBounds = vi.fn()

  beforeEach(() => {
    setBounds.mockClear()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        preview: { setVisibility: vi.fn(), onVisibilityApplied: () => () => {} },
        browserTab: { setBounds }
      }
    })
    useOverlayOccluderStore.getState().reset()
    browserViewBounds.register(TAB, PANEL)
    browserViewBounds.place(TAB, PLACEMENT)
    getOverlayGuard().sync(PANEL)
  })

  afterEach(() => {
    resetOverlayGuard()
    browserViewBounds.unregister(TAB)
    useOverlayOccluderStore.getState().reset()
    usePreviewCollapsedStore.setState({ collapsed: new Set() })
    usePreviewStore.setState({ panels: new Map() })
  })

  const lastVisible = (): boolean | undefined => (setBounds.mock.lastCall?.[0] as BoundsRequest | undefined)?.visible

  it.each(['settings', 'toast', 'dialog', 'menu', 'overlay'] as const)(
    'hides the page while a %s is on screen, and shows it after',
    async (kind) => {
      expect(lastVisible()).toBe(true)

      useOverlayOccluderStore.getState().register(kind)
      await Promise.resolve()
      expect(lastVisible()).toBe(false)

      useOverlayOccluderStore.getState().unregister(kind)
      await Promise.resolve()
      expect(lastVisible()).toBe(true)
    }
  )

  it('hides on the collapsed store and shows when it clears', () => {
    usePreviewCollapsedStore.getState().setCollapsed(PANEL)
    expect(lastVisible()).toBe(false)
    usePreviewCollapsedStore.getState().clearCollapsed(PANEL)
    expect(lastVisible()).toBe(true)
  })

  it('stops hiding when the tab is unregistered', async () => {
    browserViewBounds.unregister(TAB)
    setBounds.mockClear()
    useOverlayOccluderStore.getState().register('settings')
    await Promise.resolve()
    expect(setBounds).not.toHaveBeenCalled()
  })
})
