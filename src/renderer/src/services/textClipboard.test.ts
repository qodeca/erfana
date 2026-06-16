// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for TextClipboardService (renderer)
 *
 * Covers the transport-error chokepoint: write/read success + failure,
 * retry-once on transient failure, debounced toast coalescing a burst into a
 * single toast, and logger.error on every failure.
 *
 * Window-mock pitfall: extend `window` via `(window as any).api = …`; never use
 * `vi.stubGlobal('window')` (destroys React/DOM internals).
 *
 * @see Issue #203 - Central text-clipboard service
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// =============================================================================
// Mock renderer logger + toast helpers
// =============================================================================

const mockLoggerError = vi.fn()
vi.mock('../utils/logger', () => ({
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: (...args: unknown[]) => mockLoggerError(...args),
    fatal: vi.fn()
  }
}))

const mockShowErrorToast = vi.fn()
vi.mock('../utils/toastHelpers', () => ({
  showErrorToast: (...args: unknown[]) => mockShowErrorToast(...args)
}))

// =============================================================================
// Import after mocks
// =============================================================================

import { TextClipboardService } from './textClipboard'
import { CLIPBOARD_MAX_TEXT_LENGTH } from '../../../shared/ipc/clipboard-schema'

// =============================================================================
// Test harness
// =============================================================================

const mockWriteText = vi.fn()
const mockReadText = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  // Extend window — never replace it.
  ;(window as unknown as { api: unknown }).api = {
    clipboard: {
      writeText: mockWriteText,
      readText: mockReadText
    }
  }
})

afterEach(() => {
  vi.useRealTimers()
})

/** Advance fake timers and flush microtasks so awaited promises settle. */
async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
}

describe('TextClipboardService', () => {
  describe('writeText', () => {
    it('returns true on success without retry or toast', async () => {
      mockWriteText.mockResolvedValue(true)
      const service = new TextClipboardService()

      const result = await service.writeText('hello')

      expect(result).toBe(true)
      expect(mockWriteText).toHaveBeenCalledTimes(1)
      expect(mockWriteText).toHaveBeenCalledWith('hello')
      expect(mockLoggerError).not.toHaveBeenCalled()
      await advance(1000)
      expect(mockShowErrorToast).not.toHaveBeenCalled()
    })

    it('retries once and returns true when the first attempt resolves false but the retry succeeds', async () => {
      mockWriteText.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
      const service = new TextClipboardService()

      const promise = service.writeText('hello')
      await advance(50) // RETRY_DELAY_MS

      await expect(promise).resolves.toBe(true)
      expect(mockWriteText).toHaveBeenCalledTimes(2)
      expect(mockLoggerError).not.toHaveBeenCalled()
      await advance(1000)
      expect(mockShowErrorToast).not.toHaveBeenCalled()
    })

    it('retries once on throw and resolves true when the retry succeeds (no toast)', async () => {
      mockWriteText.mockRejectedValueOnce(new Error('transient')).mockResolvedValueOnce(true)
      const service = new TextClipboardService()

      const promise = service.writeText('hello')
      await advance(50)

      await expect(promise).resolves.toBe(true)
      expect(mockWriteText).toHaveBeenCalledTimes(2)
      expect(mockLoggerError).not.toHaveBeenCalled()
      await advance(1000)
      expect(mockShowErrorToast).not.toHaveBeenCalled()
    })

    it('returns false, logs error, and shows a debounced toast when both attempts fail', async () => {
      mockWriteText.mockResolvedValue(false)
      const service = new TextClipboardService()

      const promise = service.writeText('hello')
      await advance(50)

      await expect(promise).resolves.toBe(false)
      expect(mockWriteText).toHaveBeenCalledTimes(2)
      expect(mockLoggerError).toHaveBeenCalledTimes(1)

      // Toast is debounced — not fired yet.
      expect(mockShowErrorToast).not.toHaveBeenCalled()
      await advance(500) // TOAST_DEBOUNCE_MS
      expect(mockShowErrorToast).toHaveBeenCalledTimes(1)
    })

    it('logs error and shows toast when both attempts throw', async () => {
      mockWriteText.mockRejectedValue(new Error('locked'))
      const service = new TextClipboardService()

      const promise = service.writeText('hello')
      await advance(50)

      await expect(promise).resolves.toBe(false)
      expect(mockLoggerError).toHaveBeenCalledTimes(1)
      await advance(500)
      expect(mockShowErrorToast).toHaveBeenCalledTimes(1)
    })

    it('logs the FIRST attempt error when the retry resolves a non-throw failure', async () => {
      // First attempt throws 'first'; the retry resolves false (a non-throw
      // failure). The captured first error must be the one logged so
      // logger.error never receives undefined.
      mockWriteText.mockRejectedValueOnce(new Error('first')).mockResolvedValueOnce(false)
      const service = new TextClipboardService()

      const promise = service.writeText('hello')
      await advance(50)

      await expect(promise).resolves.toBe(false)
      expect(mockLoggerError).toHaveBeenCalledTimes(1)
      const [, loggedError] = mockLoggerError.mock.calls[0]
      expect(loggedError).toBeInstanceOf(Error)
      expect((loggedError as Error).message).toBe('first')
    })
  })

  describe('readText', () => {
    it('returns the clipboard text on success', async () => {
      mockReadText.mockResolvedValue('pasted')
      const service = new TextClipboardService()

      await expect(service.readText()).resolves.toBe('pasted')
      expect(mockReadText).toHaveBeenCalledTimes(1)
      expect(mockLoggerError).not.toHaveBeenCalled()
    })

    it("returns '' immediately for an empty clipboard — one invoke, no retry, no error, no toast", async () => {
      // A legitimately empty clipboard resolves '' on the FIRST attempt: success,
      // not failure. No second invoke, no logger.error, no toast (advance timers
      // past both the retry delay and the toast debounce to prove it).
      mockReadText.mockResolvedValue('')
      const service = new TextClipboardService()

      await expect(service.readText()).resolves.toBe('')
      expect(mockReadText).toHaveBeenCalledTimes(1)
      expect(mockLoggerError).not.toHaveBeenCalled()

      await advance(1000)
      expect(mockReadText).toHaveBeenCalledTimes(1)
      expect(mockShowErrorToast).not.toHaveBeenCalled()
    })

    it("returns the recovered text when the first attempt throws but the retry resolves '' ", async () => {
      // A throw is a transport failure → retry once. If the retry resolves an
      // empty clipboard, that is a success: return '' with no error/toast.
      mockReadText.mockRejectedValueOnce(new Error('transient')).mockResolvedValueOnce('')
      const service = new TextClipboardService()

      const promise = service.readText()
      await advance(50)

      await expect(promise).resolves.toBe('')
      expect(mockReadText).toHaveBeenCalledTimes(2)
      expect(mockLoggerError).not.toHaveBeenCalled()
      await advance(1000)
      expect(mockShowErrorToast).not.toHaveBeenCalled()
    })

    it('retries once and returns text when the first attempt rejects but the retry resolves', async () => {
      mockReadText.mockRejectedValueOnce(new Error('transient')).mockResolvedValueOnce('pasted')
      const service = new TextClipboardService()

      const promise = service.readText()
      await advance(50)

      await expect(promise).resolves.toBe('pasted')
      expect(mockReadText).toHaveBeenCalledTimes(2)
      expect(mockLoggerError).not.toHaveBeenCalled()
      await advance(1000)
      expect(mockShowErrorToast).not.toHaveBeenCalled()
    })

    it("returns '', logs error, and shows a debounced toast when both attempts fail", async () => {
      mockReadText.mockRejectedValue(new Error('locked'))
      const service = new TextClipboardService()

      const promise = service.readText()
      await advance(50)

      await expect(promise).resolves.toBe('')
      expect(mockReadText).toHaveBeenCalledTimes(2)
      expect(mockLoggerError).toHaveBeenCalledTimes(1)
      await advance(500)
      expect(mockShowErrorToast).toHaveBeenCalledTimes(1)
    })
  })

  describe('a queued failure is not cancelled by a later unrelated success', () => {
    it('still announces a write failure even when a different write succeeds within the debounce window', async () => {
      const service = new TextClipboardService()

      // First write fails on both attempts → schedules a debounced toast.
      mockWriteText.mockResolvedValue(false)
      const failed = service.writeText('a')
      await advance(50)
      await expect(failed).resolves.toBe(false)
      expect(mockLoggerError).toHaveBeenCalledTimes(1)
      // Toast is queued but not yet fired.
      expect(mockShowErrorToast).not.toHaveBeenCalled()

      // A subsequent successful write must NOT swallow the queued failure: a
      // genuine failure that already occurred is still surfaced to the user.
      mockWriteText.mockResolvedValue(true)
      await expect(service.writeText('b')).resolves.toBe(true)

      await advance(500)
      expect(mockShowErrorToast).toHaveBeenCalledTimes(1)
    })

    it('still announces a read failure even when a later read succeeds within the debounce window', async () => {
      const service = new TextClipboardService()

      mockReadText.mockRejectedValue(new Error('locked'))
      const failed = service.readText()
      await advance(50)
      await expect(failed).resolves.toBe('')
      expect(mockShowErrorToast).not.toHaveBeenCalled()

      mockReadText.mockReset().mockResolvedValue('recovered')
      await expect(service.readText()).resolves.toBe('recovered')

      await advance(500)
      expect(mockShowErrorToast).toHaveBeenCalledTimes(1)
    })
  })

  describe('over-cap writeText short-circuit', () => {
    it('does not invoke and returns false (logs + debounced toast) for an over-cap payload', async () => {
      const service = new TextClipboardService()
      // One char over the cap → deterministic reject, fail fast.
      const oversize = 'x'.repeat(CLIPBOARD_MAX_TEXT_LENGTH + 1)

      await expect(service.writeText(oversize)).resolves.toBe(false)

      // No IPC at all — neither attempt nor retry.
      expect(mockWriteText).not.toHaveBeenCalled()
      expect(mockLoggerError).toHaveBeenCalledTimes(1)
      await advance(500)
      expect(mockShowErrorToast).toHaveBeenCalledTimes(1)
    })

    it('invokes normally for a payload exactly at the cap', async () => {
      mockWriteText.mockResolvedValue(true)
      const service = new TextClipboardService()
      const atCap = 'x'.repeat(CLIPBOARD_MAX_TEXT_LENGTH)

      await expect(service.writeText(atCap)).resolves.toBe(true)
      expect(mockWriteText).toHaveBeenCalledTimes(1)
    })
  })

  describe('toast debounce coalescing', () => {
    it('coalesces a burst of failures into a single toast while logging each failure', async () => {
      mockWriteText.mockResolvedValue(false)
      const service = new TextClipboardService()

      // Fire a burst of three failing writes within the debounce window.
      const p1 = service.writeText('a')
      await advance(50)
      const p2 = service.writeText('b')
      await advance(50)
      const p3 = service.writeText('c')
      await advance(50)

      await Promise.all([p1, p2, p3])

      // Every failure logs…
      expect(mockLoggerError).toHaveBeenCalledTimes(3)
      // …but only one toast fires once the debounce window elapses.
      expect(mockShowErrorToast).not.toHaveBeenCalled()
      await advance(500)
      expect(mockShowErrorToast).toHaveBeenCalledTimes(1)

      // A SECOND burst after the window re-fires a (single) toast — the
      // debounce coalesces within a window, it does not suppress later failures.
      const p4 = service.writeText('d')
      await advance(50)
      await p4
      expect(mockShowErrorToast).toHaveBeenCalledTimes(1)
      await advance(500)
      expect(mockShowErrorToast).toHaveBeenCalledTimes(2)
    })
  })
})
