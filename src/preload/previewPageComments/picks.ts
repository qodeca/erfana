// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pick signals (docs/designs/html-preview-comments.md §7.3, §8
 * `preview-page:commentPick`, §19 R3-5, R3-8; tests J-007, J-008, SEC-05,
 * SEC-06).
 *
 * A pick only ever asks main to OPEN something – the menu, the comment
 * window, a pin's threads. Nothing on this channel writes (§4.1 B1). What
 * leaves the isolated world is enums, a token, a pin key, numbers, and for a
 * JS-built element its path, tag, quote and snapshot – never an element, an
 * offset or a file path (SEC-05). Main validates every field again.
 *
 * At most {@link PICKS_PER_SECOND} picks leave a frame in any one-second
 * window; main applies its own limit too, because a compromised renderer
 * would not run this one (§9.1 S7).
 */
import { PICKS_PER_SECOND, PICK_TAG_MAX_CHARS, RUNTIME_PATH_MAX_CHARS, VIEW_HASH_MAX_CHARS } from './constants'
import { pathBelow, quoteOf, snapshotOf, whiteSpaceOf, type PickQuote } from './domPath'
import type { Point } from './geometry'
import type { TokenRegistry } from './tokens'

/** What a pick asks for. `parent` = Alt+↑ out of a frame's `<body>`; `exit` = Esc. */
export type PickKind = 'menu' | 'open' | 'icon' | 'parent' | 'exit'
/** How the user picked. */
export type PickVia = 'pointer' | 'keyboard'

/** The frame's viewport and scroll at pick time (§5.3 `view`). */
export interface PickView {
  readonly w: number
  readonly h: number
  readonly dpr: number
  readonly x: number
  readonly y: number
  readonly hash?: string
}

/** A JS-built element below its tokened ancestor (§5.3 `runtime`). */
export interface PickRuntime {
  readonly path: string
  readonly tag: string
  readonly quote?: PickQuote
  readonly snapshot: string
  readonly truncated?: true
}

/** What a pick says about its element. */
export interface PickTarget {
  /** The token of the element, or of its nearest tokened ancestor. */
  readonly token?: string
  readonly runtime?: PickRuntime
  /** White space of the anchor's parent (R3-8). */
  readonly ws?: 'collapse' | 'preserve'
}

/** The `commentPick` payload. */
export interface PickPayload extends PickTarget {
  readonly kind: PickKind
  readonly via: PickVia
  readonly key?: string
  /** A pointer pick: the trusted event's `screenX/Y` (R3-5). */
  readonly screen?: Point
  /** A keyboard pick: the element's top-left + 4 px, frame CSS pixels. */
  readonly point?: Point
  readonly view: PickView
}

/** At most {@link PICKS_PER_SECOND} picks in any one-second window. */
export class PickLimiter {
  private readonly accepted: number[] = []
  private droppedCount = 0

  constructor(
    private readonly now: () => number,
    private readonly perSecond: number = PICKS_PER_SECOND
  ) {}

  /** Picks refused so far. */
  get dropped(): number {
    return this.droppedCount
  }

  /** Spend one pick; false (and counted) when the last second already had its share. */
  tryTake(): boolean {
    const now = this.now()
    while (this.accepted.length > 0 && now - this.accepted[0] >= 1_000) this.accepted.shift()
    if (this.accepted.length < this.perSecond) {
      this.accepted.push(now)
      return true
    }
    this.droppedCount += 1
    return false
  }
}

/** Round to a whole CSS pixel; anything not finite becomes 0. */
function whole(value: number): number {
  return Number.isFinite(value) ? Math.round(value) : 0
}

/** The frame's view right now. */
export function viewOf(win: Window): PickView {
  const hash = win.location.hash
  const dpr = Number.isFinite(win.devicePixelRatio) ? win.devicePixelRatio : 1
  return {
    w: whole(win.innerWidth),
    h: whole(win.innerHeight),
    dpr,
    x: whole(win.scrollX),
    y: whole(win.scrollY),
    ...(hash !== '' && hash.length <= VIEW_HASH_MAX_CHARS ? { hash } : {})
  }
}

/** A trusted event's screen point (R3-5). */
export function screenOf(event: MouseEvent): Point {
  return { x: whole(event.screenX), y: whole(event.screenY) }
}

/** A keyboard pick's point: `element`'s top-left + 4 px (§7.3 step 4). */
export function elementPoint(element: Element): Point {
  const rect = element.getBoundingClientRect()
  return { x: whole(rect.left + 4), y: whole(rect.top + 4) }
}

/**
 * What a pick says about `element`: its own token, or – for an element that
 * is not in the file – its nearest tokened ancestor's token plus a runtime
 * description. An element too deep or too oddly named to describe falls back
 * to the ancestor alone. No tokened ancestor at all (a page served raw) sends
 * no token, and main answers "Can't comment here".
 */
export function describeTarget(registry: TokenRegistry, element: Element): PickTarget {
  const tokened = registry.nearestTokened(element)
  if (tokened === undefined) return {}
  const ws = whiteSpaceOf(tokened.element)
  const base = { token: tokened.token, ws }
  if (tokened.element === element) return base
  const path = pathBelow(tokened.element, element) as string
  const tag = element.localName
  if (path.length > RUNTIME_PATH_MAX_CHARS || tag.length > PICK_TAG_MAX_CHARS) return base
  const quote = quoteOf(tokened.element, element)
  const { snapshot, truncated } = snapshotOf(element)
  return {
    ...base,
    runtime: {
      path,
      tag,
      ...(quote ? { quote } : {}),
      snapshot,
      ...(truncated ? { truncated: true as const } : {})
    }
  }
}
