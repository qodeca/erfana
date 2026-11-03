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
 *   renderer unchanged): F6 and Shift+F6 move forward and back through the
 *   navigation row, the pick row, the strip, the find row and the page
 *   (025-FR-047, commit 19); from the page main forwards them, and Shift+F6
 *   lands on the last control of the find row, else the strip, else the
 *   pick row. With the prompt-actions panel open they close it first, like a
 *   toolbar click (025-FR-049); with the dialog open they move nothing
 *   (025-FR-050). Esc on a navigation-row or pick-row button returns focus
 *   to the page. The address bar handles its own Esc.
 */
import { useCallback, useEffect, useRef } from 'react'
import type { DockviewApi, DockviewPanelApi } from 'dockview'
import type { ForwardedKeyAction } from '../../../../../shared/ipc/browser-tab-schema'
import { browserTabGateway } from '../../../services/browserTabGateway'
import { openBrowserTab } from '../../../utils/openBrowserTab'
import { requestBrowserPanelClose } from '../../../services/browser/browserTabLifecycle'
import { logger } from '../../../utils/logger'
import { useLatestRef } from '../../../hooks/useLatestRef'

/** Options for {@link useBrowserKeys}. */
export interface UseBrowserKeysOptions {
  readonly tabId: string | null
  /** The editor panel, for the user's close. */
  readonly panelId: string
  /** Open the find row (Ctrl/Cmd+F, 025-FR-008). */
  readonly openFind: () => void
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
  /** The pick surface open over the page (commit 19). */
  readonly pickSurface?: 'none' | 'panel' | 'dialog'
  /** Close the prompt-actions panel without sending, as a toolbar click does. */
  readonly closePanel?: () => void
}

/** The F6 zones after the navigation row, in order (025-FR-047); the page comes after the last. */
const ZONE_SELECTORS = ['[data-brw-zone="pick"]', '[data-testid="browser-strip"]', '[data-testid="browser-find-row"]'] as const
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex="0"]'

/** The zones of `root` that hold a control now, in F6 order: the navigation row first. */
function liveZones(root: HTMLElement, nav: HTMLElement | null): HTMLElement[] {
  return [nav, ...ZONE_SELECTORS.map(selector => root.querySelector<HTMLElement>(selector))].filter(
    (zone): zone is HTMLElement => zone !== null && zone.querySelector(FOCUSABLE) !== null
  )
}

/** Focus the first or the last control of `zone`; the navigation row starts at the address bar. */
function focusZone(zone: HTMLElement, end: 'first' | 'last', focusAddress: () => void, nav: HTMLElement | null): void {
  if (end === 'first' && zone === nav) {
    focusAddress()
    return
  }
  const controls = [...zone.querySelectorAll<HTMLElement>(FOCUSABLE)]
  ;(end === 'first' ? controls[0] : controls[controls.length - 1])?.focus()
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
      const { tabId: tab, api, containerApi, focusAddress, focusLastTool, rootRef } = latest.current
      if (tab === null) return
      const fail = (error: unknown): void =>
        logger.warn('Browser key action failed', {
          action,
          error: error instanceof Error ? error.message : String(error)
        })
      switch (action) {
        case 'focusAddress':
          // With the prompt-actions menu open, Ctrl/Cmd+L closes it without sending first (025-FR-049).
          if (latest.current.pickSurface === 'panel') latest.current.closePanel?.()
          return focusAddress()
        case 'focusNextZone':
          return focusAddress()
        case 'focusPreviousZone': {
          const nav = latest.current.navRef.current
          const zones = rootRef.current === null ? [] : liveZones(rootRef.current, nav)
          const last = zones[zones.length - 1]
          // The navigation row's last visible control is More (always shown, OD-22).
          return last === undefined || last === nav ? focusLastTool() : focusZone(last, 'last', focusAddress, nav)
        }
        case 'reload':
          return void browserTabGateway.history(tab, 'reload').catch(fail)
        case 'back':
        case 'forward':
          return void browserTabGateway.history(tab, action).catch(fail)
        case 'devTools':
          return void browserTabGateway.devTools(tab).catch(fail)
        case 'closeTab':
          return requestBrowserPanelClose(latest.current.panelId, () => api.close())
        case 'newTab':
          return void openBrowserTab(containerApi)
        case 'nextEditorTab':
          return cycleEditorTab(api, 1)
        case 'previousEditorTab':
          return cycleEditorTab(api, -1)
        case 'find':
          return latest.current.openFind()
        case 'focusPanel':
          // The focus-panel key map is not built yet.
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
      // A menu this tab opened (the panel's target menu) draws in the portal: focus there has not left the
      // tab, and main must not close the open pick panel as if it had (025-FR-030).
      if (next instanceof Element && next.closest('#portal-root') !== null) return
      report(null, false)
    },
    [rootRef, report]
  )

  /** F6 (or Shift+F6) from `target`: the next (or previous) zone, the page after the last. */
  const moveZone = useCallback(
    (target: Node | null, back: boolean): void => {
      const { pickSurface = 'none', closePanel, focusAddress, focusPageArea } = latest.current
      const root = rootRef.current
      if (root === null || pickSurface === 'dialog') return
      const nav = navRef.current
      const zones = liveZones(root, nav)
      if (pickSurface === 'panel') {
        // Closes like a toolbar click: F6 to Pick element, Shift+F6 to the strip's last control, else More (025-FR-049).
        closePanel?.()
        const pickZone = root.querySelector<HTMLElement>('[data-brw-zone="pick"]')
        const strip = root.querySelector<HTMLElement>('[data-testid="browser-strip"]')
        const into = back ? (strip !== null && strip.querySelector(FOCUSABLE) !== null ? strip : navRef.current) : pickZone
        if (into === nav && back) latest.current.focusLastTool()
        else if (into !== null) focusZone(into, back ? 'last' : 'first', focusAddress, nav)
        return
      }
      const at = target === null ? -1 : zones.findIndex(zone => zone.contains(target))
      if (at === -1 && back) {
        // From the page area: the last zone's last control, as main's forwarded Shift+F6 does.
        act('focusPreviousZone')
        return
      }
      const next = at === -1 ? 0 : at + (back ? -1 : 1)
      const zone = zones[next]
      if (at !== -1 && zone === undefined) {
        focusPageArea()
        return
      }
      if (zone !== undefined) focusZone(zone, back ? 'last' : 'first', focusAddress, nav)
    },
    [latest, rootRef, navRef, act]
  )

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.defaultPrevented || event.nativeEvent.isComposing) return
      const target = event.target instanceof Node ? event.target : null
      const inNav = target !== null && navRef.current?.contains(target) === true
      if (event.key === 'F6' && !event.altKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault()
        moveZone(target, event.shiftKey)
        return
      }
      if (event.key === 'Tab' && event.ctrlKey && !event.metaKey && !event.altKey && latest.current.pickSurface !== 'dialog') {
        // Ctrl+Tab from the tab's own controls, the menu included: the next editor tab (025-FR-049, 025-FR-051).
        event.preventDefault()
        act(event.shiftKey ? 'previousEditorTab' : 'nextEditorTab')
        return
      }
      const inPick = target instanceof Element && target.closest('[data-brw-zone="pick"]') !== null
      if (event.key === 'Escape' && (inNav || inPick) && target instanceof HTMLButtonElement) {
        event.preventDefault()
        latest.current.focusPageArea()
      }
    },
    [navRef, latest, moveZone, act]
  )

  return { onKeyDown, onFocus, onBlur }
}
