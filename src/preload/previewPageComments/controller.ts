// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One frame's comment overlay (docs/designs/comments/html-preview-comments.md §6,
 * §7.1–§7.3, §7.5 step 6–7, §7.10, §10; folded sections: §19 Rev 4).
 *
 * It holds the state main last sent, the document's tokens, the hover and
 * keyboard-picker position, and draws the overlay in one render pass per
 * animation frame. The input side (`input.ts`) calls in with trusted events
 * only; everything that leaves for main goes through `send`.
 */
import { reduceCommentMode, type CommentModeStep } from '../../shared/comments/overlayCore/modeState'
import { AnchorReporter } from './anchors'
import { COMMENT_HELLO_CHANNEL, COMMENT_PICK_CHANNEL, CONTROL_PICKS_PER_SECOND, MODE_TAB_AVOID_PX } from './constants'
import { EMPTY_FRAME_MAP, iframeOfKey, mapChildFrames, shieldsOf, suffixFor, type FrameMap, type Shield } from './frames'
import { openAround, SectionRestore } from './foldedSections'
import { boxOf, clipToViewport, viewportOf, type Box, type Point, type Viewport } from './geometry'
import { IconResolver } from './iconResolver'
import { labelOf, labelText } from './label'
import { OverlayHost } from './overlayHost'
import { overlayCss } from './overlayStyles'
import { OverlayView, outlineModelOf, type OutlineModel } from './overlayView'
import { PickHold } from './pickHold'
import { levelDown, levelUp, pickableExcept, stepOf, type LevelMove, type PickablePredicate } from './picker'
import { MarkResolver, type MarkPlacement } from './marks'
import { elementOfHit, hitAt, type OverlayHit } from './overlayHits'
import { HelloRepeater, RevealFlash } from './revealFlash'
import { describeTarget, elementPoint, PickLimiter, screenOf, stackPart, StepSender, stepElementOf, viewOf, wordsPart, type PickKind, type PickPayload } from './picks'
import { SelectionButton } from './selectionButton'
import { readSelection, type PageWords } from './words'
import { placePins, type PinInput, type PinPlacement } from './pins'
import { CursorSheet, PageWatch, RenderScheduler, ScrollRestore } from './scheduling'
import { IDLE_STATE, parseCommentState, pxOf, type CommentState } from './state'
import { TokenRegistry } from './tokens'

/** What the controller needs from its frame. */
export interface ControllerDeps {
  readonly win: Window & typeof globalThis
  readonly doc: Document
  readonly send: (channel: string, payload: unknown) => void
  readonly now: () => number
  /** `window === window.top`: only the top frame draws the mode indicator. */
  readonly isTop: boolean
}

export type { OverlayHit } from './overlayHits'

/** A keyboard picker action (`input.ts` maps keys to these). */
export type PickerAction = 'next' | 'previous' | 'up' | 'down' | 'open' | 'menu' | 'exit'

/** The comment overlay of one frame. */
export class CommentController {
  readonly tokens: TokenRegistry
  private readonly host: OverlayHost
  private readonly anchors: AnchorReporter
  /** Element and pin picks share one budget; Esc and Alt+↑-out-of-a-frame each have their own. */
  private readonly limiters: Readonly<Record<'pick' | 'exit' | 'parent', PickLimiter>>
  /** Where the keyboard picker is, for the comment window's live region – never text in the page (§10.2). */
  private readonly steps: StepSender
  private readonly scheduler: RenderScheduler
  private readonly watch: PageWatch
  private readonly cursor: CursorSheet
  private readonly restorer: ScrollRestore
  private readonly sections: SectionRestore
  private readonly pickable: PickablePredicate
  private readonly icons: IconResolver
  private state: CommentState = IDLE_STATE
  private view: OverlayView | null = null
  private frameMap: FrameMap = EMPTY_FRAME_MAP
  private current: Element | null = null
  private levelHold = false
  /** Keeps the picked element while main's menu or window hides the page. */
  private readonly pickHold = new PickHold(() => this.deps.doc.visibilityState === 'hidden')
  private downPath: Element[] = []
  private selected: Element | null = null
  private pointer: Point | null = null
  private pins: PinPlacement[] = []
  private marks: MarkPlacement[] = []
  private readonly markResolver: MarkResolver
  /** The Comment button over a selection (C-16) and the box it was last drawn in. */
  private readonly button: SelectionButton
  private buttonBox: Box | null = null
  private shields: Shield[] = []
  private readonly flash: RevealFlash
  private readonly hellos: HelloRepeater
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
    this.steps = new StepSender(now, payload => deps.send(COMMENT_PICK_CHANNEL, payload))
    this.scheduler = new RenderScheduler(deps.win, () => this.render())
    this.watch = new PageWatch(deps, target => this.host.isHost(target), () => this.scheduler.soon())
    this.cursor = new CursorSheet(doc)
    this.restorer = new ScrollRestore(deps.win, now)
    this.sections = new SectionRestore(deps.win, doc, now)
    this.pickable = pickableExcept(element => this.host.isHost(element))
    this.icons = new IconResolver(this.tokens, () => this.watch.version)
    this.markResolver = new MarkResolver(() => this.watch.version)
    this.button = new SelectionButton(deps.win)
    this.flash = new RevealFlash(now, () => this.scheduler.soon())
    this.hellos = new HelloRepeater(now, deps.send)
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
    this.followMode(reduceCommentMode({ on: previous.mode }, { type: 'set', on: next.mode }))
    this.watch.set(next.mode || next.icons.length > 0)
    if (next.openSections !== undefined) this.sections.start(next.openSections)
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

  /** The Comment button, pin, mark (in comment mode) or shield at `point`, topmost first. */
  overlayHit(point: Point): OverlayHit | null {
    const words = this.button.current
    const button = words !== null && this.buttonBox !== null ? { words, box: this.buttonBox } : null
    return hitAt({ button, pins: this.pins, marks: this.state.mode ? this.marks : [], shields: this.shields }, point)
  }

  /** A trusted pointer move. */
  pointerAt(point: Point): void {
    this.pointer = point
    this.pickHold.pointerMoved()
    if (this.state.mode) {
      const raw = this.hitElement(point)
      if (raw !== null && !(this.levelHold && this.current?.contains(raw) === true)) {
        if (raw !== this.current) this.select(raw, false)
      }
    }
    this.scheduler.soon()
  }

  /** The pointer left the frame (or entered a child frame) – or the view hid under it ({@link PickHold}). */
  pointerLeft(): void {
    this.pointer = null
    if (!this.pickHold.pointerLeft() && !this.levelHold) this.current = null
    this.scheduler.soon()
  }

  /** A trusted `visibilitychange`: the view hidden behind a still frame, or shown again. */
  visibilityChanged(): void {
    this.pickHold.visibilityChanged()
  }

  /** Any trusted wheel, key or press: the user takes over the scroll. */
  userInput(): void {
    this.restorer.cancel()
    this.sections.cancel()
  }

  /** A trusted pointer event that reached the overlay host. */
  overlayEvent(event: MouseEvent): void {
    const hit = this.overlayHit({ x: event.clientX, y: event.clientY })
    if (hit === null) return
    const primaryClick = event.type === 'click' && event.button === 0 && event.detail > 0
    if (hit.kind === 'pin' || hit.kind === 'mark') {
      // A mark acts as its pin; a stack pin names every pin merged into it (C-17).
      const { key, element } = hit.kind === 'pin' ? hit.pin : hit.mark
      if (primaryClick) this.pickIcon(key, element, event, hit.kind === 'pin' ? hit.pin.members : undefined)
      return
    }
    // The Comment button opens the window on its words (C-16).
    if (hit.kind === 'button') {
      if (primaryClick) this.pickElement('open', hit.words.target, event, hit.words)
      return
    }
    // A shield exists only in comment mode (`shieldsOf`).
    if (primaryClick) this.pickElement('open', hit.iframe, event)
    if (event.type === 'contextmenu') this.pickElement('menu', hit.iframe, event)
  }

  /**
   * A trusted press, click or context menu on the page, in comment mode. A
   * drag selects words and shows the Comment button; a click picks (024-FR-004,
   * overlayCore `gesture`). With words selected, the menu is about them.
   */
  pageEvent(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target : null
    if (target === null) return
    const element = this.current?.contains(target) === true ? this.current : target
    const at = { x: event.clientX, y: event.clientY }
    if (event.type === 'mousedown' && event.button === 0) this.button.press(at)
    if (event.type === 'contextmenu') {
      // Shift+F10 / the Menu key also fire a contextmenu: the key already picked.
      if (this.deps.now() - this.keyboardMenuAt < 1_000) return
      const words = this.selectionWords()
      this.pickElement('menu', words?.target ?? element, event, words)
    }
    if (event.type === 'click' && event.button === 0 && event.detail > 0) {
      if (this.button.release(at, this.selectionWords())) this.scheduler.soon()
      else this.pickElement('open', element, event)
    }
  }

  /**
   * A trusted right-click outside comment mode (OD-01): read now, and sent
   * as a `context` pick after the dispatch only when no page listener
   * cancelled it – on the selected words, or the element under the pointer.
   */
  pageContextMenu(event: MouseEvent): void {
    if (this.state.mode || !this.state.commentable || !(event.target instanceof Element)) return
    const words = this.selectionWords()
    const target = describeTarget(this.tokens, words?.target ?? event.target)
    const payload: PickPayload = { kind: 'context', via: 'pointer', ...target, ...wordsPart(words, target), screen: screenOf(event), view: viewOf(this.deps.win) }
    setTimeout(() => {
      if (!event.defaultPrevented) this.sendPick(payload)
    }, 0)
  }

  /** A keyboard picker action, in comment mode. */
  pickerAction(action: PickerAction): void {
    if (action === 'exit') {
      this.followMode(reduceCommentMode({ on: this.state.mode }, { type: 'escape' }))
      this.render()
      return
    }
    const current = this.ensureCurrent()
    if (current === null) return
    if (action === 'next' || action === 'previous') {
      const next = stepOf(current, action === 'next', this.body(), this.pickable)
      if (next !== null) this.moveTo(next)
    } else if (action === 'up') {
      this.stepLevel(levelUp(current, this.body(), this.downPath, this.deps.isTop))
    } else if (action === 'down') {
      this.stepLevel(levelDown(current, this.downPath, this.pickable))
    } else {
      if (action === 'menu') this.keyboardMenuAt = this.deps.now()
      // With the Comment button showing, Enter and the menu are about its words (C-16).
      const words = this.button.current
      this.pickElement(action, words?.target ?? current, undefined, words)
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
    this.steps.dispose()
    this.restorer.cancel()
    this.sections.cancel()
    this.cursor.set(false)
    this.flash.dispose()
    this.host.dispose()
  }

  private body(): Element {
    return this.deps.doc.body ?? (this.deps.doc.documentElement as Element)
  }

  private hitElement(point: Point): Element | null {
    const hit = this.overlayHit(point)
    if (hit !== null) return elementOfHit(hit)
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
    this.pickHold.release()
    this.downPath = []
    this.selected = null
  }

  private moveTo(element: Element): void {
    const path = this.downPath
    this.select(element, true)
    this.downPath = path
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    this.renderNow()
    this.steps.say('showing', stepElementOf(this.tokens, element), viewOf(this.deps.win))
  }

  /** An Alt+↑ / Alt+↓ step; out of a frame's <body>, main hands the picker to the parent's <iframe>. */
  private stepLevel(move: LevelMove): void {
    const view = viewOf(this.deps.win)
    if (move.kind === 'parent-frame') this.sendPick({ kind: 'parent', via: 'keyboard', view })
    else if (move.kind === 'say') this.steps.say(move.say, undefined, view)
    else {
      this.moveTo(move.element)
      this.downPath = [...move.path]
    }
  }

  private pickElement(kind: Extract<PickKind, 'menu' | 'open'>, element: Element, event?: MouseEvent, words: PageWords | null = null): void {
    if (!this.state.commentable) return
    const where = event === undefined ? { point: elementPoint(element) } : { screen: screenOf(event) }
    const via = event === undefined ? 'keyboard' : 'pointer'
    const target = describeTarget(this.tokens, element)
    this.button.hide()
    this.paintSelected(element)
    this.sendPick({ kind, via, ...target, ...wordsPart(words, target), ...where, view: viewOf(this.deps.win) })
  }

  /** The page's selected words, if any (never in the overlay). */
  private selectionWords(): PageWords | null {
    return readSelection(this.deps.win, node => this.host.isHost(node))
  }

  /** Pins and marks exist only in a commentable frame: a non-commentable state carries no icons. */
  private pickIcon(key: string, element: Element, event: MouseEvent, members?: readonly PinInput[]): void {
    this.paintSelected(element)
    this.sendPick({ kind: 'icon', via: 'pointer', key, ...stackPart(members), screen: screenOf(event), view: viewOf(this.deps.win) })
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
    if (!limiter.tryTake()) return
    this.deps.send(COMMENT_PICK_CHANNEL, payload)
    // A menu, open or icon pick: main's menu or window hides the page, and the picker holds its element meanwhile.
    if (limiter === this.limiters.pick && this.state.mode) this.pickHold.picked()
  }

  /** One comment-mode step (overlayCore `modeState.ts`); `state.mode` already holds a `set`. */
  private followMode(step: CommentModeStep): void {
    if (step.requestExit) this.sendPick({ kind: 'exit', via: 'keyboard', view: viewOf(this.deps.win) })
    if (!step.changed) return
    this.state = { ...this.state, mode: step.on }
    this.cursor.set(step.on)
    // The window says the mode change (`commentModeChanged`); the page says nothing.
    if (!step.on) {
      this.select(null, false)
      this.pointer = null
      this.button.hide()
      return
    }
    // Turned on with words selected: the mode only comes on, around them, with the Comment button (C-16).
    const words = this.selectionWords()
    if (words !== null) {
      this.current = words.target
      this.button.show(words)
    }
  }

  private reveal(key: string): void {
    const element = this.icons.resolve(this.state.icons).find(r => r.icon.key === key)?.element
    if (element === undefined) return
    openAround(element)
    element.scrollIntoView({ block: 'center' })
    this.flash.start(element)
    this.renderNow()
  }

  private overlayLost(): void {
    this.view = null
    this.pins = []
    this.shields = []
    this.anchors.markUnavailable('overlay-removed')
  }

  private outlineOf(viewport: Viewport): OutlineModel | null {
    const element = this.current
    if (!this.state.mode || element === null || !element.isConnected) return null
    const comments = this.pins.flatMap(pin => pin.members ?? [pin]).reduce((sum, pin) => sum + (pin.element === element ? pin.count : 0), 0)
    const suffix = suffixFor(element, this.frameMap, this.tokens)
    return outlineModelOf(element, element === this.selected, viewport, this.deps.win.devicePixelRatio, suffix, comments)
  }

  /** One render pass. */
  private render(): void {
    const { win, doc } = this.deps
    if (doc.documentElement === null) return
    const viewport = viewportOf(win)
    this.frameMap = mapChildFrames(win, doc, this.state.childFrames)
    if (this.frameMap.mismatch) this.hellos.request()
    const icons = this.icons.resolve(this.state.icons)
    if (this.state.commentable) this.anchors.update(icons.map(r => ({ key: r.icon.key, visible: r.visible })))
    const pinned = this.state.showIcons ? icons.filter(r => r.visible) : []
    this.pins = placePins(
      pinned.map(r => ({ ...r.icon, element: r.element as Element, box: boxOf(r.element as Element) })),
      viewport,
      pxOf(this.state.theme.pinTarget)
    )
    this.marks = this.markResolver.place(pinned, viewport)
    const theme = this.state.theme
    this.buttonBox = this.state.mode ? this.button.box(viewport, pxOf(theme.pinTarget) + 2 * pxOf(theme.space1), pxOf(theme.space4)) : null
    this.shields = this.state.mode ? shieldsOf(doc, this.frameMap, viewport) : []
    this.watch.observeSizes(pinned.map(r => r.element as Element))
    const flash = this.flash.current()
    const needed = this.state.mode || this.pins.length > 0 || this.marks.length > 0 || flash !== null
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
        pinLabel: pin => labelText(labelOf(pin.element, boxOf(pin.element), suffixFor(pin.element, this.frameMap, this.tokens), 0)),
        selected: this.selected,
        shields: this.shields.map(s => s.box),
        indicator: {
          visible: this.state.mode && this.deps.isTop,
          bottom: this.pointer !== null && this.pointer.y < MODE_TAB_AVOID_PX
        },
        flash: flash === null ? null : clipToViewport(boxOf(flash), viewport),
        marks: this.marks,
        marksClickable: this.state.mode,
        button: this.buttonBox
      },
      viewport
    )
  }
}
