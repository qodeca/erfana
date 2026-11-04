// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Measures a panel toolbar row and decides which buttons fit (#451).
 *
 * The row measures its OWN width with a ResizeObserver – a dock splitter
 * resizes a panel without the window resizing. Widths of the parts are read
 * from the DOM after every commit and cached by id, so a button that has moved
 * (and is no longer rendered) keeps the width it had in the row. A hidden tab
 * measures 0 wide; that is "not drawn", not "narrow", and leaves the layout as
 * it was.
 *
 * Pinned content (#461) is measured as drawn, 0 included – an empty live region
 * is 0 wide, not "not drawn" – and a spacer by its CSS `min-width`, since it
 * otherwise takes whatever width is left. Pinned content can change width
 * without this row re-rendering (a count inside the comment tools), so it is
 * observed too.
 *
 * @module components/ToolbarOverflow/useToolbarOverflow
 */
import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useLatestRef } from '../../hooks/useLatestRef'
import { computeOverflow, FULL_LAYOUT, sameLayout, type OverflowLayout } from './toolbarOverflow.logic'

/** The attribute each button's slot carries, naming the action it holds. */
export const SLOT_ID_ATTRIBUTE = 'data-overflow-id'

/** Marks a slot whose content never moves; its value is `pinned` or `spacer`. */
export const SLOT_KIND_ATTRIBUTE = 'data-overflow-kind'

/** Cache keys for the row's fixed parts, outside any action id space. */
const ICON_KEY = '\u0000icon'
const MORE_KEY = '\u0000more'

/** The parts of the row the hook reads. */
export interface ToolbarOverflowRefs {
  row: RefObject<HTMLElement | null>
  actions: RefObject<HTMLElement | null>
  icon: RefObject<HTMLElement | null>
  title: RefObject<HTMLElement | null>
  /** Words that stay beside the title at every width (a filter chip) */
  addon?: RefObject<HTMLElement | null>
  more: RefObject<HTMLButtonElement | null>
}

/** One action, as the hook needs it. */
export interface ToolbarOverflowSpec {
  id: string
  moveLast?: boolean
  /** Never moves: pinned content or a spacer (#461) */
  pinned?: boolean
}

/** Options for {@link useToolbarOverflow}. */
export interface UseToolbarOverflowOptions {
  refs: ToolbarOverflowRefs
  /** The actions in toolbar order */
  specs: readonly ToolbarOverflowSpec[]
  hasIcon: boolean
  hasTitle: boolean
  /** Called when the row's width changes (an open menu closes on resize) */
  onResize?: () => void
}

function px(value: string): number {
  const parsed = parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** The rendered width of an element that is displayed, or null. */
function displayedWidth(element: HTMLElement | null): number | null {
  if (!element) return null
  const { width } = element.getBoundingClientRect()
  return width > 0 ? width : null
}

/** The inline padding and border of an element: what its content box loses. */
function inlineChrome(element: HTMLElement | null): number {
  if (!element) return 0
  const style = getComputedStyle(element)
  return (
    px(style.paddingLeft) + px(style.paddingRight) + px(style.borderLeftWidth) + px(style.borderRightWidth)
  )
}

/**
 * The width a slot counts for: a button as drawn (null while not drawn),
 * pinned content as drawn even when 0, a spacer at its minimum.
 */
function slotWidth(slot: HTMLElement): number | null {
  const kind = slot.getAttribute(SLOT_KIND_ATTRIBUTE)
  if (kind === 'spacer') return px(getComputedStyle(slot).minWidth)
  if (kind === 'pinned') return slot.getBoundingClientRect().width
  return displayedWidth(slot)
}

/**
 * Read the row's widths (caching each part's last drawn width) and compute its
 * layout.
 *
 * @returns The layout, or null while the row is not drawn (a hidden tab)
 */
function measureRow(
  refs: ToolbarOverflowRefs,
  specs: readonly ToolbarOverflowSpec[],
  cache: Map<string, number>,
  hasIcon: boolean,
  hasTitle: boolean
): OverflowLayout | null {
  const row = refs.row.current
  if (!row || row.clientWidth === 0) return null
  const rowStyle = getComputedStyle(row)
  // The addon never moves or hides, so its width (and its gap) is taken off the top.
  const addonWidth = displayedWidth(refs.addon?.current ?? null)
  const actions = refs.actions.current
  // A button group drawn as a box of its own (the Mermaid toolbar's) loses its
  // padding and border too.
  const available =
    row.clientWidth -
    px(rowStyle.paddingLeft) -
    px(rowStyle.paddingRight) -
    (addonWidth === null ? 0 : addonWidth + px(rowStyle.columnGap)) -
    inlineChrome(actions)

  actions?.querySelectorAll<HTMLElement>(`[${SLOT_ID_ATTRIBUTE}]`).forEach((slot) => {
    const width = slotWidth(slot)
    const id = slot.getAttribute(SLOT_ID_ATTRIBUTE)
    if (id && width !== null) cache.set(id, width)
  })
  const iconWidth = displayedWidth(refs.icon.current)
  if (iconWidth !== null) cache.set(ICON_KEY, iconWidth)
  const moreWidth = displayedWidth(refs.more.current)
  if (moreWidth !== null) cache.set(MORE_KEY, moreWidth)

  // Before a part has ever been drawn, borrow a sibling's width: the header
  // buttons and … share one size, so the first frame is already right.
  const anyAction = specs
    .filter((spec) => !spec.pinned)
    .map((spec) => cache.get(spec.id))
    .find((w) => w !== undefined)
  const fallback = cache.get(MORE_KEY) ?? anyAction ?? 0
  const title = refs.title.current

  return computeOverflow({
    available,
    rowGap: px(rowStyle.columnGap),
    itemGap: actions ? px(getComputedStyle(actions).columnGap) : 0,
    iconWidth: cache.get(ICON_KEY) ?? 0,
    titleReserve: title ? px(getComputedStyle(title).minWidth) : 0,
    hasIcon,
    hasTitle,
    moreWidth: fallback,
    items: specs.map((spec) => ({
      id: spec.id,
      width: cache.get(spec.id) ?? (spec.pinned ? 0 : fallback),
      moveLast: spec.moveLast,
      pinned: spec.pinned
    }))
  })
}

/**
 * Where focus must go once `next` renders: to … when the focused button is
 * about to move, to the last row button when … itself is about to go.
 */
function focusTargetFor(refs: ToolbarOverflowRefs, next: OverflowLayout): 'more' | 'last' | null {
  const active = document.activeElement
  const focusedSlot = active instanceof HTMLElement ? active.closest(`[${SLOT_ID_ATTRIBUTE}]`) : null
  const focusedId =
    focusedSlot && refs.actions.current?.contains(focusedSlot) ? focusedSlot.getAttribute(SLOT_ID_ATTRIBUTE) : null
  if (focusedId && next.moved.includes(focusedId)) return 'more'
  if (active !== null && active === refs.more.current && next.moved.length === 0) return 'last'
  return null
}

/**
 * Follow a toolbar row's width and return what it shows.
 *
 * Focus never falls off the row: when the focused button is about to move,
 * focus goes to "…" once it renders; when "…" itself is about to go (every
 * button fits again), focus goes to the last button in the row.
 *
 * @param options - The row's elements, its actions and a resize callback
 * @returns The current layout
 */
export function useToolbarOverflow({
  refs,
  specs,
  hasIcon,
  hasTitle,
  onResize
}: UseToolbarOverflowOptions): OverflowLayout {
  const [layout, setLayout] = useState<OverflowLayout>(FULL_LAYOUT)
  const widths = useRef(new Map<string, number>())
  const pendingFocus = useRef<'more' | 'last' | null>(null)
  const specsRef = useLatestRef(specs)
  const onResizeRef = useLatestRef(onResize)
  const lastRowWidth = useRef(0)
  // The layout last committed or requested, read by `measure` outside render.
  const layoutRef = useRef<OverflowLayout>(FULL_LAYOUT)

  /** Measure the row and, when the layout changes, plan focus and apply it. */
  const measure = (): void => {
    const next = measureRow(refs, specsRef.current, widths.current, hasIcon, hasTitle)
    if (!next || sameLayout(layoutRef.current, next)) return
    pendingFocus.current = focusTargetFor(refs, next)
    layoutRef.current = next
    setLayout(next)
  }
  // The ResizeObserver outlives a render; it calls the latest closure.
  const measureRef = useLatestRef(measure)

  // Every commit: an action may have appeared, changed or gone. Setting an
  // equal layout returns the previous object, so this settles in one pass.
  useLayoutEffect(() => {
    measure()
  })

  // Move focus once the row it belongs in has rendered.
  useLayoutEffect(() => {
    const target = pendingFocus.current
    if (!target) return
    pendingFocus.current = null
    if (target === 'more') {
      refs.more.current?.focus()
      return
    }
    const buttons = refs.actions.current?.querySelectorAll<HTMLElement>(`[${SLOT_ID_ATTRIBUTE}] button`)
    buttons?.[buttons.length - 1]?.focus()
  }, [layout, refs])

  useLayoutEffect(() => {
    const row = refs.row.current
    if (!row || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(() => {
      const width = row.clientWidth
      if (width === 0) return
      if (lastRowWidth.current !== 0 && width !== lastRowWidth.current) onResizeRef.current?.()
      lastRowWidth.current = width
      measureRef.current()
    })
    observer.observe(row)
    return () => observer.disconnect()
  }, [refs, measureRef, onResizeRef])

  // Pinned content resizes on its own (a count, a status message): re-measure.
  // Re-attached after every commit, since the pinned slots may have changed.
  useLayoutEffect(() => {
    const pinned = refs.actions.current?.querySelectorAll<HTMLElement>(`[${SLOT_KIND_ATTRIBUTE}="pinned"]`)
    if (!pinned || pinned.length === 0 || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(() => measureRef.current())
    pinned.forEach((slot) => observer.observe(slot))
    return () => observer.disconnect()
  })

  return layout
}
