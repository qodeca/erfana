// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Per-panel preview state tests (issue #124, WI-2).
 *
 * The zoom and, from WI-17b, the tab's history outlive the live view, and that
 * is the point of the module: they survive a suspend, and a closed tab takes
 * them with it.
 * `PreviewViewService.test.ts` ("page zoom", "live-view budget") covers the
 * same rules through the service.
 */
import { describe, expect, it } from 'vitest'
import { PREVIEW } from '../../../shared/constants'
import { createPreviewPanelState } from './previewPanelState'
import { createTabHistory, pushEntry } from './previewTabHistory'

describe('createPreviewPanelState — zoom', () => {
  it('starts every panel at 0, which is 100 %', () => {
    const state = createPreviewPanelState()

    expect(state.zoomLevel('panel-A')).toBe(0)
  })

  it('steps the level and remembers it for that panel only', () => {
    const state = createPreviewPanelState()

    expect(state.stepZoom('panel-A', 1)).toBe(1)
    expect(state.stepZoom('panel-A', 2)).toBe(3)

    expect(state.zoomLevel('panel-A')).toBe(3)
    expect(state.zoomLevel('panel-B')).toBe(0)
  })

  it('clamps the level to the preview range in both directions', () => {
    const state = createPreviewPanelState()

    expect(state.stepZoom('panel-A', 100)).toBe(PREVIEW.MAX_ZOOM_LEVEL)
    expect(state.stepZoom('panel-A', 1)).toBe(PREVIEW.MAX_ZOOM_LEVEL)
    expect(state.stepZoom('panel-A', -100)).toBe(PREVIEW.MIN_ZOOM_LEVEL)
    expect(state.zoomLevel('panel-A')).toBe(PREVIEW.MIN_ZOOM_LEVEL)
  })

  it('goes back to 0 on a step of 0, whatever the level was', () => {
    const state = createPreviewPanelState()
    state.stepZoom('panel-A', -3)

    expect(state.stepZoom('panel-A', 0)).toBe(0)
    expect(state.zoomLevel('panel-A')).toBe(0)
  })
})

describe('createPreviewPanelState — history (issue #124, WI-17b)', () => {
  it('has no history before a panel first opens', () => {
    const state = createPreviewPanelState()

    expect(state.history('panel-A')).toBeNull()
  })

  it('keeps the list it was given, for that panel only', () => {
    const state = createPreviewPanelState()
    const first = createTabHistory({ filePath: '/proj/a.html', anchor: null })
    const moved = pushEntry(first, { filePath: '/proj/b.html', anchor: 'top' })

    state.setHistory('panel-A', first)
    state.setHistory('panel-A', moved)

    expect(state.history('panel-A')).toBe(moved)
    expect(state.history('panel-B')).toBeNull()
  })
})

describe('createPreviewPanelState — lifetimes', () => {
  it('forgets the zoom and the history once the tab is gone, and only for that tab', () => {
    const state = createPreviewPanelState()
    const history = createTabHistory({ filePath: '/proj/a.html', anchor: null })
    state.stepZoom('panel-A', 2)
    state.stepZoom('panel-B', -1)
    state.setHistory('panel-A', history)
    state.setHistory('panel-B', history)

    state.forget('panel-A')

    expect(state.zoomLevel('panel-A')).toBe(0)
    expect(state.zoomLevel('panel-B')).toBe(-1)
    expect(state.history('panel-A')).toBeNull()
    expect(state.history('panel-B')).toBe(history)
  })

  it('does nothing when a panel with no state is forgotten', () => {
    const state = createPreviewPanelState()

    state.forget('panel-A')

    expect(state.zoomLevel('panel-A')).toBe(0)
  })
})
