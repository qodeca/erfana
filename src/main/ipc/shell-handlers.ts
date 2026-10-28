// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { logger } from '../services/LoggingService'
import { openExternalSafe } from '../utils/openExternalSafe'
import { registerHandle } from './registry'

/**
 * Shell IPC Handlers
 *
 * Opens external URLs in the system's default application.
 *
 * The check itself (`parseExternalUrl`: parse, protocol allowlist from
 * `EXTERNAL_PROTOCOLS`, no credentials, no share-looking input, length bound)
 * and the open live in `../utils/openExternalSafe`, shared with the window-open
 * handler so every route to the OS goes through one path. The process-wide
 * sender gate in `registry.ts` still applies first.
 */
export function registerShellHandlers(): void {
  /**
   * Open a URL in the system's default application.
   *
   * @param url - the URL to open
   * @throws when the URL is refused by the external-open check
   */
  registerHandle('shell:openExternal', async (_event, url: unknown) => {
    await openExternalSafe(url)
  })

  logger.info('✅ Shell IPC handlers registered')
}
