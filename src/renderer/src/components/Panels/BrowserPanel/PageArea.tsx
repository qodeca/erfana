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
 */
import type { BrowserTabState } from '../../../stores/useBrowserTabStore'
import { BROWSER_TEST_IDS } from './browserTestIds'
import { CertificatePage, CrashedPage, EmptyTabPage, LoadErrorPage } from './ErfanaPages'

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
  mayTakeFocus
}: PageAreaProps): JSX.Element {
  const live = state !== null && state.erfanaPage === null
  const ringed = live && pageFocused
  return (
    <div ref={pageAreaRef} className={`erf-brw-frame${ringed ? ' erf-brw-frame--focused' : ''}`}>
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
    </div>
  )
}
