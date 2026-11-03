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
 * - `tabAdded` → a new editor tab hosting the tab the page opened.
 *
 * Forwarded keys are per panel (`useBrowserKeys`): acting on them needs the
 * panel's own controls.
 */
import type { TabAddedEvent } from '../../../../shared/ipc/browser-tab-bridge-types'
import { browserTabGateway } from '../browserTabGateway'
import { useBrowserTabStore } from '../../stores/useBrowserTabStore'

/** What the window does with a page-opened tab. */
export interface BrowserTabEventDeps {
  /** Host the tab main made in a new editor tab. */
  readonly openPageTab: (event: TabAddedEvent) => void
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
    })
  ]
  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe()
  }
}
