// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * What in a page is the page's own to act on, outside comment mode
 * (differences table D-09, D-10): a click there stays the page's, and the
 * Comment button is never drawn over it. A drawn control with neither a role
 * nor a pointer cursor cannot be seen from here: a stated limit
 * (docs/designs/comments/spike-outside-mode.md § Risks).
 */
import type { Box } from './geometry'

/** Links, form controls, players, editable text and the roles that act on a click. */
const PAGE_CONTROLS = [
  'a[href]',
  'area[href]',
  'button',
  'input',
  'select',
  'textarea',
  'summary',
  'label',
  'option',
  'video',
  'audio',
  '[contenteditable]',
  '[onclick]',
  ...['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'option', 'combobox', 'slider', 'textbox'].map(role => `[role="${role}"]`)
].join(', ')

/** What the button also keeps off: another document's controls cannot be seen from this frame. */
const COVERED_CONTROLS = `${PAGE_CONTROLS}, iframe, embed, object`

/** How far apart the button's box is sampled: less than the smallest control a pointer can hit. */
const SAMPLE_STEP_PX = 8

/** Whether `element` shows a pointer cursor, the mark of a clickable part with no role. */
function hasPointerCursor(element: Element, win: Window): boolean {
  return win.getComputedStyle(element).cursor === 'pointer'
}

/**
 * Whether an event's path runs through a page control. The first element alone
 * is asked for its cursor: `cursor` inherits, so it speaks for the path.
 *
 * @param path - `event.composedPath()`, read during the dispatch.
 * @param win - The frame's window.
 */
export function onPageControl(path: readonly EventTarget[], win: Window): boolean {
  const elements = path.filter((target): target is Element => target instanceof Element)
  if (elements.some(element => element.matches(PAGE_CONTROLS))) return true
  return elements.length > 0 && hasPointerCursor(elements[0], win)
}

/** The sample points of `box`, its far edges included. */
function samplesOf({ left, top, width, height }: Box): { readonly x: number; readonly y: number }[] {
  const along = (from: number, size: number): number[] => {
    const points: number[] = []
    for (let at = 0; at < size; at += SAMPLE_STEP_PX) points.push(from + at)
    return [...points, from + size - 1]
  }
  return along(top, height).flatMap(y => along(left, width).map(x => ({ x, y })))
}

/**
 * Whether a page control lies under `box`.
 *
 * @param doc - The frame's document.
 * @param win - The frame's window.
 * @param box - Where the button would go.
 * @param isOverlay - Erfana's own host, which sits above everything here.
 */
export function coversPageControl(doc: Document, win: Window, box: Box, isOverlay: (element: Element) => boolean): boolean {
  // A document with no hit test (jsdom) has nothing to measure.
  if (typeof doc.elementsFromPoint !== 'function') return false
  return samplesOf(box).some(({ x, y }) => {
    const under = doc.elementsFromPoint(x, y).find(element => !isOverlay(element))
    return under !== undefined && (under.closest(COVERED_CONTROLS) !== null || hasPointerCursor(under, win))
  })
}
