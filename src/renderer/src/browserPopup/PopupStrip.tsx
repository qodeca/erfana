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
 *   selected and copied. At rest the origin is fitted to the field's width
 *   (`useOriginFit`), so a long host never pushes its registrable domain out
 *   of view; focused, the field holds the whole address for copying.
 * - **No web address yet** – before the first commit, at `about:blank`, or a
 *   document its opener wrote with no navigation – it reads "about:blank –
 *   opened by {origin}", naming the frame that opened it, as the OS title does
 *   (S-22). "Loading…" shows only until main first answers.
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
import { fittedText, originText, popupBlankText, type FittedOrigin } from '../../../shared/browser/originFormat'
import { securityBadge, pathOf } from '../components/Panels/BrowserPanel/browserPanel.logic'
import { useOriginFit } from '../components/Panels/BrowserPanel/useOriginFit'
import { BROWSER_TEST_IDS } from '../components/Panels/BrowserPanel/browserTestIds'
import './PopupStrip.css'

const BLANK = 'about:blank'

/**
 * What the strip shows for `strip`: the formatted address – its origin
 * `fitted` when given – "about:blank – opened by {origin}" while the popup has
 * no address of its own, or a waiting line before main answers.
 */
export function popupAddress(strip: PopupStripResponse | null, fitted: FittedOrigin | null = null): string {
  if (strip === null) return 'Loading…'
  const committed = strip.committedUrl
  if (committed === null || committed === BLANK) return popupBlankText(strip.openedBy)
  const origin = strip.origin
  if (origin?.kind === 'web') return `${fitted === null ? originText(origin) : fittedText(fitted)}${pathOf(committed)}`
  if (origin?.kind === 'nonWeb') return `${origin.scheme}:`
  return committed
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

  const [field, setField] = useState<HTMLInputElement | null>(null)
  const [focused, setFocused] = useState(false)
  const webOrigin = strip?.origin?.kind === 'web' ? strip.origin : null
  const fitted = useOriginFit(field, webOrigin)
  const badge = strip === null ? null : securityBadge(strip.security)
  const address = popupAddress(strip, focused ? null : fitted)
  return (
    <div className="erf-popup-strip" data-testid={BROWSER_TEST_IDS.POPUP_STRIP}>
      {badge !== null && (
        <span className={`erf-popup-strip__badge erf-popup-strip__badge--${badge.tone}`} title={badge.description}>
          {badge.icon === 'file' ? <File size={14} aria-hidden="true" /> : <CircleAlert size={14} aria-hidden="true" />}
          <span>{badge.word}</span>
        </span>
      )}
      <input
        ref={setField}
        className="erf-popup-strip__address"
        aria-label="Pop-up window address"
        aria-description={badge?.description}
        readOnly
        value={address}
        spellCheck={false}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
    </div>
  )
}
