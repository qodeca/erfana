// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The pick-and-send test hooks of the built-in browser (spec 025 commits
 * 14–15, solution design § 12 T3, T14): `globalThis.__erfanaTestHooks.pick`,
 * reached by e2e tests through `app.evaluate`. Test builds only – reached
 * through `./index`. ERFANA_BROWSER_TEST_HOOK_SENTINEL
 *
 * - **Reads**: the node and box of the highlight Erfana asked for, with its
 *   exact label (S-1: tests assert this, not the engine's paint); the targets
 *   a tab's CDP session holds (T14); the pick state and the held capture.
 * - **Faults**: an empty or failed screenshot, a slow or throwing hint
 *   lookup, a failed capture write (025-AC-034, 025-AC-037, 025-AC-060).
 * - **Test colours** (025-AC-034): the live pick outline's ink and paper in
 *   unique colours; what Erfana's band draws now (surface bounds, strips and
 *   their colours) – the positive control that the band is up in those
 *   colours – and the page as `capturePage` gives it, so a test shows the
 *   band is absent from the page's own image even while it is drawn.
 * - **Expiry**: run the 025-FR-039 sweep now, on the test clock.
 * - **Bench** (025-AC-049, 025-AC-050): the stage timings, and when each
 *   draw of Erfana's band placed its strips, on `process.hrtime` (the
 *   clock of Chromium's trace) – the hover bench's end mark.
 *
 * Never touches a `webContents`' debugger (only `cdp/` may).
 */
import { mainClock } from '../utils/mainClock'
import type { BrowserRuntime } from '../services/browser/browserAppSetup'
import type { PickSummary } from '../services/browser/capture/BrowserCapture'
import type { BrowserTabPick } from '../services/browser/pick/BrowserTabPick'
import type { BandState } from '../services/browser/pick/pickBand'
import type { BenchStage, FaultPair } from '../services/browser/pick/pickSupport'
import type { Box } from '../services/browser/pick/pickGeometry'

export interface HookHighlight {
  readonly label: string
  readonly box: Box | null
  readonly sessionKey: string
  readonly backendNodeId: number
  readonly frameId: string
}

/** One draw of Erfana's band, as {@link BrowserPickTestHook.bandDraws} gives it. */
export interface HookBandDraw {
  /** Main's `process.hrtime` in µs, taken right after the strips' bounds and visibility were set. */
  readonly atUs: number
  /** The box outlined: the element's border box in the top-level viewport, CSS px. */
  readonly box: Box
  /** How many strips were placed (at most `BAND_STRIP_COUNT`). */
  readonly strips: number
}

/** Band draws kept per recording; the oldest go first. */
export const BAND_DRAW_RECORDS = 2_000

export interface HookPickState {
  readonly active: boolean
  readonly frozen: boolean
  readonly capture: {
    readonly id: string
    readonly index: number
    readonly firstIndex: number
    readonly summary: PickSummary
    readonly afterNavigation: boolean
    readonly written: readonly string[]
    readonly pickPoint: { x: number; y: number }
  } | null
}

export interface BrowserPickTestHook {
  /** What the live highlight shows now (node, top-level box, exact label), or null. */
  highlight(tabId: string): HookHighlight | null
  /** The targets the tab's CDP session holds: session key, target id, type, URL. */
  attachedTargets(tabId: string): Array<{ sessionKey: string; targetId: string; type: string; url: string }>
  state(tabId: string): HookPickState
  /** The next `count` screenshots come back empty. */
  armEmptyCaptures(count: number): void
  /** The next `count` screenshots fail. */
  armCaptureFailures(count: number): void
  /** The React lookup takes `ms` on the main clock's timers, or throws. */
  armHints(options: { delayMs?: number; throws?: boolean }): void
  /** The next `count` capture writes fail. */
  armWriteFailures(count: number): void
  resetFaults(): void
  /**
   * Draw the live pick outline's ink and paper in test colours (0–255
   * channels, alpha 0–1), or in the product colours again with `null`;
   * `resetFaults` clears them too.
   */
  setHighlightColours(pair: FaultPair | null): void
  /** What Erfana's band draws for the tab now, or null (nothing shows, or the engine draws the outline). */
  band(tabId: string): BandState | null
  /**
   * The tab's page as `capturePage` gives it now, as a base64 PNG. The
   * engine's fallback outline shows in such an image (commit-8 probe); the
   * band never does, which a test checks while the band is drawn.
   */
  pagePng(tabId: string): Promise<string>
  /** Run the expiry sweep of `projectRoot` now; resolves the names deleted. */
  expire(projectRoot: string): Promise<string[]>
  bench(stage: BenchStage): number[]
  clearBench(): void
  /**
   * Record every draw of Erfana's band from now on, of every tab, and forget
   * the draws recorded before (025-AC-049 bench).
   */
  recordBandDraws(): void
  /** The band draws of tab `tabId` recorded since {@link recordBandDraws}, oldest first. */
  bandDraws(tabId: string): HookBandDraw[]
}

/** Main's monotonic clock in µs: the clock Chromium's trace timestamps are on (`e2e/utils/chrome-trace.ts`). */
function hrtimeUs(): number {
  return Number(process.hrtime.bigint() / 1000n)
}

function requireRuntime(getRuntime: () => BrowserRuntime | null): BrowserRuntime {
  const runtime = getRuntime()
  if (runtime === null) throw new Error('The browser runtime is not installed')
  return runtime
}

/**
 * Build the pick hook over the runtime `getRuntime` returns at call time;
 * `nowUs` stamps the band draws (tests pass their own).
 */
export function createBrowserPickTestHook(getRuntime: () => BrowserRuntime | null, nowUs: () => number = hrtimeUs): BrowserPickTestHook {
  const pickOf = (tabId: string): BrowserTabPick => {
    const runtime = requireRuntime(getRuntime)
    const tab = runtime.tabs.list().find((t) => t.id === tabId)
    if (tab === undefined) throw new Error(`No browser tab ${tabId}`)
    const pick = runtime.picks.forTab(tab)
    if (pick === null) throw new Error(`Browser tab ${tabId} has no pick pipeline`)
    return pick
  }
  const faults = () => requireRuntime(getRuntime).picks.faults
  const bandDraws: Array<HookBandDraw & { readonly tabId: string }> = []

  return {
    highlight: (tabId) => {
      const record = pickOf(tabId).highlight.record
      if (record === null) return null
      return { label: record.label, box: record.box, ...record.node }
    },
    attachedTargets: (tabId) => pickOf(tabId).attachedTargets().map((t) => ({ ...t })),
    state: (tabId) => {
      const pick = pickOf(tabId)
      const capture = pick.capture
      return {
        active: pick.isActive,
        frozen: pick.isFrozen,
        capture:
          capture === null
            ? null
            : {
                id: capture.id,
                index: capture.index,
                firstIndex: capture.firstIndex,
                summary: capture.summary(),
                afterNavigation: capture.afterNavigation,
                written: [...capture.written],
                pickPoint: { ...capture.moment.pickPoint }
              }
      }
    },
    armEmptyCaptures: (count) => faults().armEmptyCaptures(count),
    armCaptureFailures: (count) => faults().armCaptureFailures(count),
    armHints: ({ delayMs, throws }) => {
      const until =
        delayMs === undefined ? undefined : new Promise<void>((resolve) => mainClock.setTimeout(resolve, delayMs))
      faults().armHints({ until, throws })
    },
    armWriteFailures: (count) => faults().armWriteFailures(count),
    resetFaults: () => faults().reset(),
    setHighlightColours: (pair) => faults().setHighlightColours(pair),
    band: (tabId) => {
      const state = pickOf(tabId).highlight.band
      return state === null ? null : { bounds: { ...state.bounds }, strips: state.strips.map((s) => ({ tone: s.tone, rect: { ...s.rect } })), colours: { ...state.colours } }
    },
    pagePng: async (tabId) => {
      const runtime = requireRuntime(getRuntime)
      const tab = runtime.tabs.list().find((t) => t.id === tabId)
      if (tab === undefined) throw new Error(`No browser tab ${tabId}`)
      return (await tab.contents.capturePage()).toPNG().toString('base64')
    },
    expire: (projectRoot) => requireRuntime(getRuntime).picks.store.expire(projectRoot, new Date(mainClock.now())),
    bench: (stage) => [...requireRuntime(getRuntime).picks.bench.read(stage)],
    clearBench: () => requireRuntime(getRuntime).picks.bench.clear(),
    recordBandDraws: () => {
      bandDraws.length = 0
      requireRuntime(getRuntime).picks.bandDrawn = (tabId, box, state) => {
        // Stamped first: the strips were placed just before this call.
        const atUs = nowUs()
        bandDraws.push({ tabId, atUs, box: { ...box }, strips: state.strips.length })
        if (bandDraws.length > BAND_DRAW_RECORDS) bandDraws.shift()
      }
    },
    bandDraws: (tabId) => bandDraws.filter((d) => d.tabId === tabId).map(({ atUs, box, strips }) => ({ atUs, box: { ...box }, strips }))
  }
}
