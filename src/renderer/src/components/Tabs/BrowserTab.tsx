// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * BrowserTab – the editor tab of a built-in browser tab (spec 025,
 * 025-FR-004; solution design § 9.1; design deck *Browser tab (editor tab)*,
 * Tabs card, proposed).
 *
 * - **Label**: the page title; while none is known, the formatted host with
 *   no path, fitted to the tab's width (a long host loses subdomain labels
 *   from the front, never its registrable domain); "New browser tab" for an
 *   empty tab. For a load the page started,
 *   main keeps the committed page's title until the new document commits, so
 *   the label never names a page the tab has not reached.
 * - **The title is page text**: it sits in `<bdi dir="auto">`, so a
 *   right-to-left title cannot reorder the tab's own text around it.
 * - **A fixed browser-kind mark** (the globe) always leads, before the
 *   page's own icon, so a site icon drawn to look like a file icon cannot
 *   make the tab read as an editor tab. With no site icon the mark stands
 *   alone (the design's generic icon).
 * - Close, middle-click close and the shared tab context menu, as the
 *   preview tab has. Closing asks main first (the page may ask to stay,
 *   025-FR-058); the editor tab goes when main reports the tab closed.
 */
import { useCallback, useMemo, useRef, useState, type MouseEvent } from 'react'
import { Globe, LoaderCircle, X } from 'lucide-react'
import type { IDockviewPanelHeaderProps } from 'dockview'
import { ContextMenu } from '../ContextMenu/ContextMenu'
import { isKeyboardMenuEcho } from '../ContextMenu/contextMenuKey'
import { useTabContextMenu } from './useTabContextMenu'
import { useTabMenuKey } from './useTabMenuKey'
import { useBrowserTabStore } from '../../stores/useBrowserTabStore'
import { requestBrowserPanelClose } from '../../services/browser/browserTabLifecycle'
import type { BrowserPanelParams } from '../../utils/openBrowserTab'
import { fittedText } from '../../../../shared/browser/originFormat'
import { tabLabel, tabLabelOrigin, tabTooltip } from '../Panels/BrowserPanel/browserPanel.logic'
import { useOriginFit } from '../Panels/BrowserPanel/useOriginFit'
import { browserShortcut } from '../Panels/BrowserPanel/browserShortcuts'
import { BROWSER_TEST_IDS } from '../Panels/BrowserPanel/browserTestIds'
import './BrowserTab.css'

const ICON = { size: 14, strokeWidth: 2, 'aria-hidden': true } as const

/**
 * The browser editor tab.
 *
 * @param props - Dockview header props with {@link BrowserPanelParams}
 * @returns The tab
 */
export function BrowserTab(props: IDockviewPanelHeaderProps<BrowserPanelParams>): JSX.Element {
  const { api, params } = props
  const panelId = params?.panelId || api.id
  const entry = useBrowserTabStore(s => {
    const tabId = s.tabByPanel.get(panelId)
    return tabId === undefined ? undefined : s.byTab.get(tabId)
  })
  const state = entry?.state ?? null
  const label = tabLabel(state)
  const loading = state?.loading === true
  // A host label is fitted to the tab: subdomain labels go from the front, so
  // the registrable domain never sits past the tab's clipped end.
  const labelOrigin = useMemo(() => tabLabelOrigin(state), [state])
  const [labelBox, setLabelBox] = useState<HTMLSpanElement | null>(null)
  const fittedLabel = useOriginFit(labelBox, labelOrigin)
  const shortLabel = fittedLabel === null ? null : fittedText(fittedLabel)
  const fitted = shortLabel !== null && shortLabel !== label ? shortLabel : null

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  useTabMenuKey(rootRef, setContextMenu)
  const contextMenuItems = useTabContextMenu(panelId, () => setContextMenu(null))

  const handleClose = useCallback(
    (event?: MouseEvent) => {
      event?.stopPropagation()
      requestBrowserPanelClose(panelId, () => api.close())
    },
    [api, panelId]
  )

  const handleAuxClick = useCallback(
    (event: MouseEvent) => {
      if (event.button !== 1) return
      event.preventDefault()
      handleClose()
    },
    [handleClose]
  )

  const handleContextMenu = useCallback((event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (isKeyboardMenuEcho()) return
    setContextMenu({ x: event.clientX, y: event.clientY })
  }, [])

  const preventDrag = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }, [])

  return (
    <>
      <div
        ref={rootRef}
        className="erf-brw-tab"
        title={tabTooltip(state)}
        onAuxClick={handleAuxClick}
        onContextMenu={handleContextMenu}
        draggable={false}
        onDragStart={preventDrag}
        onDrag={preventDrag}
        data-testid={BROWSER_TEST_IDS.EDITOR_TAB}
        data-panel-id={panelId}
      >
        <span className="erf-brw-tab__kind">
          <Globe {...ICON} />
        </span>
        {entry?.iconUrl != null && !loading && (
          <img className="erf-brw-tab__icon" src={entry.iconUrl} alt="" />
        )}
        {loading && (
          <span className="erf-brw-tab__icon">
            <LoaderCircle {...ICON} />
          </span>
        )}
        <span ref={setLabelBox} className="erf-brw-tab__label">
          {/* A fitted host is drawn over the whole one, which stays (hidden) to size the tab: sized by the short text, the tab would shrink and cut again. */}
          <bdi dir="auto" className={fitted === null ? undefined : 'erf-brw-tab__sizer'}>
            {label}
          </bdi>
          {fitted !== null && (
            <bdi dir="auto" className="erf-brw-tab__fitted">
              {fitted}
            </bdi>
          )}
          {loading && <span className="erf-brw-tab__sr">, loading</span>}
        </span>
        <button
          type="button"
          className="erf-brw-tab__close"
          onClick={handleClose}
          title={`Close (${browserShortcut('close').label})`}
          aria-label={`Close ${label}`}
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  )
}
