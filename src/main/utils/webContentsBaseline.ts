// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import type { WebContents } from 'electron'
import { logger } from '../services/LoggingService'
import { openExternalSafeDetached } from './openExternalSafe'

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
 * - A window-open request is always denied; an allowed external URL is routed
 *   through `openExternalSafe` instead.
 * - A navigation away from the current document is cancelled.
 *
 * Installed at creation, so a window that sets its own (stricter) handler later
 * simply replaces the open handler, and its own `will-navigate` listener runs
 * alongside this one.
 */
export function applyWebContentsBaseline(wc: BaselineTarget): void {
  wc.setWindowOpenHandler((details) => {
    openExternalSafeDetached(details.url)
    return { action: 'deny' }
  })
  wc.on('will-navigate', (event, url) => {
    const current = wc.getURL()
    if (withoutHash(url) !== withoutHash(current)) {
      logger.warn('Blocked webContents navigation')
      event.preventDefault()
    }
  })
}

export function registerWebContentsBaseline(app: {
  on(event: 'web-contents-created', listener: (e: unknown, wc: WebContents) => void): unknown
}): void {
  app.on('web-contents-created', (_event, wc) => {
    applyWebContentsBaseline(wc as unknown as BaselineTarget)
  })
}
