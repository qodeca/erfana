// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for {@link useImageExportHandlers}.
 *
 * What these pin, in order of how much they would cost to get wrong:
 *
 * 1. A second click while an export is in flight is a NO-OP - never a second
 *    request that comes back as "another export is already running".
 * 2. Only the invoked flag flips, and it clears in `finally` on success, on a
 *    failure response and on a rejected invoke alike.
 * 3. Toasts go out on the provider-free `app:toast` channel, so the panel needs
 *    no `ToastProvider` in any of its suites.
 *
 * The live-region half - what is announced, where it lands and when it clears -
 * lives in the sibling `.announcement` suite, which needs the same ~100 lines of
 * scaffolding. Split because `vi.mock` for the logger hoists to module scope, so
 * the two halves cannot share a module without also sharing that hoist.
 *
 * @module useImageExportHandlers.test
 * @see Issue #73 - PNG / PDF / clipboard export controls in the image viewer
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

import type { ImageExportResponse } from '../../../../../../shared/ipc/image-export-schema'
import type { GlobalToastPayload } from '../../../Toast/toastService'
import {
  useImageExportHandlers,
  type UseImageExportHandlersResult
} from './useImageExportHandlers'
import { logger } from '../../../../utils/logger'

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

/**
 * The three busy flags in one assertable shape: `[png, pdf, clipboard]`.
 *
 * The hook exposes no combined `isBusy` - "any export is running" is derived by
 * the controls from these three, so a fourth flag cannot disagree with them.
 */
function busyFlags(result: UseImageExportHandlersResult): boolean[] {
  return [result.isExportingPng, result.isExportingPdf, result.isCopying]
}

describe('useImageExportHandlers', () => {
  describe('Request', () => {
    it('sends the displayed path and the invoked target', async () => {
      const { result } = renderExportHook()

      await act(async () => {
        result.current.onExportPng()
      })

      expect(run).toHaveBeenCalledTimes(1)
      expect(run).toHaveBeenCalledWith({ filePath: FILE_PATH, target: 'png' })
    })

    it('maps each handler to its own target', async () => {
      const { result } = renderExportHook()

      await act(async () => {
        result.current.onExportPdf()
      })
      await act(async () => {
        result.current.onCopyImage()
      })

      expect(run.mock.calls.map(([request]) => request.target)).toEqual(['pdf', 'clipboard'])
    })

    it('does nothing without a file path', async () => {
      const { result } = renderHook(() =>
        useImageExportHandlers({ filePath: '', isFullScreen: false })
      )

      await act(async () => {
        result.current.onExportPng()
      })

      expect(run).not.toHaveBeenCalled()
    })
  })

  describe('Busy state', () => {
    it('flips only the invoked flag, and marks everything busy', async () => {
      const gate = deferred<ImageExportResponse>()
      run.mockReturnValue(gate.promise)
      const { result } = renderExportHook()

      act(() => {
        result.current.onExportPdf()
      })

      await waitFor(() => expect(result.current.isExportingPdf).toBe(true))
      // Only the invoked flag flips. The controls mark all three busy from
      // these, which is what keeps a click that is legal within THIS panel from
      // coming back as an IMAGE_EXPORT_BUSY toast.
      expect(busyFlags(result.current)).toEqual([false, true, false])

      await act(async () => {
        gate.resolve({ ...PNG_OK, target: 'pdf' } as ImageExportResponse)
      })

      expect(busyFlags(result.current)).toEqual([false, false, false])
    })

    it('ignores a second click while an export is in flight', async () => {
      const gate = deferred<ImageExportResponse>()
      run.mockReturnValue(gate.promise)
      const { result } = renderExportHook()

      act(() => {
        result.current.onExportPng()
        // Same tick: the state has not re-rendered yet, so only the ref-based
        // guard can catch this one.
        result.current.onExportPng()
        result.current.onCopyImage()
      })

      expect(run).toHaveBeenCalledTimes(1)

      await act(async () => {
        gate.resolve(PNG_OK)
      })
    })

    it('clears the flag when the response is a failure', async () => {
      run.mockResolvedValue({
        success: false,
        errorCode: 'IMAGE_EXPORT_WRITE_FAILED',
        error: 'Could not write to that folder'
      } as unknown as ImageExportResponse)
      const { result } = renderExportHook()

      await act(async () => {
        result.current.onExportPng()
      })

      expect(busyFlags(result.current)).toEqual([false, false, false])
    })

    it('clears the flag when the invoke itself rejects', async () => {
      run.mockRejectedValue(new Error('bridge exploded'))
      const { result } = renderExportHook()

      await act(async () => {
        result.current.onExportPng()
      })

      // A stuck busy flag would leave the controls permanently unusable, which
      // is worse than the failure that caused it.
      expect(busyFlags(result.current)).toEqual([false, false, false])
    })

    it('accepts a new export after the previous one settled', async () => {
      const { result } = renderExportHook()

      await act(async () => {
        result.current.onExportPng()
      })
      await act(async () => {
        result.current.onExportPng()
      })

      expect(run).toHaveBeenCalledTimes(2)
    })
  })

  describe('Toasts', () => {
    it('announces a successful export', async () => {
      const { result } = renderExportHook()

      await act(async () => {
        result.current.onExportPng()
      })

      expect(toasts).toEqual([
        {
          title: 'PNG exported',
          message: 'Saved as icon.png',
          type: 'success',
          duration: 3000
        }
      ])
    })

    it('shows NO toast when the save dialog was cancelled', async () => {
      run.mockResolvedValue({
        success: false,
        errorCode: 'IMAGE_EXPORT_CANCELLED',
        error: 'Image export was cancelled'
      } as unknown as ImageExportResponse)
      const { result } = renderExportHook()

      await act(async () => {
        result.current.onExportPng()
      })

      expect(toasts).toEqual([])
    })

    it('quotes the resolved error message on a failure', async () => {
      run.mockResolvedValue({
        success: false,
        errorCode: 'IMAGE_EXPORT_CLIPBOARD_FAILED',
        error: 'The clipboard rejected the image'
      } as unknown as ImageExportResponse)
      const { result } = renderExportHook()

      await act(async () => {
        result.current.onCopyImage()
      })

      expect(toasts).toEqual([
        {
          title: 'Copy failed',
          message: 'The clipboard rejected the image',
          type: 'error',
          duration: 5000
        }
      ])
    })

    it('falls back to the catch-all message when the invoke rejects', async () => {
      run.mockRejectedValue(new Error('/Users/someone/secret/path is unreadable'))
      const { result } = renderExportHook()

      await act(async () => {
        result.current.onExportPdf()
      })

      expect(toasts).toHaveLength(1)
      expect(toasts[0].title).toBe('Export failed')
      // The raw error can carry an absolute path; it goes to the log, not the UI.
      expect(toasts[0].message).toBe('Image export failed')
      expect(toasts[0].message).not.toContain('/Users/')
      // The raw error is NOT recorded: a rejected invoke carries the
      // main-process message verbatim, and this log line lands on disk.
      expect(logger.error).toHaveBeenCalledWith('Image export bridge call failed', undefined, {
        target: 'pdf',
        reason: 'invoke-rejected'
      })
      expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain('/Users/')
    })
  })

})
