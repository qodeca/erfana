// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Child frames ↔ their `<iframe>` and `<frame>` elements
 * (docs/designs/comments/html-preview-comments.md §6 "Frames", §10.2, §19 R3-3, R3-4;
 * test J-017).
 *
 * Main sends a parent its child frames as opaque keys in `WebFrameMain.frames`
 * order. That order is creation order, and so is `window[i]` (spike S8) –
 * neither is DOM order once a script adds or moves an iframe. So child `i` is
 * `window[i]`, and its element is the frame element whose `contentWindow` is
 * that same window. Frame names and `src` are never used to map: both are
 * page-controlled.
 *
 * When the counts differ (a frame was just added or removed) nothing is
 * mapped – every frame is shielded – and the caller asks main again.
 *
 * Non-commentable frames (refused, `srcdoc`, `about:blank`, `javascript:`)
 * get a click-shield in comment mode: `about:blank` and `javascript:` frames
 * run no preload, so only the parent can swallow clicks over them (R3-3). A
 * frame that shows inline content is shielded whatever main's list says: the
 * list can be stale (a page that navigates a project frame to `about:blank`
 * keeps its window – and its `src` – so the mapping still says commentable,
 * or swaps one frame for another in the same slot).
 */
import { boxOf, clipToViewport, isRendered, type Box, type Viewport } from './geometry'
import { frameFileOf, type LabelSuffix } from './label'
import type { ChildFrameState } from './state'
import type { TokenRegistry } from './tokens'

/** An element that holds a child frame. */
export type FrameElement = HTMLIFrameElement | HTMLFrameElement

/** Every element that can hold a child frame (a `<frameset>` page has `<frame>`s). */
const FRAME_SELECTOR = 'iframe, frame'

/** What the parent knows about one of its frame elements. */
export interface FrameEntry {
  readonly key: string
  readonly commentable: boolean
}

/** The result of mapping a parent's frame elements. */
export interface FrameMap {
  readonly byElement: ReadonlyMap<FrameElement, FrameEntry>
  /** Main's list and `window.length` disagree: ask again. */
  readonly mismatch: boolean
}

/** One click-shield: a frame's visible box. */
export interface Shield {
  readonly box: Box
  readonly frame: FrameElement
}

/** The map before main has sent a frame list. */
export const EMPTY_FRAME_MAP: FrameMap = Object.freeze({ byElement: new Map(), mismatch: false })

/** Whether `element` holds a child frame. */
export function isFrameElement(element: Element): element is FrameElement {
  return element instanceof HTMLIFrameElement || element instanceof HTMLFrameElement
}

/** The document's frame elements, in DOM order. */
function frameElementsOf(doc: Document): FrameElement[] {
  return [...doc.querySelectorAll<FrameElement>(FRAME_SELECTOR)]
}

/** Pair main's child frames with this document's frame elements. */
export function mapChildFrames(
  win: Window,
  doc: Document,
  childFrames: readonly ChildFrameState[] | undefined
): FrameMap {
  if (childFrames === undefined) return EMPTY_FRAME_MAP
  if (win.length !== childFrames.length) return { byElement: new Map(), mismatch: true }
  const frames = frameElementsOf(doc)
  const byElement = new Map<FrameElement, FrameEntry>()
  childFrames.forEach((child, index) => {
    const frameWindow = win[index]
    const element = frames.find(frame => frame.contentWindow === frameWindow)
    if (element !== undefined) byElement.set(element, { key: child.key, commentable: child.commentable })
  })
  return { byElement, mismatch: false }
}

/** The frame element of child `key`, if mapped. */
export function iframeOfKey(map: FrameMap, key: string): FrameElement | undefined {
  for (const [element, entry] of map.byElement) {
    if (entry.key === key) return element
  }
  return undefined
}

/** Whether a frame's attributes ask for content the page wrote itself (`srcdoc`, `about:`, `javascript:`). */
function isInline(frame: FrameElement): boolean {
  if (frame.hasAttribute('srcdoc')) return true
  const src = (frame.getAttribute('src') ?? '').trim().toLowerCase()
  return src === '' || src.startsWith('about:') || src.startsWith('javascript:')
}

/**
 * Whether the frame shows an `about:` document now, whatever its `src` says.
 * Such a document has the parent's origin, so it is readable here. A project
 * file reads as its `erfana-preview:` URL, and a cross-origin document as
 * `null`: neither is shielded by this check.
 */
function showsInlineDocument(frame: FrameElement): boolean {
  return (frame.contentDocument?.URL ?? '').startsWith('about:')
}

/** Whether `frame` gets a click-shield in comment mode. */
export function isShielded(map: FrameMap, frame: FrameElement): boolean {
  return map.byElement.get(frame)?.commentable !== true || isInline(frame) || showsInlineDocument(frame)
}

/** The click-shields of comment mode: every rendered, shielded frame on screen. */
export function shieldsOf(doc: Document, map: FrameMap, viewport: Viewport): Shield[] {
  const out: Shield[] = []
  for (const frame of frameElementsOf(doc)) {
    if (!isShielded(map, frame) || !isRendered(frame)) continue
    const box = clipToViewport(boxOf(frame), viewport)
    if (box !== null) out.push({ box, frame })
  }
  return out
}

/** The label suffix for a frame element (§10.2). */
export function iframeSuffix(map: FrameMap, frame: FrameElement): LabelSuffix {
  if (!isShielded(map, frame)) return { kind: 'frame', file: frameFileOf(frame.src) }
  return isInline(frame) || showsInlineDocument(frame) ? { kind: 'inline-frame' } : { kind: 'refused-frame' }
}

/**
 * What an element's label says it is: a frame (by its child frame's state),
 * an element a script built (no token of its own below a tokened one), or
 * nothing more.
 */
export function suffixFor(element: Element, map: FrameMap, tokens: Pick<TokenRegistry, 'tokenOf' | 'nearestTokened'>): LabelSuffix {
  if (isFrameElement(element)) return iframeSuffix(map, element)
  return tokens.tokenOf(element) === undefined && tokens.nearestTokened(element) !== undefined ? { kind: 'script' } : { kind: 'none' }
}
