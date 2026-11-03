// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pick and send for every browser tab of this process, main side (spec 025,
 * 025-FR-025 to 025-FR-039, 025-FR-046, 025-FR-053, 025-FR-061; solution
 * design § 6.2, § 9.4, § 13 commits 14–15).
 *
 * - {@link BrowserPicks.attachTab} gives a tab its pick controller
 *   (`BrowserTabPick.ts`) before its first page loads.
 * - {@link BrowserPicks.writeCapture} (`browser-tab:writeCapture`): the shell
 *   guard runs first, before any file is written, and refuses without a
 *   toast (025-FR-061); then the facts and hints are awaited, the files
 *   rendered (`capture/captureRender.ts`) and written all-or-nothing
 *   (`capture/CaptureStore.ts`). A failed write leaves no file and keeps the
 *   capture held for a retry (025-FR-046). A tab that lost its capture while
 *   the write ran (closed, navigated and closed) gets its files deleted.
 * - {@link BrowserPicks.discardCaptureFiles}: the terminal write failed after
 *   the files were written – they go, the capture stays.
 * - {@link BrowserPicks.targetStatus}: the toolbar's target status.
 * - Capture expiry follows the open project (`CaptureExpiry`).
 */
import { randomBytes } from 'node:crypto'
import type { Clock } from '../../../../shared/clock'
import { fenceToken } from '../../../../shared/browser/captureFiles'
import { widthPreset as presetOf } from '../../../../shared/browser/widthPresets'
import type { PickEvent, TargetStatusResponse, WriteCaptureResponse } from '../../../../shared/ipc/browser-tab-schema'
import { logger } from '../../LoggingService'
import type { BrowserTab, TabHost } from '../BrowserTab'
import { outlineColour } from '../capture/accentColour'
import { guardOf, targetStatus, targetStatusAtSend, targetStatusResponse, type TargetTerminals } from '../capture/BrowserTargetStatus'
import type { Bitmap } from '../capture/captureImage'
import { renderCapture } from '../capture/captureRender'
import { CaptureStore, CaptureWriteError } from '../capture/CaptureStore'
import type { TabInputPick } from '../input/BrowserTabInput'
import { BrowserTabPick, type PickRouting } from './BrowserTabPick'
import type { PickCdp } from './pickCdp'
import { PickBench, PickFaults } from './pickSupport'

/** Longest a send waits for the facts and hints before writing what it has. */
export const SEND_READ_TIMEOUT_MS = 10_000

export interface BrowserPicksDeps {
  readonly clock: Clock
  /** PNG encoding of a BGRA bitmap (Electron's `nativeImage` in the app). */
  readonly encodePng: (bitmap: Bitmap) => Uint8Array
  /** The terminal service's guard surface; without it every target reads as no terminal. */
  readonly terminals?: () => TargetTerminals | null
  readonly store?: CaptureStore
  /** The tab-kind CDP session of a page `webContents`, when recorded outside {@link BrowserPicks.registerSession}. */
  readonly sessionOf?: (contents: object) => PickCdp | null
}

/** The tab's routing as the pick pipeline attaches to it (`BrowserTabInput`). */
export type TabPickInput = PickRouting & { attachPick(pick: TabInputPick): void }

export type WriteCaptureInput = {
  readonly captureId: string
  readonly terminalId: string
  readonly sendAnyway?: true
}

export class BrowserPicks {
  readonly faults = new PickFaults()
  readonly bench = new PickBench()
  readonly store: CaptureStore
  private readonly sessions = new WeakMap<object, PickCdp>()
  private readonly byTab = new Map<string, { tab: BrowserTab; pick: BrowserTabPick }>()

  constructor(private readonly deps: BrowserPicksDeps) {
    this.store = deps.store ?? new CaptureStore(() => () => this.faults.writeFault())
  }

  /** The tab's pick controller, before its first page loads; null without a CDP session. */
  attachTab(tab: BrowserTab, host: TabHost, cdp: PickCdp | null, routing: PickRouting, events: { pick(event: PickEvent): void }): BrowserTabPick | null {
    if (cdp === null) return null
    return new BrowserTabPick({
      tabId: tab.id,
      contents: tab.contents,
      cdp,
      routing,
      viewOrigin: () => {
        const placed = tab.viewFrame.placement()
        if (placed === null || host.isDestroyed()) return null
        const content = host.getContentBounds()
        return { x: content.x + placed.view.x, y: content.y + placed.view.y }
      },
      widthPreset: () => ({ kind: 'preset', name: presetOf(tab.viewFrame.widthPreset).recordName }),
      projectRoot: () => tab.projectRoot,
      clock: this.deps.clock,
      events,
      faults: this.faults,
      bench: this.bench
    })
  }

  detachTab(pick: BrowserTabPick): void {
    pick.dispose()
  }

  /** Record the tab-kind CDP session of a page `webContents` (`browserAppSetup.attachTabCdp`). */
  registerSession(contents: object, cdp: PickCdp): void {
    this.sessions.set(contents, cdp)
  }

  /**
   * Give `tab` its pick pipeline, wired to its routing (`BrowserTabInput`):
   * pick mode, Up and Down and the capture effects. Pick events go to `send`
   * (the owning window). Does nothing without routing or a CDP session.
   */
  attach(tab: BrowserTab, host: TabHost, input: TabPickInput | null, send: (event: PickEvent) => void): BrowserTabPick | null {
    if (input === null || this.byTab.has(tab.id)) return null
    const pick = this.attachTab(tab, host, this.sessions.get(tab.contents) ?? this.deps.sessionOf?.(tab.contents) ?? null, input, { pick: send })
    if (pick === null) return null
    input.attachPick({ mode: (on) => pick.setMode(on), refine: (move) => pick.refine(move), onEffect: (effect) => pick.onEffect(effect) })
    this.byTab.set(tab.id, { tab, pick })
    tab.contents.once('destroyed', () => this.forgetTab(tab.id))
    return pick
  }

  /** The pick pipeline of `tab`, or null. */
  forTab(tab: BrowserTab): BrowserTabPick | null {
    const entry = this.byTab.get(tab.id)
    return entry?.tab === tab ? entry.pick : null
  }

  /** **Pick this element** from the context menu of tab `tabId` at `at` (page view px). Never rejects. */
  pickAt(tabId: string, at: { x: number; y: number }): void {
    const pick = this.byTab.get(tabId)?.pick
    if (pick === undefined) return
    pick.pickAt(at).catch((error: unknown) => logger.warn('Browser pick: Pick this element failed', { error: String(error) }))
  }

  /** Dispose the pick pipeline of a closed tab. */
  forgetTab(tabId: string): void {
    const entry = this.byTab.get(tabId)
    if (entry === undefined) return
    this.byTab.delete(tabId)
    entry.pick.dispose()
  }

  /** The toolbar's status of `terminalId` for the window whose renderer is `ownerWebContentsId`. */
  targetStatus(ownerWebContentsId: number, terminalId: string): TargetStatusResponse {
    const terminals = this.deps.terminals?.() ?? null
    if (terminals === null) return { kind: 'unknown', process: null, fresh: false }
    return targetStatusResponse(targetStatus(terminals, ownerWebContentsId, terminalId))
  }

  /** `browser-tab:writeCapture`: guard, then write the held capture's files (design § 6.2). Never rejects. */
  async writeCapture(tab: BrowserTab, pick: BrowserTabPick, ownerWebContentsId: number, input: WriteCaptureInput): Promise<WriteCaptureResponse> {
    const capture = pick.capture
    if (capture === null || capture.id !== input.captureId) return { error: 'The capture is no longer held – pick the element again' }
    const terminals = this.deps.terminals?.() ?? null
    const verdict = terminals === null ? ({ kind: 'noTerminal' } as const) : await targetStatusAtSend(terminals, ownerWebContentsId, input.terminalId)
    const guard = guardOf(verdict, input.sendAnyway === true)
    if (guard !== null) return { guard }
    // The read may wait for a Windows process snapshot; the capture may have gone meanwhile.
    if (pick.capture !== capture) return { error: 'The capture is no longer held – pick the element again' }
    if (capture.writing !== null) return (await capture.writing) as WriteCaptureResponse
    const startedAt = this.deps.clock.now()
    const writing = this.write(tab, pick, input.captureId)
    capture.writing = writing
    try {
      return await writing
    } finally {
      capture.writing = null
      this.bench.record('send', this.deps.clock.now() - startedAt)
    }
  }

  /** `browser-tab:discardCaptureFiles`: delete the files of the capture's last send; the capture stays held. */
  async discardCaptureFiles(tab: BrowserTab, pick: BrowserTabPick, captureId: string): Promise<boolean> {
    const capture = pick.capture
    if (capture === null || capture.id !== captureId) return false
    const names = capture.written
    capture.written = []
    await this.store.remove(tab.projectRoot, names)
    return true
  }

  private async write(tab: BrowserTab, pick: BrowserTabPick, captureId: string): Promise<WriteCaptureResponse> {
    const capture = pick.capture
    if (capture === null) return { error: 'The capture is no longer held – pick the element again' }
    let names: string[] = []
    try {
      const element = await withTimeout(this.deps.clock, capture.element(), SEND_READ_TIMEOUT_MS)
      const rendered = renderCapture(capture.moment, element, {
        randomId: randomBytes(4).toString('hex'),
        token: fenceToken(new Uint8Array(randomBytes(16))),
        outline: outlineColour(),
        encodePng: this.deps.encodePng
      })
      names = [rendered.context.name, rendered.screenshot.name, rendered.crop.name]
      const [context, screenshot, crop] = await this.store.write(tab.projectRoot, [
        { name: rendered.context.name, data: rendered.context.text },
        { name: rendered.screenshot.name, data: rendered.screenshot.png },
        { name: rendered.crop.name, data: rendered.crop.png }
      ])
      if (pick.capture?.id !== captureId) {
        // The tab, the project or the pick went while the files were written (025-FR-053).
        await this.store.remove(tab.projectRoot, names)
        return { error: 'The pick ended before the capture was saved' }
      }
      capture.written = names
      return { paths: { context, screenshot, crop } }
    } catch (error) {
      if (error instanceof CaptureWriteError) return { error: `The capture could not be saved: ${error.message}` }
      logger.warn('Browser capture could not be rendered', { error: error instanceof Error ? error.name : 'other' })
      await this.store.remove(tab.projectRoot, names)
      return { error: 'The capture could not be saved' }
    }
  }
}

function withTimeout<T>(clock: Clock, work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = clock.setTimeout(() => reject(new Error('timed out')), ms)
    work.then(
      (value) => {
        clock.clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clock.clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    )
  })
}
