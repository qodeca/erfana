// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tooltips for the browser tab's toolbar controls – the navigation row and
 * the pick row (spec 025, 025-FR-051, 025-AC-065; design § Layout rules
 * "Pick-row tooltips" R2-H5, R3-M1, R4-M3; proposed Tooltip card).
 *
 * A control opts in with {@link tooltipProps}: `data-tip` carries the text
 * (lines split on `\n`) and `aria-description` the same text, so the
 * description reaches assistive tech whether or not the bubble shows.
 *
 * - **Shown** on keyboard focus (`:focus-visible`) at once, and on hover
 *   after {@link TOOLTIP_HOVER_DELAY_MS}. Focus wins over hover.
 * - **Esc, shown by keyboard focus**: the first Esc only hides it and is
 *   consumed – focus and pick mode stay; the next Esc does the state's
 *   routing (`useBrowserKeys`). It stays hidden until the control loses and
 *   regains focus.
 * - **Esc, shown by hover only**: the Esc routes and hides it in the same
 *   press; it stays hidden until the pointer leaves and re-enters. An Esc the
 *   page took (page focus) reaches main, not this DOM, so the panel calls
 *   {@link ToolbarTooltip.dismissHover} when that Esc's action lands (pick
 *   mode ending). A control whose text changes under a hover tooltip (it was
 *   pressed) hides it the same way.
 * - **Where**: one bubble, drawn inside the pick row's band – the panel clips
 *   everything above the navigation row and the native page paints over
 *   everything below the pick row. It starts after the send notice or the
 *   banner's first clause (else after Pick element) and ends before the
 *   control that holds focus when that control is in the pick row; one line,
 *   cut with an ellipsis, the full text kept in the description. With less
 *   than {@link TOOLTIP_MIN_WIDTH_PX} of room it does not show (design H-02:
 *   "if no side is free it is not shown").
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLatestRef } from '../../../hooks/useLatestRef'
import { BROWSER_TEST_IDS } from './browserTestIds'

/** Hover time before a tooltip shows (Tooltip card: a short delay on hover, none on focus). */
export const TOOLTIP_HOVER_DELAY_MS = 400
/** Narrowest bubble worth drawing; below it the tooltip does not show. */
export const TOOLTIP_MIN_WIDTH_PX = 80
/** Room kept between the bubble and what it must not cover. */
const TOOLTIP_GAP_PX = 4

/** The props a toolbar control spreads to take a tooltip. */
export interface TooltipTriggerProps {
  readonly 'data-tip': string
  readonly 'aria-description': string
}

/**
 * The props that give a toolbar control its tooltip.
 *
 * @param text - The tooltip's text; `\n` separates its lines
 * @returns Props to spread on the control
 *
 * @example
 * ```tsx
 * <button aria-label="Reload" {...tooltipProps('Reload (⌘R)')} />
 * ```
 */
export function tooltipProps(text: string): TooltipTriggerProps {
  return { 'data-tip': text, 'aria-description': text.replace(/\n/g, ' – ') }
}

/** Where the bubble sits in the band, in px from the band's left edge; `width: null` when the band is not laid out. */
export interface TooltipPlacement {
  readonly left: number
  readonly width: number | null
}

/** The bubble to draw, or nothing. */
export interface TooltipView {
  readonly lines: readonly string[]
  readonly placement: TooltipPlacement
}

/** What the panel wires. */
export interface ToolbarTooltip {
  readonly view: TooltipView | null
  /** A hover-only tooltip's Esc landed elsewhere (page focus): hide it until the pointer re-enters. */
  readonly dismissHover: () => void
}

/** Options for {@link useToolbarTooltip}. */
export interface UseToolbarTooltipOptions {
  /** The rows whose `[data-tip]` controls take tooltips. */
  readonly rows: readonly React.RefObject<HTMLElement>[]
  /** The pick row: the band the bubble is drawn in. */
  readonly band: React.RefObject<HTMLElement>
  /** The panel root, which sees every Esc pressed in the tab's DOM. */
  readonly scope: React.RefObject<HTMLElement>
  /** `false` hides any tooltip (the rows are inert while the dialog is open). */
  readonly enabled: boolean
}

interface Shown {
  readonly trigger: HTMLElement
  readonly text: string
  readonly by: 'focus' | 'hover'
}

function isFocusVisible(element: Element): boolean {
  try {
    return element.matches(':focus-visible')
  } catch {
    // An engine without the selector: focus is the only cue there is.
    return true
  }
}

/**
 * Where the bubble goes in `band` for `trigger`, or `null` when there is no room.
 *
 * @param band - The pick row
 * @param trigger - The control the tooltip describes
 * @returns The placement
 */
export function placeTooltip(band: HTMLElement, trigger: HTMLElement): TooltipPlacement | null {
  const row = band.getBoundingClientRect()
  if (row.width === 0) return { left: 0, width: null }
  const anchor =
    band.querySelector('.erf-brw-notice') ?? band.querySelector('.erf-brw-banner-line__first') ?? band.querySelector('.erf-brw-pickbtn')
  const padding = parseFloat(getComputedStyle(band).paddingRight) || 0
  let start = (anchor === null ? 0 : anchor.getBoundingClientRect().right - row.left) + TOOLTIP_GAP_PX
  let end = row.width - padding
  if (band.contains(trigger)) {
    const box = trigger.getBoundingClientRect()
    if (box.left - row.left >= start) end = Math.min(end, box.left - row.left - TOOLTIP_GAP_PX)
    else start = Math.max(start, box.right - row.left + TOOLTIP_GAP_PX)
  }
  return end - start >= TOOLTIP_MIN_WIDTH_PX ? { left: start, width: end - start } : null
}

/**
 * Runs the toolbar tooltips of one browser tab.
 *
 * @param options - {@link UseToolbarTooltipOptions}
 * @returns {@link ToolbarTooltip}
 */
export function useToolbarTooltip(options: UseToolbarTooltipOptions): ToolbarTooltip {
  const { rows, band, scope, enabled } = options
  const [shown, setShown] = useState<Shown | null>(null)
  const [placement, setPlacement] = useState<TooltipPlacement | null>(null)
  const shownRef = useLatestRef(shown)
  const dismissedFocus = useRef(new WeakSet<HTMLElement>())
  const dismissedHover = useRef(new WeakSet<HTMLElement>())
  const rowsRef = useLatestRef(rows)

  useEffect(() => {
    if (!enabled) return
    let hoverTimer: ReturnType<typeof setTimeout> | undefined
    const triggerOf = (target: EventTarget | null): HTMLElement | null => {
      if (!(target instanceof Element)) return null
      const trigger = target.closest<HTMLElement>('[data-tip]')
      const inRow = trigger !== null && rowsRef.current.some(row => row.current?.contains(trigger) === true)
      return inRow ? trigger : null
    }
    const show = (trigger: HTMLElement, by: Shown['by']): void => setShown({ trigger, text: trigger.dataset.tip ?? '', by })

    const onFocusIn = (event: FocusEvent): void => {
      const trigger = triggerOf(event.target)
      if (trigger === null || dismissedFocus.current.has(trigger) || !isFocusVisible(trigger)) return
      clearTimeout(hoverTimer)
      show(trigger, 'focus')
    }
    const onFocusOut = (event: FocusEvent): void => {
      const trigger = triggerOf(event.target)
      if (trigger === null) return
      dismissedFocus.current.delete(trigger)
      if (shownRef.current?.trigger === trigger && shownRef.current.by === 'focus') setShown(null)
    }
    const onPointerOver = (event: PointerEvent): void => {
      const trigger = triggerOf(event.target)
      const current = shownRef.current
      if (trigger === null || dismissedHover.current.has(trigger) || current?.trigger === trigger || current?.by === 'focus') return
      clearTimeout(hoverTimer)
      hoverTimer = setTimeout(() => show(trigger, 'hover'), TOOLTIP_HOVER_DELAY_MS)
    }
    const onPointerOut = (event: PointerEvent): void => {
      const trigger = triggerOf(event.target)
      if (trigger === null || (event.relatedTarget instanceof Node && trigger.contains(event.relatedTarget))) return
      clearTimeout(hoverTimer)
      dismissedHover.current.delete(trigger)
      if (shownRef.current?.trigger === trigger && shownRef.current.by === 'hover') setShown(null)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      const current = shownRef.current
      if (event.key !== 'Escape' || event.isComposing || current === null) return
      if (current.by === 'focus' && document.activeElement === current.trigger) {
        // The first Esc is the tooltip's alone (025-AC-065); the next one routes.
        event.preventDefault()
        event.stopPropagation()
        dismissedFocus.current.add(current.trigger)
      } else {
        // Hover only: this Esc routes as well, and the tooltip waits for the pointer to come back.
        dismissedHover.current.add(current.trigger)
      }
      setShown(null)
    }

    const targets = rowsRef.current.map(row => row.current).filter((row): row is HTMLElement => row !== null)
    for (const row of targets) {
      row.addEventListener('focusin', onFocusIn)
      row.addEventListener('focusout', onFocusOut)
      row.addEventListener('pointerover', onPointerOver)
      row.addEventListener('pointerout', onPointerOut)
    }
    const root = scope.current
    root?.addEventListener('keydown', onKeyDown)
    return () => {
      clearTimeout(hoverTimer)
      for (const row of targets) {
        row.removeEventListener('focusin', onFocusIn)
        row.removeEventListener('focusout', onFocusOut)
        row.removeEventListener('pointerover', onPointerOver)
        row.removeEventListener('pointerout', onPointerOut)
      }
      root?.removeEventListener('keydown', onKeyDown)
      setShown(null)
    }
  }, [enabled, scope, rowsRef, shownRef])

  // The control's text changed while shown: a focus tooltip follows it; a hover one was pressed, so it goes.
  const trigger = shown?.trigger ?? null
  const by = shown?.by ?? null
  useEffect(() => {
    if (trigger === null) return
    const observer = new MutationObserver(() => {
      if (by === 'hover') {
        dismissedHover.current.add(trigger)
        setShown(null)
      } else {
        setShown({ trigger, text: trigger.dataset.tip ?? '', by: 'focus' })
      }
    })
    observer.observe(trigger, { attributes: true, attributeFilter: ['data-tip'] })
    return () => observer.disconnect()
  }, [trigger, by])

  // Measured once the bubble's trigger is known: the band's layout decides where it fits.
  useLayoutEffect(() => {
    const host = band.current
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the place is measured from the band's and the trigger's DOM rects in this layout effect, before paint
    setPlacement(shown === null || host === null || !shown.trigger.isConnected ? null : placeTooltip(host, shown.trigger))
  }, [shown, band])

  const dismissHover = useCallback(() => {
    const current = shownRef.current
    if (current?.by !== 'hover') return
    dismissedHover.current.add(current.trigger)
    setShown(null)
  }, [shownRef])

  const view = shown !== null && placement !== null && shown.text !== '' ? { lines: shown.text.split('\n'), placement } : null
  return { view, dismissHover }
}

/**
 * The bubble, drawn inside the pick row.
 *
 * @param props - The view to draw, or `null`
 * @returns The tooltip, or nothing
 */
export function ToolbarTooltipBubble({ view }: { readonly view: TooltipView | null }): JSX.Element | null {
  if (view === null) return null
  const { left, width } = view.placement
  return (
    <span
      role="tooltip"
      className="erf-brw-tip"
      style={{ left, ...(width === null ? {} : { width }) }}
      data-testid={BROWSER_TEST_IDS.TOOLBAR_TOOLTIP}
    >
      {view.lines.map((line, index) => (
        <span key={index} className="erf-brw-tip__line">
          {line}
        </span>
      ))}
    </span>
  )
}
