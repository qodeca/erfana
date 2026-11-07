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
 *   first browser tab opens is listed too; `downloadDone` and
 *   `downloadFailed` → toasts (`browserDownloadNotices.ts`, 025-FR-020);
 * - `tabAdded` → a new editor tab hosting the tab the page opened;
 * - `strip`, `findResult`, `contextMenu` → the chrome store the panels draw
 *   from (commit 18);
 * - `pick` → the pick store (commit 19); a confirmed pick's capture goes up
 *   as the page area's still image, a failed one is a toast, and an ended
 *   capture lets the still go (a page change's capture stays for the dialog);
 * - `contextMenu` waits for the page's still image before it opens, so the
 *   menu never draws over a blank page area (ADR 0011, commit 19);
 * - `tabClosed` → the editor tab goes (`browserTabClosedByMain`), with the
 *   tab's pick state, every still holder and its still image;
 * - `newTabCommand` → the app menu's **New browser tab**.
 *
 * Forwarded keys are per panel (`useBrowserKeys`): acting on them needs the
 * panel's own controls.
 */
import type { TabAddedEvent } from '../../../../shared/ipc/browser-tab-bridge-types'
import { browserTabGateway } from '../browserTabGateway'
import { useBrowserTabStore } from '../../stores/useBrowserTabStore'
import { useBrowserChromeStore } from '../../stores/useBrowserChromeStore'
import { useBrowserPickStore } from '../../stores/useBrowserPickStore'
import { showErrorToast } from '../../utils/toastHelpers'
import type { PickEvent } from '../../../../shared/ipc/browser-tab-schema'
import { browserTabClosedByMain } from './browserTabLifecycle'
import { showDownloadNotice } from './browserDownloadNotices'
import { browserStill, CONTEXT_MENU_STILL_HOLDER, PICK_STILL_HOLDER } from './browserStill'

/** Mirror one pick event, and move the still image with the capture. */
function applyPick(event: PickEvent): void {
  useBrowserPickStore.getState().apply(event)
  if (event.kind === 'captured') {
    const image = { data: event.still, width: event.stillWidth, height: event.stillHeight }
    void browserStill.showPick(event.tabId, PICK_STILL_HOLDER, image)
  } else if (event.kind === 'captureFailed') {
    // Deck *Toast – capture failed* (025-FR-046): no panel, pick mode stays on.
    showErrorToast("Couldn't capture this element", `${event.reason}. Nothing was sent – pick it again.`)
  } else if (event.kind === 'ended' && event.reason !== 'pageChanged') {
    browserStill.release(event.tabId, PICK_STILL_HOLDER)
  }
}

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
      else showDownloadNotice(event)
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
    browserTabGateway.onPick(event => {
      applyPick(event)
    }),
    browserTabGateway.onContextMenu(event => {
      // The menu opens over the page's picture, or over Erfana's background when none could be taken.
      void browserStill.hold(event.tabId, CONTEXT_MENU_STILL_HOLDER).then(() => {
        useBrowserChromeStore.getState().openMenu(event)
      })
    }),
    browserTabGateway.onTabClosed(event => {
      useBrowserPickStore.getState().forget(event.tabId)
      // Every still holder goes with the tab: the panel may unmount before its own release runs.
      browserStill.forget(event.tabId)
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
