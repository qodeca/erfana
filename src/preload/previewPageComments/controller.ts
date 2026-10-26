// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One frame's comment overlay (docs/designs/html-preview-comments.md §6,
 * §7.1–§7.3, §7.5 step 6–7, §7.10, §10).
 *
 * It holds the state main last sent, the document's tokens, the hover and
 * keyboard-picker position, and draws the overlay in one render pass per
 * animation frame. The input side (`input.ts`) calls in with trusted events
 * only; everything that leaves for main goes through `send`.
 */
import { AnchorReporter } from './anchors'
import {
  COMMENT_HELLO_CHANNEL,
  COMMENT_PICK_CHANNEL,
  CONTROL_PICKS_PER_SECOND,
  HELLO_REPEAT_MAX,
  HELLO_REPEAT_MIN_MS,
  MODE_TAB_AVOID_PX,
  REVEAL_FLASH_MS
} from './constants'
import {
  EMPTY_FRAME_MAP,
  iframeOfKey,
  iframeSuffix,
  isFrameElement,
  mapChildFrames,
  shieldsOf,
  type FrameElement,
  type FrameMap,
  type Shield
} from './frames'
import { boxOf, clipToViewport, contains, outlineBox, viewportOf, type Point, type Viewport } from './geometry'
import { IconResolver } from './iconResolver'
import { labelOf, labelText, type LabelSuffix } from './label'
import { OverlayHost } from './overlayHost'
import { overlayCss } from './overlayStyles'
import { OverlayView, type OutlineModel } from './overlayView'
import { firstChildOf, parentOf, pickableExcept, stepOf, type PickablePredicate } from './picker'
import { describeTarget, elementPoint, PickLimiter, screenOf, viewOf, type PickKind, type PickPayload } from './picks'
import { placePins, type PinPlacement } from './pins'
import { CursorSheet, PageWatch, RenderScheduler, ScrollRestore } from './scheduling'
import { IDLE_STATE, parseCommentState, pxOf, type CommentState } from './state'
import { TokenRegistry } from './tokens'

/** Microcopy the live region speaks (§10.10 "Announce"). */
export const ANNOUNCE = Object.freeze({
  modeOn: 'Comment mode on. Click an element, or press Tab to pick one. Esc to leave.',
  modeOff: 'Comment mode off.',
  top: 'Top of page – no parent to select.',
  noChild: 'No child elements.',
  showing: (label: string) => `Showing ${label}.`
})

/** What the controller needs from its frame. */
export interface ControllerDeps {
  readonly win: Window & typeof globalThis
  readonly doc: Document
  readonly send: (channel: string, payload: unknown) => void
  readonly now: () => number
  /** `window === window.top`: only the top frame draws the mode indicator and speaks mode changes. */
  readonly isTop: boolean
}

/** A pin or a shield under the pointer. */
export type OverlayHit =
  | { readonly kind: 'pin'; readonly pin: PinPlacement }
  | { readonly kind: 'shield'; readonly iframe: FrameElement }

/** A keyboard picker action (`input.ts` maps keys to these). */
export type PickerAction = 'next' | 'previous' | 'up' | 'down' | 'open' | 'menu' | 'exit'

/** The comment overlay of one frame. */
export class CommentController {
  readonly tokens: TokenRegistry
  private readonly host: OverlayHost
  private readonly anchors: AnchorReporter
  /** Element and pin picks share one budget; Esc and Alt+↑-out-of-a-frame each have their own. */
  private readonly limiters: Readonly<Record<'pick' | 'exit' | 'parent', PickLimiter>>
  private readonly scheduler: RenderScheduler
  private readonly watch: PageWatch
  private readonly cursor: CursorSheet
  private readonly restorer: ScrollRestore
  private readonly pickable: PickablePredicate
  private readonly icons: IconResolver
  private state: CommentState = IDLE_STATE
  private view: OverlayView | null = null
  private frameMap: FrameMap = EMPTY_FRAME_MAP
  private current: Element | null = null
  private levelHold = false
  private downPath: Element[] = []
  private selected: Element | null = null
  private pointer: Point | null = null
  private pins: PinPlacement[] = []
  private shields: Shield[] = []
  private flash: { readonly element: Element; readonly until: number } | null = null
  private flashTimer: ReturnType<typeof setTimeout> | null = null
  private hellos = 0
  private lastHelloAt = Number.NEGATIVE_INFINITY
  private keyboardMenuAt = Number.NEGATIVE_INFINITY
  private ready = false

  constructor(private readonly deps: ControllerDeps) {
    const { doc, now } = deps
    this.tokens = new TokenRegistry(doc, doc.readyState === 'loading')
    this.host = new OverlayHost({ doc, now, onUnavailable: () => this.overlayLost() })
    this.anchors = new AnchorReporter({ send: deps.send, now })
    this.limiters = {
      pick: new PickLimiter(now),
      exit: new PickLimiter(now, CONTROL_PICKS_PER_SECOND),
      parent: new PickLimiter(now, CONTROL_PICKS_PER_SECOND)
    }
    this.scheduler = new RenderScheduler(deps.win, () => this.render())
    this.watch = new PageWatch(deps, target => this.host.isHost(target), () => this.scheduler.soon())
    this.cursor = new CursorSheet(doc)
    this.restorer = new ScrollRestore(deps.win, now)
    this.pickable = pickableExcept(element => this.host.isHost(element))
    this.icons = new IconResolver(this.tokens, () => this.watch.version)
  }

  /** Comment mode is on for this frame. */
  get mode(): boolean {
    return this.state.mode
  }

  /** Start capturing tokens (preload start). */
  start(): void {
    this.tokens.start()
  }

  /** The preload's `DOMContentLoaded`: close the token window and say hello, once. */
  documentReady(): void {
    if (this.ready) return
    this.ready = true
    this.tokens.closeWindow()
    this.deps.send(COMMENT_HELLO_CHANNEL, {})
  }

  /**
   * The page replaced `<html>` – `document.open()`, which erased every
   * listener (§9.1 S25). The guards are back already; put back the rest. A
   * script in the written markup could register its listeners ahead of them,
   * so comments are no longer trustworthy for this load: main hears the
   * overlay is unavailable. The overlay itself keeps drawing.
   */
  documentReplaced(): void {
    this.tokens.closeWindow()
    this.watch.reattach()
    this.cursor.reassert()
    this.anchors.markUnavailable('document-replaced')
    this.scheduler.soon()
  }

  /** A `toggle` on the overlay host, which the guards kept from the page. */
  hostToggled(event: Event): void {
    this.host.handleToggle(event)
  }

  /** A `commentState` message from main. */
  applyState(raw: unknown): void {
    const next = parseCommentState(raw)
    if (next === null) return
    const previous = this.state
    this.state = next
    if (this.view !== null && (JSON.stringify(next.theme) !== JSON.stringify(previous.theme) || next.hidden !== previous.hidden)) {
      this.host.setCss(overlayCss(next.theme, next.hidden))
    }
    if (next.mode !== previous.mode) this.modeChanged(next.mode)
    this.watch.set(next.mode || next.icons.length > 0)
    if (next.restore !== undefined) this.restorer.start(next.restore)
    this.render()
    if (next.reveal !== undefined) this.reveal(next.reveal)
    if (next.focusFrame !== undefined) {
      const iframe = iframeOfKey(this.frameMap, next.focusFrame)
      if (iframe !== undefined) this.moveTo(iframe)
    }
  }

  /** Whether an event hit Erfana's overlay (its path holds the host). */
  isOverlayEvent(event: Event): boolean {
    return event.composedPath().some(target => this.host.isHost(target))
  }

  /** The pin or shield at `point`, topmost first. */
  overlayHit(point: Point): OverlayHit | null {
    for (let i = this.pins.length - 1; i >= 0; i -= 1) {
      if (contains(this.pins[i].box, point)) return { kind: 'pin', pin: this.pins[i] }
    }
    const shield = this.shields.find(s => contains(s.box, point))
    return shield === undefined ? null : { kind: 'shield', iframe: shield.frame }
  }

  /** A trusted pointer move. */
  pointerAt(point: Point): void {
    this.pointer = point
    if (this.state.mode) {
      const raw = this.hitElement(point)
      if (raw !== null && !(this.levelHold && this.current?.contains(raw) === true)) {
        if (raw !== this.current) this.select(raw, false)
      }
    }
    this.scheduler.soon()
  }

  /** The pointer left the frame (or entered a child frame). */
  pointerLeft(): void {
    this.pointer = null
    if (!this.levelHold) this.current = null
    this.scheduler.soon()
  }

  /** Any trusted wheel, key or press: the user takes over the scroll. */
  userInput(): void {
    this.restorer.cancel()
  }

  /** A trusted pointer event that reached the overlay host. */
  overlayEvent(event: MouseEvent): void {
    const hit = this.overlayHit({ x: event.clientX, y: event.clientY })
    if (hit === null) return
    const primaryClick = event.type === 'click' && event.button === 0 && event.detail > 0
    if (hit.kind === 'pin') {
      if (primaryClick) this.pickIcon(hit.pin, event)
      return
    }
    // A shield exists only in comment mode (`shieldsOf`).
    if (primaryClick) this.pickElement('open', hit.iframe, event)
    if (event.type === 'contextmenu') this.pickElement('menu', hit.iframe, event)
  }

  /** A trusted click or context menu on the page, in comment mode. */
  pageEvent(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target : null
    if (target === null) return
    const element = this.current?.contains(target) === true ? this.current : target
    if (event.type === 'contextmenu') {
      // Shift+F10 / the Menu key also fire a contextmenu: the key already picked.
      if (this.deps.now() - this.keyboardMenuAt < 1_000) return
      this.pickElement('menu', element, event)
    }
    if (event.type === 'click' && event.button === 0 && event.detail > 0) {
      this.pickElement('open', element, event)
    }
  }

  /** A keyboard picker action, in comment mode. */
  pickerAction(action: PickerAction): void {
    if (action === 'exit') {
      this.exit()
      return
    }
    const current = this.ensureCurrent()
    if (current === null) return
    if (action === 'next' || action === 'previous') {
      const next = stepOf(current, action === 'next', this.body(), this.pickable)
      if (next !== null) this.moveTo(next)
    } else if (action === 'up') {
      this.stepUp(current)
    } else if (action === 'down') {
      this.stepDown(current)
    } else {
      if (action === 'menu') this.keyboardMenuAt = this.deps.now()
      this.pickElement(action, current)
    }
  }

  /** Run the render now (tests and picks, which must paint before main captures). */
  renderNow(): void {
    this.scheduler.cancel()
    this.render()
  }

  /** Remove every listener, observer and timer (tests). */
  dispose(): void {
    this.tokens.stop()
    this.watch.set(false)
    this.scheduler.cancel()
    this.anchors.dispose()
    this.restorer.cancel()
    this.cursor.set(false)
    if (this.flashTimer !== null) clearTimeout(this.flashTimer)
    this.host.dispose()
  }

  private body(): Element {
    return this.deps.doc.body ?? (this.deps.doc.documentElement as Element)
  }

  private hitElement(point: Point): Element | null {
    const hit = this.overlayHit(point)
    if (hit !== null) return hit.kind === 'pin' ? hit.pin.element : hit.iframe
    const { doc } = this.deps
    const element = doc.elementFromPoint(point.x, point.y)
    return element === null || this.host.isHost(element) ? null : element
  }

  private ensureCurrent(): Element | null {
    if (this.current?.isConnected === true) return this.current
    const viewport = viewportOf(this.deps.win)
    const start =
      (this.pointer !== null ? this.hitElement(this.pointer) : null) ??
      this.hitElement({ x: viewport.width / 2, y: viewport.height / 2 }) ??
      this.deps.doc.body
    this.current = start
    return start
  }

  private select(element: Element | null, hold: boolean): void {
    this.current = element
    this.levelHold = hold
    this.downPath = []
    this.selected = null
  }

  private moveTo(element: Element): void {
    const path = this.downPath
    this.select(element, true)
    this.downPath = path
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    this.renderNow()
    const box = boxOf(element)
    this.announce(ANNOUNCE.showing(labelText(labelOf(element, box, this.suffixOf(element), this.commentsOn(element)))))
  }

  private stepUp(current: Element): void {
    const parent = parentOf(current, this.body())
    if (parent === null) {
      // Out of a frame's <body>: main hands the picker to the parent's <iframe>.
      if (!this.deps.isTop) this.sendPick({ kind: 'parent', via: 'keyboard', view: viewOf(this.deps.win) })
      else this.announce(ANNOUNCE.top)
      return
    }
    const path = [...this.downPath, current]
    this.moveTo(parent)
    this.downPath = path
  }

  private stepDown(current: Element): void {
    const back = this.downPath.at(-1)
    if (back !== undefined && back.parentElement === current && back.isConnected) {
      const path = this.downPath.slice(0, -1)
      this.moveTo(back)
      this.downPath = path
      return
    }
    const child = firstChildOf(current, this.pickable)
    if (child === null) this.announce(ANNOUNCE.noChild)
    else this.moveTo(child)
  }

  private exit(): void {
    this.sendPick({ kind: 'exit', via: 'keyboard', view: viewOf(this.deps.win) })
    this.state = { ...this.state, mode: false }
    this.modeChanged(false)
    this.render()
  }

  private pickElement(kind: Extract<PickKind, 'menu' | 'open'>, element: Element, event?: MouseEvent): void {
    if (!this.state.commentable) return
    const where = event === undefined ? { point: elementPoint(element) } : { screen: screenOf(event) }
    const via = event === undefined ? 'keyboard' : 'pointer'
    this.paintSelected(element)
    this.sendPick({ kind, via, ...describeTarget(this.tokens, element), ...where, view: viewOf(this.deps.win) })
  }

  /** Pins exist only in a commentable frame: a non-commentable state carries no icons. */
  private pickIcon(pin: PinPlacement, event: MouseEvent): void {
    this.paintSelected(pin.element)
    this.sendPick({ kind: 'icon', via: 'pointer', key: pin.key, screen: screenOf(event), view: viewOf(this.deps.win) })
  }

  /** The selected outline must be painted before main captures the still (§3, R3-6). */
  private paintSelected(element: Element): void {
    if (this.state.mode) this.current = element
    this.selected = element
    this.renderNow()
  }

  private sendPick(payload: PickPayload): void {
    const { kind } = payload
    const limiter = kind === 'exit' || kind === 'parent' ? this.limiters[kind] : this.limiters.pick
    if (limiter.tryTake()) this.deps.send(COMMENT_PICK_CHANNEL, payload)
  }

  private modeChanged(on: boolean): void {
    this.cursor.set(on)
    if (!on) {
      this.select(null, false)
      this.pointer = null
    }
    if (this.deps.isTop && (on || this.view !== null)) this.announce(on ? ANNOUNCE.modeOn : ANNOUNCE.modeOff)
  }

  private announce(text: string): void {
    if (this.view === null) this.render(true)
    this.view?.announce(text)
  }

  private reveal(key: string): void {
    const element = this.icons.resolve(this.state.icons).find(r => r.icon.key === key)?.element
    if (element === undefined) return
    element.scrollIntoView({ block: 'center' })
    this.flash = { element, until: this.deps.now() + REVEAL_FLASH_MS }
    if (this.flashTimer !== null) clearTimeout(this.flashTimer)
    this.flashTimer = setTimeout(() => {
      this.flash = null
      this.flashTimer = null
      this.scheduler.soon()
    }, REVEAL_FLASH_MS)
    this.renderNow()
  }

  private overlayLost(): void {
    this.view = null
    this.pins = []
    this.shields = []
    this.anchors.markUnavailable('overlay-removed')
  }

  private commentsOn(element: Element): number {
    return this.pins.reduce((sum, pin) => sum + (pin.element === element ? pin.count : 0), 0)
  }

  private suffixOf(element: Element): LabelSuffix {
    if (isFrameElement(element)) return iframeSuffix(this.frameMap, element)
    const scripted = this.tokens.tokenOf(element) === undefined && this.tokens.nearestTokened(element) !== undefined
    return scripted ? { kind: 'script' } : { kind: 'none' }
  }

  private outlineOf(viewport: Viewport): OutlineModel | null {
    const element = this.current
    if (!this.state.mode || element === null || !element.isConnected) return null
    const box = boxOf(element)
    const outlined = outlineBox(box, viewport, this.deps.win.devicePixelRatio)
    if (outlined === null) return null
    const label = labelOf(element, box, this.suffixOf(element), this.commentsOn(element))
    return { box: outlined, selected: element === this.selected, label }
  }

  private requestHello(): void {
    const now = this.deps.now()
    if (this.hellos >= HELLO_REPEAT_MAX || now - this.lastHelloAt < HELLO_REPEAT_MIN_MS) return
    this.hellos += 1
    this.lastHelloAt = now
    this.deps.send(COMMENT_HELLO_CHANNEL, {})
  }

  /** One render pass; `force` builds the overlay even with nothing to draw (the live region). */
  private render(force = false): void {
    const { win, doc } = this.deps
    if (doc.documentElement === null) return
    const viewport = viewportOf(win)
    this.frameMap = mapChildFrames(win, doc, this.state.childFrames)
    if (this.frameMap.mismatch) this.requestHello()
    const icons = this.icons.resolve(this.state.icons)
    if (this.state.commentable) this.anchors.update(icons.map(r => ({ key: r.icon.key, visible: r.visible })))
    const pinned = this.state.showIcons ? icons.filter(r => r.visible) : []
    this.pins = placePins(
      pinned.map(r => ({ ...r.icon, element: r.element as Element, box: boxOf(r.element as Element) })),
      viewport,
      pxOf(this.state.theme.pinTarget)
    )
    this.shields = this.state.mode ? shieldsOf(doc, this.frameMap, viewport) : []
    this.watch.observeSizes(pinned.map(r => r.element as Element))
    const flash = this.flash !== null && this.flash.until > this.deps.now() ? this.flash.element : null
    const needed = force || this.state.mode || this.pins.length > 0 || flash !== null
    if (!needed && this.view === null) return
    const root = this.host.ensure()
    if (root === null) return
    if (this.view === null) {
      this.host.setCss(overlayCss(this.state.theme, this.state.hidden))
      this.view = new OverlayView(doc, root, pxOf(this.state.theme.size) * 1.4 + 2)
    }
    this.view.render(
      {
        outline: this.outlineOf(viewport),
        pins: this.pins,
        pinLabel: pin => labelText(labelOf(pin.element, boxOf(pin.element), this.suffixOf(pin.element), 0)),
        selected: this.selected,
        shields: this.shields.map(s => s.box),
        indicator: {
          visible: this.state.mode && this.deps.isTop,
          bottom: this.pointer !== null && this.pointer.y < MODE_TAB_AVOID_PX
        },
        flash: flash === null ? null : clipToViewport(boxOf(flash), viewport)
      },
      viewport
    )
  }
}
