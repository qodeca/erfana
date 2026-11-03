// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Opens a built-in browser tab in the editor area (spec 025, 025-FR-001,
 * 025-FR-004): **New browser tab** (the editor strip's button, a forwarded
 * Ctrl/Cmd+T) and a tab a page opened (`browser-tab:tabAdded`).
 *
 * The one place a browser panel id is minted – `browser-panel-<n>`, a counter,
 * never a path – and the one place the `browser` component and `browserTab`
 * tab component ids are named, so `EditorAreaSplitPanel`'s registry and this
 * file cannot drift apart. Browser panels render `always`: a hidden tab keeps
 * its page loaded and its DOM mounted (025-FR-007).
 */
import type { DockviewApi, IDockviewPanel } from 'dockview'
import { useProjectStore } from '../stores/useProjectStore'

/** The dockview component id of the browser panel. */
export const BROWSER_PANEL_COMPONENT = 'browser'
/** The dockview tab component id of the browser editor tab. */
export const BROWSER_TAB_COMPONENT = 'browserTab'
/** The editor tab's label before anything loads (design deck *Label – empty*). */
export const NEW_BROWSER_TAB_TITLE = 'New browser tab'

const PANEL_ID_PREFIX = 'browser-panel-'

/** Parameters a browser panel and its editor tab receive from dockview. */
export interface BrowserPanelParams {
  /** The panel id, repeated so the tab component can read it. */
  panelId: string
  /** A tab main already made (page-opened); absent for a tab the panel asks main for. */
  tabId?: string
  /** Put keyboard focus in the address bar once the tab is shown (025-FR-001). */
  focusAddress?: boolean
}

/** Options for {@link openBrowserTab}. */
export interface OpenBrowserTabOptions {
  /** Host a tab main already made instead of asking for a new one. */
  readonly tabId?: string
  /** Open without activating it (a page asked for a background tab). */
  readonly background?: boolean
}

let counter = 0

/**
 * Whether `panelId` names a browser panel.
 *
 * @param panelId - Any editor panel id
 * @returns `true` for an id {@link openBrowserTab} minted
 */
export function isBrowserPanelId(panelId: string): boolean {
  return panelId.startsWith(PANEL_ID_PREFIX)
}

function mintPanelId(api: DockviewApi): string {
  do {
    counter += 1
  } while (api.getPanel(`${PANEL_ID_PREFIX}${counter}`) !== undefined)
  return `${PANEL_ID_PREFIX}${counter}`
}

/**
 * Open a browser tab in the editor area.
 *
 * A new empty tab (no `tabId`) is activated with its address bar focused; a
 * page-opened tab is activated unless the page asked for the background.
 *
 * @param api - The editor area's dockview api, or `null` before it is ready
 * @param options - {@link OpenBrowserTabOptions}
 * @returns The new panel, or `undefined` when the editor area is not ready
 *
 * @example
 * ```ts
 * openBrowserTab(useProjectStore.getState().dockviewApi)
 * ```
 */
export function openBrowserTab(
  api: DockviewApi | null | undefined,
  options: OpenBrowserTabOptions = {}
): IDockviewPanel | undefined {
  if (!api) return undefined
  const panelId = mintPanelId(api)
  const activate = options.background !== true
  const params: BrowserPanelParams = {
    panelId,
    ...(options.tabId === undefined ? { focusAddress: true } : { tabId: options.tabId })
  }
  const panel = api.addPanel({
    id: panelId,
    component: BROWSER_PANEL_COMPONENT,
    tabComponent: BROWSER_TAB_COMPONENT,
    title: NEW_BROWSER_TAB_TITLE,
    renderer: 'always',
    params,
    inactive: !activate
  })
  // Tracked so a project switch closes it with the other editor tabs (025-FR-006).
  useProjectStore.getState().registerEditorPanel(panelId)
  if (activate) {
    panel.api.setActive()
    panel.group.focus()
  }
  return panel
}
