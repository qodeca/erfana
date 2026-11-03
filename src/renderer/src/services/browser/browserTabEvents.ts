// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The window-wide built-in browser events (spec 025, solution design § 8 and
 * § 9.1, commit 17), subscribed once per window by `EditorAreaSplitPanel`:
 *
 * - `state` and `focus` → the browser tab store, which the panels and editor
 *   tabs read;
 * - `notice` of kind `localAddressSeen` → the empty tab's local addresses
 *   (025-FR-063), heard from the start so an address printed before the
 *   first browser tab opens is listed too;
 * - `tabAdded` → a new editor tab hosting the tab the page opened;
 * - `strip`, `findResult`, `contextMenu` → the chrome store the panels draw
 *   from (commit 18);
 * - `tabClosed` → the editor tab goes (`browserTabClosedByMain`);
 * - `newTabCommand` → the app menu's **New browser tab**.
 *
 * Forwarded keys are per panel (`useBrowserKeys`): acting on them needs the
 * panel's own controls.
 */
import type { TabAddedEvent } from '../../../../shared/ipc/browser-tab-bridge-types'
import { browserTabGateway } from '../browserTabGateway'
import { useBrowserTabStore } from '../../stores/useBrowserTabStore'
import { useBrowserChromeStore } from '../../stores/useBrowserChromeStore'
import { browserTabClosedByMain } from './browserTabLifecycle'

/** What the window does with a page-opened tab. */
export interface BrowserTabEventDeps {
  /** Host the tab main made in a new editor tab. */
  readonly openPageTab: (event: TabAddedEvent) => void
  /** Remove the editor tab `panelId` (main closed its tab). */
  readonly removePanel: (panelId: string) => void
  /** The app menu's **New browser tab**; `byKey` when Ctrl/Cmd+T fired it. */
  readonly newTabCommand: (byKey: boolean) => void
}

/**
 * Subscribe the window's browser events.
 *
 * @param deps - {@link BrowserTabEventDeps}
 * @returns One function that removes every subscription
 *
 * @example
 * ```ts
 * useEffect(() => mountBrowserTabEvents({ openPageTab: (e) => openBrowserTab(api, e) }), [])
 * ```
 */
export function mountBrowserTabEvents(deps: BrowserTabEventDeps): () => void {
  const store = useBrowserTabStore.getState
  // Every callback returns nothing: a value returned across the context
  // bridge is cloned, and one that cannot be (a dockview panel) throws inside
  // the preload's emitter and stops the other listeners on that channel.
  const unsubscribers = [
    browserTabGateway.onState(event => {
      store().applyState(event)
    }),
    browserTabGateway.onFocus(event => {
      store().setPageFocused(event.tabId, event.pageFocused)
    }),
    browserTabGateway.onNotice(event => {
      if (event.kind === 'localAddressSeen') store().addLocalAddress(event.text)
    }),
    browserTabGateway.onTabAdded(event => {
      deps.openPageTab(event)
    }),
    browserTabGateway.onStrip(event => {
      useBrowserChromeStore.getState().applyStrip(event)
    }),
    browserTabGateway.onFindResult(event => {
      useBrowserChromeStore.getState().applyFind(event)
    }),
    browserTabGateway.onContextMenu(event => {
      useBrowserChromeStore.getState().openMenu(event)
    }),
    browserTabGateway.onTabClosed(event => {
      browserTabClosedByMain(event.tabId, deps.removePanel)
    }),
    browserTabGateway.onNewTabCommand(event => {
      deps.newTabCommand(event.byKey)
    })
  ]
  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe()
  }
}
