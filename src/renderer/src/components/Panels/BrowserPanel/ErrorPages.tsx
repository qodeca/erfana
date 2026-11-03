// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The load-error, certificate and crashed pages in a browser tab's page area
 * (spec 025, 025-FR-059, 025-FR-021, 025-FR-056; ADR 0011 decision 5; design
 * `page-states.html`, deck *Load error*, *Certificate warning*, *Crashed and
 * hung*; commit 18). DOM: while one shows, the native view is hidden.
 *
 * - **Load error**: the per-code title, sentence and next step, the loopback
 *   hint in its place on a loopback address, the address and code lines, and
 *   Reload ("Reloading…" while it loads). Focus on Reload when the user
 *   started the load, else on the heading.
 * - **Certificate**: Back to safety (filled primary, focused), and **Proceed
 *   anyway** shown at once as a quieter text button with the caution text
 *   beside it. Proceed anyway is blocked for 500 ms after the page appears and
 *   ignores a press that began before it (Security rule 10; main checks the
 *   same on its clock). *More about this error* holds the address and code,
 *   never a button. Erfana pages offer navigation only (Security rule 11).
 * - **Crashed**: the spec-fixed title and Reload.
 *
 * Focus on arrival (design § Where focus lands) is taken only when focus was
 * already in this tab – an Erfana page never pulls focus from another panel.
 */
import { useEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from 'react'
import type { BrowserTabState } from '../../../stores/useBrowserTabStore'
import { browserTabGateway } from '../../../services/browserTabGateway'
import { logger } from '../../../utils/logger'
import { useLatestRef } from '../../../hooks/useLatestRef'
import { getBasename } from '../../../utils/fileUtils'
import { netErrorCodeText } from '../../../../../shared/browser/netErrorMessages'
import { rowAddress, shownAddress } from './browserPanel.logic'
import { certificateCopy, loadErrorCopy, sentenceHost } from './erfanaPageCopy'
import { STRIP_INPUT_GUARD_MS } from './stripRows.logic'

/** Props of the error pages. */
export interface ErfanaPageProps {
  readonly tabId: string
  readonly state: BrowserTabState
  /** Whether focus was in this tab, so the page may take it. */
  readonly mayTakeFocus: () => boolean
}

function useArrivalFocus<T extends HTMLElement>(mayTakeFocus: () => boolean, key: unknown): React.RefObject<T> {
  const ref = useRef<T>(null)
  const mayRef = useLatestRef(mayTakeFocus)
  useEffect(() => {
    if (mayRef.current()) ref.current?.focus()
  }, [key, mayRef])
  return ref
}

function warn(what: string): (error: unknown) => void {
  return error => logger.warn(what, { error: error instanceof Error ? error.message : String(error) })
}

function reload(tabId: string): void {
  browserTabGateway.history(tabId, 'reload').catch(warn('Browser tab reload failed'))
}

/** The decoded file name of a `file:` address, or `''`. */
function fileNameOf(address: string | null): string {
  if (address === null || !address.startsWith('file:')) return ''
  try {
    return getBasename(decodeURIComponent(new URL(address).pathname))
  } catch {
    return ''
  }
}

/**
 * The load-error page (025-FR-059).
 *
 * @param props - {@link ErfanaPageProps}
 * @returns The page, or nothing without `state.loadError`
 */
export function LoadErrorPage({ tabId, state, mayTakeFocus }: ErfanaPageProps): JSX.Element | null {
  const error = state.loadError
  const toReload = error?.focus === 'reload'
  const reloadRef = useArrivalFocus<HTMLButtonElement>(() => toReload && mayTakeFocus(), error?.code)
  const headingRef = useArrivalFocus<HTMLHeadingElement>(() => !toReload && mayTakeFocus(), error?.code)
  if (error === undefined) return null
  const address = shownAddress(state)
  const copy = loadErrorCopy(error.code, state.origin, fileNameOf(address))
  return (
    <div className="erf-brw-page" role="region" aria-labelledby={`erf-brw-err-${tabId}`}>
      <h2 ref={headingRef} id={`erf-brw-err-${tabId}`} tabIndex={-1} className="erf-brw-page__title">
        {copy.title}
      </h2>
      <p className="erf-brw-page__body">{copy.sentence}</p>
      <p className="erf-brw-page__body">{copy.nextStep}</p>
      <p className="erf-brw-page__code">
        {rowAddress(address ?? '')} · {copy.code}
      </p>
      <button
        ref={reloadRef}
        type="button"
        className="erf-brw-page__action"
        aria-disabled={state.loading ? true : undefined}
        onClick={() => {
          if (!state.loading) reload(tabId)
        }}
      >
        {state.loading ? 'Reloading…' : 'Reload'}
      </button>
    </div>
  )
}

/**
 * The crashed page (025-FR-056); focus on Reload.
 *
 * @param props - {@link ErfanaPageProps}
 * @returns The page
 */
export function CrashedPage({ tabId, mayTakeFocus }: ErfanaPageProps): JSX.Element {
  const reloadRef = useArrivalFocus<HTMLButtonElement>(mayTakeFocus, 'crashed')
  return (
    <div className="erf-brw-page">
      <h2 className="erf-brw-page__title">This page crashed</h2>
      <p className="erf-brw-page__body">Its process stopped unexpectedly. Press Reload to open it again.</p>
      <button ref={reloadRef} type="button" className="erf-brw-page__action" onClick={() => reload(tabId)}>
        Reload
      </button>
    </div>
  )
}

/** Whether the guard that started at `since` still runs; re-renders once when it ends. */
function useGuardSince(since: number): boolean {
  const [over, setOver] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setOver(true), Math.max(0, since + STRIP_INPUT_GUARD_MS - performance.now()))
    return () => clearTimeout(timer)
  }, [since])
  return !over
}

/**
 * The certificate warning page (025-FR-021).
 *
 * @param props - {@link ErfanaPageProps}
 * @returns The page, or nothing without `state.certificate`
 */
export function CertificatePage({ tabId, state, mayTakeFocus }: ErfanaPageProps): JSX.Element | null {
  const warning = state.certificate
  const backRef = useArrivalFocus<HTMLButtonElement>(mayTakeFocus, warning?.decisionId)
  // The page appeared now, on the renderer's clock (`PageArea` keys this page by its
  // decision, so a new warning mounts afresh); main keeps `shownAt` on its own.
  const [appearedAt] = useState(() => performance.now())
  const guarded = useGuardSince(appearedAt)
  const pressRef = useRef(0)
  if (warning === undefined) return null
  const host = warning.host || sentenceHost(state.origin)
  const copy = certificateCopy(warning.code, host)
  const decide = (proceed: boolean): void => {
    browserTabGateway
      .certificate({ tabId, decisionId: warning.decisionId, proceed })
      .catch(warn(proceed ? 'Proceed anyway failed' : 'Back to safety failed'))
  }
  const markPress = (event: PointerEvent | KeyboardEvent): void => {
    pressRef.current = event.timeStamp
  }
  const proceed = (): void => {
    // Blocked look for the first 500 ms; a press begun before the page appeared never counts.
    if (guarded || pressRef.current < appearedAt) return
    decide(true)
  }
  const cautionId = `erf-brw-caution-${tabId}`
  return (
    <div className="erf-brw-page">
      <h2 className="erf-brw-page__title">{`${host} has a certificate Erfana can't trust`}</h2>
      <p className="erf-brw-page__body">Someone could be pretending to be {host} to read or change what you send.</p>
      <p className="erf-brw-page__body">{copy.sentence}</p>
      <button
        ref={backRef}
        type="button"
        className="erf-brw-page__action erf-brw-page__action--primary"
        onClick={() => decide(false)}
      >
        Back to safety
      </button>
      <div className="erf-brw-page__proceed">
        <button
          type="button"
          className="erf-brw-page__text-action"
          aria-label={`Proceed anyway to ${host}`}
          aria-describedby={cautionId}
          aria-disabled={guarded ? true : undefined}
          onPointerDown={markPress}
          onKeyDown={markPress}
          onClick={proceed}
        >
          Proceed anyway
        </button>
        <p id={cautionId} className="erf-brw-page__caution">
          {copy.caution}
        </p>
      </div>
      <details className="erf-brw-page__details">
        <summary>More about this error</summary>
        <p className="erf-brw-page__code">{rowAddress(shownAddress(state) ?? '')}</p>
        <p className="erf-brw-page__code">{netErrorCodeText(warning.code)}</p>
      </details>
    </div>
  )
}
