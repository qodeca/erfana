// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The chips at the end of the address bar (spec 025, 025-FR-008, 025-FR-011,
 * 025-FR-019; design § Address bar, deck *Chip – …*):
 *
 * - **Zoom** – "{n}%" while the site is not at 100%; a press resets it.
 * - **Pop-up blocked** – while the tab's pop-up row is in the strip; a press
 *   moves focus to that row.
 *
 * There is no "in use" chip for the camera, microphone or screen: the engine
 * never reports that a capture ends (025-FR-019, owner decision 2026-11-05).
 *
 * A chip that goes while it holds focus hands focus to the address field
 * (design § Where focus lands). Every chip is at least 24px.
 */
import { useLayoutEffect, useRef } from 'react'
import { SquareArrowOutUpRight } from 'lucide-react'
import type { BrowserTabState } from '../../../stores/useBrowserTabStore'
import { BROWSER_TEST_IDS } from './browserTestIds'
import { browserShortcut } from './browserShortcuts'
import { tooltipProps } from './ToolbarTooltip'

/** Props for {@link AddressChips}. */
export interface AddressChipsProps {
  readonly state: BrowserTabState | null
  readonly popupBlocked: boolean
  readonly addressRef: React.RefObject<HTMLInputElement>
  readonly onResetZoom: () => void
  readonly onShowPopupRow: () => void
}

const ICON = { size: 14, strokeWidth: 2, 'aria-hidden': true } as const

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
  if (!zoomShown && !popupBlocked) return null
  const reset = browserShortcut('zoomReset')
  return (
    <span className="erf-brw-chips" data-testid={BROWSER_TEST_IDS.CHIPS}>
      {zoomShown && (
        <button
          ref={zoomRef}
          type="button"
          className="erf-brw-chip"
          data-fold-step="3"
          aria-label={`${zoom}% zoom, reset to 100%`}
          aria-keyshortcuts={reset.aria}
          {...tooltipProps(`Reset zoom to 100% (${reset.label})`)}
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
          {...tooltipProps('Pop-up blocked')}
          onClick={onShowPopupRow}
        >
          <SquareArrowOutUpRight {...ICON} />
          <span className="erf-brw-chip__text">Pop-up blocked</span>
        </button>
      )}
    </span>
  )
}
