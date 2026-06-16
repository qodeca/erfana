// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Central text-clipboard service (renderer)
 *
 * Single chokepoint every in-scope text surface routes through for clipboard
 * read/write. Backed by Electron's native `clipboard` module in the main
 * process via the async, Zod-validated `window.api.clipboard` bridge.
 *
 * Transport-error chokepoint (design §4/§8): a failed `invoke` is retried once
 * after a short delay; if it still fails the service ALWAYS logs an error and
 * surfaces a debounced error toast (a burst of failures coalesces into a single
 * toast). Clipboard *semantics* (empty selection, empty clipboard, max-length)
 * stay per-surface by design.
 *
 * Read vs write failure signals differ:
 * - `writeText` returns `boolean`; `false` is a real failure (retry it).
 * - `readText` returns `string`; an empty string is a LEGITIMATELY EMPTY
 *   clipboard, NOT a failure. The read path therefore only retries / surfaces a
 *   failure when the underlying `invoke` THROWS — never when it resolves `''`.
 *
 * @see Issue #203 - Central text-clipboard service
 * @see docs/design/issue-203-clipboard-service.md §4 (renderer service API)
 */
import { logger } from '../utils/logger'
import { showErrorToast } from '../utils/toastHelpers'
import { isWithinClipboardCap } from '../../../shared/ipc/clipboard-schema'

/** Delay before the single retry of a failed transport operation (ms). */
const RETRY_DELAY_MS = 50

/** Window within which repeated failures coalesce into a single toast (ms). */
const TOAST_DEBOUNCE_MS = 500

/**
 * Error toasts PERSIST until the user dismisses them (manual dismiss via the
 * toast's Close button). A clipboard failure is a real, actionable error the
 * user should not miss to an auto-dismiss timer.
 */
const TOAST_DURATION_PERSIST = 0

const TOAST_TITLE = 'Clipboard error'
const TOAST_MESSAGE =
  'Could not access the clipboard — another app may be using it. Try again in a moment.'

/** Resolve after `ms` milliseconds. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Renderer-side clipboard service.
 *
 * Exposed as the {@link textClipboard} singleton; tests swap it via a
 * module-level `vi.mock('../services/textClipboard', …)` rather than a hook
 * seam (the hook had no consumers and was removed).
 */
export class TextClipboardService {
  /** Pending debounce timer for the coalesced error toast, if any. */
  private toastTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * Write plain text to the OS clipboard.
   *
   * Deterministic over-cap short-circuit: a payload exceeding the Zod cap is
   * rejected by the main process anyway, so we fail fast here — no invoke, no
   * retry, no cloning a multi-MB string across IPC — and surface the failure
   * through the normal failure path (the user genuinely could not copy).
   *
   * Otherwise retries once on transport failure (`false`); on continued failure
   * logs an error and shows a debounced toast.
   *
   * @param text - text to copy
   * @returns `true` on success, `false` on failure
   */
  async writeText(text: string): Promise<boolean> {
    if (!isWithinClipboardCap(text)) {
      this.handleFailure()
      return false
    }
    // `false` is a real transport failure for write → treat it as such.
    return this.retry(() => window.api.clipboard.writeText(text), false, (v) => v === false)
  }

  /**
   * Read plain text from the OS clipboard.
   *
   * Returns untrusted plain text — consumers MUST treat as data (no
   * innerHTML/eval/dangerouslySetInnerHTML).
   *
   * An empty clipboard is a SUCCESS, not a failure: when the underlying invoke
   * resolves `''` on the first attempt the service returns `''` immediately —
   * no retry, no second invoke, no `logger.error`, no toast. Only a THROW is a
   * transport failure: it is retried once after a short delay, and continued
   * failure logs an error, shows a debounced toast, and returns `''`.
   *
   * @returns the clipboard text, or `''` on transport failure / empty clipboard
   */
  async readText(): Promise<string> {
    // Read uses the default `isFailure` (throw-only): a resolved value —
    // including '' for an empty clipboard — is returned as-is, never retried.
    return this.retry(() => window.api.clipboard.readText(), '')
  }

  /**
   * Run a transport operation with a single retry after {@link RETRY_DELAY_MS}.
   *
   * A failure is EITHER a thrown error OR a resolved value the caller flags via
   * `isFailure` (write passes `v => v === false`; read uses the throw-only
   * default). On continued failure the FIRST attempt's thrown error is captured
   * and passed (`retryError ?? firstError`) to {@link handleFailure} so
   * `logger.error` never receives `undefined`.
   *
   * @param attempt - the transport call to run (and retry once)
   * @param fallback - the value returned on continued failure
   * @param isFailure - flags a resolved value as a failure (default: never)
   */
  private async retry<T>(
    attempt: () => Promise<T>,
    fallback: T,
    isFailure: (value: T) => boolean = () => false
  ): Promise<T> {
    let firstError: unknown
    try {
      const first = await attempt()
      if (!isFailure(first)) return first
    } catch (error) {
      firstError = error
    }

    try {
      await delay(RETRY_DELAY_MS)
      const second = await attempt()
      if (!isFailure(second)) return second
      this.handleFailure(firstError)
      return fallback
    } catch (retryError) {
      this.handleFailure(retryError ?? firstError)
      return fallback
    }
  }

  /**
   * Always log the failure; surface a debounced (coalesced) error toast.
   *
   * A queued failure is NEVER cancelled by a later unrelated success — only the
   * debounce coalesces a BURST of failures into a single toast.
   */
  private handleFailure(error?: unknown): void {
    logger.error('Clipboard operation failed', error instanceof Error ? error : undefined)
    this.scheduleToast()
  }

  /** Debounce error toasts so a burst of failures yields a single toast. */
  private scheduleToast(): void {
    if (this.toastTimer !== null) {
      clearTimeout(this.toastTimer)
    }
    this.toastTimer = setTimeout(() => {
      this.toastTimer = null
      // duration 0 → persists until manually dismissed (Close button).
      showErrorToast(TOAST_TITLE, TOAST_MESSAGE, TOAST_DURATION_PERSIST)
    }, TOAST_DEBOUNCE_MS)
  }
}

/** Singleton instance shared by all consumers. */
export const textClipboard = new TextClipboardService()
