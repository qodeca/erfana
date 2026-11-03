// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The page area (spec 025; design § Anatomy zone 6, § Page area and frame;
 * ADR 0011 decision 5): a frame – a `--space-1` gap and a
 * `--border-width-thick` edge, drawn in the violet ring while the page has
 * keyboard focus – around the placeholder the native view covers exactly.
 *
 * While an Erfana page is the tab's content it is drawn here as DOM over the
 * placeholder, and the native view is hidden by the guard's `covered` gate.
 * The live page is never a Tab stop (025-FR-047): F6, a click, Esc on a
 * toolbar control or a load reach it.
 *
 * While an Erfana surface draws over the page (commit 19, ADR 0011), the
 * page's still image is drawn here (`StillImage`) and the surface – the
 * prompt-actions panel or the instruction dialog – over it (`overlay`). A
 * press on the still image outside the surface is `onStillPress` (the panel
 * closes, 025-FR-049), except the later presses of a double-click. In pick mode the frame turns lime – solid, or dashed
 * while keyboard focus is outside the tab (025-FR-065).
 */
import type { BrowserTabState } from '../../../stores/useBrowserTabStore'
import { BROWSER_TEST_IDS } from './browserTestIds'
import { CertificatePage, CrashedPage, EmptyTabPage, LoadErrorPage } from './ErfanaPages'
import { StillImage } from './StillImage'
import type { TabStill } from '../../../stores/useBrowserStillStore'
import type { BrowserRect } from '../../../../../shared/ipc/browser-tab-schema'

/** Props for {@link PageArea}. */
export interface PageAreaProps {
  readonly tabId: string | null
  readonly state: BrowserTabState | null
  readonly pageFocused: boolean
  readonly placeholderRef: React.RefObject<HTMLDivElement>
  readonly pageAreaRef: React.RefObject<HTMLDivElement>
  readonly localAddresses: readonly string[]
  /** Load an empty-tab row. */
  readonly onOpen: (url: string) => void
  readonly mayTakeFocus: () => boolean
  /** The page's still image while a surface draws over it, or `null`. */
  readonly still?: TabStill | null
  /** The picked element's box, outlined on a pick's still image. */
  readonly outline?: BrowserRect | null
  /** Pick mode's frame: `on` (solid lime) or `away` (dashed, focus outside the tab). */
  readonly pickFrame?: 'on' | 'away' | null
  /** The surface drawn over the still image. */
  readonly overlay?: React.ReactNode
  /** A press on the still image outside the surface. */
  readonly onStillPress?: () => void
}

type ErfanaPageProps = Pick<
  PageAreaProps,
  'tabId' | 'state' | 'localAddresses' | 'onOpen' | 'mayTakeFocus'
>

function ErfanaPage({
  tabId,
  state,
  localAddresses,
  onOpen,
  mayTakeFocus
}: ErfanaPageProps): JSX.Element | null {
  // Before main's first state the tab is opening: the empty page is what it will be.
  const page = state === null ? 'empty' : state.erfanaPage
  if (page === null) return null
  if (page === 'empty') return <EmptyTabPage localAddresses={localAddresses} onOpen={onOpen} />
  if (tabId === null || state === null) return null
  if (page === 'loadError')
    return <LoadErrorPage tabId={tabId} state={state} mayTakeFocus={mayTakeFocus} />
  if (page === 'crashed')
    return <CrashedPage tabId={tabId} state={state} mayTakeFocus={mayTakeFocus} />
  return (
    <CertificatePage key={state.certificate?.decisionId} tabId={tabId} state={state} mayTakeFocus={mayTakeFocus} />
  )
}

/**
 * Renders the frame, the placeholder and any Erfana page.
 *
 * @param props - {@link PageAreaProps}
 * @returns The page area
 */
export function PageArea({
  tabId,
  state,
  pageFocused,
  placeholderRef,
  pageAreaRef,
  localAddresses,
  onOpen,
  mayTakeFocus,
  still = null,
  outline = null,
  pickFrame = null,
  overlay,
  onStillPress
}: PageAreaProps): JSX.Element {
  const live = state !== null && state.erfanaPage === null
  const ringed = live && pageFocused && pickFrame === null
  const frameClass = [
    'erf-brw-frame',
    ringed ? 'erf-brw-frame--focused' : '',
    pickFrame === 'on' ? 'erf-brw-frame--pick' : '',
    pickFrame === 'away' ? 'erf-brw-frame--pick-away' : ''
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <div ref={pageAreaRef} className={frameClass}>
      <div
        ref={placeholderRef}
        className="erf-brw-frame__view"
        aria-hidden="true"
        data-testid={BROWSER_TEST_IDS.PAGE_PLACEHOLDER}
      />
      {!live && (
        <div className="erf-brw-frame__erfana">
          <ErfanaPage
            tabId={tabId}
            state={state}
            localAddresses={localAddresses}
            onOpen={onOpen}
            mayTakeFocus={mayTakeFocus}
          />
        </div>
      )}
      {live && still !== null && (
        <div
          className="erf-brw-frame__still"
          onMouseDown={event => {
            // The second press of the double-click that confirmed a pick lands here once the still covers
            // the page: the system counts it (`detail` 2 and up, within its double-click interval) and it is
            // ignored, so a double-click does not pick and discard (025-FR-049). A pointer event carries no count.
            // Its default is prevented too: focus stays in the menu, or leaving the tab would close it.
            if (event.detail > 1) {
              event.preventDefault()
              return
            }
            // React bubbles a portal's events through its React parents: a press in a menu the surface opened
            // (the target chooser, drawn in the portal root) is not a press on the still image (025-FR-030).
            const inDom = event.target instanceof Node && event.currentTarget.contains(event.target)
            const onSurface = event.target instanceof Element && event.target.closest('.erf-brw-actions') !== null
            if (inDom && !onSurface) onStillPress?.()
          }}
        >
          <StillImage image={still.image} outline={still.source === 'pick' ? outline : null} zoomPercent={state?.zoomPercent ?? 100} />
          {overlay}
        </div>
      )}
    </div>
  )
}
