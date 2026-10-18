// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { shell } from 'electron'
import { logger } from '../services/LoggingService'
import { describeUrlForLog, parseExternalUrl } from './externalUrl'

/**
 * The ONLY module allowed to import `shell` from electron (enforced by ESLint).
 * Every route that hands a URL to the operating system goes through here.
 */

/** Thrown when a URL fails the external-open check. Carries no URL content. */
export class ExternalUrlRefusedError extends Error {
  constructor() {
    super('Refused to open external URL')
    this.name = 'ExternalUrlRefusedError'
  }
}

/**
 * Open a URL in the system's default application after checking it.
 *
 * @param url - Untrusted value.
 * @throws {ExternalUrlRefusedError} when {@link parseExternalUrl} rejects it.
 */
export async function openExternalSafe(url: unknown): Promise<void> {
  const href = parseExternalUrl(url)
  if (href === null) {
    logger.warn('Refused external open', {
      type: typeof url,
      length: typeof url === 'string' ? url.length : 0
    })
    throw new ExternalUrlRefusedError()
  }

  try {
    await shell.openExternal(href)
    logger.info('External URL opened', { target: describeUrlForLog(href) })
  } catch (error) {
    logger.error('Failed to open external URL', error instanceof Error ? error : undefined, {
      target: describeUrlForLog(href)
    })
    throw error
  }
}

/** Fire-and-forget variant for event handlers that cannot await. Never throws. */
export function openExternalSafeDetached(url: unknown): void {
  openExternalSafe(url).catch(() => {
    // already logged by openExternalSafe
  })
}

const SYSTEM_SETTINGS_PREFIX = 'x-apple.systempreferences:'

/**
 * Open a fixed, app-authored OS settings pane (macOS only). Not for page or
 * user supplied values: only the system-settings scheme is accepted.
 */
export async function openSystemSettingsPane(pane: string): Promise<void> {
  if (!pane.startsWith(SYSTEM_SETTINGS_PREFIX)) throw new ExternalUrlRefusedError()
  await shell.openExternal(pane)
}
