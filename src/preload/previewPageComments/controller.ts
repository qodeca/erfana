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
import { modeTabMovesAway } from '../../shared/comments/overlayCore/reveal'
import { COMMENT_HELLO_CHANNEL, COMMENT_PICK_CHANNEL } from './constants'
import { EMPTY_FRAME_MAP, iframeOfKey, mapChildFrames, shieldsOf, suffixFor, type FrameMap, type Shield } from './frames'
import { openAround, SectionRestore } from './foldedSections'
import { boxOf, clipToViewport, isRendered, viewportOf, type Box, type Point, type Viewport } from './geometry'
import { IconResolver } from './iconResolver'
import { labelOf, labelText } from './label'
import { OverlayHost } from './overlayHost'
import { overlayCss } from './overlayStyles'
import { OverlayView, outlineModelOf, type OutlineModel } from './overlayView'
import { pointerTakesOver } from '../../shared/comments/overlayCore/pointerFollow'
import { PickHold } from './pickHold'
import { movePicker, type PickerMove, type PickerStep, type PickerTree } from '../../shared/comments/overlayCore/pickerKeys'
import { focusedElement, pageTree, pickableExcept, pickerStart, type PickablePredicate } from './picker'
import { MarkResolver, type MarkPlacement } from './marks'
import { elementOfHit, hitAt, linkedHover, NO_HOVER, routeOverlayEvent, type OverlayHit } from './overlayHits'
import { HelloRepeater, RevealFlash } from './revealFlash'
import { describeTarget, elementPoint, PickBudgets, screenOf, stackPart, StepSender, stepElementOf, viewOf, wordsPart, type PickKind, type PickPayload } from './picks'
import { PageMenu } from './pageMenu'
import { onSelection, SelectionButton, selectionEnd, selectionInView } from './selectionButton'
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

/** The comment overlay of one frame. */
export class CommentController {
  readonly tokens: TokenRegistry
  private readonly host: OverlayHost
  private readonly anchors: AnchorReporter
  private readonly picks: PickBudgets
  /** Where the keyboard picker is, for the comment window's live region – never text in the page (§10.2). */
  private readonly steps: StepSender
  private readonly scheduler: RenderScheduler
  private readonly watch: PageWatch
  private readonly cursor: CursorSheet
  private readonly restorer: ScrollRestore
  private readonly sections: SectionRestore
  private readonly pickable: PickablePredicate
  private readonly tree: PickerTree<Element>
  private readonly icons: IconResolver
  private state: CommentState = IDLE_STATE
  private view: OverlayView | null = null
  private frameMap: FrameMap = EMPTY_FRAME_MAP
  private current: Element | null = null
  private levelHold = false
  /** The mode just came on, nothing picked yet. After a reload it was on: focus returning must not talk over "Comment saved". */
  private entering = false
  /** Keeps the picked element while main's menu or window hides the page. */
  private readonly pickHold = new PickHold(() => this.deps.doc.visibilityState === 'hidden')
  private downPath: Element[] = []
  private selected: Element | null = null
  private selectedKey: string | null = null
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
  /** Erfana's menu outside comment mode: the right-click and the keyboard's route (OD-01, K-1). */
  readonly menu: PageMenu
  private ready = false

  constructor(private readonly deps: ControllerDeps) {
    const { doc, now } = deps
    this.tokens = new TokenRegistry(doc, doc.readyState === 'loading')
    this.host = new OverlayHost({ doc, now, onUnavailable: () => this.overlayLost() })
    this.anchors = new AnchorReporter({ send: deps.send, now })
    this.picks = new PickBudgets(now, payload => deps.send(COMMENT_PICK_CHANNEL, payload))
    this.steps = new StepSender(now, payload => deps.send(COMMENT_PICK_CHANNEL, payload))
    this.scheduler = new RenderScheduler(deps.win, () => this.render())
    this.watch = new PageWatch(deps, target => this.host.isHost(target), () => this.scheduler.soon())
    this.cursor = new CursorSheet(doc)
    this.restorer = new ScrollRestore(deps.win, now)
    this.sections = new SectionRestore(deps.win, doc, now)
    this.pickable = pickableExcept(element => this.host.isHost(element))
    this.tree = pageTree(() => this.body(), this.pickable)
    this.icons = new IconResolver(this.tokens, () => this.watch.version)
    this.markResolver = new MarkResolver(() => this.watch.version)
    this.button = new SelectionButton(deps.win, now, () => this.scheduler.soon())
    this.flash = new RevealFlash(now, () => this.scheduler.soon())
    this.hellos = new HelloRepeater(now, deps.send)
    const open = (): boolean => !this.state.mode && this.state.commentable
    this.menu = new PageMenu({ win: deps.win, tokens: this.tokens, now, open, words: () => this.selectionWords(), wordsAt: point => this.wordsAt(point), wordsPoint: () => selectionEnd(deps.win), keyTarget: () => this.menuKeyTarget(), send: payload => this.sendPick(payload) })
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
   * The page replaced `<html>` (`document.open()`, §9.1 S25), erasing every listener. The guards
   * are back; put back the rest. A script could get ahead of them: main hears it is unavailable.
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
    this.entering = previous !== IDLE_STATE && !previous.mode && next.mode
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
      if (raw !== null && pointerTakesOver(this.current, raw, this.levelHold)) this.select(raw, false)
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
    routeOverlayEvent(hit, event, {
      icon: (key, element, click, members) => this.pickIcon(key, element, click, members),
      element: (kind, element, click, words) => this.pickElement(kind, element, click, words)
    })
  }

  /**
   * A trusted press, click or context menu on the page, in comment mode. A
   * drag selects words and shows the Comment button; a click picks (024-FR-004,
   * overlayCore `gesture`). The menu is about the words only with the pointer on them (I-22).
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
      const words = this.wordsAt(at)
      this.pickElement('menu', words?.target ?? element, event, words)
    }
    if (event.type === 'click' && event.button === 0 && event.detail > 0) {
      if (this.button.release(at, this.selectionWords())) this.holdWords()
      else this.pickElement('open', element, event)
    }
  }

  /** The keyboard reached the top frame in comment mode (K-6): the picker starts, with no hold, so the pointer still leads. */
  startPicker(): void {
    if (!this.state.mode || !this.entering || !this.deps.isTop || this.current?.isConnected === true) return
    const start = this.ensureCurrent()
    if (start !== null) this.moveTo(start)
    this.levelHold = false
  }

  /** A keyboard picker step, in comment mode. */
  pickerAction(step: PickerStep): void {
    if (step === 'exit') {
      this.followMode(reduceCommentMode({ on: this.state.mode }, { type: 'escape' }))
      this.render()
      return
    }
    const started = this.current?.isConnected === true
    const current = this.ensureCurrent()
    if (current === null) return
    if (step === 'open' || step === 'menu') this.pickOutlined(step, current)
    else if (!started) this.moveTo(current) // The first key lands on the start element: nobody was told where it was.
    else this.followMove(movePicker(this.tree, current, this.downPath, step))
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
    this.button.dispose()
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
    this.current = pickerStart((this.pointer !== null ? this.hitElement(this.pointer) : null) ?? this.centreElement(), this.deps.doc, this.tree)
    return this.current
  }

  private centreElement(): Element | null {
    const viewport = viewportOf(this.deps.win)
    return this.hitElement({ x: viewport.width / 2, y: viewport.height / 2 })
  }

  /** The focused element, else the picker's start with no pointer: a key has nothing to do with where the mouse is (I-18). */
  private menuKeyTarget(): Element | null {
    return focusedElement(this.deps.doc, this.pickable) ?? pickerStart(this.centreElement(), this.deps.doc, this.tree)
  }

  /** A drag selected words: the outline goes around them and holds there, so Enter acts on what is outlined (K-11). */
  private holdWords(): void {
    if (this.button.current !== null) this.select(this.button.current.target, true)
    this.scheduler.soon()
  }

  private select(element: Element | null, hold: boolean): void {
    this.current = element
    this.levelHold = hold
    this.entering = false
    this.pickHold.release()
    this.downPath = []
    this.selected = this.selectedKey = null
  }

  private moveTo(element: Element): void {
    const path = this.downPath
    this.select(element, true)
    this.downPath = path
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    this.renderNow()
    this.steps.say('showing', stepElementOf(this.tokens, element), viewOf(this.deps.win))
  }

  /** A move's end: out of a frame's <body> main hands the picker to the parent's <iframe>; else the sentence or the move. */
  private followMove(move: PickerMove<Element>): void {
    if ('target' in move) {
      this.button.hide()
      this.moveTo(move.target)
      this.downPath = [...move.path]
    } else if (move.end === 'top' && !this.deps.isTop) this.sendPick({ kind: 'parent', via: 'keyboard', view: viewOf(this.deps.win) })
    else this.steps.say(move.end, undefined, viewOf(this.deps.win))
  }

  /** Enter and the menu act on what is outlined (K-11): the Comment button's words only when they are its words. */
  private pickOutlined(kind: 'open' | 'menu', element: Element): void {
    if (kind === 'menu') this.keyboardMenuAt = this.deps.now()
    const shown = this.button.wordsInView(viewportOf(this.deps.win))
    const words = shown?.target === element ? shown : null
    this.pickElement(kind, element, undefined, words, words === null ? null : this.button.menuPoint())
  }

  private pickElement(kind: Extract<PickKind, 'menu' | 'open'>, element: Element, event?: MouseEvent, words: PageWords | null = null, point: Point | null = null): void {
    if (!this.state.commentable) return
    const where = event === undefined ? { point: point ?? elementPoint(element) } : { screen: screenOf(event) }
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

  /** The page's selected words, when the pointer at `point` is on them. */
  private wordsAt(point: Point): PageWords | null {
    return onSelection(this.deps.win, point) ? this.selectionWords() : null
  }

  /** Pins and marks exist only in a commentable frame: a non-commentable state carries no icons. */
  private pickIcon(key: string, element: Element, event: MouseEvent, members?: readonly PinInput[]): void {
    this.paintSelected(element, key)
    this.sendPick({ kind: 'icon', via: 'pointer', key, ...stackPart(members), screen: screenOf(event), view: viewOf(this.deps.win) })
  }

  /** The selected outline must be painted before main captures the still (§3, R3-6). */
  private paintSelected(element: Element, key: string | null = null): void {
    if (this.state.mode) this.current = element
    this.selected = element
    this.selectedKey = key
    this.renderNow()
  }

  private sendPick(payload: PickPayload): void {
    // A menu, open or icon pick: main's menu or window hides the page, and the picker holds its element meanwhile.
    if (this.picks.send(payload) && this.state.mode) this.pickHold.picked()
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
    // Turned on with words selected in view: the mode only comes on, around them, with the Comment button (C-16).
    const words = selectionInView(this.deps.win, viewportOf(this.deps.win)) ? this.selectionWords() : null
    if (words !== null) {
      this.current = words.target
      this.button.show(words)
    }
    if (this.deps.doc.hasFocus()) this.startPicker()
  }

  private reveal(key: string): void {
    const element = this.icons.resolve(this.state.icons).find(r => r.icon.key === key)?.element
    if (element === undefined) return
    openAround(element)
    element.scrollIntoView({ block: 'center' })
    if (isRendered(element)) this.flash.start(element)
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
    const hover = this.state.mode && this.pointer !== null ? linkedHover(this.overlayHit(this.pointer), this.marks) : NO_HOVER
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
        selectedKey: this.selectedKey,
        shields: this.shields.map(s => s.box),
        indicator: {
          visible: this.state.mode && this.deps.isTop,
          bottom: modeTabMovesAway(this.pointer?.y ?? null)
        },
        flash: flash === null ? null : clipToViewport(boxOf(flash), viewport),
        marks: this.marks,
        marksClickable: this.state.mode,
        hover,
        button: this.buttonBox
      },
      viewport
    )
  }
}
