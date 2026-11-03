// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the native-view kinds (spec 025, commit 16): the reason
 * precedence and the browser tab kind over the bounds owner.
 */
import { describe, expect, it, vi } from 'vitest'
import type { BoundsRequest } from '../../../../shared/ipc/browser-tab-schema'
import { createBrowserViewBounds } from '../browser/browserViewBounds'
import { VISIBILITY_REASON, createBrowserViewKind, visibilityReason } from './nativeViewKinds'

describe('visibilityReason', () => {
  it.each([
    [true, true, null, VISIBILITY_REASON.activeTab],
    [false, false, 'collapsed', VISIBILITY_REASON.inactiveTab],
    [false, true, 'unconfirmed', VISIBILITY_REASON.chromeUnconfirmed],
    [false, true, 'too-short', VISIBILITY_REASON.chromeTooShort],
    [false, true, 'collapsed', VISIBILITY_REASON.collapsed],
    [false, true, 'covered', VISIBILITY_REASON.covered],
    [false, true, null, VISIBILITY_REASON.occluded]
  ] as const)('visible %s, active %s, gate %s → %s', (visible, active, gate, reason) => {
    expect(visibilityReason(visible, active, gate)).toBe(reason)
  })
})

describe('createBrowserViewKind', () => {
  const placement = {
    bounds: { x: 0, y: 0, width: 100, height: 100 },
    clip: { x: 0, y: 0, width: 100, height: 100 }
  }

  function make(collapsed = new Set<string>()): {
    kind: ReturnType<typeof createBrowserViewKind>
    views: ReturnType<typeof createBrowserViewBounds>
    sent: BoundsRequest[]
    gateListeners: Set<() => void>
  } {
    const sent: BoundsRequest[] = []
    const views = createBrowserViewBounds((request) => sent.push(request))
    const gateListeners = new Set<() => void>()
    const kind = createBrowserViewKind(views, {
      isCollapsed: (panelId) => collapsed.has(panelId),
      subscribe: (listener) => {
        gateListeners.add(listener)
        return () => gateListeners.delete(listener)
      }
    })
    return { kind, views, sent, gateListeners }
  }

  it('lists registered tabs as views keyed by tab id, hosted by their panel', () => {
    const { kind, views } = make()
    views.register('browser-tab-1', 'browser-panel-1')
    expect(kind.liveViews()).toEqual([{ viewId: 'browser-tab-1', panelId: 'browser-panel-1' }])
  })

  it('gates a collapsed panel only', () => {
    const { kind } = make(new Set(['browser-panel-1']))
    expect(kind.getGate('browser-panel-1')).toBe('collapsed')
    expect(kind.getGate('browser-panel-2')).toBeNull()
  })

  it('sends its visibility through the bounds owner', () => {
    const { kind, views, sent } = make()
    views.register('browser-tab-1', 'browser-panel-1')
    views.place('browser-tab-1', placement)
    kind.setVisibility('browser-tab-1', true, 'active-tab')
    expect(sent).toEqual([expect.objectContaining({ tabId: 'browser-tab-1', visible: true })])
  })

  it('forwards registry, gate and applied subscriptions', () => {
    const { kind, views, gateListeners } = make()
    const live = vi.fn()
    const applied = vi.fn()
    kind.subscribe(live)
    const unsubscribeGate = kind.subscribeGate(() => {})
    kind.subscribeVisibilityApplied?.(applied)

    views.register('browser-tab-1', 'browser-panel-1')
    views.reportApplied('browser-tab-1', false)
    expect(live).toHaveBeenCalledTimes(1)
    expect(applied).toHaveBeenCalledExactlyOnceWith('browser-tab-1', false)
    expect(gateListeners.size).toBe(1)

    unsubscribeGate()
    expect(gateListeners.size).toBe(0)
  })
})
