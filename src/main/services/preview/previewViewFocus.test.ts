// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The keyboard route into a previewed page (issue #124, QG-8 U1).
 *
 * The three refusals and the one success, over a fake registry: a panel with no
 * live view, a view belonging to another window, a view that refuses because it
 * is not drawn, and a live, drawn view in the asking window.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  createPreviewViewFocus,
  type PreviewFocusableEntry
} from './previewViewFocus'

const PANEL = 'preview-1'
const WINDOW_ID = 7

/** A registry holding one entry, plus the view's `focusPage` spy. */
function harness(entry: PreviewFocusableEntry | null): {
  focusPage: (panelId: string, windowId: number) => boolean
  entry: ReturnType<typeof vi.fn>
} {
  const lookup = vi.fn((panelId: string) => (panelId === PANEL ? entry : null))
  return { focusPage: createPreviewViewFocus({ registry: { entry: lookup } }), entry: lookup }
}

/** An entry whose view answers `answer` when asked to take focus. */
function entryOf(windowId: number, answer: boolean): PreviewFocusableEntry & {
  view: { focusPage: ReturnType<typeof vi.fn> }
} {
  return { view: { focusPage: vi.fn(() => answer) }, windowId }
}

describe('createPreviewViewFocus', () => {
  it('focuses the page of a live view in the asking window', () => {
    const entry = entryOf(WINDOW_ID, true)
    const { focusPage } = harness(entry)

    expect(focusPage(PANEL, WINDOW_ID)).toBe(true)
    expect(entry.view.focusPage).toHaveBeenCalledTimes(1)
  })

  it('refuses a panel with no live view', () => {
    const { focusPage, entry } = harness(null)

    expect(focusPage('preview-closed', WINDOW_ID)).toBe(false)
    expect(entry).toHaveBeenCalledWith('preview-closed')
  })

  it('never focuses a view that belongs to another window', () => {
    // Panel ids are path-derived, so two windows previewing one file mint the
    // same id: the window has to be checked, not assumed.
    const entry = entryOf(WINDOW_ID, true)
    const { focusPage } = harness(entry)

    expect(focusPage(PANEL, WINDOW_ID + 1)).toBe(false)
    expect(entry.view.focusPage).not.toHaveBeenCalled()
  })

  it("passes on the view's own refusal – a page that is not drawn", () => {
    const entry = entryOf(WINDOW_ID, false)
    const { focusPage } = harness(entry)

    expect(focusPage(PANEL, WINDOW_ID)).toBe(false)
    expect(entry.view.focusPage).toHaveBeenCalledTimes(1)
  })
})
