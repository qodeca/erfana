// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Erfana's own pages in a browser tab's page area (spec 025, 025-FR-063,
 * 025-FR-056, 025-FR-059, 025-FR-021; ADR 0011 decision 5; design
 * `page-states.html`, `tab-and-toolbar.html` § Empty-tab hint). They are DOM:
 * while one shows, the native view is hidden (the guard's `covered` gate).
 *
 * - **Empty tab** – the 8 most recent addresses, the local servers the
 *   project's terminals printed this session, and the pick hint. A row loads
 *   its address as a history navigation.
 * - **Load error, crashed, certificate** – minimal pages for this commit: the
 *   heading, the sentence and the one safe action (Reload, Back to safety).
 *   The design's per-code titles, the loopback hints, **Proceed anyway** with
 *   its input guard and *More about this error* come with commit 18.
 *
 * Focus on arrival (design § Where focus lands) is taken only when focus was
 * already in this tab – an Erfana page never pulls focus from another panel.
 */
import { useEffect, useRef, useState } from 'react'
import { originParts, originText } from '../../../../../shared/browser/originFormat'
import { netErrorCodeText, netErrorMessage } from '../../../../../shared/browser/netErrorMessages'
import type { BrowserTabState } from '../../../stores/useBrowserTabStore'
import { browserTabGateway } from '../../../services/browserTabGateway'
import { logger } from '../../../utils/logger'
import { useLatestRef } from '../../../hooks/useLatestRef'
import { browserShortcut } from './browserShortcuts'
import { pathOf, shownAddress } from './browserPanel.logic'

/** How many recent addresses the empty tab lists (025-FR-063). */
export const EMPTY_TAB_RECENT_ROWS = 8

/**
 * An address for a row, through the origin formatter (Security rule 2). The
 * renderer has no public-suffix list, so the whole host counts as the
 * registrable domain here – nothing is dimmed, nothing is cut.
 */
export function rowAddress(url: string): string {
  const parts = originParts(url, () => null)
  return parts?.kind === 'web' ? `${originText(parts)}${pathOf(url)}` : url
}

/** Props for {@link EmptyTabPage}. */
export interface EmptyTabPageProps {
  readonly localAddresses: readonly string[]
  readonly onOpen: (url: string) => void
}

/**
 * The empty tab (025-FR-063, design deck *Empty-tab hint*).
 *
 * @param props - {@link EmptyTabPageProps}
 * @returns The page
 */
export function EmptyTabPage({ localAddresses, onOpen }: EmptyTabPageProps): JSX.Element {
  const [recent, setRecent] = useState<readonly string[]>([])
  useEffect(() => {
    let live = true
    browserTabGateway
      .suggest('')
      .then(answer => {
        if (live) setRecent(answer.rows.slice(0, EMPTY_TAB_RECENT_ROWS).map(row => row.url))
      })
      .catch((error: unknown) => {
        logger.warn('Browser history could not be read', {
          error: error instanceof Error ? error.message : String(error)
        })
      })
    return () => {
      live = false
    }
  }, [])
  const firstRun = recent.length === 0 && localAddresses.length === 0
  return (
    <div className="erf-brw-page erf-brw-page--empty">
      {firstRun && (
        <p className="erf-brw-page__body">
          Type an address such as localhost:5173 in the address bar.
        </p>
      )}
      {recent.length > 0 && (
        <AddressList heading="Recent" name="Recent addresses" urls={recent} onOpen={onOpen} />
      )}
      {localAddresses.length > 0 && (
        <AddressList
          heading="Local servers seen in your terminals"
          name="Local servers"
          urls={localAddresses}
          onOpen={onOpen}
        />
      )}
      <p className="erf-brw-page__hint">
        Load your app, then click <strong>Pick element</strong> ({browserShortcut('pick').label}) to
        pick an element
      </p>
    </div>
  )
}

function AddressList(props: {
  readonly heading: string
  readonly name: string
  readonly urls: readonly string[]
  readonly onOpen: (url: string) => void
}): JSX.Element {
  return (
    <section className="erf-brw-page__section">
      <h2 className="erf-brw-page__heading">{props.heading}</h2>
      <ul className="erf-brw-page__list" aria-label={props.name}>
        {props.urls.map(url => (
          <li key={url}>
            <button type="button" className="erf-brw-page__row" onClick={() => props.onOpen(url)}>
              {rowAddress(url)}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Props of the minimal Erfana pages. */
export interface ErfanaPageProps {
  readonly tabId: string
  readonly state: BrowserTabState
  /** Whether focus was in this tab, so the page may take it. */
  readonly mayTakeFocus: () => boolean
}

function useArrivalFocus<T extends HTMLElement>(
  mayTakeFocus: () => boolean,
  key: unknown
): React.RefObject<T> {
  const ref = useRef<T>(null)
  const mayRef = useLatestRef(mayTakeFocus)
  useEffect(() => {
    if (mayRef.current()) ref.current?.focus()
  }, [key, mayRef])
  return ref
}

function reload(tabId: string): void {
  browserTabGateway.history(tabId, 'reload').catch((error: unknown) => {
    logger.warn('Browser tab reload failed', {
      error: error instanceof Error ? error.message : String(error)
    })
  })
}

/**
 * The load-error page (025-FR-059), minimal: focus on Reload when the user
 * started the load, else on the heading.
 *
 * @param props - {@link ErfanaPageProps}
 * @returns The page, or nothing without `state.loadError`
 */
export function LoadErrorPage({ tabId, state, mayTakeFocus }: ErfanaPageProps): JSX.Element | null {
  const error = state.loadError
  const toReload = error?.focus === 'reload'
  const reloadRef = useArrivalFocus<HTMLButtonElement>(
    () => toReload && mayTakeFocus(),
    error?.code
  )
  const headingRef = useArrivalFocus<HTMLHeadingElement>(
    () => !toReload && mayTakeFocus(),
    error?.code
  )
  if (error === undefined) return null
  return (
    <div className="erf-brw-page">
      <h2 ref={headingRef} tabIndex={-1} className="erf-brw-page__title">
        {"Can't open this page"}
      </h2>
      <p className="erf-brw-page__body">{netErrorMessage(error.code)}</p>
      <p className="erf-brw-page__code">
        {rowAddress(shownAddress(state) ?? '')} · {netErrorCodeText(error.code)}
      </p>
      <button
        ref={reloadRef}
        type="button"
        className="erf-brw-page__action"
        onClick={() => reload(tabId)}
      >
        Reload
      </button>
    </div>
  )
}

/**
 * The crashed page (025-FR-056), minimal; focus on Reload.
 *
 * @param props - {@link ErfanaPageProps}
 * @returns The page
 */
export function CrashedPage({ tabId, mayTakeFocus }: ErfanaPageProps): JSX.Element {
  const reloadRef = useArrivalFocus<HTMLButtonElement>(mayTakeFocus, 'crashed')
  return (
    <div className="erf-brw-page">
      <h2 className="erf-brw-page__title">This page crashed</h2>
      <p className="erf-brw-page__body">
        Its process stopped unexpectedly. Press Reload to open it again.
      </p>
      <button
        ref={reloadRef}
        type="button"
        className="erf-brw-page__action"
        onClick={() => reload(tabId)}
      >
        Reload
      </button>
    </div>
  )
}

/**
 * The certificate warning page (025-FR-021), minimal: **Back to safety**
 * only, focused on arrival. **Proceed anyway** is commit 18's.
 *
 * @param props - {@link ErfanaPageProps}
 * @returns The page, or nothing without `state.certificate`
 */
export function CertificatePage({
  tabId,
  state,
  mayTakeFocus
}: ErfanaPageProps): JSX.Element | null {
  const warning = state.certificate
  const backRef = useArrivalFocus<HTMLButtonElement>(mayTakeFocus, warning?.decisionId)
  if (warning === undefined) return null
  const backToSafety = (): void => {
    browserTabGateway
      .certificate({ tabId, decisionId: warning.decisionId, proceed: false })
      .catch((error: unknown) => {
        logger.warn('Back to safety failed', {
          error: error instanceof Error ? error.message : String(error)
        })
      })
  }
  return (
    <div className="erf-brw-page">
      <h2 className="erf-brw-page__title">{`${warning.host} has a certificate Erfana can't trust`}</h2>
      <p className="erf-brw-page__body">
        Someone could be pretending to be {warning.host} to read or change what you send.
      </p>
      <button
        ref={backRef}
        type="button"
        className="erf-brw-page__action erf-brw-page__action--primary"
        onClick={backToSafety}
      >
        Back to safety
      </button>
    </div>
  )
}
