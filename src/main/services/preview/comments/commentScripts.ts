// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The scripts comments run in the preview's top frame
 * (docs/designs/html-preview-comments.md §7.5 steps 3 and 6, §19 R3-6; spikes
 * S2, S6).
 *
 * All of them run in isolated world {@link COMMENT_WORLD_ID} – 997 to 999 are
 * taken by the bounds ack, the backdrop read and the stylesheet swap – so a
 * page cannot patch what they call. They read and set scroll positions, read
 * which `<details>` are open and wait for frames; none of them reads the page's
 * text or writes its DOM. Every result is parsed here before main trusts it,
 * and every caller time-boxes the call: a hidden view may never run an
 * animation frame.
 */
import { PREVIEW_LIMITS } from '../../../../shared/preview-limits'

/** The isolated world comments run in (§7.5 step 3). */
export const COMMENT_WORLD_ID = 996
/** Longest wait for any of these scripts. */
export const COMMENT_SCRIPT_TIMEOUT_MS = 400
/** Longest restore loop after a save reload (§7.5 step 6). */
export const RESTORE_BUDGET_MS = 1_000

const LARGEST_SCROLL = 10_000_000
const HASH_MAX_CHARS = 512
const { COMMENT_OPEN_SECTIONS_MAX: OPEN_SECTIONS_MAX, COMMENT_SECTIONS_SCANNED_MAX: SECTIONS_SCANNED_MAX } = PREVIEW_LIMITS

/** The top frame's scroll and hash when a save starts (§7.5 step 3). */
export interface TopScroll {
  readonly x: number
  readonly y: number
  /** `''` for none. */
  readonly hash: string
  /**
   * The open `<details>`, each by its place among the page's `<details>` in
   * document order, ascending; absent when none is open (§19 Rev 4 "folded
   * sections"). The top frame's preload reopens them after the reload.
   */
  readonly openSections?: readonly number[]
}

/** A point in the top frame's CSS pixels. */
export interface FrameOffset {
  readonly x: number
  readonly y: number
}

/**
 * Read the top frame's scroll position, hash and open sections: the places of
 * the open ones among the first {@link SECTIONS_SCANNED_MAX} `<details>`, at
 * most {@link OPEN_SECTIONS_MAX}. Indexed, never `.length`: a live collection
 * counts the whole document for its length, and the read has 400 ms.
 */
export const READ_SCROLL_SCRIPT = `(() => {
  const all = document.getElementsByTagName('details')
  const openSections = []
  for (let i = 0; i < ${SECTIONS_SCANNED_MAX} && openSections.length < ${OPEN_SECTIONS_MAX}; i += 1) {
    const section = all[i]
    if (section === undefined) break
    if (section.open === true) openSections.push(i)
  }
  return { x: window.scrollX, y: window.scrollY, hash: location.hash, openSections }
})()`

/**
 * Wait two animation frames – one is not enough for the selected outline to
 * reach a capture (S6) – then, for `childIndex` ≥ 0, report where the content
 * box of the top frame's child `window[childIndex]` sits, found by
 * `contentWindow` identity (S8), as a JSON-able `{x, y}` or `null`.
 */
export function waitFramesScript(childIndex: number): string {
  const index = Number.isInteger(childIndex) && childIndex >= 0 ? childIndex : -1
  return `new Promise((resolve) => {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const index = ${index}
    if (index < 0) { resolve({ x: 0, y: 0 }); return }
    const child = window[index]
    const frame = child === undefined ? undefined : [...document.querySelectorAll('iframe, frame')].find((f) => f.contentWindow === child)
    if (frame === undefined) { resolve(null); return }
    const rect = frame.getBoundingClientRect()
    const style = getComputedStyle(frame)
    resolve({
      x: rect.left + frame.clientLeft + (parseFloat(style.paddingLeft) || 0),
      y: rect.top + frame.clientTop + (parseFloat(style.paddingTop) || 0)
    })
  }))
})`
}

/**
 * Put the top frame back where the save found it (§7.5 step 6): set the hash
 * when it differs, then `scrollTo` every animation frame until the page is
 * there and tall enough, the reader scrolls, or {@link RESTORE_BUDGET_MS}
 * passes. Resolves `true` when the position was reached.
 */
export function restoreScrollScript(target: TopScroll): string {
  const x = Math.round(Math.max(0, Math.min(LARGEST_SCROLL, target.x)))
  const y = Math.round(Math.max(0, Math.min(LARGEST_SCROLL, target.y)))
  const hash = JSON.stringify(target.hash.slice(0, HASH_MAX_CHARS))
  return `new Promise((resolve) => {
  const x = ${x}, y = ${y}, hash = ${hash}
  if (hash !== '' && location.hash !== hash) location.hash = hash
  const started = performance.now()
  let stopped = false
  const stop = (event) => { if (event.isTrusted) stopped = true }
  const kinds = ['wheel', 'keydown', 'pointerdown', 'touchstart']
  for (const kind of kinds) window.addEventListener(kind, stop, { capture: true, passive: true })
  const done = (reached) => {
    for (const kind of kinds) window.removeEventListener(kind, stop, { capture: true })
    resolve(reached)
  }
  const step = () => {
    if (stopped) { done(false); return }
    window.scrollTo(x, y)
    if (Math.abs(window.scrollX - x) < 1 && Math.abs(window.scrollY - y) < 1) { done(true); return }
    if (performance.now() - started > ${RESTORE_BUDGET_MS}) { done(false); return }
    requestAnimationFrame(step)
  }
  step()
})`
}

function finite(value: unknown, max: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= max ? value : undefined
}

/**
 * A read's open sections: at most {@link OPEN_SECTIONS_MAX} places, each a
 * whole number below {@link SECTIONS_SCANNED_MAX}, ascending and once each.
 * Anything else is none – the scroll still counts.
 */
export function parseOpenSections(raw: unknown): readonly number[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > OPEN_SECTIONS_MAX) return undefined
  if (!raw.every(place => Number.isInteger(place) && place >= 0 && place < SECTIONS_SCANNED_MAX)) return undefined
  return [...new Set(raw as number[])].sort((a, b) => a - b)
}

/** A {@link READ_SCROLL_SCRIPT} result, or `undefined` when it is not one. */
export function parseTopScroll(raw: unknown): TopScroll | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const { x, y, hash, openSections } = raw as Record<string, unknown>
  const sx = finite(x, LARGEST_SCROLL)
  const sy = finite(y, LARGEST_SCROLL)
  if (sx === undefined || sy === undefined || typeof hash !== 'string' || hash.length > HASH_MAX_CHARS) {
    return undefined
  }
  const sections = parseOpenSections(openSections)
  return { x: Math.max(0, sx), y: Math.max(0, sy), hash, ...(sections === undefined ? {} : { openSections: sections }) }
}

/** A {@link waitFramesScript} result, or `undefined` when it is not one. */
export function parseFrameOffset(raw: unknown): FrameOffset | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const { x, y } = raw as Record<string, unknown>
  const ox = finite(x, LARGEST_SCROLL)
  const oy = finite(y, LARGEST_SCROLL)
  return ox === undefined || oy === undefined ? undefined : { x: ox, y: oy }
}
