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
 * - **Fold steps 3–7** (design § States › Tiers): when the address field
 *   cannot show the scheme, the registrable domain and the port even with the
 *   path and every subdomain label gone, the zoom chip, Open in system
 *   browser and DevTools go into More, then Forward and Reload, then the
 *   field's margins shrink, the badge word goes to its icon, and Back goes
 *   last (`useNavFold`, `navFold.logic.ts`). A folded tool's keys keep
 *   working, and More lists the navigation tools it took. A tool that folds
 *   while focused hands focus to More.
 */
import { forwardRef, useCallback, useEffect, useId, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, RotateCw, CodeXml, ExternalLink, X } from 'lucide-react'
import type { BrowserTabState } from '../../../stores/useBrowserTabStore'
import { AddressBar } from './AddressBar'
import { addressDisplay, navGroupDescription } from './browserPanel.logic'
import { foldedNavItems, isFolded, navFoldAttribute, parseFoldStep } from './navFold.logic'
import { useNavFold } from './useNavFold'
import { browserShortcut } from './browserShortcuts'
import { MoreMenu, type MoreMenuActions } from './MoreMenu'
import { sentenceHost } from './erfanaPageCopy'
import { formatShortcut } from '../../../utils/shortcutLabel'
import type { StillSurface } from './useStillSurface'
import { tooltipProps } from './ToolbarTooltip'

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
  readonly onSubmitAddress: (input: string, source?: 'address' | 'history') => Promise<boolean>
  readonly onAddressEscape: () => void
  readonly onAddressEdit: () => void
  readonly errorId: string | null
  /** **Open in system browser**; resolves when main answered. */
  readonly onOpenInSystemBrowser: () => Promise<void>
  readonly moreActions: MoreMenuActions
  /** The address bar's chips. */
  readonly chips?: React.ReactNode
  /** The page's still image under More and under the address suggestions (commit 19). */
  readonly moreStill?: StillSurface
  readonly suggestStill?: StillSurface
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
    const [row, setRow] = useState<HTMLDivElement | null>(null)
    const setRowRef = useCallback(
      (element: HTMLDivElement | null) => {
        setRow(element)
        if (typeof ref === 'function') ref(element)
        else if (ref !== null) ref.current = element
      },
      [ref]
    )
    const display = addressDisplay(state)
    const fold = useNavFold(row, display.kind === 'web' ? display.parts : null)
    /** The row's control that last took focus, until focus moves to another element. */
    const lastFocusedRef = useRef<HTMLElement | null>(null)

    // A tool that folds while focused hands focus to More (the browser drops it to the body).
    useEffect(() => {
      const last = lastFocusedRef.current
      const step = parseFoldStep(last?.closest('[data-fold-step]')?.getAttribute('data-fold-step'))
      if (last === null || step === null || !isFolded(step, fold)) return
      const active = document.activeElement
      if (active !== null && active !== document.body && active !== last) return
      lastFocusedRef.current = null
      lastToolRef.current?.focus()
    }, [fold, lastToolRef])

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
      // A tool folded into More (Forward from step 4) cannot take focus either.
      const otherStep = parseFoldStep(other?.getAttribute('data-fold-step'))
      const otherFolded = otherStep !== null && isFolded(otherStep, fold)
      if (other !== null && !other.disabled && !otherFolded) other.focus()
      else addressRef.current?.focus()
    }, [canGoBack, canGoForward, addressRef, fold])

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
        ref={setRowRef}
        className="erf-brw-nav"
        role="group"
        aria-label="Navigation"
        aria-describedby={description === null ? undefined : descriptionId}
        data-fold={navFoldAttribute(fold)}
        onFocus={event => (lastFocusedRef.current = event.target)}
        onBlur={event => {
          // A blur because the control was hidden keeps it, for the handoff above.
          if (event.relatedTarget !== null) lastFocusedRef.current = null
        }}
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
          data-fold-step="7"
          aria-label="Back"
          aria-keyshortcuts={back.aria}
          {...tooltipProps(canGoBack ? `Back (${back.label})` : 'Back – no earlier page')}
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
          data-fold-step="4"
          aria-label="Forward"
          aria-keyshortcuts={forward.aria}
          {...tooltipProps(canGoForward ? `Forward (${forward.label})` : 'Forward – no later page')}
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
            data-fold-step="4"
            aria-label="Stop loading"
            {...tooltipProps('Stop loading')}
            onClick={props.onStop}
          >
            <X {...TOOL_ICON} />
          </button>
        ) : (
          <button
            type="button"
            className="erf-brw-tool"
            data-fold-step="4"
            aria-label="Reload"
            aria-keyshortcuts={reload.aria}
            {...tooltipProps(`Reload (${reload.label})`)}
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
          suggestStill={props.suggestStill}
        >
          {props.chips}
        </AddressBar>
        <button
          type="button"
          className="erf-brw-tool"
          data-fold-step="3"
          aria-label={systemName}
          {...tooltipProps(systemTitle)}
          aria-disabled={opening || !live ? true : undefined}
          onClick={openExternal}
        >
          <ExternalLink {...TOOL_ICON} />
        </button>
        <button
          type="button"
          className="erf-brw-tool"
          data-fold-step="3"
          aria-label={devToolsName}
          aria-keyshortcuts={devTools.aria}
          {...tooltipProps(`${devToolsName} (${devTools.label})`)}
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
          still={props.moreStill}
          navItems={foldedNavItems({
            count: fold,
            canGoBack,
            canGoForward,
            loading,
            keys: { back: back.label, forward: forward.label, reload: formatShortcut('R', { mod: true }) },
            onBack: props.onBack,
            onForward: props.onForward,
            onReload: props.onReload,
            onStop: props.onStop
          })}
        />
      </div>
    )
  }
)
