// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Open a browser tab already pointed somewhere (spec 025): a link clicked in
 * the terminal (025-FR-009, source `terminalLink`) or the HTML Preview's
 * **Open in browser tab** (025-FR-010, the previewed file from its served
 * folder, shown as its `file://` address).
 *
 * The tab opens like any new tab ({@link openBrowserTab}) but without putting
 * focus in its address bar; its main-process tab is asked for once – the
 * panel's own mount joins the same request (`ensureBrowserTab`) – and then
 * the load is started. A refusal is a toast; a tab that could not open is
 * already reported and closed by the panel.
 */
import type { DockviewApi } from 'dockview'
import type { NavigateResponse } from '../../../shared/ipc/browser-tab-schema'
import { browserTabGateway } from '../services/browserTabGateway'
import { ensureBrowserTab } from '../services/browser/browserTabLifecycle'
import { refusedMessage } from '../components/Panels/BrowserPanel/browserPanel.logic'
import { openBrowserTab } from './openBrowserTab'
import { showErrorToast } from './toastHelpers'
import { logger } from './logger'

/** Where the new tab goes. */
export type BrowserTabTarget =
  | { readonly kind: 'url'; readonly url: string; readonly source: 'terminalLink' }
  | { readonly kind: 'file'; readonly filePath: string }

/** The toast title of every refusal. */
export const OPEN_TAB_FAILED_TITLE = "Couldn't open the address"

function load(tabId: string, target: BrowserTabTarget): Promise<NavigateResponse> {
  return target.kind === 'url'
    ? browserTabGateway.navigate({ tabId, input: target.url, source: target.source })
    : browserTabGateway.openLocalFile(tabId, target.filePath)
}

function report(response: NavigateResponse, target: BrowserTabTarget): void {
  if ('ok' in response) return
  const input = target.kind === 'url' ? target.url : target.filePath
  const message = refusedMessage(response, input) ?? ('error' in response ? response.error : '')
  showErrorToast(OPEN_TAB_FAILED_TITLE, message)
}

/**
 * Open a browser tab at `target`.
 *
 * @param api - The editor area's dockview api, or `null` before it is ready
 * @param target - {@link BrowserTabTarget}
 * @returns `false` when there is no editor area to open it in (the caller may fall back), else `true`
 *
 * @example
 * ```ts
 * await openBrowserTabAt(useProjectStore.getState().dockviewApi, { kind: 'url', url, source: 'terminalLink' })
 * ```
 */
export async function openBrowserTabAt(api: DockviewApi | null | undefined, target: BrowserTabTarget): Promise<boolean> {
  const panel = openBrowserTab(api, { focusAddress: false })
  if (panel === undefined) return false
  const opened = await ensureBrowserTab(panel.id)
  if ('error' in opened) return true
  try {
    report(await load(opened.tabId, target), target)
  } catch (error) {
    logger.warn('Browser tab could not load its first address', { error: error instanceof Error ? error.message : String(error) })
    showErrorToast(OPEN_TAB_FAILED_TITLE, 'The browser tab did not answer.')
  }
  return true
}
