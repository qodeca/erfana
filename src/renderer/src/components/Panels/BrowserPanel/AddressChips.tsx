// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The chips at the end of the address bar (spec 025, 025-FR-008, 025-FR-011,
 * 025-FR-019; design § Address bar, deck *Chip – …*):
 *
 * - **In use** – camera, microphone, screen: static text, never a button, and
 *   it never leaves the field (Security rule 15).
 * - **Zoom** – "{n}%" while the site is not at 100%; a press resets it.
 * - **Pop-up blocked** – while the tab's pop-up row is in the strip; a press
 *   moves focus to that row.
 *
 * A chip that goes while it holds focus hands focus to the address field
 * (design § Where focus lands). Every chip is at least 24px.
 */
import { useLayoutEffect, useRef } from 'react'
import { Camera, Mic, MonitorUp, SquareArrowOutUpRight } from 'lucide-react'
import type { BrowserTabState } from '../../../stores/useBrowserTabStore'
import { sentenceHost } from './erfanaPageCopy'
import { BROWSER_TEST_IDS } from './browserTestIds'
import { browserShortcut } from './browserShortcuts'

/** Props for {@link AddressChips}. */
export interface AddressChipsProps {
  readonly state: BrowserTabState | null
  readonly popupBlocked: boolean
  readonly addressRef: React.RefObject<HTMLInputElement>
  readonly onResetZoom: () => void
  readonly onShowPopupRow: () => void
}

const ICON = { size: 14, strokeWidth: 2, 'aria-hidden': true } as const

/** The in-use chips' words and names (deck *Chip – in use*). */
export function inUseChips(state: BrowserTabState | null): ReadonlyArray<{ kind: 'camera' | 'microphone' | 'screen'; text: string; name: string }> {
  if (state === null) return []
  const host = sentenceHost(state.origin)
  const chips: Array<{ kind: 'camera' | 'microphone' | 'screen'; text: string; name: string }> = []
  if (state.inUse.camera) chips.push({ kind: 'camera', text: 'Camera', name: `${host} is using your camera` })
  if (state.inUse.microphone) chips.push({ kind: 'microphone', text: 'Microphone', name: `${host} is using your microphone` })
  if (state.inUse.screen) chips.push({ kind: 'screen', text: 'Screen', name: `${host} is using your screen` })
  return chips
}

/** Hands focus to the address field when the chip behind `ref` goes while focused. */
function useFocusHandoff(shown: boolean, addressRef: React.RefObject<HTMLInputElement>): React.RefObject<HTMLButtonElement> {
  const ref = useRef<HTMLButtonElement>(null)
  const hadFocus = useRef(false)
  useLayoutEffect(() => {
    if (shown) return
    if (hadFocus.current) {
      hadFocus.current = false
      addressRef.current?.focus()
    }
  }, [shown, addressRef])
  useLayoutEffect(() => {
    const node = ref.current
    if (node === null) return
    const onFocus = (): void => {
      hadFocus.current = true
    }
    const onBlur = (event: FocusEvent): void => {
      // A blur because the chip left the DOM keeps the flag for the handoff above.
      if (event.relatedTarget !== null) hadFocus.current = false
    }
    node.addEventListener('focus', onFocus)
    node.addEventListener('blur', onBlur)
    return () => {
      node.removeEventListener('focus', onFocus)
      node.removeEventListener('blur', onBlur)
    }
  }, [shown])
  return ref
}

/**
 * Renders the chips, or nothing when none shows.
 *
 * @param props - {@link AddressChipsProps}
 * @returns The chips
 */
export function AddressChips({ state, popupBlocked, addressRef, onResetZoom, onShowPopupRow }: AddressChipsProps): JSX.Element | null {
  const zoom = state?.zoomPercent ?? 100
  const zoomShown = state !== null && state.erfanaPage === null && zoom !== 100
  const zoomRef = useFocusHandoff(zoomShown, addressRef)
  const popupRef = useFocusHandoff(popupBlocked, addressRef)
  const inUse = inUseChips(state)
  if (!zoomShown && !popupBlocked && inUse.length === 0) return null
  const reset = browserShortcut('zoomReset')
  return (
    <span className="erf-brw-chips" data-testid={BROWSER_TEST_IDS.CHIPS}>
      {inUse.map(chip => (
        <span key={chip.kind} className="erf-brw-chip erf-brw-chip--static" role="img" aria-label={chip.name}>
          {chip.kind === 'camera' && <Camera {...ICON} />}
          {chip.kind === 'microphone' && <Mic {...ICON} />}
          {chip.kind === 'screen' && <MonitorUp {...ICON} />}
          <span className="erf-brw-chip__text" aria-hidden="true">
            {chip.text}
          </span>
        </span>
      ))}
      {zoomShown && (
        <button
          ref={zoomRef}
          type="button"
          className="erf-brw-chip"
          data-fold-step="3"
          aria-label={`${zoom}% zoom, reset to 100%`}
          aria-keyshortcuts={reset.aria}
          title={`Reset zoom to 100% (${reset.label})`}
          onClick={onResetZoom}
        >
          {zoom}%
        </button>
      )}
      {popupBlocked && (
        <button
          ref={popupRef}
          type="button"
          className="erf-brw-chip erf-brw-chip--warning"
          aria-label="Pop-up blocked, show options"
          title="Pop-up blocked"
          onClick={onShowPopupRow}
        >
          <SquareArrowOutUpRight {...ICON} />
          <span className="erf-brw-chip__text">Pop-up blocked</span>
        </button>
      )}
    </span>
  )
}
