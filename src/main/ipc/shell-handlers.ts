// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { shell } from 'electron'
import { logger } from '../services/LoggingService'
import { registerHandle } from './registry'

/**
 * Shell IPC Handlers
 *
 * Opens external URLs in the system's default application.
 *
 * Security (sd-074b §7, phase 0). This handler previously accepted any string
 * and passed it straight to `shell.openExternal`, with a comment delegating
 * validation to the renderer — which is not a control the main process can
 * rely on, and stops being true at all once a previewed page can influence what
 * the renderer asks for. Electron's own security guidance is explicit that
 * `openExternal` misuse can compromise the host, and that URL checks must use a
 * parser rather than string comparison, because prefix matching is foolable.
 *
 * The gate is now:
 *  - the process-wide sender gate (`ipcSenderGate.ts`) — only our own renderer;
 *  - a `new URL()` parse — an unparseable string is refused;
 *  - exact `url.protocol` equality against {@link ALLOWED_EXTERNAL_PROTOCOLS};
 *  - refusal of embedded credentials (`user:pass@host`), a classic phishing and
 *    credential-leak shape;
 *  - a length bound, so a multi-megabyte string never reaches the OS handler.
 *
 * The normalised `URL.href` is what gets opened, so the string that was
 * validated is exactly the string that is launched.
 */

/**
 * Protocols this handler will hand to the OS.
 *
 * Deliberately identical to the renderer's existing `SAFE_EXTERNAL_PROTOCOLS`
 * (`src/renderer/src/utils/linkProtocols.ts`) so this hardening changes *how*
 * URLs are checked, not *which* links work — no existing markdown link
 * regresses. `tel:` and `ftp:` are inherited from that list; both route to an
 * OS-registered handler with no browser in between and are worth revisiting as
 * a product decision, separately from this security fix.
 */
const ALLOWED_EXTERNAL_PROTOCOLS: ReadonlySet<string> = new Set([
  'http:',
  'https:',
  'mailto:',
  'tel:',
  'ftp:'
])

/** Upper bound on an accepted URL. Well past any legitimate link. */
const MAX_URL_LENGTH = 2048

/**
 * Scheme + host only, for logging. The URL can carry user content (a mailto
 * body, a query string), so the full value is never written to a log file —
 * matching the redaction convention used elsewhere in the main process.
 */
function describeForLog(parsed: URL): string {
  return parsed.host ? `${parsed.protocol}//${parsed.host}` : parsed.protocol
}

export function registerShellHandlers(): void {
  /**
   * Open a URL in the system's default application.
   *
   * @param url - the URL to open; must parse and carry an allowed protocol
   * @returns Promise<void> - resolves once the OS handler has been invoked
   * @throws when the URL is missing, oversize, unparseable, carries a protocol
   *         outside {@link ALLOWED_EXTERNAL_PROTOCOLS}, or embeds credentials
   */
  registerHandle('shell:openExternal', async (_event, url: unknown) => {
    if (typeof url !== 'string' || url.length === 0 || url.length > MAX_URL_LENGTH) {
      logger.warn('Refused shell:openExternal — not a bounded string', {
        type: typeof url,
        length: typeof url === 'string' ? url.length : 0
      })
      throw new Error('Refused to open external URL')
    }

    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      logger.warn('Refused shell:openExternal — unparseable URL')
      throw new Error('Refused to open external URL')
    }

    if (!ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
      logger.warn('Refused shell:openExternal — protocol not allowed', {
        protocol: parsed.protocol
      })
      throw new Error('Refused to open external URL')
    }

    if (parsed.username !== '' || parsed.password !== '') {
      logger.warn('Refused shell:openExternal — URL embeds credentials', {
        target: describeForLog(parsed)
      })
      throw new Error('Refused to open external URL')
    }

    try {
      // Open the normalised href: what was validated is what is launched.
      await shell.openExternal(parsed.href)
      logger.info('External URL opened', { target: describeForLog(parsed) })
    } catch (error) {
      logger.error('Failed to open external URL', error instanceof Error ? error : undefined, {
        target: describeForLog(parsed)
      })
      throw error
    }
  })

  logger.info('✅ Shell IPC handlers registered')
}
