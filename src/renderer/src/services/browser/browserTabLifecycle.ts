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
 * - **The user's close** ({@link requestBrowserPanelClose}, commit 18): the
 *   editor tab stays while main asks the page; it goes only when main sends
 *   `browser-tab:tabClosed` ({@link browserTabClosedByMain}), so **Stay** on
 *   the leave-page prompt keeps it (025-FR-058). A tab main does not hold, or
 *   a request that fails, closes the editor tab at once.
 * - **Close.** {@link closeBrowserTab} runs when dockview removes the panel.
 *   The panel is marked closing first, so the guard hides the page in the same
 *   tick (a page left attached would paint over the next editor tab), then
 *   the view is unregistered. A tab main already closed is not asked again;
 *   any other (a project switch, Close all) is closed as Erfana's close
 *   (`byUser: false`), which never asks (S-31) – nothing would show the prompt.
 */
import { browserTabGateway } from '../browserTabGateway'
import { browserViewBounds } from './browserViewBounds'
import { useBrowserTabStore } from '../../stores/useBrowserTabStore'
import { useBrowserChromeStore } from '../../stores/useBrowserChromeStore'
import { logger } from '../../utils/logger'
import { browserStill } from './browserStill'

/** What opening a panel's tab came to. */
export type EnsureTabResult = { readonly tabId: string } | { readonly error: string }

/** Requests in flight or settled, by panel: one `create` per panel. */
const opening = new Map<string, Promise<EnsureTabResult>>()

/** Tabs main reported gone whose editor tab is being removed: not closed again. */
const closedInMain = new Set<string>()

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
      await browserTabGateway.close(response.tabId, false)
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
    useBrowserChromeStore.getState().dropTab(tabId)
    // Its still image and every holder go too, whatever the panel's effects managed before unmounting.
    browserStill.forget(tabId)
    if (!closedInMain.delete(tabId)) {
      browserTabGateway.close(tabId, false).catch((error: unknown) => {
        logger.error('Browser tab could not be closed', error instanceof Error ? error : undefined)
      })
    }
  }
  useBrowserTabStore.getState().removePanel(panelId)
}

/**
 * The user closes the editor tab `panelId` (its × button, middle click,
 * Ctrl/Cmd+W, the tab menu): main asks the page first.
 *
 * @param panelId - The browser panel
 * @param removePanel - Removes the editor tab now (dockview's `close`)
 *
 * @example
 * ```ts
 * requestBrowserPanelClose(panelId, () => api.close())
 * ```
 */
export function requestBrowserPanelClose(panelId: string, removePanel: () => void): void {
  const tabId = useBrowserTabStore.getState().tabOf(panelId)
  if (tabId === null) {
    removePanel()
    return
  }
  browserTabGateway
    .close(tabId)
    .then(held => {
      // `false`: main holds no such tab, so no `tabClosed` will come.
      if (held !== true) removePanel()
    })
    .catch((error: unknown) => {
      logger.error('Browser tab could not be closed', error instanceof Error ? error : undefined)
      removePanel()
    })
}

/**
 * Main reports `tabId` gone: hide its page, then remove its editor tab.
 *
 * @param tabId - The tab main closed
 * @param removePanel - Removes the editor tab `panelId` (dockview), which runs {@link closeBrowserTab}
 */
export function browserTabClosedByMain(tabId: string, removePanel: (panelId: string) => void): void {
  useBrowserChromeStore.getState().dropTab(tabId)
  const store = useBrowserTabStore.getState()
  const panelId = store.byTab.get(tabId)?.panelId
  if (panelId === undefined) return
  closedInMain.add(tabId)
  store.markClosing(panelId)
  removePanel(panelId)
  // A panel dockview no longer had: forget it here instead.
  if (closedInMain.delete(tabId)) {
    opening.delete(panelId)
    browserViewBounds.unregister(tabId)
    useBrowserTabStore.getState().removePanel(panelId)
  }
}

/** Forget every panel (tests). Tabs in main are not closed. */
export function resetBrowserTabLifecycle(): void {
  opening.clear()
  closedInMain.clear()
}
