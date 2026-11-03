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
 * - **Load error, crashed, certificate** – `ErrorPages.tsx` (commit 18).
 */
import { useEffect, useState } from 'react'
import { browserTabGateway } from '../../../services/browserTabGateway'
import { logger } from '../../../utils/logger'
import { browserShortcut } from './browserShortcuts'
import { rowAddress } from './browserPanel.logic'

/** How many recent addresses the empty tab lists (025-FR-063). */
export const EMPTY_TAB_RECENT_ROWS = 8

export { rowAddress } from './browserPanel.logic'

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
        pick an element.
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

export { CertificatePage, CrashedPage, LoadErrorPage, type ErfanaPageProps } from './ErrorPages'
