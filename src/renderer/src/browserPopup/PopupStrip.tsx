// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The origin strip of a browser popup window (spec 025, 025-FR-011; ADR 0011
 * decision 9; design README § Anatomy, "A popup window"; deck *Popup strip*;
 * commit 18). The popup's own host renderer draws it above the page; the page
 * is a native view main places under it.
 *
 * - **Read-only address**, through main's formatter (Security rule 2): the
 *   committed address only, never page text; focusable so it can be
 *   selected and copied. Before the first commit it says the popup is
 *   loading.
 * - **The badge** for remote `http` and local files, as the address bar.
 * - Asked again on every `browser-tab:popupChanged`.
 * - **Ctrl/Cmd+W** closes the popup (025-FR-014). The host has no platform
 *   bridge (no `window.api`), so either modifier closes it; neither key means
 *   anything else in the strip.
 *
 * No navigation row, no pick row: a popup cannot be navigated from Erfana.
 */
import { useEffect, useState } from 'react'
import { CircleAlert, File } from 'lucide-react'
import type { BrowserPopupBridge } from '../../../shared/ipc/browser-popup-bridge-types'
import type { PopupStripResponse } from '../../../shared/ipc/browser-tab-popup-schema'
import { originText } from '../../../shared/browser/originFormat'
import { securityBadge, pathOf } from '../components/Panels/BrowserPanel/browserPanel.logic'
import { BROWSER_TEST_IDS } from '../components/Panels/BrowserPanel/browserTestIds'
import './PopupStrip.css'

/** What the strip shows for `strip`: the formatted address, or a waiting line. */
export function popupAddress(strip: PopupStripResponse | null): string {
  if (strip === null || strip.committedUrl === null) return 'Loading…'
  const origin = strip.origin
  if (origin?.kind === 'web') return `${originText(origin)}${pathOf(strip.committedUrl)}`
  if (origin?.kind === 'nonWeb') return `${origin.scheme}:`
  return strip.committedUrl
}

/** Props for {@link PopupStrip}. */
export interface PopupStripProps {
  readonly api: BrowserPopupBridge
}

/**
 * The popup's origin strip.
 *
 * @param props - {@link PopupStripProps}
 * @returns The strip
 */
export function PopupStrip({ api }: PopupStripProps): JSX.Element {
  const [strip, setStrip] = useState<PopupStripResponse | null>(null)

  useEffect(() => {
    let live = true
    const read = (): void => {
      api
        .strip()
        .then(answer => {
          if (live) setStrip(answer)
        })
        .catch(() => {
          if (live) setStrip(null)
        })
    }
    read()
    const off = api.onChanged(() => {
      read()
    })
    return () => {
      live = false
      off()
    }
  }, [api])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'w') {
        event.preventDefault()
        void api.close()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [api])

  const badge = strip === null ? null : securityBadge(strip.security)
  const address = popupAddress(strip)
  return (
    <div className="erf-popup-strip" data-testid={BROWSER_TEST_IDS.POPUP_STRIP}>
      {badge !== null && (
        <span className={`erf-popup-strip__badge erf-popup-strip__badge--${badge.tone}`} title={badge.description}>
          {badge.icon === 'file' ? <File size={14} aria-hidden="true" /> : <CircleAlert size={14} aria-hidden="true" />}
          <span>{badge.word}</span>
        </span>
      )}
      <input
        className="erf-popup-strip__address"
        aria-label="Pop-up window address"
        aria-description={badge?.description}
        readOnly
        value={address}
        spellCheck={false}
      />
    </div>
  )
}
