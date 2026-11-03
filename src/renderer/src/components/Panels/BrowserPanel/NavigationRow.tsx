// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The navigation row (spec 025, 025-FR-002, 025-FR-003, 025-FR-013; design
 * § Navigation row, frame "Navigation row – fresh tab"): Back, Forward,
 * Reload or Stop, the address bar and DevTools, in that Tab order
 * (025-AC-053).
 *
 * - **Back and Forward are native `disabled`** with no history, so Tab skips
 *   them (025-AC-053); the reason joins the group's description. When the
 *   focused one disables itself, focus hands to the other (or to the address
 *   bar), never to the document.
 * - **Reload becomes Stop** while a page loads; Stop has no key (R5-M5).
 * - **DevTools** is not a toggle: its name says "Show DevTools" while open.
 * - **Open in system browser** (025-FR-057): `aria-disabled` with "Opening…"
 *   while the request runs; disabled with no page.
 * - **More** is always shown (OD-22) and is the row's last control.
 * - The address bar's chips (zoom, pop-up blocked, in use) sit at its end.
 *
 * The fold order of § States › Tiers is not built yet: at narrow widths the
 * address field shrinks and every tool stays on the row.
 */
import { forwardRef, useEffect, useId, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, RotateCw, CodeXml, ExternalLink, X } from 'lucide-react'
import type { BrowserTabState } from '../../../stores/useBrowserTabStore'
import { AddressBar } from './AddressBar'
import { navGroupDescription } from './browserPanel.logic'
import { browserShortcut } from './browserShortcuts'
import { MoreMenu, type MoreMenuActions } from './MoreMenu'
import { sentenceHost } from './erfanaPageCopy'

/** Props for {@link NavigationRow}. */
export interface NavigationRowProps {
  readonly state: BrowserTabState | null
  readonly addressRef: React.RefObject<HTMLInputElement>
  readonly lastToolRef: React.RefObject<HTMLButtonElement>
  readonly onBack: () => void
  readonly onForward: () => void
  readonly onReload: () => void
  readonly onStop: () => void
  readonly onDevTools: () => void
  readonly onSubmitAddress: (input: string) => Promise<boolean>
  readonly onAddressEscape: () => void
  readonly onAddressEdit: () => void
  readonly errorId: string | null
  /** **Open in system browser**; resolves when main answered. */
  readonly onOpenInSystemBrowser: () => Promise<void>
  readonly moreActions: MoreMenuActions
  /** The address bar's chips. */
  readonly chips?: React.ReactNode
}

const TOOL_ICON = { size: 16, strokeWidth: 2, 'aria-hidden': true } as const

type NavTool = 'back' | 'forward' | null

/**
 * Renders the navigation row.
 *
 * @param props - {@link NavigationRowProps}
 * @param ref - The row element (the toolbar-focus zone F6 leaves)
 * @returns The row
 */
export const NavigationRow = forwardRef<HTMLDivElement, NavigationRowProps>(
  function NavigationRow(props, ref) {
    const { state, addressRef, lastToolRef, errorId } = props
    const canGoBack = state?.canGoBack ?? false
    const canGoForward = state?.canGoForward ?? false
    const loading = state?.loading ?? false
    const devToolsOpen = state?.devToolsOpen ?? false
    const descriptionId = `erf-brw-nav-${useId().replace(/[^\w-]/g, '')}`
    const description = navGroupDescription(canGoBack, canGoForward)
    const backRef = useRef<HTMLButtonElement>(null)
    const forwardRef_ = useRef<HTMLButtonElement>(null)
    const focusedRef = useRef<NavTool>(null)

    // A focused Back or Forward that disables itself hands focus on (design § Where focus lands).
    useEffect(() => {
      const lost =
        (focusedRef.current === 'back' && !canGoBack) ||
        (focusedRef.current === 'forward' && !canGoForward)
      const self = focusedRef.current === 'back' ? backRef.current : forwardRef_.current
      const active = document.activeElement
      // Chromium drops focus to the body; an engine that leaves it on the disabled button counts too.
      if (!lost || (active !== null && active !== document.body && active !== self)) return
      const other = focusedRef.current === 'back' ? forwardRef_.current : backRef.current
      focusedRef.current = null
      if (other !== null && !other.disabled) other.focus()
      else addressRef.current?.focus()
    }, [canGoBack, canGoForward, addressRef])

    const back = browserShortcut('back')
    const forward = browserShortcut('forward')
    const reload = browserShortcut('reload')
    const devTools = browserShortcut('devTools')
    const devToolsName = devToolsOpen ? 'Show DevTools' : 'DevTools'
    const live = state !== null && state.erfanaPage === null && state.committedUrl !== null
    const [opening, setOpening] = useState(false)
    const openExternal = (): void => {
      if (opening || !live) return
      setOpening(true)
      void props.onOpenInSystemBrowser().finally(() => setOpening(false))
    }
    const systemName = opening ? 'Opening…' : 'Open in system browser'
    const systemTitle = opening || !live ? systemName : `Open ${sentenceHost(state?.origin ?? null)} in your system browser`

    return (
      <div
        ref={ref}
        className="erf-brw-nav"
        role="group"
        aria-label="Navigation"
        aria-describedby={description === null ? undefined : descriptionId}
      >
        {description !== null && (
          <span id={descriptionId} className="erf-brw-hidden">
            {description}
          </span>
        )}
        <button
          ref={backRef}
          type="button"
          className="erf-brw-tool"
          aria-label="Back"
          aria-keyshortcuts={back.aria}
          title={canGoBack ? `Back (${back.label})` : 'Back – no earlier page'}
          disabled={!canGoBack}
          onFocus={() => (focusedRef.current = 'back')}
          onBlur={() => (focusedRef.current = canGoBack ? null : focusedRef.current)}
          onClick={props.onBack}
        >
          <ArrowLeft {...TOOL_ICON} />
        </button>
        <button
          ref={forwardRef_}
          type="button"
          className="erf-brw-tool"
          aria-label="Forward"
          aria-keyshortcuts={forward.aria}
          title={canGoForward ? `Forward (${forward.label})` : 'Forward – no later page'}
          disabled={!canGoForward}
          onFocus={() => (focusedRef.current = 'forward')}
          onBlur={() => (focusedRef.current = canGoForward ? null : focusedRef.current)}
          onClick={props.onForward}
        >
          <ArrowRight {...TOOL_ICON} />
        </button>
        {loading ? (
          <button
            type="button"
            className="erf-brw-tool"
            aria-label="Stop loading"
            title="Stop loading"
            onClick={props.onStop}
          >
            <X {...TOOL_ICON} />
          </button>
        ) : (
          <button
            type="button"
            className="erf-brw-tool"
            aria-label="Reload"
            aria-keyshortcuts={reload.aria}
            title={`Reload (${reload.label})`}
            onClick={props.onReload}
          >
            <RotateCw {...TOOL_ICON} />
          </button>
        )}
        <AddressBar
          ref={addressRef}
          state={state}
          onSubmit={props.onSubmitAddress}
          onEscape={props.onAddressEscape}
          onEdit={props.onAddressEdit}
          errorId={errorId}
        >
          {props.chips}
        </AddressBar>
        <button
          type="button"
          className="erf-brw-tool"
          aria-label={systemName}
          title={systemTitle}
          aria-disabled={opening || !live ? true : undefined}
          onClick={openExternal}
        >
          <ExternalLink {...TOOL_ICON} />
        </button>
        <button
          type="button"
          className="erf-brw-tool"
          aria-label={devToolsName}
          aria-keyshortcuts={devTools.aria}
          title={`${devToolsName} (${devTools.label})`}
          onClick={props.onDevTools}
        >
          <CodeXml {...TOOL_ICON} />
        </button>
        <MoreMenu
          buttonRef={lastToolRef}
          actions={props.moreActions}
          zoomPercent={state?.zoomPercent ?? 100}
          widthPreset={state?.widthPreset ?? 'full'}
          live={live}
          devToolsOpen={devToolsOpen}
        />
      </div>
    )
  }
)
