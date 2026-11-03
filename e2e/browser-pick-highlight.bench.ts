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
 * `sendInputEvent` (S-27), as in the e2e lanes. One Chromium performance trace
 * covers the whole run; per move it reads:
 *
 * - **start** – the input event's own timestamp
 *   (`InputLatency::MouseMove`, `COMPONENT_INPUT_EVENT_LATENCY_ORIGINAL`);
 * - **the outline** – the first `Overlay.highlightQuad` Erfana sent after it,
 *   and the engine overlay's first paint after that command;
 * - **end** – the presentation time of the first frame that committed that
 *   paint (`PipelineReporter`, see `utils/chrome-trace.ts`).
 *
 * Pacing is condition-based and does not touch rendering: the next move goes
 * out once main reports the new element and the page's Event Timing observer
 * has seen the `pointerover` entry of this move, which the engine delivers only
 * after the frame following the move was presented. A move whose outline was
 * replaced by the next one before any frame showed it counts as a miss (an
 * infinite latency), never as a skipped sample.
 *
 * Raw results go to `$ERFANA_BENCH_OUT` (default `.local/bench/`).
 *
 * @see docs/performance/browser-025-highlight.md
 */
import type { Page } from '@playwright/test'
import { test, expect } from './fixtures/browserHarness'
import { PickFlow, PICK_WAIT_MS } from './pages/browser-pick-flow.page'
import type { Box } from './pages/browser-pick.page'
import { rendererFrames, displayedAfter, inputEventTimes, rendererMainThread, startTrace, type TraceEvent } from './utils/chrome-trace'
import { machine, summarise, writeBenchRecord } from './utils/bench-stats'

const WARM_UP_MOVES = 20
const MEASURED_MOVES = 200
/** 025-NFR-004: the 95th percentile is at most this. */
const TARGET_P95_MS = 50
/** How long the page may take to report the frame after a move before pacing gives up on that move. */
const PRESENTED_WAIT_MS = 3_000
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

interface MoveRecord {
  move: number
  warmUp: boolean
  target: string
  sentFrom: number
  sentTo: number
  paced: boolean
}

interface Sample {
  move: number
  target: string
  inputAt: number | null
  commandAt: number | null
  paintAt: number | null
  presentedAt: number | null
  frame: number | null
  latencyMs: number | null
  miss: string | null
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

/** Count the page's `pointerover` Event Timing entries (reported after the next presented frame). */
async function installPresentedCounter(pwPage: Page): Promise<void> {
  await pwPage.evaluate(() => {
    const w = window as unknown as { __benchOver?: { count: number; waiters: Array<() => void> } }
    const state = { count: 0, waiters: [] as Array<() => void> }
    w.__benchOver = state
    new PerformanceObserver((list) => {
      state.count += list.getEntries().filter((e) => e.name === 'pointerover').length
      for (const wake of state.waiters.splice(0)) wake()
    }).observe({ type: 'event', durationThreshold: 16 } as PerformanceObserverInit)
  })
}

/** Resolve true once the page counted more than `seen` entries, false after `timeoutMs`. No polling. */
async function waitForPresented(pwPage: Page, seen: number, timeoutMs: number): Promise<boolean> {
  return pwPage.evaluate(
    ([before, limit]) =>
      new Promise<boolean>((resolve) => {
        const state = (window as unknown as { __benchOver: { count: number; waiters: Array<() => void> } }).__benchOver
        if (state.count > before) return resolve(true)
        const timer = setTimeout(() => resolve(false), limit)
        state.waiters.push(() => {
          if (state.count > before) {
            clearTimeout(timer)
            resolve(true)
          }
        })
      }),
    [seen, timeoutMs] as const
  )
}

async function presentedCount(pwPage: Page): Promise<number> {
  return pwPage.evaluate(() => (window as unknown as { __benchOver: { count: number } }).__benchOver.count)
}

/** Per move: input time → highlightQuad → overlay paint → displayed frame. */
function analyse(events: readonly TraceEvent[], moves: readonly MoveRecord[], tabPid: number, pageFrame: string): Sample[] {
  const mainTid = rendererMainThread(events, tabPid)
  if (mainTid === null) throw new Error(`The trace has no main thread for the tab renderer ${tabPid}`)
  const frames = rendererFrames(events, tabPid)
  const quads = events
    .filter((e) => e.name === 'DevToolsSession::HandleCommand in Browser' && e.ph === 'X' && (e.args as { method?: string })?.method === 'Overlay.highlightQuad')
    .map((e) => e.ts)
    .sort((a, b) => a - b)
  const overlayPaints = events
    .filter((e) => {
      if (e.pid !== tabPid || e.tid !== mainTid || e.name !== 'Paint') return false
      const data = (e.args as { data?: { frame?: string; nodeName?: string } })?.data
      return data?.frame !== pageFrame && (data?.nodeName ?? '').startsWith('CANVAS')
    })
    .map((e) => e.ts)
    .sort((a, b) => a - b)

  return moves.map((m, i) => {
    const sample: Sample = { move: m.move, target: m.target, inputAt: null, commandAt: null, paintAt: null, presentedAt: null, frame: null, latencyMs: null, miss: null }
    const nextSent = moves[i + 1]?.sentFrom ?? Number.POSITIVE_INFINITY
    sample.inputAt = inputEventTimes(events, m.sentFrom, m.sentTo, 'MouseMove')[0] ?? null
    if (sample.inputAt === null) return { ...sample, miss: 'no input event in the trace' }
    sample.commandAt = quads.find((t) => t >= sample.inputAt! && t < nextSent) ?? null
    if (sample.commandAt === null) return { ...sample, miss: 'no highlightQuad before the next move' }
    const nextCommand = quads.find((t) => t > sample.commandAt!) ?? Number.POSITIVE_INFINITY
    sample.paintAt = overlayPaints.find((t) => t > sample.commandAt!) ?? null
    if (sample.paintAt === null || sample.paintAt > nextCommand) return { ...sample, miss: 'outline replaced before it was painted' }
    const shown = displayedAfter(frames, sample.paintAt)
    if (shown === null) return { ...sample, miss: 'no presented frame after the paint' }
    sample.presentedAt = shown.presentedAt
    sample.frame = shown.sequence
    sample.latencyMs = (shown.presentedAt - sample.inputAt) / 1000
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
  const pageFrame = ((await cdp.send('Page.getFrameTree')) as { frameTree: { frame: { id: string } } }).frameTree.frame.id
  const tabId = await flow.tabId()
  const { webContentsId } = await flow.panel.hookTab()
  const env = await app.evaluate(({ app: electronApp, screen, webContents }, id) => ({
    tabPid: webContents.fromId(id)!.getOSProcessId(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    gpu: electronApp.getGPUFeatureStatus(),
    display: { scaleFactor: screen.getPrimaryDisplay().scaleFactor, size: screen.getPrimaryDisplay().size }
  }), webContentsId)

  await flow.pickButton.click()
  await flow.waitForActive(true)
  const driver = await flow.driver()
  const targets = await readTargets(pwPage!)
  expect(targets.length, 'distinct hover targets on the page').toBeGreaterThanOrEqual(8)
  await installPresentedCounter(pwPage!)
  const viewport = await pwPage!.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }))

  const trace = await startTrace(cdp)
  const moves: MoveRecord[] = []
  for (let move = 0; move < WARM_UP_MOVES + MEASURED_MOVES; move++) {
    const target = targets[move % targets.length]
    const seen = await presentedCount(pwPage!)
    const [sentFrom, sentTo] = await app.evaluate((_e, [id, x, y]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the hooks live on main's globalThis, untyped there
      const hooks = (globalThis as any).__erfanaTestHooks
      const from = Number(process.hrtime.bigint() / 1000n)
      hooks.browser.move(id, x, y)
      return [from, Number(process.hrtime.bigint() / 1000n)]
    }, [tabId, target.x, target.y] as const)
    // Main outlined this element (the hook's box is the node's border box).
    await expect
      .poll(async () => {
        const box = (await driver.highlight())?.box
        return box !== null && box !== undefined && Math.abs(box.x - target.box.x) <= 1 && Math.abs(box.y - target.box.y) <= 1 && Math.abs(box.width - target.box.width) <= 1
      }, { timeout: PICK_WAIT_MS, message: `highlight on ${target.selector}[${target.index}]` })
      .toBe(true)
    const paced = await waitForPresented(pwPage!, seen, PRESENTED_WAIT_MS)
    moves.push({ move, warmUp: move < WARM_UP_MOVES, target: `${target.selector}[${target.index}]`, sentFrom, sentTo, paced })
  }
  const events = await trace.stop()

  const samples = analyse(events, moves, env.tabPid, pageFrame).filter((s) => s.move >= WARM_UP_MOVES)
  const latencies = samples.map((s) => (s.latencyMs === null ? Number.POSITIVE_INFINITY : s.latencyMs))
  const summary = {
    label: LABEL,
    date: new Date().toISOString(),
    measured: samples.length,
    warmUp: WARM_UP_MOVES,
    misses: samples.filter((s) => s.miss !== null).length,
    unpaced: moves.filter((m) => !m.paced && !m.warmUp).length,
    latencyMs: summarise(latencies),
    targetP95Ms: TARGET_P95_MS,
    pass: summarise(latencies).p95 <= TARGET_P95_MS
  }
  await writeBenchRecord(`browser-025-highlight-${LABEL}`, {
    summary,
    environment: { ...env, viewport, machine: machine(), targets: targets.length },
    samples
  })
  // The run is valid when every measured move was found in the trace; the result is a number, not a pass/fail of the test.
  expect(samples.filter((s) => s.miss === 'no input event in the trace' || s.miss === 'no presented frame after the paint')).toEqual([])
})
