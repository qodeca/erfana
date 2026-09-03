// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The consent step between a previewed page and the OS browser (sd-074b §5.5).
 *
 * The URL has already been parsed and allow-listed by the navigation policy, and
 * the click was a genuine user gesture — but a gesture is not informed consent.
 * A previewed page owns its whole viewport and can move an anchor under the
 * cursor between mousedown and click, and the preview has no address bar, no
 * status bar and no hover-URL, so the destination is otherwise invisible.
 *
 * Three rules, each of which was learned the hard way:
 *
 * - **The dialog is owned by the window whose preview asked.** An unowned
 *   dialog (the shape this used to have) is not modal, is not raised with the
 *   app, and on Windows can sit behind it — and a consent question the reader
 *   cannot see is a link that silently does nothing. If that window is gone,
 *   the link is refused rather than asked on some other window: a question on
 *   an unrelated window cannot say which preview is asking.
 * - **One question at a time, and the others are refused, not queued.** Link
 *   routing is fire-and-forget, so without a gate several activations would
 *   each open a modal. Queueing them (the old `Promise` chain) meant a burst of
 *   clicks became a burst of sequential modals later. Now a second activation
 *   while one is open rejects, which the caller turns into a badge.
 * - **Every outcome is logged.** The 2026-09-03 Windows verification saw a click
 *   go nowhere with nothing in the log to say whether it had reached main at
 *   all; `asking` / `opened` / `cancelled` / `refused` make the next report
 *   diagnosable from the log alone. The destination logged is the origin, never
 *   the full href.
 */
import { logger } from '../../services/LoggingService'

/** The slice of `BrowserWindow` the dialog needs: identity only. */
export interface ConsentWindow {
  readonly id: number
  isDestroyed(): boolean
}

/** The slice of `dialog.showMessageBox`'s return value that decides the outcome. */
export interface ConsentAnswer {
  readonly response: number
}

/** The options handed to the dialog, mirroring Electron's `MessageBoxOptions`. */
export interface ConsentDialogOptions {
  readonly type: 'question'
  readonly buttons: string[]
  readonly defaultId: number
  readonly cancelId: number
  readonly message: string
  readonly detail: string
}

/** Injectable Electron surfaces, so the consent rules are unit-testable. */
export interface ExternalLinkConsentDeps {
  /** `BrowserWindow.fromId`, filtered to live windows; `null` when gone. */
  readonly resolveWindow: (windowId: number) => ConsentWindow | null
  /** `dialog.showMessageBox(window, options)` — always parented. */
  readonly showMessageBox: (
    window: ConsentWindow,
    options: ConsentDialogOptions
  ) => Promise<ConsentAnswer>
  /** `shell.openExternal`. */
  readonly openExternal: (url: string) => Promise<void>
}

/** Index of the "Open" button; Cancel is 0 and is also the escape/close answer. */
const OPEN_BUTTON = 1

/**
 * What the consent dialog names as the destination.
 *
 * `URL.origin` is the STRING `"null"` for every non-special scheme — `tel:`,
 * `sms:`, `mailto:` — and `"null"` is truthy, so `origin || protocol` printed
 * the literal word "null" as the destination. That dialog is the only thing
 * between an untrusted page and an OS hand-off, and for those schemes it named
 * nothing at all.
 *
 * Never the full href: it is attacker-controlled, so it is both a leak surface
 * (a `mailto:` body, a query string) and a log/UI-injection surface. Scheme plus
 * the addressed target is enough to decide with.
 */
export function describeExternalDestination(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return '(unparseable link)'
  }
  if (parsed.origin !== 'null' && parsed.origin !== '') {
    return parsed.origin
  }
  // Opaque-origin scheme: the pathname carries the number or address.
  const target = parsed.pathname
  return target === '' ? parsed.protocol : `${parsed.protocol}${target}`
}

/**
 * Build the `openExternal` dependency the live views call: ask on the given
 * window, open only on "Open", refuse (reject) when a question is already open
 * or the window is gone. A rejection is the caller's cue to badge the click.
 */
export function createExternalLinkConsent(
  deps: ExternalLinkConsentDeps
): (url: string, windowId: number) => Promise<void> {
  let pending = false

  return async (url: string, windowId: number): Promise<void> => {
    const destination = describeExternalDestination(url)

    if (pending) {
      logger.info('Preview external link: refused', { destination, reason: 'dialog-open' })
      throw new Error('An external-link question is already open')
    }
    const window = deps.resolveWindow(windowId)
    if (window === null) {
      logger.info('Preview external link: refused', { destination, reason: 'no-window', windowId })
      throw new Error('The window that asked is gone')
    }

    pending = true
    try {
      logger.info('Preview external link: asking', { destination, windowId })
      const { response } = await deps.showMessageBox(window, {
        type: 'question',
        buttons: ['Cancel', 'Open'],
        defaultId: 0,
        cancelId: 0,
        message: 'Open this link outside Erfana?',
        detail: `The preview wants to open:\n\n${destination}`
      })
      if (response !== OPEN_BUTTON) {
        logger.info('Preview external link: cancelled', { destination })
        return
      }
      logger.info('Preview external link: opened', { destination })
      await deps.openExternal(url)
    } finally {
      pending = false
    }
  }
}
