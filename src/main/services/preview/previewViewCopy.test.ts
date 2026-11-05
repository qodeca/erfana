// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Copy from the HTML preview's right-click menu (#463): the refusals and the
 * one success, over a fake registry.
 */
import { describe, expect, it, vi, type Mock } from 'vitest'

import { createPreviewViewCopy, type PreviewCopyableEntry } from './previewViewCopy'

const PANEL = 'preview-1'
const WINDOW_ID = 7

/** A registry holding one entry, plus the lookup spy. */
function harness(entry: PreviewCopyableEntry | null): {
  copySelection: (panelId: string, windowId: number) => boolean
  entry: Mock
} {
  const lookup = vi.fn((panelId: string) => (panelId === PANEL ? entry : null))
  return { copySelection: createPreviewViewCopy({ registry: { entry: lookup } }), entry: lookup }
}

/** An entry whose view answers `answer` when asked to copy. */
function entryOf(windowId: number, answer: boolean): PreviewCopyableEntry & {
  view: { copySelection: Mock }
} {
  return { view: { copySelection: vi.fn(() => answer) }, windowId }
}

describe('createPreviewViewCopy', () => {
  it('copies in the page of a live view in the asking window', () => {
    const entry = entryOf(WINDOW_ID, true)
    const { copySelection } = harness(entry)

    expect(copySelection(PANEL, WINDOW_ID)).toBe(true)
    expect(entry.view.copySelection).toHaveBeenCalledTimes(1)
  })

  it('refuses a panel with no live view', () => {
    const { copySelection, entry } = harness(null)

    expect(copySelection('preview-closed', WINDOW_ID)).toBe(false)
    expect(entry).toHaveBeenCalledWith('preview-closed')
  })

  it('never copies in a view that belongs to another window', () => {
    const entry = entryOf(WINDOW_ID, true)
    const { copySelection } = harness(entry)

    expect(copySelection(PANEL, WINDOW_ID + 1)).toBe(false)
    expect(entry.view.copySelection).not.toHaveBeenCalled()
  })

  it("passes on the view's own refusal – a page being torn down", () => {
    const entry = entryOf(WINDOW_ID, false)
    const { copySelection } = harness(entry)

    expect(copySelection(PANEL, WINDOW_ID)).toBe(false)
    expect(entry.view.copySelection).toHaveBeenCalledTimes(1)
  })
})
