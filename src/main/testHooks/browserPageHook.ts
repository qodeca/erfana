// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The page-feature test hooks of the built-in browser (spec 025 commit 12h,
 * solution design § 12 T3): reached as `globalThis.__erfanaTestHooks.page`
 * by e2e tests through `app.evaluate`. Test builds only – reached through
 * `./index`.
 *
 * - **Reads**: a tab's state as its window gets it (load error, crash, zoom
 *   applied), its page zoom factor, where its clipping parent and page view
 *   sit, and the project's address history.
 * - **Crash**: `forcefullyCrashRenderer()` on a tab's page (025-AC-072).
 * - **Clear faults** (025-AC-023): a clearing step that never settles or
 *   fails, so the timeout and failure paths can be shown.
 * - **Terminal output**: a chunk as `TerminalService` would emit it, for the
 *   empty tab's local addresses.
 *
 * Never touches a `webContents`' debugger (only `cdp/` may).
 */
import type { ClearDataCategory } from '../../shared/ipc/browser-tab-page-schema'
import type { TabStateEvent } from '../../shared/ipc/browser-tab-schema'
import type { BrowserRuntime } from '../services/browser/browserAppSetup'
import type { BrowserTab } from '../services/browser/BrowserTab'
import type { ClearFault } from '../services/browser/page/BrowserPages'
import type { PagePlacement } from '../services/browser/page/widthPresetLayout'

export interface BrowserPageTestHook {
  /** The tab's state as its window receives it. */
  state(tabId: string): TabStateEvent
  /** `webContents.getZoomFactor()` of the tab's page. */
  zoomFactor(tabId: string): number
  /** Where the clipping parent and the page view sit (DIP), or `null` while hidden. */
  placement(tabId: string): PagePlacement | null
  /** Kill the tab's page process as a crash would. */
  crash(tabId: string): void
  /** The tab's project's address history, most recent first. */
  history(tabId: string): Promise<string[]>
  /** Plant (or with `null`, remove) a fault in one clearing step. */
  setClearFault(category: ClearDataCategory, fault: ClearFault | null): void
  /** Feed one chunk of terminal output, as `TerminalService`'s `data` event. */
  terminalOutput(webContentsId: number, terminalId: string, data: string): void
  /** The local addresses seen in terminal output this run. */
  localAddresses(): string[]
}

function requireRuntime(getRuntime: () => BrowserRuntime | null): BrowserRuntime {
  const runtime = getRuntime()
  if (runtime === null) throw new Error('The browser runtime is not installed')
  return runtime
}

/** Build the page hook over the runtime `getRuntime` returns at call time. */
export function createBrowserPageTestHook(getRuntime: () => BrowserRuntime | null): BrowserPageTestHook {
  const tab = (tabId: string): BrowserTab => {
    const found = requireRuntime(getRuntime)
      .tabs.list()
      .find((t) => t.id === tabId)
    if (found === undefined) throw new Error(`No browser tab ${tabId}`)
    return found
  }
  return {
    state: (tabId) => requireRuntime(getRuntime).tabs.stateOf(tab(tabId)),
    zoomFactor: (tabId) => tab(tabId).contents.getZoomFactor(),
    placement: (tabId) => tab(tabId).viewFrame.placement(),
    crash: (tabId) => tab(tabId).contents.forcefullyCrashRenderer(),
    history: (tabId) => {
      const found = tab(tabId)
      return requireRuntime(getRuntime).pages.suggest(found.projectRoot, found.caseSensitive, '')
    },
    setClearFault: (category, fault) => {
      const faults = requireRuntime(getRuntime).pages.clearFaults
      if (fault === null) faults.delete(category)
      else faults.set(category, fault)
    },
    terminalOutput: (webContentsId, terminalId, data) =>
      requireRuntime(getRuntime).pages.terminalOutput(webContentsId, terminalId, data),
    localAddresses: () => requireRuntime(getRuntime).pages.localAddresses()
  }
}
