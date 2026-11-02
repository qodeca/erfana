// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import type { WebContents } from 'electron'
import { logger } from '../services/LoggingService'

/** The subset of a `webContents` the baseline touches. */
export interface BaselineTarget {
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): void
  on(
    event: 'will-navigate',
    listener: (event: { preventDefault(): void }, url: string) => void
  ): unknown
  getURL(): string
}

/** Drop the fragment so same-document anchor moves are not treated as a leave. */
function withoutHash(url: string): string {
  const index = url.indexOf('#')
  return index === -1 ? url : url.slice(0, index)
}

/**
 * Deny-by-default window-open and navigation policy for every webContents.
 *
 * - A window-open request is always denied. Nothing is opened: a window that
 *   wants links to reach the OS (the main window) sets its own handler that
 *   goes through `openExternalSafeDetached`.
 * - A navigation away from the current document is cancelled.
 *
 * Installed at creation, so a window that sets its own (stricter) handler later
 * simply replaces the open handler, and its own `will-navigate` listener runs
 * alongside this one.
 */
export function applyWebContentsBaseline(wc: BaselineTarget): void {
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
  wc.on('will-navigate', (event, url) => {
    const current = wc.getURL()
    if (withoutHash(url) !== withoutHash(current)) {
      logger.warn('Blocked webContents navigation')
      event.preventDefault()
    }
  })
}

/**
 * Decides, per created `webContents`, whether the baseline applies. The
 * default applies it to every one. The built-in browser passes its session
 * registry (`services/browser/browserSessionRegistry.ts`): only REGISTERED
 * browser view ids skip the baseline, and an unregistered `webContents` in a
 * browser session gets the baseline and is then refused (spec 025, ADR 0009
 * decision 5).
 */
export interface BaselineGate<T> {
  classify(wc: T): 'baseline' | 'exempt' | 'refused'
  refuse(wc: T): void
}

const APPLY_TO_ALL: BaselineGate<unknown> = {
  classify: () => 'baseline',
  refuse: () => undefined
}

export function registerWebContentsBaseline<T = WebContents>(
  app: {
    on(event: 'web-contents-created', listener: (e: unknown, wc: T) => void): unknown
  },
  gate: BaselineGate<T> = APPLY_TO_ALL
): void {
  app.on('web-contents-created', (_event, wc) => {
    const verdict = gate.classify(wc)
    if (verdict === 'exempt') return
    // A refused webContents gets the baseline first, so it can open and
    // navigate nothing in the moment before it is closed.
    applyWebContentsBaseline(wc as unknown as BaselineTarget)
    if (verdict === 'refused') gate.refuse(wc)
  })
}
