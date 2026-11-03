// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * BrowserPanel – a built-in browser tab in the editor area (spec 025,
 * 025-FR-001 to 025-FR-004, 025-FR-007, 025-FR-063; solution design § 9.1,
 * commit 17; design `docs/designs/browser/`, proposed).
 *
 * The page runs in a native view main owns; this panel is the DOM around it:
 * the navigation row (with More and the address chips), the find row, the
 * strip rows (the refused address first), and the page area whose
 * placeholder the view covers – or an Erfana page drawn there instead – plus
 * the page right-click menu and Clear browsing data (commit 18). Glue
 * only: the tab's lifetime is `browserTabLifecycle`, its state the browser tab
 * store, where the page sits `useBrowserBounds`, keys `useBrowserKeys`, focus
 * into the page `useBrowserPageFocus`, decisions `browserPanel.logic.ts`.
 *
 * Whether the page shows is the native-view guard's decision alone (active
 * tab, no overlay, not collapsed, no Erfana page) – nothing here shows or
 * hides it. The panel renders `always`, so a hidden tab keeps its page loaded
 * and its DOM mounted (025-FR-007). The error boundary is mounted at the
 * registration site (`EditorAreaSplitPanel`), keyed by the project.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview'
import { DOCKVIEW_PANEL_VISIBLE, useDockviewValue } from '../../../hooks/useDockviewValue'
import { useBrowserTabStore } from '../../../stores/useBrowserTabStore'
import { useBrowserChromeStore, type ShownStripRow } from '../../../stores/useBrowserChromeStore'
import { useOptionalDialog } from '../../Dialog/DialogContext'
import { browserTabGateway } from '../../../services/browserTabGateway'
import { ensureBrowserTab } from '../../../services/browser/browserTabLifecycle'
import type { BrowserPanelParams } from '../../../utils/openBrowserTab'
import { showErrorToast } from '../../../utils/toastHelpers'
import { logger } from '../../../utils/logger'
import { NavigationRow } from './NavigationRow'
import { PageArea } from './PageArea'
import { refusedMessage } from './browserPanel.logic'
import { useBrowserBounds } from './useBrowserBounds'
import { useBrowserKeys } from './useBrowserKeys'
import { useBrowserPageFocus } from './useBrowserPageFocus'
import { BROWSER_TEST_IDS } from './browserTestIds'
import { StripRows } from './StripRows'
import { FindRow } from './FindRow'
import { AddressChips } from './AddressChips'
import { PageContextMenu } from './PageContextMenu'
import { ClearDataDialog } from './ClearDataDialog'
import type { MoreMenuActions } from './MoreMenu'
import { forgetBrowserData, openInSystemBrowser } from './browserDataActions'
import './BrowserPanel.css'
import './BrowserChrome.css'

const NO_ROWS: readonly ShownStripRow[] = []

/** The first focusable element of an Erfana page, for F6 and Esc. */
const ERFANA_PAGE_FOCUSABLE =
  '.erf-brw-frame__erfana button, .erf-brw-frame__erfana [tabindex="-1"]'

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** A rejection handler that logs `what`. */
function fail(what: string): (error: unknown) => void {
  return error => logger.warn(what, { error: errorText(error) })
}

/**
 * A browser tab's panel.
 *
 * @param props - Dockview panel props with {@link BrowserPanelParams}
 * @returns The panel
 *
 * @example
 * ```ts
 * openBrowserTab(dockviewApi) // adds { component: 'browser', params: { panelId, focusAddress: true } }
 * ```
 */
export function BrowserPanel(props: IDockviewPanelProps<BrowserPanelParams>): JSX.Element {
  const { params, api, containerApi } = props
  const panelId = params?.panelId || api.id
  const adoptTabId = params?.tabId
  const isVisible = useDockviewValue(api, DOCKVIEW_PANEL_VISIBLE)
  const tabId = useBrowserTabStore(s => s.tabByPanel.get(panelId) ?? null)
  const entry = useBrowserTabStore(s => (tabId === null ? undefined : s.byTab.get(tabId)))
  const localAddresses = useBrowserTabStore(s => s.localAddresses)
  const rows = useBrowserChromeStore(s => (tabId === null ? NO_ROWS : (s.rows.get(tabId) ?? NO_ROWS)))
  const findResult = useBrowserChromeStore(s => (tabId === null ? undefined : s.find.get(tabId)))
  const dialog = useOptionalDialog()
  const [findOpen, setFindOpen] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)
  const state = entry?.state ?? null
  const pageFocused = entry?.pageFocused ?? false
  const live = state !== null && state.erfanaPage === null

  const rootRef = useRef<HTMLDivElement>(null)
  const navRef = useRef<HTMLDivElement>(null)
  const addressRef = useRef<HTMLInputElement>(null)
  const lastToolRef = useRef<HTMLButtonElement>(null)
  const placeholderRef = useRef<HTMLDivElement>(null)
  const pageAreaRef = useRef<HTMLDivElement>(null)
  const [refused, setRefused] = useState<string | null>(null)
  const refusedId = `erf-brw-refused-${useId().replace(/[^\w-]/g, '')}`

  // Open (or adopt) the tab once per panel; a refusal closes the editor tab with a toast.
  useEffect(() => {
    let current = true
    void ensureBrowserTab(panelId, adoptTabId).then(result => {
      if (!current || !('error' in result)) return
      showErrorToast("Browser tab couldn't open", result.error)
      api.close()
    })
    return () => {
      current = false
    }
  }, [panelId, adoptTabId, api])

  useBrowserBounds({ panelId, tabId, placeholderRef, isVisible })
  const focusPage = useBrowserPageFocus({ panelId, tabId, erfanaPage: state?.erfanaPage ?? null })

  const focusAddress = useCallback(() => {
    addressRef.current?.focus()
    addressRef.current?.select()
  }, [])
  const focusLastTool = useCallback(() => lastToolRef.current?.focus(), [])
  const focusPageArea = useCallback(() => {
    if (live) {
      focusPage()
      return
    }
    pageAreaRef.current?.querySelector<HTMLElement>(ERFANA_PAGE_FOCUSABLE)?.focus()
  }, [live, focusPage])

  const openFind = useCallback(() => {
    if (live) setFindOpen(true)
  }, [live])

  const keys = useBrowserKeys({
    tabId,
    panelId,
    openFind,
    api,
    containerApi,
    rootRef,
    navRef,
    focusAddress,
    focusLastTool,
    focusPageArea
  })

  // A new empty tab opens with the address bar focused (025-FR-001), once it is drawn –
  // after dockview's own group focus on activation.
  const wantsAddressFocus = useRef(params?.focusAddress === true)
  useEffect(() => {
    if (!wantsAddressFocus.current || !isVisible) return
    wantsAddressFocus.current = false
    const frame = requestAnimationFrame(focusAddress)
    return () => cancelAnimationFrame(frame)
  }, [isVisible, focusAddress])

  const load = useCallback(
    async (input: string, source: 'address' | 'history'): Promise<boolean> => {
      if (tabId === null) return false
      try {
        const response = await browserTabGateway.navigate({ tabId, input, source })
        if ('ok' in response) {
          setRefused(null)
          focusPage(true)
          return true
        }
        const message = refusedMessage(response, input)
        if (message !== null) setRefused(message)
        else showErrorToast("Couldn't open the address", 'error' in response ? response.error : '')
      } catch (error) {
        logger.warn('Browser tab navigation failed', { error: errorText(error) })
        showErrorToast("Couldn't open the address", 'The browser tab did not answer.')
      }
      return false
    },
    [tabId, focusPage]
  )

  const history = useCallback(
    (step: 'back' | 'forward' | 'reload' | 'stop') => {
      if (tabId === null) return
      browserTabGateway.history(tabId, step).catch((error: unknown) => {
        logger.warn('Browser tab history step failed', { step, error: errorText(error) })
      })
    },
    [tabId]
  )

  const mayTakeFocus = useCallback(
    () =>
      pageFocused ||
      (document.activeElement !== null &&
        rootRef.current?.contains(document.activeElement) === true),
    [pageFocused]
  )

  const moreActions = useMemo<MoreMenuActions>(
    () => ({
      zoom: step => {
        if (tabId !== null) browserTabGateway.zoom(tabId, step).catch(fail('Browser tab zoom failed'))
      },
      widthPreset: preset => {
        if (tabId !== null) browserTabGateway.widthPreset(tabId, preset).catch(fail('Browser width preset failed'))
      },
      find: () => setFindOpen(true),
      openInSystemBrowser: () => {
        if (tabId !== null) void openInSystemBrowser(tabId)
      },
      devTools: () => {
        if (tabId !== null) browserTabGateway.devTools(tabId).catch(fail('Browser tab DevTools failed'))
      },
      clearData: () => setClearOpen(true),
      forget: () => {
        if (dialog !== undefined) void forgetBrowserData(dialog.showConfirm)
      }
    }),
    [tabId, dialog]
  )

  const popupBlocked = rows.some(shown => shown.row.kind === 'popupBlocked')
  const showPopupRow = useCallback(() => {
    rootRef.current?.querySelector<HTMLElement>('[data-strip-kind="popupBlocked"]')?.focus()
  }, [])
  const closeFind = useCallback(() => {
    setFindOpen(false)
    if (tabId !== null) useBrowserChromeStore.getState().clearFind(tabId)
    if (live) focusPage()
  }, [tabId, live, focusPage])
  const pageOrigin = useCallback(() => placeholderRef.current?.getBoundingClientRect() ?? null, [])
  const afterMenu = useCallback(() => {
    if (live) focusPage()
  }, [live, focusPage])

  return (
    <div
      ref={rootRef}
      className="erf-brw"
      data-testid={BROWSER_TEST_IDS.PANEL}
      data-browser-tab-id={tabId ?? undefined}
      onKeyDown={keys.onKeyDown}
      onFocus={keys.onFocus}
      onBlur={keys.onBlur}
    >
      <NavigationRow
        ref={navRef}
        state={state}
        addressRef={addressRef}
        lastToolRef={lastToolRef}
        onBack={() => history('back')}
        onForward={() => history('forward')}
        onReload={() => history('reload')}
        onStop={() => history('stop')}
        onDevTools={() => {
          if (tabId === null) return
          browserTabGateway.devTools(tabId).catch((error: unknown) => {
            logger.warn('Browser tab DevTools failed', { error: errorText(error) })
          })
        }}
        onSubmitAddress={input => load(input, 'address')}
        onAddressEscape={() => {
          setRefused(null)
          if (live) focusPage()
        }}
        onAddressEdit={() => setRefused(null)}
        errorId={refused === null ? null : refusedId}
        onOpenInSystemBrowser={() => (tabId === null ? Promise.resolve() : openInSystemBrowser(tabId))}
        moreActions={moreActions}
        chips={
          <AddressChips
            state={state}
            popupBlocked={popupBlocked}
            addressRef={addressRef}
            onResetZoom={() => moreActions.zoom('reset')}
            onShowPopupRow={showPopupRow}
          />
        }
      />
      {findOpen && live && tabId !== null && <FindRow tabId={tabId} result={findResult} onClose={closeFind} />}
      <StripRows tabId={tabId} rows={rows} refused={refused} refusedId={refusedId} onEmpty={focusPageArea} />
      <PageArea
        tabId={tabId}
        state={state}
        pageFocused={pageFocused}
        placeholderRef={placeholderRef}
        pageAreaRef={pageAreaRef}
        localAddresses={localAddresses}
        onOpen={url => void load(url, 'history')}
        mayTakeFocus={mayTakeFocus}
      />
      <PageContextMenu tabId={tabId} pageOrigin={pageOrigin} onClosed={afterMenu} />
      {clearOpen && <ClearDataDialog onClose={() => setClearOpen(false)} />}
    </div>
  )
}
