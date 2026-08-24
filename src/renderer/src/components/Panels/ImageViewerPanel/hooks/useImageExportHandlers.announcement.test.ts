// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Live-region tests for {@link useImageExportHandlers}.
 *
 * What these pin:
 *
 * 1. A cancelled save dialog produces no toast and no announcement.
 * 2. While the panel is on top the regions stay quiet - the toast is reachable
 *    there, and saying the same sentence twice is worse than saying it once.
 * 3. While FULL SCREEN they speak, because the overlay is `aria-modal="true"`
 *    and the toast regions are outside it. A failure goes to the assertive
 *    region: announced politely it can be queued or dropped, and the user is
 *    then left believing the file was written.
 * 4. The sentence clears itself on the matching toast's budget, and its timer
 *    does not outlive the panel.
 *
 * Scaffolding is duplicated from the sibling suite on purpose: `vi.mock` hoists
 * to module scope, so the two halves cannot share a module without sharing that
 * hoist (test-file split policy, docs/windows/contributing.md).
 *
 * @module useImageExportHandlers.announcement.test
 * @see Issue #73 - PNG / PDF / clipboard export controls in the image viewer
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

import type { ImageExportResponse } from '../../../../../../shared/ipc/image-export-schema'
import type { GlobalToastPayload } from '../../../Toast/toastService'
import { useImageExportHandlers } from './useImageExportHandlers'
import { logger } from '../../../../utils/logger'
import {
  EXPORT_TOAST_ERROR_MS,
  EXPORT_TOAST_SUCCESS_MS,
  politeAnnouncement,
  SILENT_ANNOUNCEMENT
} from '../imageExportToast.logic'
import { IMAGE_EXPORT_COPY } from '../imageViewerStatus.logic'

// The real renderer logger posts over a bridge that does not exist under jsdom
// and prints a stack per call; the assertions below only care THAT it was told.
vi.mock('../../../../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

const FILE_PATH = '/proj/icon.png'

/** A plain successful PNG export. */
const PNG_OK = {
  success: true,
  target: 'png',
  filePath: '/out/icon.png',
  output: { width: 256, height: 256 }
} as ImageExportResponse

/** Every toast dispatched during the current test, in order. */
let toasts: GlobalToastPayload[] = []
let listener: EventListener
let run: Mock<(request: { filePath: string; target: string }) => Promise<ImageExportResponse>>

/** Deferred promise, so a test can hold an export open and inspect the busy state. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.mocked(logger.error).mockClear()
  toasts = []
  listener = ((event: CustomEvent<GlobalToastPayload>) => {
    toasts.push(event.detail)
  }) as EventListener
  window.addEventListener('app:toast', listener)

  run = vi.fn<(request: { filePath: string; target: string }) => Promise<ImageExportResponse>>()
  run.mockResolvedValue(PNG_OK)
  // Extend `window`; never `vi.stubGlobal('window', …)`, which destroys React's
  // DOM internals.
  ;(window as unknown as { api: unknown }).api = { imageExport: { run } }
})

afterEach(() => {
  window.removeEventListener('app:toast', listener)
})

function renderExportHook(isFullScreen = false) {
  return renderHook(
    (props: { isFullScreen: boolean }) =>
      useImageExportHandlers({ filePath: FILE_PATH, isFullScreen: props.isFullScreen }),
    { initialProps: { isFullScreen } }
  )
}

describe('useImageExportHandlers – announcements', () => {
  describe('Live-region announcement', () => {
    it('is empty before anything happens', () => {
      const { result } = renderExportHook()
      expect(result.current.exportAnnouncement).toEqual(SILENT_ANNOUNCEMENT)
    })

    it('announces the busy sentence while in flight', async () => {
      const gate = deferred<ImageExportResponse>()
      run.mockReturnValue(gate.promise)
      const { result } = renderExportHook()

      act(() => {
        result.current.onCopyImage()
      })

      await waitFor(() =>
        expect(result.current.exportAnnouncement).toEqual(
          politeAnnouncement(IMAGE_EXPORT_COPY.clipboard.announceBusy)
        )
      )

      await act(async () => {
        gate.resolve(PNG_OK)
      })
    })

    it('clears on settle while the panel is the top surface', async () => {
      const { result } = renderExportHook(false)

      await act(async () => {
        result.current.onExportPng()
      })

      // The toast is reachable here, so the regions stay quiet rather than
      // saying the same sentence twice.
      expect(result.current.exportAnnouncement).toEqual(SILENT_ANNOUNCEMENT)
    })

    it('keeps the settled sentence while full screen', async () => {
      const { result } = renderExportHook(true)

      await act(async () => {
        result.current.onExportPng()
      })

      // The overlay is aria-modal and the toast lives outside it.
      expect(result.current.exportAnnouncement).toEqual(
        politeAnnouncement('PNG exported: Saved as icon.png')
      )
    })

    it('reads the surface at SETTLE time, not at click time', async () => {
      const gate = deferred<ImageExportResponse>()
      run.mockReturnValue(gate.promise)
      const { result, rerender } = renderExportHook(false)

      act(() => {
        result.current.onExportPng()
      })

      // The user went full screen while the save dialog was open.
      rerender({ isFullScreen: true })

      await act(async () => {
        gate.resolve(PNG_OK)
      })

      expect(result.current.exportAnnouncement).toEqual(
        politeAnnouncement('PNG exported: Saved as icon.png')
      )
    })

    it('re-states the RUNNING action for a click the controls swallowed', async () => {
      const gate = deferred<ImageExportResponse>()
      run.mockReturnValue(gate.promise)
      const { result } = renderExportHook()

      act(() => {
        result.current.onExportPdf()
      })
      await waitFor(() => expect(result.current.isExportingPdf).toBe(true))

      // The user clicked Copy 200 ms into a PDF export. The sentence names what
      // is actually running, never the button that was pressed.
      act(() => {
        result.current.onBusyClick()
      })

      expect(result.current.exportAnnouncement).toEqual(
        politeAnnouncement(IMAGE_EXPORT_COPY.pdf.announceBusy)
      )
      // A click the UI itself swallowed is not an error: no toast, ever.
      expect(toasts).toHaveLength(0)

      await act(async () => {
        gate.resolve(PNG_OK)
      })
    })

    it('says nothing when no export is running', () => {
      const { result } = renderExportHook()

      act(() => {
        result.current.onBusyClick()
      })

      expect(result.current.exportAnnouncement).toEqual(SILENT_ANNOUNCEMENT)
      expect(toasts).toHaveLength(0)
    })

    it('says nothing at all about a cancellation', async () => {
      run.mockResolvedValue({
        success: false,
        errorCode: 'IMAGE_EXPORT_CANCELLED',
        error: 'Image export was cancelled'
      } as unknown as ImageExportResponse)
      const { result } = renderExportHook(true)

      await act(async () => {
        result.current.onExportPng()
      })

      expect(result.current.exportAnnouncement).toEqual(SILENT_ANNOUNCEMENT)
    })

    it('routes a FAILURE to the assertive region', async () => {
      run.mockResolvedValue({
        success: false,
        errorCode: 'IMAGE_EXPORT_WRITE_FAILED',
        error: 'Could not write to that folder'
      } as unknown as ImageExportResponse)
      const { result } = renderExportHook(true)

      await act(async () => {
        result.current.onExportPng()
      })

      expect(result.current.exportAnnouncement).toEqual({
        text: 'Export failed: Could not write to that folder',
        region: 'alert'
      })
    })
  })

  describe('Clearing the settled sentence', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('empties the region once the success toast would have gone', async () => {
      const { result } = renderExportHook(true)

      await act(async () => {
        result.current.onExportPng()
      })
      expect(result.current.exportAnnouncement.text).not.toBe('')

      // Left standing, the sentence is still in the accessibility tree when the
      // user leaves full screen and the region re-mounts in the panel.
      await act(async () => {
        vi.advanceTimersByTime(EXPORT_TOAST_SUCCESS_MS - 1)
      })
      expect(result.current.exportAnnouncement.text).not.toBe('')

      await act(async () => {
        vi.advanceTimersByTime(1)
      })
      expect(result.current.exportAnnouncement).toEqual(SILENT_ANNOUNCEMENT)
    })

    it('gives a failure the longer error-toast window', async () => {
      run.mockResolvedValue({
        success: false,
        errorCode: 'IMAGE_EXPORT_WRITE_FAILED',
        error: 'Could not write to that folder'
      } as unknown as ImageExportResponse)
      const { result } = renderExportHook(true)

      await act(async () => {
        result.current.onExportPng()
      })

      await act(async () => {
        vi.advanceTimersByTime(EXPORT_TOAST_SUCCESS_MS)
      })
      expect(result.current.exportAnnouncement.region).toBe('alert')

      await act(async () => {
        vi.advanceTimersByTime(EXPORT_TOAST_ERROR_MS - EXPORT_TOAST_SUCCESS_MS)
      })
      expect(result.current.exportAnnouncement).toEqual(SILENT_ANNOUNCEMENT)
    })

    it('lets a new export supersede the pending clear', async () => {
      const { result } = renderExportHook(true)

      await act(async () => {
        result.current.onExportPng()
      })
      await act(async () => {
        vi.advanceTimersByTime(EXPORT_TOAST_SUCCESS_MS - 100)
      })

      const gate = deferred<ImageExportResponse>()
      run.mockReturnValue(gate.promise)
      act(() => {
        result.current.onExportPdf()
      })

      // The previous run's timer must not wipe the sentence THIS one is saying.
      await act(async () => {
        vi.advanceTimersByTime(200)
      })
      expect(result.current.exportAnnouncement).toEqual(
        politeAnnouncement(IMAGE_EXPORT_COPY.pdf.announceBusy)
      )

      await act(async () => {
        gate.resolve({ ...PNG_OK, target: 'pdf' } as ImageExportResponse)
      })
    })

    it('clears its timer on unmount', async () => {
      const clearSpy = vi.spyOn(globalThis, 'clearTimeout')
      const { result, unmount } = renderExportHook(true)

      await act(async () => {
        result.current.onExportPng()
      })
      clearSpy.mockClear()
      unmount()

      // A timer left running after unmount is a state write React warns about,
      // and it outlives the panel that owned the sentence.
      expect(clearSpy).toHaveBeenCalled()
      clearSpy.mockRestore()
    })
  })
})
