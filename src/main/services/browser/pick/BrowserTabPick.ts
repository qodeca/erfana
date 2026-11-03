// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pick mode of one browser tab, main side (spec 025, 025-FR-025 to
 * 025-FR-029, 025-FR-053; solution design § 4, § 6.1; ADR 0007, ADR 0008).
 *
 * The routing reducer (`input/BrowserTabInput.ts`) decides *when*: pick mode
 * on and off, a confirm, a close. This module does the engine work:
 *
 * - **On and off**: the engine side is `pickModeSwitch.ts`.
 * - **Hover**: each move is hit-tested (`pickHitTest.ts`), one in flight, the
 *   latest wins; the engine outlines the element and its label goes out (`highlight`).
 * - **Up and Down before a confirm** walk the hovered element's chain on the
 *   live page; a move of the mouse to another element starts over from it.
 * - **Confirm** ({@link BrowserTabPick.startCapture}, `capture/` modules):
 *   re-hit-test at the click, hide the highlight, take the screenshot (one
 *   retry when the first comes back empty), snapshot the chain, hold the
 *   capture and send the still image (`captured`); then read the facts and
 *   the hints, and – for a second-Ctrl/Cmd+E pick – freeze the page.
 * - **Menu**: refinement and close (`pickMenu.ts`), and the page navigating
 *   underneath. The capture reads themselves are `pickCaptureReads.ts`.
 *
 * Every exit releases the capture (except after a navigation, when only an
 * open dialog may still send it) and unfreezes the page.
 */
import { randomBytes } from 'node:crypto'
import type { Clock } from '../../../../shared/clock'
import type { RoutingEffect, RoutingEvent, RoutingState } from '../../../../shared/browser/routingState'
import type { WidthPresetRecord } from '../../../../shared/browser/widthPresets'
import type { PickEvent } from '../../../../shared/ipc/browser-tab-schema'
import type { ClosePickReason } from '../../../../shared/ipc/browser-tab-pick-schema'
import { logger } from '../../LoggingService'
import { BrowserCapture, type RefineMove } from '../capture/BrowserCapture'
import { downscaleBitmap } from '../capture/captureImage'
import { PickReader, type PickCdp, type PickNode } from './pickCdp'
import { CaptureFailure, PickCaptureReads } from './pickCaptureReads'
import { readChain, type ElementChain } from './pickElement'
import { PickFrames } from './pickFrames'
import { PickFreeze, type FreezeAudio } from './pickFreeze'
import type { Point, PointerReport } from './pickGeometry'
import { PickHighlight, type HighlightRecord } from './pickHighlight'
import { PickHitTest } from './pickHitTest'
import { closeEvent, refineHeld } from './pickMenu'
import { centre, flashThenHide, sameNode } from './pickFlash'
import { PickModeSwitch } from './pickModeSwitch'
import { PickBench, type PickFaults } from './pickSupport'

/** The still image's longest side; 4096² × 4 bytes is the event's 64 MiB cap. */
export const STILL_MAX_EDGE_PX = 4096

type Listener = (...args: unknown[]) => void

/** The page `webContents` surface pick mode needs. */
export interface PickContents extends FreezeAudio {
  on(event: string, listener: Listener): unknown
  removeListener(event: string, listener: Listener): unknown
  capturePage(): Promise<{ toBitmap(): Buffer; getSize(): { width: number; height: number }; getScaleFactors?(): number[] }>
  getZoomFactor(): number
  getURL(): string
  getTitle(): string
  insertCSS(css: string, options?: { cssOrigin?: 'user' | 'author' }): Promise<string>
  removeInsertedCSS(key: string): Promise<void>
}

/** The tab's routing, as pick mode drives it (`BrowserTabInput`). */
export interface PickRouting {
  state(): RoutingState
  dispatch(event: RoutingEvent): readonly RoutingEffect[]
}

export interface BrowserTabPickDeps {
  readonly tabId: string
  readonly contents: PickContents
  readonly cdp: PickCdp
  readonly routing: PickRouting
  /** The page view's top-left on the screen (DIP), or null while hidden. */
  readonly viewOrigin: () => Point | null
  readonly widthPreset: () => WidthPresetRecord
  /** The open project's root, for the resolved source; null when unknown. */
  readonly projectRoot: () => string | null
  readonly clock: Clock
  readonly events: { pick(event: PickEvent): void }
  readonly faults?: PickFaults
  readonly bench?: PickBench
}

const captureId = (): string => randomBytes(16).toString('hex')

export class BrowserTabPick {
  readonly reader: PickReader
  readonly frames: PickFrames
  readonly highlight: PickHighlight
  private readonly hitTest: PickHitTest
  private readonly freeze: PickFreeze
  private readonly reads: PickCaptureReads
  private readonly modeSwitch: PickModeSwitch
  private readonly offs: Array<() => void> = []
  private readonly listeners: Array<[string, Listener]> = []
  private active = false
  private lastPointer: PointerReport | null = null
  private lastViewPoint: Point | null = null
  private clickPointer: PointerReport | null = null
  /** The element **Pick this element** hit, for the confirm the reducer queues next (025-FR-057). */
  private menuTarget: { node: PickNode; viewPoint: Point } | null = null
  private hoverBusy = false
  private hoverQueued: PointerReport | null = null
  /** Up and Down before a confirm: the hovered element's chain and where the highlight is on it. */
  private preChain: { chain: Promise<ElementChain>; index: number | null; node: PickNode } | null = null
  private held: BrowserCapture | null = null
  /** The element just sent: its outline flashes on the live page as pick mode ends (025-FR-060). */
  private sentNode: PickNode | null = null
  private navigating = false
  private disposed = false

  constructor(private readonly deps: BrowserTabPickDeps) {
    this.reader = new PickReader(deps.cdp)
    this.frames = new PickFrames(deps.cdp, this.reader)
    this.highlight = new PickHighlight(this.reader, this.frames, () => deps.faults?.highlightColour() ?? null)
    this.hitTest = new PickHitTest(this.reader, this.frames)
    this.freeze = new PickFreeze(deps.cdp, this.reader, deps.contents, () => this.externalResume())
    this.modeSwitch = new PickModeSwitch(deps.cdp, this.reader, this.frames, deps.contents)
    this.reads = new PickCaptureReads({
      reader: this.reader,
      frames: this.frames,
      capturePage: () => deps.contents.capturePage(),
      isFrozen: () => this.freeze.isFrozen,
      projectRoot: deps.projectRoot,
      clock: deps.clock,
      faults: deps.faults
    })
    this.offs.push(
      deps.cdp.on('protocolEvent', (event) => {
        if (event.method === 'CSS.styleSheetAdded') this.reads.recordStyleSheet(event.params)
      }),
      deps.cdp.on('targetAttached', (target) => {
        if (this.active && target.type === 'iframe') this.modeSwitch.focusEmulation(target.sessionKey, true)
      }),
      deps.cdp.on('targetDetached', (target) => this.reader.forgetSession(target.sessionKey)),
      deps.cdp.on('detached', () => this.routing({ type: 'endSilently' }))
    )
    this.listen('before-mouse-event', (_event: unknown, mouse: PointerReport & { type: string; button?: string }) => this.onMouse(mouse))
    this.listen('did-navigate', () => this.onNavigated())
    this.listen('did-frame-navigate', () => this.reader.reset())
  }

  /** Whether pick mode is on. */
  get isActive(): boolean {
    return this.active
  }

  /** The capture held now, or null. */
  get capture(): BrowserCapture | null {
    return this.held
  }

  get isFrozen(): boolean {
    return this.freeze.isFrozen
  }

  /** Every target the tab's CDP session holds (the test hook, T14). */
  attachedTargets(): ReturnType<PickCdp['attachedTargets']> {
    return this.deps.cdp.attachedTargets()
  }

  /** The tab's routing turned pick mode on or off. */
  setMode(on: boolean): void {
    if (on) void this.start()
    else void this.stop()
  }

  /** A routing effect this module performs (`BrowserTabInput`'s `onEffect`). */
  onEffect(effect: RoutingEffect): void {
    switch (effect.type) {
      case 'startCapture':
        // Deferred one microtask: the click's own `before-mouse-event` listener below records the point first.
        queueMicrotask(() => void this.startCapture(effect.freeze))
        return
      case 'discardCapture':
        if (this.navigating && this.held !== null) this.held.afterNavigation = true
        else this.release()
        return
      case 'unfreeze':
        void this.unfreeze()
        return
      default:
    }
  }

  /** Up or Down (and their Alt aliases) in pick mode or in the menu (025-FR-027). */
  refine(move: RefineMove): void {
    if (this.held !== null) void this.refineHeld(move)
    else if (move === 'parent' || move === 'child') void this.refineLive(move)
  }

  /**
   * **Pick this element** from the page's context menu at `at` (page view
   * px, zoom included): hit-test there, then let the routing pick at once
   * (`contextMenuPick`, 025-FR-057). Pick mode goes on first (the session refuses DOM while it is off); over
   * nothing it goes back off. The routing may refuse (a menu or dialog open).
   */
  async pickAt(at: Point): Promise<void> {
    if (this.disposed || !this.deps.cdp.attached || this.deps.contents.isDestroyed()) return
    const wasActive = this.active
    if (!wasActive) await this.start()
    const zoom = this.deps.contents.getZoomFactor() || 1
    const hit = await this.hitTest.atViewPoint({ x: at.x / zoom, y: at.y / zoom }).catch(() => null)
    if (hit === null || this.disposed) return void (wasActive || (await this.stop()))
    this.menuTarget = { node: hit.node, viewPoint: hit.viewPoint }
    this.routing({ type: 'contextMenuPick' })
    // Only the confirm this dispatch queued (one microtask, `onEffect`) may use it.
    queueMicrotask(() => {
      this.menuTarget = null
    })
  }

  /** Remove every listener, release the capture, unfreeze. The tab is closing. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const off of this.offs.splice(0)) off()
    for (const [event, listener] of this.listeners.splice(0)) {
      if (!this.deps.contents.isDestroyed()) this.deps.contents.removeListener(event, listener)
    }
    this.held = null
    void this.freeze.unfreeze()
    this.freeze.dispose()
    this.frames.dispose()
  }

  // ── Pick mode on and off ───────────────────────────────────────────────

  private async start(): Promise<void> {
    if (this.active || this.disposed || !this.deps.cdp.attached) return
    this.active = true
    this.sentNode = null
    this.reads.clearStyleSheets()
    await this.modeSwitch.on(() => this.active)
    if (this.lastPointer !== null) this.hover(this.lastPointer)
  }

  private async stop(): Promise<void> {
    if (!this.active) return
    this.active = false
    this.preChain = null
    this.lastViewPoint = null
    if (this.held !== null && !this.held.afterNavigation) this.release()
    await this.unfreeze()
    const sent = this.sentNode
    this.sentNode = null
    if (!(await flashThenHide(this.highlight, sent, this.deps.clock, () => this.active))) await this.modeSwitch.off()
  }

  // ── Hover ───────────────────────────────────────────────────────────────

  private onMouse(mouse: PointerReport & { type: string; button?: string }): void {
    if (mouse.type === 'mouseMove' || mouse.type === 'mouseEnter') {
      this.lastPointer = mouse
      if (this.active && this.held === null && this.deps.routing.state().surface === 'none') this.hover(mouse)
      return
    }
    if (mouse.type === 'mouseDown' && (mouse.button ?? 'left') === 'left') {
      this.lastPointer = mouse
      this.clickPointer = mouse
      // Only the confirm the reducer queued in this same event may use it.
      queueMicrotask(() => {
        this.clickPointer = null
      })
    }
  }

  private hover(report: PointerReport): void {
    if (this.hoverBusy) {
      this.hoverQueued = report
      return
    }
    this.hoverBusy = true
    const startedAt = this.deps.clock.now()
    void this.hoverOnce(report, startedAt).finally(() => {
      this.hoverBusy = false
      const next = this.hoverQueued
      this.hoverQueued = null
      if (next !== null && this.active && this.held === null) this.hover(next)
    })
  }

  private async hoverOnce(report: PointerReport, startedAt: number): Promise<void> {
    const hit = await this.pointerHit(report)
    if (!this.active || this.held !== null) return
    if (hit === null) {
      if (this.highlight.record !== null) await this.highlight.hide()
      this.preChain = null
      this.routing({ type: 'hover', element: false })
      this.emit({ kind: 'highlight', label: null })
      return
    }
    this.lastViewPoint = hit.viewPoint
    // Skipped only while it shows: after a capture hid it, the same element is outlined again.
    const same = this.highlight.record !== null && this.preChain !== null && this.preChain.index === null && sameNode(this.preChain.node, hit.node)
    if (same) return
    this.preChain = null
    const record = await this.highlight.show(hit.node)
    if (record === null || !this.active) return
    this.preChain = { chain: readChain(this.reader, this.frames, hit.node), index: null, node: hit.node }
    this.preChain.chain.catch(() => undefined)
    this.routing({ type: 'hover', element: true })
    this.emit({ kind: 'highlight', label: record.label })
    this.deps.bench?.record('highlight', this.deps.clock.now() - startedAt)
  }

  private async pointerHit(report: PointerReport): Promise<{ node: PickNode; viewPoint: Point } | null> {
    const origin = this.deps.viewOrigin() ?? { x: 0, y: 0 }
    const zoom = this.deps.contents.isDestroyed() ? 1 : this.deps.contents.getZoomFactor()
    return this.hitTest.atPointer(report, origin, zoom || 1).catch(() => null)
  }

  private async refineLive(move: 'parent' | 'child'): Promise<void> {
    const pre = this.preChain
    if (pre === null || !this.active) {
      this.note('moveTheMouse')
      return
    }
    let chain: ElementChain
    try {
      chain = await pre.chain
    } catch {
      this.note('elementGone')
      return
    }
    const last = chain.entries.length - 1
    const at = pre.index ?? last
    const next = move === 'parent' ? at - 1 : at + 1
    if (next < 0) return this.note('topOfPage')
    if (next > last) return this.note('backAtStart')
    const node = chain.entries[next].node
    if (node === null) return this.note('elementGone')
    pre.index = next === last ? null : next
    const record = await this.highlight.show(node)
    if (record !== null) this.emit({ kind: 'highlight', label: record.label })
  }

  // ── Confirm and the held capture ──────────────────────────────────────

  /** Confirm the pick: the capture of 025-FR-053, the still image, then the facts, the hints and the freeze. */
  async startCapture(freeze: boolean): Promise<void> {
    const startedAt = this.deps.clock.now()
    const click = this.clickPointer
    const fromMenu = this.menuTarget
    this.clickPointer = null
    this.menuTarget = null
    this.emit({ kind: 'capturing' })
    try {
      const target = fromMenu ?? (await this.confirmTarget(click))
      if (target === null) throw new CaptureFailure('The element under the pointer could not be read')
      const logs = this.deps.cdp.logSnapshot()
      const url = this.deps.contents.getURL()
      const title = this.deps.contents.getTitle()
      await this.highlight.hide()
      const image = await this.reads.screenshot()
      const [viewport, chain] = await Promise.all([this.reads.viewport(), readChain(this.reader, this.frames, target.node)])
      const time = new Date(this.deps.clock.now())
      const capture = new BrowserCapture(
        captureId(),
        {
          time,
          utcOffsetMinutes: -time.getTimezoneOffset(),
          image,
          viewport,
          widthPreset: this.deps.widthPreset(),
          pickPoint: target.viewPoint,
          url,
          title,
          logs
        },
        chain,
        { facts: (entry, index) => this.reads.facts(chain, entry, index), hints: (index) => this.reads.hints(chain, index) }
      )
      if (!this.active && !this.deps.routing.state().capturing) return
      this.held = capture
      const still = downscaleBitmap(image, STILL_MAX_EDGE_PX, STILL_MAX_EDGE_PX)
      this.emit({ kind: 'captured', captureId: capture.id, still: still.data, stillWidth: still.width, stillHeight: still.height, summary: capture.summary() })
      this.routing({ type: 'captureReady' })
      this.deps.bench?.record('confirmToMenu', this.deps.clock.now() - startedAt)
      void this.afterMenu(capture, freeze)
    } catch (error) {
      const reason = error instanceof CaptureFailure ? error.message : 'The capture could not be taken'
      logger.warn('Browser pick: capture failed', { error: error instanceof CaptureFailure ? 'capture' : String(error) })
      this.emit({ kind: 'captureFailed', reason })
      this.routing({ type: 'captureFailed' })
    }
  }

  /** Facts and hints after the menu shows; then the freeze of a second-Ctrl/Cmd+E pick (ADR 0008 decision 2). */
  private async afterMenu(capture: BrowserCapture, freeze: boolean): Promise<void> {
    // Every element refinement can reach is read before the pause (ADR 0008 probe fallback).
    await Promise.all([capture.facts().catch(() => undefined), capture.hints(), ...(freeze ? [capture.prefetchAll()] : [])])
    // The panel gets the element's text and confirmed source once read; the same element, so no "changed" mark.
    if (this.held === capture) this.emit({ kind: 'refined', captureId: capture.id, summary: capture.summary() })
    if (!freeze || this.held !== capture || this.deps.routing.state().surface === 'none') return
    await this.freeze.freeze()
    if (this.held !== capture) {
      await this.unfreeze()
      return
    }
    capture.frozen = true
    this.emit({ kind: 'frozen', captureId: capture.id })
    this.routing({ type: 'frozen' })
  }

  /** The node to capture: re-hit-tested at a click, else the highlighted (or refined) element. */
  private async confirmTarget(click: PointerReport | null): Promise<{ node: PickNode; viewPoint: Point } | null> {
    if (click !== null) return this.pointerHit(click)
    const record: HighlightRecord | null = this.highlight.record
    if (record === null) return null
    const point = this.lastViewPoint ?? centre(record.box)
    return { node: record.node, viewPoint: point }
  }

  private async refineHeld(move: RefineMove): Promise<void> {
    const capture = this.held
    if (capture === null) return
    await refineHeld(capture, move, {
      reader: this.reader,
      frames: this.frames,
      isHeld: (c) => this.held === c,
      refined: (e) => this.emit({ kind: 'refined', ...e }),
      note: (n) => this.note(n)
    })
  }

  private onNavigated(): void {
    this.reader.reset()
    this.highlight.forget()
    this.preChain = null
    const state = this.deps.routing.state()
    if (!state.pick && this.held === null) return
    if (this.held !== null) this.held.afterNavigation = true // An open dialog may still send it; pick mode's end must not release it.
    this.navigating = true
    try {
      this.routing({ type: 'pageNavigated' })
    } finally {
      this.navigating = false
    }
    this.emit({ kind: 'ended', reason: this.held !== null ? 'pageChanged' : 'navigated' })
  }

  private externalResume(): void {
    const capture = this.held
    if (capture === null) return
    capture.frozen = false
    void this.freeze.unfreeze().then(() => {
      this.routing({ type: 'menuClose', reason: 'esc' })
      if (this.held === capture) this.release()
      this.emit({ kind: 'ended', reason: 'user' })
    })
  }

  private async unfreeze(): Promise<void> {
    if (this.held !== null) this.held.frozen = false
    await this.freeze.unfreeze()
  }

  /** Release the held capture (and its handles). */
  release(): void {
    this.held = null
  }

  /** Close the menu or dialog without sending, or after a send (`closePick`). */
  close(id: string, reason: ClosePickReason): boolean {
    if (this.held === null || this.held.id !== id) return false
    const event = closeEvent(reason, this.deps.routing.state().surface)
    if (reason === 'sent' && !this.held.afterNavigation) this.sentNode = this.held.entry.node
    this.routing(event)
    // A capture the reducer no longer tracks (after a navigation, or a `sent`) is released here.
    if (this.held?.id === id && (reason === 'sent' || this.held.afterNavigation || this.deps.routing.state().surface === 'none')) {
      this.release()
      void this.unfreeze()
    }
    return true
  }

  private routing(event: RoutingEvent): void {
    if (!this.disposed) this.deps.routing.dispatch(event)
  }

  private note(note: Extract<PickEvent, { kind: 'note' }>['note']): void {
    this.emit({ kind: 'note', note })
  }

  private emit(event: DistributiveOmit<PickEvent, 'tabId'>): void {
    if (!this.disposed) this.deps.events.pick({ tabId: this.deps.tabId, ...event } as PickEvent)
  }

  private listen<A extends unknown[]>(event: string, typed: (...args: A) => void): void {
    const listener = typed as unknown as Listener
    this.deps.contents.on(event, listener)
    this.listeners.push([event, listener])
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
