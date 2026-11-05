// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A {@link BrowserTabPick} over the sample page, a fake page `webContents`
 * and the real routing reducer – effects delivered as `BrowserTabInput`
 * delivers them (`pickMode` to `setMode`, the rest to `onEffect`).
 */
import { EventEmitter } from 'node:events'
import { createManualClock, type TestClock } from '../../../../../shared/clock'
import { INITIAL_ROUTING_STATE, reduceRouting, type RoutingEvent, type RoutingState } from '../../../../../shared/browser/routingState'
import type { PickEvent } from '../../../../../shared/ipc/browser-tab-schema'
import { BrowserTabPick, type PickContents, type PickRouting } from '../BrowserTabPick'
import type { OutlineBand } from '../pickBand'
import { PickBench, PickFaults } from '../pickSupport'
import type { FakePage } from './fakePage'
import { samplePage } from './samplePage'

export class FakePickContents extends EventEmitter implements PickContents {
  destroyed = false
  muted = false
  zoom = 1
  url = 'https://app.test/'
  title = 'App'
  /** An opaque 800 × 600 image at scale 2 unless replaced. */
  image = { width: 800, height: 600, scale: 2, alpha: 255 }
  /** The fixed scripts run in an isolated world, in order. */
  readonly scripts: Array<{ worldId: number; code: string }> = []
  /** How many screenshots were taken. */
  captures = 0
  /** How the page answers a frame wait: drawn at once, never (a busy main thread), or with an error (the page went). */
  paint: 'drawn' | 'never' | 'fails' = 'drawn'
  /** Called as a fixed script starts, before it answers (a test reads what had happened by then). */
  onScript: (() => void) | null = null
  readonly css: string[] = []
  readonly removedCss: string[] = []

  isDestroyed(): boolean {
    return this.destroyed
  }
  isAudioMuted(): boolean {
    return this.muted
  }
  setAudioMuted(m: boolean): void {
    this.muted = m
  }
  executeJavaScriptInIsolatedWorld(worldId: number, scripts: Array<{ code: string }>): Promise<unknown> {
    for (const script of scripts) this.scripts.push({ worldId, code: script.code })
    this.onScript?.()
    if (this.paint === 'never') return new Promise(() => undefined)
    return this.paint === 'fails' ? Promise.reject(new Error('Script failed to execute')) : Promise.resolve(0)
  }
  async capturePage() {
    this.captures++
    const { width, height, scale, alpha } = this.image
    const data = Buffer.alloc(width * scale * height * scale * 4, 255)
    if (alpha !== 255) for (let i = 3; i < data.length; i += 4) data[i] = alpha
    return { toBitmap: () => data, getSize: () => ({ width, height }) }
  }
  getZoomFactor(): number {
    return this.zoom
  }
  getURL(): string {
    return this.url
  }
  getTitle(): string {
    return this.title
  }
  async insertCSS(css: string): Promise<string> {
    this.css.push(css)
    return `css-${this.css.length}`
  }
  async removeInsertedCSS(key: string): Promise<void> {
    this.removedCss.push(key)
  }
  /** A mouse report as `before-mouse-event` gives it (main-side input: globals 0, 0). */
  mouse(type: string, x: number, y: number, button = 'left'): void {
    this.emit('before-mouse-event', {}, { type, x, y, globalX: 0, globalY: 0, button })
  }
}

export interface PickHarness {
  readonly page: FakePage
  readonly contents: FakePickContents
  readonly pick: BrowserTabPick
  readonly events: PickEvent[]
  readonly clock: TestClock
  readonly faults: PickFaults
  readonly bench: PickBench
  readonly routing: PickRouting & { dispatched: RoutingEvent[] }
  state(): RoutingState
}

export function pickHarness(
  options: { projectRoot?: string | null; crossSite?: boolean; viewSize?: { width: number; height: number } | null; band?: OutlineBand } = {}
): PickHarness {
  const contents = new FakePickContents()
  const events: PickEvent[] = []
  const clock = createManualClock(Date.UTC(2026, 10, 2, 21, 5, 9))
  const faults = new PickFaults()
  const bench = new PickBench()
  let state: RoutingState = { ...INITIAL_ROUTING_STATE, pageLoaded: true, focus: 'page' }
  let pick: BrowserTabPick | undefined
  const routing: PickHarness['routing'] = {
    dispatched: [],
    state: () => state,
    dispatch(event) {
      this.dispatched.push(event)
      const { state: next, effects } = reduceRouting(state, event)
      state = next
      for (const effect of effects) {
        if (effect.type === 'pickMode') pick?.setMode(effect.on)
        else pick?.onEffect(effect)
      }
      return effects
    }
  }
  const page = samplePage({
    crossSite: options.crossSite,
    beforeFrames: (p) => {
      pick = new BrowserTabPick({
        tabId: 'tab-1',
        contents,
        cdp: p.cdp,
        routing,
        viewOrigin: () => ({ x: 0, y: 0 }),
        widthPreset: () => ({ kind: 'preset', name: 'Full width' }),
        projectRoot: () => options.projectRoot ?? null,
        clock,
        viewSize: options.viewSize === undefined ? undefined : () => options.viewSize ?? null,
        events: { pick: (e) => events.push(e) },
        faults,
        bench,
        band: options.band
      })
    }
  })
  return { page, contents, pick: pick!, events, clock, faults, bench, routing, state: () => state }
}

/** Let every pending promise and microtask settle. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r))
}
