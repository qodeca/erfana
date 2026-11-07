// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Benchmark: pick highlight latency (spec 025, 025-AC-049, 025-NFR-004).
 *
 * Not a test of behaviour: it asserts only that each run was valid and records
 * numbers. Excluded from the normal e2e run; it runs through the env-gated
 * `bench` project:
 *
 * ```sh
 * npm run build:e2e
 * ERFANA_E2E_BENCH=1 npx playwright test --project=bench e2e/browser-pick-highlight.bench.ts
 * ```
 *
 * Method (025-NFR-004): pick mode on the React sample app; 20 warm-up mouse
 * moves, then 200 measured ones, each to the centre of a different element so
 * every move crosses an element boundary. Pointer input goes through main-side
 * `sendInputEvent` (S-27), as in the e2e lanes. The live outline is Erfana's
 * band (`pickBand.ts`, ADR 0007 decision 6 as amended 2026-11-05): strips on
 * a click-through child window over the page, drawn by the browser process's
 * own compositor for that window, not by the page. One Chromium performance
 * trace covers the whole run; per move it reads:
 *
 * - **start** – the input event's own timestamp
 *   (`InputLatency::MouseMove`, `COMPONENT_INPUT_EVENT_LATENCY_ORIGINAL`);
 * - **the band drawn** – main's `process.hrtime` (the trace's clock, see
 *   `utils/chrome-trace.ts`) taken right after the band set its strips'
 *   bounds and visibility for this move's element (the pick test hook's
 *   `bandDraws`, test builds only);
 * - **end** – the presentation time of the band window's first frame that
 *   committed that change (`PipelineReporter` of that window's compositor in
 *   the browser process, see `utils/chrome-trace.ts`): when the new outline
 *   was on screen. Setting the strips' bounds only marks the window's layers
 *   dirty; the user sees them one compositor frame later, at that frame's
 *   presentation, which is measured here rather than assumed.
 *
 * The band window's compositor is the browser-process compositor that commits
 * first after the band draws: the compositor and the draw share the browser's
 * main thread, so no commit can fall between the strips being set and the
 * mark. It is found once per run, by majority over every draw, and recorded.
 *
 * Pacing is condition-based: the next move goes out once main has drawn the
 * band at this move's element and the page has then run
 * {@link SETTLE_FRAMES} animation frames (about 50 ms at 60 Hz, past the
 * band frame's own presentation). The page's frames are not in the measured
 * path: the band is drawn by another compositor. A move whose band was
 * replaced by the next one before a frame showed it counts as a miss (an
 * infinite latency), never as a skipped sample, so loose pacing can only
 * make the result worse.
 *
 * Raw results go to `$ERFANA_BENCH_OUT` (default `.local/bench/`).
 *
 * @see docs/performance/browser-025-highlight.md
 */
import type { ElectronApplication, Page } from '@playwright/test'
import { test, expect } from './fixtures/browserHarness'
import { PickFlow, PICK_WAIT_MS } from './pages/browser-pick-flow.page'
import type { Box } from './pages/browser-pick.page'
import { displayedAfter, inputEventTimes, rendererFrames, startTrace, type FrameRecord, type TraceEvent } from './utils/chrome-trace'
import { machine, summarise, writeBenchRecord } from './utils/bench-stats'

const WARM_UP_MOVES = 20
const MEASURED_MOVES = 200
/** 025-NFR-004: the 95th percentile is at most this. */
const TARGET_P95_MS = 50
/** Page animation frames the next move waits for once the band was drawn. */
const SETTLE_FRAMES = 3
/** How long the page may take to run those frames before pacing gives up on that move. */
const SETTLE_WAIT_MS = 3_000
const LABEL = process.env.ERFANA_BENCH_LABEL ?? 'run'

/** Elements of the React home page worth hovering; the hover menu is left out (hovering it changes the layout). */
const TARGET_SELECTORS = [
  '.brand', '.status-card-title', '.status-card-value', '.status-card-action', '.item-name', '.item-price', '.save-button',
  '.save-label', 'h1', 'h2', 'label', 'input', 'p'
]

interface Target {
  selector: string
  index: number
  box: Box
  x: number
  y: number
}

/** One band draw as the pick test hook's `bandDraws` gives it. */
interface BandDraw {
  atUs: number
  box: Box
  strips: number
}

interface MoveRecord {
  move: number
  warmUp: boolean
  target: string
  box: Box
  sentFrom: number
  sentTo: number
  paced: boolean
}

interface Sample {
  move: number
  target: string
  inputAt: number | null
  drawAt: number | null
  commitAt: number | null
  presentedAt: number | null
  frame: number | null
  inputToDrawMs: number | null
  latencyMs: number | null
  miss: string | null
}

/** The band outlines `box` (the hook's box is the node's border box, CSS px). */
function sameBox(a: Box, b: Box): boolean {
  return Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1 && Math.abs(a.width - b.width) <= 1 && Math.abs(a.height - b.height) <= 1
}

/** Visible elements whose centre hits the element itself, read once from the page. */
async function readTargets(pwPage: Page): Promise<Target[]> {
  return pwPage.evaluate((selectors) => {
    const found: Array<{ selector: string; index: number; box: { x: number; y: number; width: number; height: number }; x: number; y: number }> = []
    const taken = new Set<Element>()
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((el, index) => {
        if (el.closest('.app-nav') !== null || taken.has(el)) return
        const r = el.getBoundingClientRect()
        const x = Math.round(r.x + r.width / 2)
        const y = Math.round(r.y + r.height / 2)
        if (r.width < 4 || r.height < 4 || x <= 0 || y <= 0 || x >= innerWidth || y >= innerHeight) return
        if (document.elementFromPoint(x, y) !== el) return
        taken.add(el)
        found.push({ selector, index, box: { x: r.x, y: r.y, width: r.width, height: r.height }, x, y })
      })
    }
    return found
  }, TARGET_SELECTORS)
}

/** Resolve true once the page ran `count` animation frames, false after `timeoutMs`. No polling. */
async function waitForFrames(pwPage: Page, count: number, timeoutMs: number): Promise<boolean> {
  return pwPage.evaluate(
    ([frames, limit]) =>
      new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), limit)
        let left = frames
        const tick = (): void => {
          left -= 1
          if (left > 0) return void requestAnimationFrame(tick)
          clearTimeout(timer)
          resolve(true)
        }
        requestAnimationFrame(tick)
      }),
    [count, timeoutMs] as const
  )
}

/* eslint-disable @typescript-eslint/no-explicit-any -- the hooks live on main's globalThis, untyped there */
async function recordBandDraws(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => (globalThis as any).__erfanaTestHooks.pick.recordBandDraws())
}

async function bandDraws(app: ElectronApplication, tabId: string): Promise<BandDraw[]> {
  return app.evaluate((_e, id) => (globalThis as any).__erfanaTestHooks.pick.bandDraws(id) as BandDraw[], tabId)
}

async function lastBandDraw(app: ElectronApplication, tabId: string): Promise<BandDraw | null> {
  return app.evaluate((_e, id) => ((globalThis as any).__erfanaTestHooks.pick.bandDraws(id) as BandDraw[]).at(-1) ?? null, tabId)
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** The first frame of `frames` that committed at or after `at` (µs), whatever its compositor. */
function firstCommitAfter(frames: readonly FrameRecord[], at: number): FrameRecord | null {
  let first: FrameRecord | null = null
  for (const f of frames) {
    if (f.commitAt === null || f.commitAt < at) continue
    if (first === null || f.commitAt < first.commitAt!) first = f
  }
  return first
}

/**
 * The band window's compositor: the browser-process compositor that commits
 * first after most band draws. Throws when no draw is followed by a commit.
 */
function bandCompositor(frames: readonly FrameRecord[], draws: readonly BandDraw[]): { layerTreeHostId: number; votes: number; draws: number } {
  const votes = new Map<number, number>()
  for (const d of draws) {
    const id = firstCommitAfter(frames, d.atUs)?.layerTreeHostId
    if (id !== null && id !== undefined) votes.set(id, (votes.get(id) ?? 0) + 1)
  }
  const [best] = [...votes.entries()].sort((a, b) => b[1] - a[1])
  if (best === undefined) throw new Error('No browser-process compositor committed after any band draw: the trace has no band frames')
  return { layerTreeHostId: best[0], votes: best[1], draws: draws.length }
}

/** Per move: input time → band drawn at the element → the band window's displayed frame. */
function analyse(frames: readonly FrameRecord[], events: readonly TraceEvent[], moves: readonly MoveRecord[], draws: readonly BandDraw[]): Sample[] {
  return moves.map((m, i) => {
    const sample: Sample = { move: m.move, target: m.target, inputAt: null, drawAt: null, commitAt: null, presentedAt: null, frame: null, inputToDrawMs: null, latencyMs: null, miss: null }
    const nextSent = moves[i + 1]?.sentFrom ?? Number.POSITIVE_INFINITY
    const inputAt = inputEventTimes(events, m.sentFrom, m.sentTo, 'MouseMove')[0] ?? null
    if (inputAt === null) return { ...sample, miss: 'no input event in the trace' }
    sample.inputAt = inputAt
    const drawIndex = draws.findIndex((d) => d.atUs >= inputAt && d.atUs < nextSent && d.strips > 0 && sameBox(d.box, m.box))
    if (drawIndex < 0) return { ...sample, miss: 'no band draw at the element before the next move' }
    const drawAt = draws[drawIndex].atUs
    sample.drawAt = drawAt
    sample.inputToDrawMs = (drawAt - inputAt) / 1000
    const committed = firstCommitAfter(frames, drawAt)
    const shown = displayedAfter(frames, drawAt)
    if (committed === null || shown === null) return { ...sample, miss: 'no presented band frame after the draw' }
    sample.commitAt = committed.commitAt
    // Drawn again at the same element (the page view placed again) changes nothing on screen; at another one it does.
    const replacedAt = draws.slice(drawIndex + 1).find((d) => !sameBox(d.box, m.box))?.atUs ?? Number.POSITIVE_INFINITY
    if (replacedAt < committed.commitAt!) return { ...sample, miss: 'band moved on before a frame showed it' }
    sample.presentedAt = shown.presentedAt
    sample.frame = shown.sequence
    sample.latencyMs = (shown.presentedAt - inputAt) / 1000
    return sample
  })
}

test('025-NFR-004 bench: pick highlight latency on the React app', async ({ appWithTestProject: app, windowWithTestProject: window, browserServers }) => {
  test.setTimeout(600_000)
  const flow = await PickFlow.open(app, window)
  const url = browserServers.sites.react18.url('/')
  await flow.load(url)
  let pwPage: Page | undefined
  await expect.poll(() => (pwPage = app.context().pages().find((p) => p.url() === url)) !== undefined, { timeout: PICK_WAIT_MS }).toBe(true)
  const cdp = await app.context().newCDPSession(pwPage!)
  const tabId = await flow.tabId()
  const { webContentsId } = await flow.panel.hookTab()
  const env = await app.evaluate(({ app: electronApp, screen, webContents }, id) => ({
    browserPid: process.pid,
    tabPid: webContents.fromId(id)!.getOSProcessId(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    gpu: electronApp.getGPUFeatureStatus(),
    display: { scaleFactor: screen.getPrimaryDisplay().scaleFactor, size: screen.getPrimaryDisplay().size, hz: screen.getPrimaryDisplay().displayFrequency }
  }), webContentsId)

  await flow.pickButton.click()
  await flow.waitForActive(true)
  const targets = await readTargets(pwPage!)
  expect(targets.length, 'distinct hover targets on the page').toBeGreaterThanOrEqual(8)
  const viewport = await pwPage!.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }))

  await recordBandDraws(app)
  const trace = await startTrace(cdp)
  const moves: MoveRecord[] = []
  for (let move = 0; move < WARM_UP_MOVES + MEASURED_MOVES; move++) {
    const target = targets[move % targets.length]
    const [sentFrom, sentTo] = await app.evaluate((_e, [id, x, y]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the hooks live on main's globalThis, untyped there
      const hooks = (globalThis as any).__erfanaTestHooks
      const from = Number(process.hrtime.bigint() / 1000n)
      hooks.browser.move(id, x, y)
      return [from, Number(process.hrtime.bigint() / 1000n)]
    }, [tabId, target.x, target.y] as const)
    // Main drew Erfana's band at this element (not the engine's fallback outline).
    await expect
      .poll(async () => {
        const last = await lastBandDraw(app, tabId)
        return last !== null && last.atUs >= sentFrom && last.strips > 0 && sameBox(last.box, target.box)
      }, { timeout: PICK_WAIT_MS, message: `band drawn at ${target.selector}[${target.index}]` })
      .toBe(true)
    const paced = await waitForFrames(pwPage!, SETTLE_FRAMES, SETTLE_WAIT_MS)
    moves.push({ move, warmUp: move < WARM_UP_MOVES, target: `${target.selector}[${target.index}]`, box: target.box, sentFrom, sentTo, paced })
  }
  const events = await trace.stop()
  const draws = await bandDraws(app, tabId)

  const browserFrames = rendererFrames(events, env.browserPid)
  const compositor = bandCompositor(browserFrames, draws)
  const bandFrames = browserFrames.filter((f) => f.layerTreeHostId === compositor.layerTreeHostId)
  const samples = analyse(bandFrames, events, moves, draws).filter((s) => s.move >= WARM_UP_MOVES)
  const latencies = samples.map((s) => (s.latencyMs === null ? Number.POSITIVE_INFINITY : s.latencyMs))
  const drawn = samples.filter((s) => s.latencyMs !== null)
  const summary = {
    label: LABEL,
    date: new Date().toISOString(),
    measured: samples.length,
    warmUp: WARM_UP_MOVES,
    misses: samples.filter((s) => s.miss !== null).length,
    unpaced: moves.filter((m) => !m.paced && !m.warmUp).length,
    latencyMs: summarise(latencies),
    inputToDrawMs: summarise(drawn.map((s) => s.inputToDrawMs!)),
    drawToPresentedMs: summarise(drawn.map((s) => (s.presentedAt! - s.drawAt!) / 1000)),
    targetP95Ms: TARGET_P95_MS,
    pass: summarise(latencies).p95 <= TARGET_P95_MS
  }
  await writeBenchRecord(`browser-025-highlight-${LABEL}`, {
    summary,
    environment: { ...env, viewport, machine: machine(), targets: targets.length, bandCompositor: compositor },
    samples
  })
  // The run is valid when every measured move was found in the trace; the result is a number, not a pass/fail of the test.
  expect(samples.filter((s) => s.miss === 'no input event in the trace' || s.miss === 'no presented band frame after the draw')).toEqual([])
})
