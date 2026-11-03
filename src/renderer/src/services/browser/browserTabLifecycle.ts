// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Which main-process tab an editor panel hosts, from its opening to its close
 * (spec 025, solution design § 9.1, commit 17).
 *
 * - **Open.** {@link ensureBrowserTab} asks main for a tab once per panel –
 *   a remount (error boundary, React's development double mount) gets the
 *   same answer – or adopts a tab main already made (a tab the page opened,
 *   `browser-tab:tabAdded`). The tab is then hosted in the store and its view
 *   registered with the bounds owner, which keeps it hidden until the
 *   native-view guard shows it.
 * - **Close.** {@link closeBrowserTab} runs when dockview removes the panel.
 *   The panel is marked closing first, so the guard hides the page in the same
 *   tick (a page left attached would paint over the next editor tab), then
 *   the view is unregistered and main is asked to close the tab.
 *
 * KNOWN GAP (reported with commit 17): main sends no event when a tab it holds
 * goes away, so the editor tab closes at once on the user's close even when
 * the page asks to stay (025-FR-058); the leave-page row is commit 18's.
 */
import { browserTabGateway } from '../browserTabGateway'
import { browserViewBounds } from './browserViewBounds'
import { useBrowserTabStore } from '../../stores/useBrowserTabStore'
import { logger } from '../../utils/logger'

/** What opening a panel's tab came to. */
export type EnsureTabResult = { readonly tabId: string } | { readonly error: string }

/** Requests in flight or settled, by panel: one `create` per panel. */
const opening = new Map<string, Promise<EnsureTabResult>>()

/** Host `tabId` in `panelId`: store entry first, then the view the guard decides. */
function host(panelId: string, tabId: string): void {
  useBrowserTabStore.getState().attach(panelId, tabId)
  browserViewBounds.register(tabId, panelId)
}

/** Whether the panel was closed while its `create` was in flight. */
function closedMeanwhile(panelId: string): boolean {
  return !opening.has(panelId)
}

async function create(panelId: string): Promise<EnsureTabResult> {
  try {
    const response = await browserTabGateway.create(panelId)
    if ('error' in response) return response
    if (closedMeanwhile(panelId)) {
      // The editor tab went before main answered: nothing hosts this tab.
      await browserTabGateway.close(response.tabId)
      return { error: 'The tab closed' }
    }
    host(panelId, response.tabId)
    return response
  } catch (error) {
    logger.error('Browser tab could not be created', error instanceof Error ? error : undefined)
    return { error: 'The browser tab could not open' }
  }
}

/**
 * The tab hosted by `panelId`, opening it once.
 *
 * @param panelId - The editor panel (`browser-panel-…`)
 * @param adoptTabId - A tab main already made for this panel (page-opened); no `create` is sent
 * @returns The tab id, or the error main gave (shown as a toast by the caller)
 *
 * @example
 * ```ts
 * const result = await ensureBrowserTab('browser-panel-1')
 * if ('error' in result) showErrorToast('Browser tab', result.error)
 * ```
 */
export function ensureBrowserTab(panelId: string, adoptTabId?: string): Promise<EnsureTabResult> {
  const known = opening.get(panelId)
  if (known !== undefined) return known
  let result: Promise<EnsureTabResult>
  if (adoptTabId === undefined) {
    result = create(panelId)
  } else {
    host(panelId, adoptTabId)
    result = Promise.resolve({ tabId: adoptTabId })
  }
  opening.set(panelId, result)
  return result
}

/**
 * The editor tab `panelId` was removed: hide its page, forget it, close it in main.
 *
 * @param panelId - The removed editor panel; a panel that hosts no tab is ignored
 */
export function closeBrowserTab(panelId: string): void {
  const pending = opening.get(panelId)
  opening.delete(panelId)
  const store = useBrowserTabStore.getState()
  const tabId = store.tabOf(panelId)
  if (pending === undefined && tabId === null) return
  // Covered first: the guard hides the page while it is still registered.
  store.markClosing(panelId)
  if (tabId !== null) {
    browserViewBounds.unregister(tabId)
    browserTabGateway.close(tabId).catch((error: unknown) => {
      logger.error('Browser tab could not be closed', error instanceof Error ? error : undefined)
    })
  }
  useBrowserTabStore.getState().removePanel(panelId)
}

/** Forget every panel (tests). Tabs in main are not closed. */
export function resetBrowserTabLifecycle(): void {
  opening.clear()
}
