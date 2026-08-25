// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the export toast formatter.
 *
 * Every message string here is quoted VERBATIM from the design's copy deck, on
 * purpose: this is the one place the wording is pinned, so a copy change has to
 * be a deliberate edit of both the deck and this file rather than a silent
 * drift.
 *
 * @module imageExportToast.logic.test
 * @see Issue #73 - PNG / PDF / clipboard export controls in the image viewer
 */

import { describe, it, expect } from 'vitest'

import type { ImageExportResponse } from '../../../../../shared/ipc/image-export-schema'
import {
  buildSelectionQualifier,
  EXPORT_TOAST_ERROR_MS,
  EXPORT_TOAST_SUCCESS_MS,
  formatExportToast,
  formatSettledAnnouncement,
  politeAnnouncement,
  SILENT_ANNOUNCEMENT,
  TOAST_FILENAME_MAX_LENGTH,
  truncateMiddle
} from './imageExportToast.logic'

type Success = Extract<ImageExportResponse, { success: true }>

/** A successful file export, with whatever the test wants to vary. */
function saved(overrides: Partial<Success> = {}): ImageExportResponse {
  return {
    success: true,
    target: 'png',
    filePath: '/out/diagram.png',
    output: { width: 256, height: 256 },
    ...overrides
  } as ImageExportResponse
}

/** A failed export carrying the message main already resolved. */
function failed(errorCode: string, error = 'Could not write to that folder'): ImageExportResponse {
  return { success: false, errorCode, error } as unknown as ImageExportResponse
}

describe('truncateMiddle', () => {
  it('leaves a name that already fits untouched', () => {
    expect(truncateMiddle('diagram.png', 48)).toBe('diagram.png')
  })

  it('elides the middle and keeps both ends', () => {
    const result = truncateMiddle('favicon-generated-2026-01-01-final.png', 20)

    expect(result).toHaveLength(20)
    expect(result.startsWith('favicon-')).toBe(true)
    // The extension is half the meaning of a filename, so a tail-only ellipsis
    // would hide exactly the part that says what was written.
    expect(result.endsWith('.png')).toBe(true)
    expect(result).toContain('…')
  })

  it('degenerates to a bare ellipsis at an unusable bound', () => {
    expect(truncateMiddle('anything.png', 1)).toBe('…')
    expect(truncateMiddle('anything.png', 0)).toBe('…')
  })
})

describe('buildSelectionQualifier', () => {
  it('reports the frame count for an animated GIF', () => {
    expect(buildSelectionQualifier({ kind: 'gif-frame', frameCount: 12 })).toBe(
      'first frame of 12'
    )
  })

  it('reports the chosen size for a multi-size ICO', () => {
    expect(
      buildSelectionQualifier({ kind: 'ico-size', width: 256, height: 256, sizeCount: 4 })
    ).toBe('256 x 256 of 4 sizes')
  })

  it('names the 2x rule for an SVG', () => {
    expect(buildSelectionQualifier({ kind: 'svg-scaled', scale: 2, width: 1024, height: 1024 })).toBe(
      'rendered at 2x (1024 x 1024)'
    )
  })

  it('says nothing when there was no choice to report', () => {
    expect(buildSelectionQualifier(undefined)).toBeNull()
    // "first frame of 1" and "… of 1 sizes" are noise about a choice nobody made.
    expect(buildSelectionQualifier({ kind: 'gif-frame', frameCount: 1 })).toBeNull()
    expect(
      buildSelectionQualifier({ kind: 'ico-size', width: 16, height: 16, sizeCount: 1 })
    ).toBeNull()
  })
})

describe('formatExportToast', () => {
  describe('file targets', () => {
    it('reports a plain PNG export', () => {
      expect(formatExportToast(saved(), { target: 'png' })).toEqual({
        title: 'PNG exported',
        message: 'Saved as diagram.png',
        type: 'success',
        duration: EXPORT_TOAST_SUCCESS_MS
      })
    })

    it('reports a plain PDF export', () => {
      const result = saved({ target: 'pdf', filePath: '/out/diagram.pdf' })

      expect(formatExportToast(result, { target: 'pdf' })).toMatchObject({
        title: 'PDF exported',
        message: 'Saved as diagram.pdf'
      })
    })

    it('appends the animated-GIF qualifier after an en dash', () => {
      const result = saved({
        filePath: '/out/loop.png',
        selection: { kind: 'gif-frame', frameCount: 12 }
      })

      expect(formatExportToast(result, { target: 'png' })?.message).toBe(
        'Saved as loop.png – first frame of 12'
      )
    })

    it('appends the multi-size-ICO qualifier', () => {
      const result = saved({
        filePath: '/out/favicon.png',
        selection: { kind: 'ico-size', width: 256, height: 256, sizeCount: 4 }
      })

      expect(formatExportToast(result, { target: 'png' })?.message).toBe(
        'Saved as favicon.png – 256 x 256 of 4 sizes'
      )
    })

    it('appends the SVG 2x qualifier', () => {
      const result = saved({
        target: 'pdf',
        filePath: '/out/logo.pdf',
        selection: { kind: 'svg-scaled', scale: 2, width: 1024, height: 1024 }
      })

      expect(formatExportToast(result, { target: 'pdf' })?.message).toBe(
        'Saved as logo.pdf – rendered at 2x (1024 x 1024)'
      )
    })

    it('shows only the basename of the destination', () => {
      const result = saved({ filePath: '/Users/someone/Desktop/private/diagram.png' })

      // The destination is outside the project and reflects the user's own
      // folder layout; the toast has no business repeating it.
      expect(formatExportToast(result, { target: 'png' })?.message).toBe('Saved as diagram.png')
    })

    it('middle-truncates a long basename', () => {
      const long = `${'a'.repeat(80)}.png`
      const message = formatExportToast(saved({ filePath: `/out/${long}` }), {
        target: 'png'
      })?.message

      expect(message).toContain('…')
      expect(message?.replace('Saved as ', '')).toHaveLength(TOAST_FILENAME_MAX_LENGTH)
    })
  })

  describe('clipboard target', () => {
    it('reports the copy without a filename', () => {
      const result = saved({ target: 'clipboard', filePath: undefined })

      expect(formatExportToast(result, { target: 'clipboard' })).toEqual({
        title: 'Copied to clipboard',
        message: 'Image copied as PNG',
        type: 'success',
        duration: EXPORT_TOAST_SUCCESS_MS
      })
    })

    it('still carries a qualifier', () => {
      const result = saved({
        target: 'clipboard',
        filePath: undefined,
        selection: { kind: 'gif-frame', frameCount: 12 }
      })

      expect(formatExportToast(result, { target: 'clipboard' })?.message).toBe(
        'Image copied as PNG – first frame of 12'
      )
    })
  })

  describe('failures', () => {
    it('quotes the resolved message under the export title', () => {
      expect(formatExportToast(failed('IMAGE_EXPORT_WRITE_FAILED'), { target: 'pdf' })).toEqual({
        title: 'Export failed',
        message: 'Could not write to that folder',
        type: 'error',
        duration: EXPORT_TOAST_ERROR_MS
      })
    })

    it('uses the copy title for a failed clipboard write', () => {
      const result = failed('IMAGE_EXPORT_CLIPBOARD_FAILED', 'The clipboard rejected the image')

      expect(formatExportToast(result, { target: 'clipboard' })).toMatchObject({
        title: 'Copy failed',
        message: 'The clipboard rejected the image'
      })
    })

    it('shows NOTHING for a cancelled save dialog', () => {
      // The user cancelled. Telling them they cancelled is noise, and this is
      // the one settled outcome with no toast at all.
      expect(formatExportToast(failed('IMAGE_EXPORT_CANCELLED'), { target: 'png' })).toBeNull()
      expect(formatExportToast(failed('IMAGE_EXPORT_CANCELLED'), { target: 'pdf' })).toBeNull()
    })

    it('stays silent rather than saying "Saved as " with no name', () => {
      // Unreachable through the schema, which requires `filePath` on a
      // non-clipboard success - but a half-sentence would be worse than silence.
      expect(formatExportToast(saved({ filePath: undefined }), { target: 'png' })).toBeNull()
    })
  })
})

describe('formatSettledAnnouncement', () => {
  const toast = {
    title: 'PNG exported',
    message: 'Saved as diagram.png',
    type: 'success'
  } as const

  const failure = {
    title: 'Export failed',
    message: 'Could not write to that folder',
    type: 'error'
  } as const

  it('clears the regions while the panel is the top surface', () => {
    // The toast region is reachable there, so letting it speak avoids saying
    // the same sentence twice.
    expect(formatSettledAnnouncement(toast, { isFullScreen: false })).toEqual(SILENT_ANNOUNCEMENT)
  })

  it('keeps the sentence while full screen, politely for a success', () => {
    // The overlay is aria-modal and the toast lives outside it, so this region
    // is the only channel a screen-reader user has.
    expect(formatSettledAnnouncement(toast, { isFullScreen: true })).toEqual({
      text: 'PNG exported: Saved as diagram.png',
      region: 'polite'
    })
  })

  it('routes a FAILURE to the assertive region', () => {
    // A politely announced failure can be queued behind whatever the reader is
    // already saying, or dropped - and the user is then left believing the file
    // was written.
    expect(formatSettledAnnouncement(failure, { isFullScreen: true })).toEqual({
      text: 'Export failed: Could not write to that folder',
      region: 'alert'
    })
  })

  it('announces nothing when there was no toast', () => {
    expect(formatSettledAnnouncement(null, { isFullScreen: true })).toEqual(SILENT_ANNOUNCEMENT)
    expect(formatSettledAnnouncement(null, { isFullScreen: false })).toEqual(SILENT_ANNOUNCEMENT)
  })
})

describe('politeAnnouncement', () => {
  it('wraps a sentence for the polite region', () => {
    expect(politeAnnouncement('Exporting as PNG…')).toEqual({
      text: 'Exporting as PNG…',
      region: 'polite'
    })
  })
})
