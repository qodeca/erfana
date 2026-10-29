// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The driver the shared overlay behaviour suite runs against (spec 024,
 * 024-FR-001; architecture note
 * specs/spec-t3-024-unified-comments/architecture/001-shared-comment-base.md § 2).
 *
 * One comment overlay behaviour, two hosts: the HTML overlay in the sealed page
 * preload and the renderer overlay of the Markdown (and `.txt`) previews. Each
 * host implements this driver over its own fixture and runs `overlay.suite.ts`.
 * The driver speaks in the suite's abstract target ids and CSS-pixel points
 * only, never in DOM nodes, tokens or channels, so a host can map them however
 * its page is built.
 *
 * Test-only and type-only apart from the fixture geometry: no imports.
 */

/** The fixture's targets: what a host lays out before the suite runs. */
export type OverlayTargetId = 'container' | 'first' | 'inner' | 'second' | 'long'

/** A target's border box, in the host's viewport CSS pixels. */
export interface OverlayTargetBox {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/**
 * The fixture every host lays out. `container` holds `first`, `second` and
 * `long`; `first` holds `inner`. Each target holds some text (a word at least),
 * so a host can make a non-collapsed selection inside it. Boxes do not
 * overlap except by nesting, and every box is larger than the tiny-element
 * ring threshold, so an outline is drawn on the box itself.
 */
export const OVERLAY_FIXTURE: Readonly<Record<OverlayTargetId, { readonly parent: OverlayTargetId | null; readonly box: OverlayTargetBox }>> = {
  container: { parent: null, box: { left: 0, top: 0, width: 600, height: 400 } },
  first: { parent: 'container', box: { left: 20, top: 20, width: 260, height: 120 } },
  inner: { parent: 'first', box: { left: 40, top: 60, width: 100, height: 30 } },
  second: { parent: 'container', box: { left: 20, top: 200, width: 260, height: 120 } },
  long: { parent: 'container', box: { left: 320, top: 20, width: 260, height: 120 } }
}

/** A point given as an offset from a target's box centre. */
export interface GesturePoint {
  readonly target: OverlayTargetId
  readonly dx?: number
  readonly dy?: number
}

/** Modifier keys held during a gesture. */
export interface GestureModifiers {
  readonly shift?: boolean
  readonly alt?: boolean
  readonly ctrl?: boolean
  readonly meta?: boolean
}

/**
 * What the overlay asked its host to do. `open` = open the comment window on
 * the target, `menu` = show the element menu, `exit` = leave comment mode.
 * `target` is `null` for a pick that names no target (`exit`), or names one
 * the fixture does not know.
 */
export interface OverlayPick {
  readonly kind: 'open' | 'menu' | 'exit'
  readonly via: 'pointer' | 'keyboard'
  readonly target: OverlayTargetId | null
}

/** A layer Esc can close, top first: the element menu, the comment window, comment mode, Find. */
export type OverlayLayer = 'menu' | 'window' | 'mode' | 'find'

/** The layers a host may not own (it then leaves the method out and the suite skips, naming why). */
export type HostedLayer = Exclude<OverlayLayer, 'mode'>

/**
 * One host's overlay, on the fixture, ready for one test. Gestures are trusted
 * user input, delivered as the browser would deliver them (pointer events,
 * mouse events, `click` with its `detail`, `dblclick`, `contextmenu`), each
 * preceded by a pointer move to its first point. Every gesture starts a fresh
 * rate-limit window, so a test never trips the host's pick limiter by accident.
 */
export interface OverlayDriver {
  /** The host's name, for messages. */
  readonly host: string
  /** What the label reads for each target in this host (`name size`, e.g. `button#buy.cta 100×30`). */
  readonly labels: Readonly<Record<OverlayTargetId, string>>
  /** Why each layer the host does not own is not here; read by the suite when it skips. */
  readonly notOwned?: Readonly<Partial<Record<HostedLayer | 'modeIndicator', string>>>

  /** Turn comment mode on, the way the host's toolbar or shortcut does. */
  modeOn(): void
  /** Turn comment mode off, the way the host's toolbar or shortcut does. */
  modeOff(): void
  /** Whether comment mode is on, as the overlay itself sees it. */
  isModeOn(): boolean
  /** The comment-mode indicator's words while it is shown, else `null`. Optional: see `notOwned.modeIndicator`. */
  modeIndicatorText?(): string | null

  /** The targets the host laid out (the whole fixture). */
  targets(): readonly OverlayTargetId[]

  /** Move the pointer to `point` (no button). */
  hover(point: GesturePoint): void
  /** One primary click. */
  click(target: OverlayTargetId, modifiers?: GestureModifiers): void
  /** A primary double click: two clicks (`detail` 1, 2) and a `dblclick`. */
  doubleClick(target: OverlayTargetId): void
  /** A primary triple click: three clicks (`detail` 1, 2, 3) and a `dblclick` after the second. */
  tripleClick(target: OverlayTargetId): void
  /**
   * Press at `from`, move to `to` in small steps, release there. The `click`
   * that follows goes where the browser sends it: to the nearest element that
   * holds both the press and the release target.
   */
  drag(from: GesturePoint, to: GesturePoint): void
  /** Make a non-collapsed text selection inside `target` (as a finished mouse or keyboard selection leaves it). */
  selectText(target: OverlayTargetId): void
  /** The text currently selected in the page, `''` when none. */
  selectedText(): string
  /** A secondary-button press: down, up, `contextmenu`, `auxclick`. */
  rightClick(target: OverlayTargetId): void
  /** A middle-button press: down, up, `auxclick`. */
  middleClick(target: OverlayTargetId): void
  /** Press and release Esc with focus in the page. */
  pressEscape(): void

  /** Every pick so far, oldest first. */
  picks(): readonly OverlayPick[]
  /** The target the last pointer or keyboard pick named, or `null`. */
  pickedTarget(): OverlayTargetId | null
  /** The target the overlay's outline is on now, or `null` when no outline is drawn. */
  outlinedTarget(): OverlayTargetId | null
  /** Whether the outline is drawn in its selected (picked) state. */
  outlineSelected(): boolean
  /** Hover `target` (in comment mode) and return the label it shows, `name size`; `null` when none is drawn. */
  labelText(target: OverlayTargetId): string | null
  /** The event types the page's own listeners saw during the last gesture or key press, in order. */
  pageSaw(): readonly string[]

  /** The top layer Esc would close now, or `null`. */
  openLayer(): OverlayLayer | null
  /** Open a layer the host owns (`menu` and `window` on `target`). Optional: see `notOwned`. */
  open?(layer: HostedLayer, target?: OverlayTargetId): void

  /** Remove everything the driver added. */
  dispose(): void
}
