// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A browser tab's keys on the renderer side (spec 025, 025-FR-014,
 * 025-FR-047, 025-FR-051; solution design § 7; ADR 0011 decisions 13–14).
 *
 * - **Forwarded keys.** Main takes the browser and reserved keys from page
 *   focus – and, while this tab reports toolbar focus, from Erfana's window –
 *   and sends them as named actions for one tab. Only this tab's actions are
 *   acted on, so the active-panel gate holds by construction.
 * - **Toolbar focus.** Focus anywhere in the panel's own DOM (the navigation
 *   row, an Erfana page) is reported with `toolbarFocus`, so main's
 *   app-window router consumes the browser keys instead of Erfana's menu
 *   (Ctrl/Cmd+R must reload the page, not Erfana).
 * - **F6, Shift+F6 and Esc in the toolbar** (reserved keys reach the
 *   renderer unchanged): F6 moves between the navigation row and the page;
 *   Esc on a navigation-row button returns focus to the page. The address
 *   bar handles its own Esc.
 */
import { useCallback, useEffect, useRef } from 'react'
import type { DockviewApi, DockviewPanelApi } from 'dockview'
import type { ForwardedKeyAction } from '../../../../../shared/ipc/browser-tab-schema'
import { browserTabGateway } from '../../../services/browserTabGateway'
import { openBrowserTab } from '../../../utils/openBrowserTab'
import { logger } from '../../../utils/logger'
import { useLatestRef } from '../../../hooks/useLatestRef'

/** Options for {@link useBrowserKeys}. */
export interface UseBrowserKeysOptions {
  readonly tabId: string | null
  /** The panel's dockview api: closing, and its group for editor-tab switching. */
  readonly api: Pick<DockviewPanelApi, 'close' | 'group'>
  readonly containerApi: DockviewApi
  /** The panel root: the toolbar-focus scope. */
  readonly rootRef: React.RefObject<HTMLElement>
  /** The navigation row. */
  readonly navRef: React.RefObject<HTMLElement>
  /** Focus and select the address bar. */
  readonly focusAddress: () => void
  /** Focus the navigation row's last control (Shift+F6 from the page). */
  readonly focusLastTool: () => void
  /** Move focus into the page area: the live page, or an Erfana page's content. */
  readonly focusPageArea: () => void
}

/** Handlers the panel root wires. */
export interface BrowserKeyHandlers {
  readonly onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void
  readonly onFocus: () => void
  readonly onBlur: (event: React.FocusEvent<HTMLElement>) => void
}

/** Activate the next or previous tab of `api`'s group, wrapping around. */
function cycleEditorTab(api: Pick<DockviewPanelApi, 'group'>, step: 1 | -1): void {
  const panels = api.group.panels
  if (panels.length < 2) return
  const current = panels.findIndex(panel => panel.id === api.group.activePanel?.id)
  const next = panels[(current + step + panels.length) % panels.length]
  next.api.setActive()
}

/**
 * Wires a browser panel's keys.
 *
 * @param options - {@link UseBrowserKeysOptions}
 * @returns The panel root's key and focus handlers
 */
export function useBrowserKeys(options: UseBrowserKeysOptions): BrowserKeyHandlers {
  const { tabId, rootRef, navRef } = options
  const latest = useLatestRef(options)
  const reportedRef = useRef<string | null>(null)

  const act = useCallback(
    (action: ForwardedKeyAction): void => {
      const { tabId: tab, api, containerApi, focusAddress, focusLastTool } = latest.current
      if (tab === null) return
      const fail = (error: unknown): void =>
        logger.warn('Browser key action failed', {
          action,
          error: error instanceof Error ? error.message : String(error)
        })
      switch (action) {
        case 'focusAddress':
        case 'focusNextZone':
          return focusAddress()
        case 'focusPreviousZone':
          return focusLastTool()
        case 'reload':
          return void browserTabGateway.history(tab, 'reload').catch(fail)
        case 'back':
        case 'forward':
          return void browserTabGateway.history(tab, action).catch(fail)
        case 'devTools':
          return void browserTabGateway.devTools(tab).catch(fail)
        case 'closeTab':
          return api.close()
        case 'newTab':
          return void openBrowserTab(containerApi)
        case 'nextEditorTab':
          return cycleEditorTab(api, 1)
        case 'previousEditorTab':
          return cycleEditorTab(api, -1)
        case 'find':
        case 'focusPanel':
          // The find row and the focus-panel key map are not built yet.
          logger.debug('Browser key action not available yet', { action })
      }
    },
    [latest]
  )

  useEffect(() => {
    if (tabId === null) return
    return browserTabGateway.onForwardedKey(event => {
      if (event.tabId === tabId) act(event.action)
    })
  }, [tabId, act])

  const report = useCallback((tab: string | null, focused: boolean): void => {
    if (focused && tab !== null && reportedRef.current !== tab) {
      reportedRef.current = tab
      browserTabGateway.toolbarFocus(tab, true)
    } else if (!focused && reportedRef.current !== null) {
      browserTabGateway.toolbarFocus(reportedRef.current, false)
      reportedRef.current = null
    }
  }, [])

  // A tab change or unmount ends what was reported.
  useEffect(() => () => report(null, false), [tabId, report])

  const onFocus = useCallback(() => report(latest.current.tabId, true), [latest, report])

  const onBlur = useCallback(
    (event: React.FocusEvent<HTMLElement>) => {
      const next = event.relatedTarget
      if (next instanceof Node && rootRef.current?.contains(next)) return
      report(null, false)
    },
    [rootRef, report]
  )

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.defaultPrevented || event.nativeEvent.isComposing) return
      const target = event.target instanceof Node ? event.target : null
      const inNav = target !== null && navRef.current?.contains(target) === true
      if (event.key === 'F6' && !event.altKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault()
        if (inNav) latest.current.focusPageArea()
        else latest.current.focusAddress()
        return
      }
      if (event.key === 'Escape' && inNav && target instanceof HTMLButtonElement) {
        event.preventDefault()
        latest.current.focusPageArea()
      }
    },
    [navRef, latest]
  )

  return { onKeyDown, onFocus, onBlur }
}
