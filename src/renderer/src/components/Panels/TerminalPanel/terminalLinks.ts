// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Where a link clicked in the terminal opens (spec 025, 025-FR-009,
 * 025-FR-045; solution design § 9.2).
 *
 * - A plain click on an `http` or `https` link opens it in a new browser tab
 *   (source `terminalLink`).
 * - Cmd-click on macOS, Ctrl-click elsewhere, opens it in the operating
 *   system's default browser through the existing checked external-open path
 *   (`shell:openExternal`, validated in main) – what a plain click did before.
 * - Any other scheme, or no editor area to open a tab in (no project open),
 *   goes the external-open path too, which main checks as before.
 *
 * The URL is never logged (025-FR-064).
 *
 * @module TerminalPanel/terminalLinks
 */
import { useProjectStore } from '../../../stores/useProjectStore'
import { openBrowserTabAt } from '../../../utils/openBrowserTabAt'
import { isMacOS } from '../../../utils/platform'
import { logger } from '../../../utils/logger'

/** What {@link openTerminalLink} uses; the defaults are the app's. */
export interface TerminalLinkDeps {
  readonly isMac: () => boolean
  /** The checked external-open path. */
  readonly openExternal: (url: string) => Promise<void>
  /** A new browser tab at `url`; `false` when there is no editor area. */
  readonly openInTab: (url: string) => Promise<boolean>
}

const APP_DEPS: TerminalLinkDeps = {
  isMac: isMacOS,
  openExternal: url => window.electron.shell.openExternal(url),
  openInTab: url => openBrowserTabAt(useProjectStore.getState().dockviewApi, { kind: 'url', url, source: 'terminalLink' })
}

/**
 * Whether a click asks for the system browser: Cmd on macOS, Ctrl elsewhere.
 *
 * @param event - The click's modifier keys
 * @param mac - Whether this is macOS
 */
export function wantsSystemBrowser(event: Pick<MouseEvent, 'metaKey' | 'ctrlKey'>, mac: boolean): boolean {
  return mac ? event.metaKey : event.ctrlKey
}

function isWebLink(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Open a link the user clicked in the terminal.
 *
 * @param url - The link (the web-links addon matches `http` and `https` only)
 * @param event - The click
 * @param deps - {@link TerminalLinkDeps}
 * @throws Whatever the external-open path throws (the caller reports it)
 */
export async function openTerminalLink(url: string, event: MouseEvent, deps: TerminalLinkDeps = APP_DEPS): Promise<void> {
  if (!wantsSystemBrowser(event, deps.isMac()) && isWebLink(url) && (await deps.openInTab(url))) return
  await deps.openExternal(url)
}

/** The link handler's error report: no URL in the log. */
export function warnTerminalLinkNotOpened(error: unknown): void {
  logger.warn('Terminal link not opened', { error: error instanceof Error ? error.message : String(error) })
}
