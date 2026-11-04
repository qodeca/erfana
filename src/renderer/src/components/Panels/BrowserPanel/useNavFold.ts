// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Measures the navigation row and decides its fold steps 3–7 (spec 025;
 * design § States › Tiers; the decision is `navFold.logic.ts`).
 *
 * Each foldable part carries `data-fold-step="N"` – the tools on the row, the
 * zoom chip, the badge word. A folded part is taken out of the flow and
 * hidden (`visibility: hidden`, so it is neither focusable nor in the
 * accessibility tree) but stays in the DOM, so its width is always known:
 * the room with no step taken is the field's room now less what the taken
 * steps gave it, and it does not depend on the steps taken – the row
 * settles in one pass. Step 5 gives back the difference between the field's
 * `--space-4` and `--space-2` margins.
 *
 * The origin's need is its form with steps 1 and 2 exhausted
 * (`minimalFittedOrigin`), measured in the field's own font.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { fittedText, minimalFittedOrigin, type WebOriginParts } from '../../../../../shared/browser/originFormat'
import { NAV_FOLD_STEPS, isFolded, navFoldCount, type NavFoldStep } from './navFold.logic'

/** Kept free at the end of the field, as `useOriginFit` keeps it. */
const SAFETY_PX = 1

const px = (value: string): number => parseFloat(value) || 0

/** The width `element` gives back when it leaves its flex parent: itself, and one gap when it has siblings. */
function widthWithGap(element: Element): number {
  const width = element.getBoundingClientRect().width
  const parent = element.parentElement
  if (parent === null || parent.children.length < 2) return width
  return width + px(getComputedStyle(parent).columnGap)
}

/** Whether `element` takes part in its parent's flex layout (a folded part, the hidden description and the suggestion list do not). */
function inFlow(element: Element): boolean {
  const style = getComputedStyle(element)
  return style.display !== 'none' && style.position !== 'absolute' && style.position !== 'fixed'
}

/** `element`'s width with its inline margins. */
function outerWidth(element: Element): number {
  const style = getComputedStyle(element)
  return element.getBoundingClientRect().width + px(style.marginLeft) + px(style.marginRight)
}

/** The room flex layout leaves `child` in `parent`: the content box less every other in-flow item and the gaps. */
function roomFor(parent: Element, child: Element, contentWidth: number): number {
  const items = [...parent.children].filter(inFlow)
  const gaps = Math.max(0, items.length - 1) * px(getComputedStyle(parent).columnGap)
  return contentWidth - gaps - items.reduce((sum, item) => (item === child ? sum : sum + outerWidth(item)), 0)
}

/**
 * The field's room in `row` as flex layout gives it, before any clamping: a
 * box shrinks no further than 0, so a field squeezed shut reads 0 whatever
 * the shortfall – this reads the shortfall too, so a fold decided from it
 * never flips back.
 */
function fieldRoom(row: HTMLElement, address: HTMLElement, field: HTMLElement): number {
  const rowStyle = getComputedStyle(row)
  const rowContent = row.clientWidth - px(rowStyle.paddingLeft) - px(rowStyle.paddingRight)
  const addressStyle = getComputedStyle(address)
  const addressBox =
    roomFor(row, address, rowContent) - px(addressStyle.marginLeft) - px(addressStyle.marginRight)
  const addressContent =
    addressBox -
    px(addressStyle.paddingLeft) -
    px(addressStyle.paddingRight) -
    px(addressStyle.borderLeftWidth) -
    px(addressStyle.borderRightWidth)
  return roomFor(address, field, addressContent)
}

/** The room each step gives back in `row`, in px. */
function freedByStep(row: HTMLElement): Record<NavFoldStep, number> {
  const freed = {} as Record<NavFoldStep, number>
  for (const step of NAV_FOLD_STEPS) {
    freed[step] = [...row.querySelectorAll(`[data-fold-step="${step}"]`)].reduce((sum, part) => sum + widthWithGap(part), 0)
  }
  const style = getComputedStyle(row)
  freed[5] = 2 * Math.max(0, px(style.getPropertyValue('--space-4')) - px(style.getPropertyValue('--space-2')))
  return freed
}

/** The drawn width of `text` in `element`'s font; 0 without a canvas (no fold is decided then). */
function textWidth(element: HTMLElement, text: string): number {
  const ctx = document.createElement('canvas').getContext('2d')
  if (ctx === null) return 0
  const style = getComputedStyle(element)
  ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  return ctx.measureText(text).width
}

/**
 * The fold count for `row` showing `parts`, with `current` steps taken now:
 * 0 without a web origin or a field, `current` before layout.
 */
function decideFold(row: HTMLElement, parts: WebOriginParts | null, current: number): number {
  const address = row.querySelector<HTMLElement>('.erf-brw-address')
  const field = address?.querySelector<HTMLElement>(':scope > .erf-brw-address__field') ?? null
  const input = field?.querySelector<HTMLElement>('.erf-brw-address__input') ?? null
  if (address === null || field === null || input === null || parts === null) return 0
  // Not laid out yet (a hidden panel, jsdom): nothing to decide from.
  if (row.clientWidth <= 0) return current
  const freed = freedByStep(row)
  // The room with no step taken: what the field has now, less what the taken steps gave it.
  const taken = NAV_FOLD_STEPS.reduce((sum, step) => (isFolded(step, current) ? sum + freed[step] : sum), 0)
  const room = fieldRoom(row, address, field) - taken
  const minimal = textWidth(input, fittedText(minimalFittedOrigin(parts)))
  const needed = minimal <= 0 ? 0 : minimal + SAFETY_PX
  return navFoldCount({ room, needed, freed, current })
}

/** The fold steps the row's committed DOM shows: the count of steps in its `data-fold`. */
export function renderedFold(row: HTMLElement): number {
  const value = row.getAttribute('data-fold')
  return value === null || value.trim() === '' ? 0 : value.trim().split(/\s+/).length
}

/**
 * The number of fold steps (0–5) the row takes.
 *
 * @param row - The navigation row, or null before it mounts
 * @param parts - The web origin the address bar shows at rest, or null for none (no fold then)
 * @returns How many of `NAV_FOLD_STEPS` are taken
 *
 * @example
 * ```tsx
 * const [row, setRow] = useState<HTMLDivElement | null>(null)
 * const fold = useNavFold(row, display.kind === 'web' ? display.parts : null)
 * // <div ref={setRow} data-fold={navFoldAttribute(fold)}>…</div>
 * ```
 */
export function useNavFold(row: HTMLElement | null, parts: WebOriginParts | null): number {
  const [count, setCount] = useState(0)
  const partsRef = useRef(parts)

  // Measured from the DOM against the steps the DOM shows now (its `data-fold`), never against a
  // count still waiting to render: two measurements in one frame (the observer and the frame
  // callback) would otherwise read one layout against another count and flip the row every frame.
  const remeasure = useCallback(() => {
    if (row !== null) setCount(decideFold(row, partsRef.current, renderedFold(row)))
  }, [row])

  // The row or the field resized (a fold taken, the panel's width, a chip on the field): observer
  // callbacks run after layout, with the sizes the decision reads.
  useEffect(() => {
    if (row === null || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(remeasure)
    observer.observe(row)
    const field = row.querySelector('.erf-brw-address__field')
    if (field !== null) observer.observe(field)
    let live = true
    // A glyph measured in a fallback font has another width.
    void document.fonts?.ready.then(() => {
      if (live) remeasure()
    })
    return () => {
      live = false
      observer.disconnect()
    }
  }, [row, remeasure])

  // A render can change what is measured without resizing anything – another origin, the zoom chip or
  // the badge word while folded – so every render measures again on the next frame.
  useEffect(() => {
    partsRef.current = parts
    const frame = requestAnimationFrame(remeasure)
    return () => cancelAnimationFrame(frame)
  })

  return count
}
