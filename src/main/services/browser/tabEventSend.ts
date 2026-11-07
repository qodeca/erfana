// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The one way a browser tab event reaches its window (spec 025, solution
 * design § 8): to the owning window only, after its schema check. An event
 * that does not match its schema is dropped and logged, never sent. Moved out
 * of `BrowserTabService.ts`, which is at its size limit.
 */
import { logger } from '../LoggingService'
import type { TabHost } from './BrowserTab'

/** Send `payload` on `channel` to `host` when it is alive and `payload` matches `schema`. */
export function sendTabEvent(
  host: TabHost,
  channel: string,
  schema: { safeParse(value: unknown): { success: boolean } },
  payload: unknown
): void {
  if (host.isDestroyed() || host.webContents.isDestroyed()) return
  if (!schema.safeParse(payload).success) {
    logger.error('Dropped a browser tab event that does not match its schema', undefined, { channel })
    return
  }
  host.webContents.send(channel, payload)
}
