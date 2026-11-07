// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Benchmark: send latency (spec 025, 025-AC-050, 025-NFR-005).
 *
 * Not a test of behaviour: it asserts only that each run was valid and records
 * numbers. Excluded from the normal e2e run; it runs through the env-gated
 * `bench` project (macOS and Linux – the stub agent runs in a POSIX shell):
 *
 * ```sh
 * npm run build:e2e
 * ERFANA_E2E_BENCH=1 npx playwright test --project=bench e2e/browser-pick-send.bench.ts
 * ```
 *
 * Method (025-NFR-005): 100 picks followed by **Explain** on the React sample
 * app, then 20 on the worst-case fixture – the element of `long-text.html`
 * whose `outerHTML` is exactly 20,000 characters, in a 1920 × 1080 CSS px
 * viewport at device pixel ratio 2 (S-35). The target terminal runs
 * `fixtures/browser/stub-agent-timed.cjs`, which stamps every chunk it
 * receives on the trace clock. Each pick records a Chromium trace from the
 * hover to the receipt, and reads:
 *
 * - **(a) confirm → menu**: from the Return key's input event timestamp
 *   (`InputLatency::*`; main's send time just before `sendInputEvent` when
 *   the trace has none – main consumes the key) to the presentation of the
 *   first frame of Erfana's window that holds the prompt-actions panel (a
 *   `console.timeStamp` marker at its insertion, then the frame that committed
 *   it). The page view leaves the window when the menu shows over the still
 *   image. That removal has no presentation time of its own, so it counts as
 *   shown two display refreshes after main removed the view, and (a) is the
 *   later of the two.
 * - **(b) Explain → terminal**: from the click's event timestamp (the click
 *   handler's `console.timeStamp`, less the handler's delay after the event)
 *   to the stub's stamp on the last chunk of the prompt.
 *
 * Raw results go to `$ERFANA_BENCH_OUT` (default `.local/bench/`).
 *
 * @see docs/performance/browser-025-send.md
 */
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import type { CDPSession, ElectronApplication, Page } from '@playwright/test'
import { test, expect } from './fixtures/browserHarness'
import { BROWSER_CHROMIUM_ARGS } from './fixtures/browser/serve'
import { BrowserSendUi, PASTE_END, SEND_WAIT_MS } from './pages/browser-send.page'
import { PICK_WAIT_MS } from './pages/browser-pick.page'
import { BROWSER_TEST_IDS } from '../src/renderer/src/components/Panels/BrowserPanel/browserTestIds'
import { displayedAfter, inputEventTimes, rendererFrames, startTrace, timeStamps, type TraceEvent } from './utils/chrome-trace'
import { machine, summarise, writeBenchRecord } from './utils/bench-stats'

const IS_POSIX = process.platform !== 'win32'
const REACT_PICKS = Number(process.env.ERFANA_BENCH_PICKS ?? 100)
const WORST_CASE_PICKS = Number(process.env.ERFANA_BENCH_WORST_PICKS ?? 20)
/** 025-NFR-005 targets, each at the 95th percentile. */
const TARGET_MENU_P95_MS = 500
const TARGET_SEND_P95_MS = 2_000
const LABEL = process.env.ERFANA_BENCH_LABEL ?? 'run'
const STUB = path.join(__dirname, 'fixtures', 'browser', 'stub-agent-timed.cjs')
const MENU_MARK = 'erf-bench-menu'
const EXPLAIN_MARK = 'erf-bench-explain'

/** The stub agent's record and arrival stamps. */
class TimedAgent {
  constructor(readonly recordFile: string) {}

  async received(): Promise<string> {
    return fs.readFile(this.recordFile, 'utf8').catch(() => '')
  }

  /** Wait for one whole prompt and Enter; resolves the stamp (µs) of the chunk that completed it. */
  async waitForSubmitted(): Promise<number> {
    await expect.poll(async () => (await this.received()).endsWith(`${PASTE_END}\r`), { timeout: SEND_WAIT_MS, message: 'one prompt and Enter' }).toBe(true)
    const lines = (await fs.readFile(`${this.recordFile}.times`, 'utf8')).trim().split('\n')
    return Number(lines[lines.length - 1].split(' ')[0])
  }

  async reset(): Promise<void> {
    await fs.writeFile(this.recordFile, '')
    await fs.writeFile(`${this.recordFile}.times`, '')
  }
}

async function startTimedAgent(send: BrowserSendUi, recordFile: string): Promise<TimedAgent> {
  await send.terminal.open()
  await send.terminal.sendCommand(`"${process.execPath}" "${STUB}" "${recordFile}"`)
  await send.terminal.waitForOutputLine(`STUB-AGENT-READY ${path.basename(recordFile)}`, { timeout: SEND_WAIT_MS })
  await send.waitForTarget(/· node, target terminal$/)
  return new TimedAgent(recordFile)
}

/**
 * Mark, in Erfana's window, the insertion of the prompt-actions panel and each
 * click on its **Explain** (with how long after the event the handler ran), and
 * record main's removals of the page view from the window.
 */
async function instrument(app: ElectronApplication, window: Page): Promise<void> {
  await window.evaluate(
    ([testId, menuMark, explainMark]) => {
      const selector = `[data-testid="${testId}"]`
      let shown = document.querySelector(selector) !== null
      new MutationObserver(() => {
        const now = document.querySelector(selector) !== null
        if (now && !shown) console.timeStamp(menuMark)
        shown = now
      }).observe(document.body, { childList: true, subtree: true })
      document.addEventListener(
        'click',
        (event) => {
          const button = (event.target as Element | null)?.closest?.('button')
          if (button?.closest(selector) && button.textContent?.trim() === 'Explain') {
            console.timeStamp(`${explainMark} ${(performance.now() - event.timeStamp).toFixed(3)}`)
          }
        },
        true
      )
    },
    [BROWSER_TEST_IDS.PROMPT_ACTIONS, MENU_MARK, EXPLAIN_MARK] as const
  )
  await app.evaluate(({ BrowserWindow }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a test-only record on main's globalThis
    const g = globalThis as any
    g.__benchDetached = [] as number[]
    const view = BrowserWindow.getAllWindows()[0].contentView
    const remove = view.removeChildView.bind(view)
    view.removeChildView = (child: Parameters<typeof remove>[0]) => {
      g.__benchDetached.push(Number(process.hrtime.bigint() / 1000n))
      return remove(child)
    }
  })
}

interface PickSample {
  pick: number
  confirmAt: number | null
  confirmSource: 'trace' | 'main' | null
  menuPresentedAt: number | null
  detachedAt: number | null
  menuMs: number | null
  explainAt: number | null
  receivedAt: number
  sendMs: number | null
  miss: string | null
}

/** Read one pick's two intervals from its trace. */
function analysePick(
  events: readonly TraceEvent[],
  pick: { pick: number; keyFrom: number; keyTo: number; receivedAt: number; detached: number[] },
  windowPid: number,
  refreshUs: number
): PickSample {
  const sample: PickSample = {
    pick: pick.pick, confirmAt: null, confirmSource: null, menuPresentedAt: null, detachedAt: null, menuMs: null,
    explainAt: null, receivedAt: pick.receivedAt, sendMs: null, miss: null
  }
  const traced = inputEventTimes(events, pick.keyFrom, pick.keyTo)[0]
  sample.confirmAt = traced ?? pick.keyFrom
  sample.confirmSource = traced === undefined ? 'main' : 'trace'
  const menu = timeStamps(events, windowPid, MENU_MARK).find((m) => m.ts >= sample.confirmAt!)
  if (menu === undefined) return { ...sample, miss: 'no menu marker' }
  const shown = displayedAfter(rendererFrames(events, windowPid), menu.ts)
  if (shown === null) return { ...sample, miss: 'no presented frame with the menu' }
  sample.menuPresentedAt = shown.presentedAt
  sample.detachedAt = pick.detached.find((t) => t >= sample.confirmAt!) ?? null
  // The removal is on screen at the earliest one refresh later; two refreshes keep the bound on the safe side.
  const removalShownAt = sample.detachedAt === null ? 0 : sample.detachedAt + 2 * refreshUs
  sample.menuMs = (Math.max(shown.presentedAt, removalShownAt) - sample.confirmAt) / 1000
  const explain = timeStamps(events, windowPid, EXPLAIN_MARK).at(-1)
  if (explain === undefined) return { ...sample, miss: 'no Explain marker' }
  sample.explainAt = explain.ts - Number(explain.message.split(' ')[1]) * 1000
  sample.sendMs = (pick.receivedAt - sample.explainAt) / 1000
  return sample
}

/** Hold the page area at `width` × `height` CSS px (the window grows; the panel is pinned when the screen stops it). */
async function holdViewport(send: BrowserSendUi, pwPage: Page, width: number, height: number): Promise<void> {
  const view = (): Promise<{ w: number; h: number }> => pwPage.evaluate(() => ({ w: innerWidth, h: innerHeight }))
  const now = await view()
  await send.app.evaluate(({ BrowserWindow }, [dw, dh]) => {
    const win = BrowserWindow.getAllWindows()[0]
    const [w, h] = win.getSize()
    win.setSize(w + dw, h + dh)
  }, [width - now.w, height - now.h] as const)
  await expect.poll(async () => JSON.stringify(await view()), { timeout: PICK_WAIT_MS }).not.toBe(JSON.stringify(now))
  const after = await view()
  if (after.w !== width || after.h !== height) {
    await send.panel.root.evaluate(
      (el, [dw, dh]) => {
        const root = el as HTMLElement
        const r = root.getBoundingClientRect()
        root.style.width = `${r.width + dw}px`
        root.style.height = `${r.height + dh}px`
        root.style.flex = '0 0 auto'
      },
      [width - after.w, height - after.h] as const
    )
  }
  await expect.poll(async () => JSON.stringify(await view()), { timeout: PICK_WAIT_MS }).toBe(JSON.stringify({ w: width, h: height }))
}

interface RunSpec {
  name: string
  url: string
  targets: readonly string[]
  picks: number
  viewport?: { width: number; height: number }
}

async function runSends(
  spec: RunSpec,
  fixtures: { app: ElectronApplication; window: Page; projectRoot: string; recordFile: string }
): Promise<{ samples: PickSample[]; environment: Record<string, unknown> }> {
  const { app, window } = fixtures
  const send = await BrowserSendUi.open(app, window, fixtures.projectRoot)
  const agent = await startTimedAgent(send, fixtures.recordFile)
  await send.load(spec.url)
  let pwPage: Page | undefined
  await expect.poll(() => (pwPage = app.context().pages().find((p) => p.url() === spec.url)) !== undefined, { timeout: PICK_WAIT_MS }).toBe(true)
  if (spec.viewport !== undefined) await holdViewport(send, pwPage!, spec.viewport.width, spec.viewport.height)
  const cdp: CDPSession = await app.context().newCDPSession(pwPage!)
  await instrument(app, window)
  const tabId = await send.panel.tabId()
  const driver = await send.driver()
  const env = await app.evaluate(({ BrowserWindow, screen }) => ({
    windowPid: BrowserWindow.getAllWindows()[0].webContents.getOSProcessId(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    display: {
      scaleFactor: screen.getPrimaryDisplay().scaleFactor,
      size: screen.getPrimaryDisplay().size,
      refreshHz: screen.getPrimaryDisplay().displayFrequency
    }
  }))
  const refreshUs = 1e6 / (env.display.refreshHz > 0 ? env.display.refreshHz : 60)
  const viewport = await pwPage!.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }))

  const samples: PickSample[] = []
  for (let pick = 0; pick < spec.picks; pick++) {
    const selector = spec.targets[pick % spec.targets.length]
    await agent.reset()
    if ((await send.pick.pickButton.getAttribute('aria-pressed')) !== 'true') await send.pick.pickButton.click()
    await expect.poll(async () => (await driver.state()).active, { timeout: PICK_WAIT_MS }).toBe(true)
    const trace = await startTrace(cdp)
    const box = await driver.rect(selector)
    await driver.move(Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2))
    await expect.poll(async () => (await driver.highlight())?.box?.width ?? -1, { timeout: PICK_WAIT_MS, message: `highlight ${selector}` }).toBeCloseTo(box.width, 0)
    const [keyFrom, keyTo] = await app.evaluate((_e, id) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the hooks live on main's globalThis, untyped there
      const hooks = (globalThis as any).__erfanaTestHooks
      const from = Number(process.hrtime.bigint() / 1000n)
      hooks.browser.key(id, 'Return', [])
      return [from, Number(process.hrtime.bigint() / 1000n)]
    }, tabId)
    await expect(send.pick.actions).toBeVisible({ timeout: PICK_WAIT_MS })
    await send.pick.action('Explain').click()
    const receivedAt = await agent.waitForSubmitted()
    const events = await trace.stop()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a test-only record on main's globalThis
    const detached = await app.evaluate(() => [...((globalThis as any).__benchDetached as number[])])
    samples.push(analysePick(events, { pick, keyFrom, keyTo, receivedAt, detached }, env.windowPid, refreshUs))
  }
  return { samples, environment: { ...env, viewport, machine: machine() } }
}

async function record(name: string, samples: PickSample[], environment: Record<string, unknown>): Promise<void> {
  const menu = samples.map((s) => s.menuMs ?? Number.POSITIVE_INFINITY)
  const sendMs = samples.map((s) => s.sendMs ?? Number.POSITIVE_INFINITY)
  const summary = {
    label: LABEL,
    date: new Date().toISOString(),
    picks: samples.length,
    misses: samples.filter((s) => s.miss !== null).length,
    confirmFromTrace: samples.filter((s) => s.confirmSource === 'trace').length,
    menuBoundByViewRemoval: samples.filter((s) => s.menuMs !== null && s.menuPresentedAt !== null && s.confirmAt !== null && s.menuMs * 1000 > s.menuPresentedAt - s.confirmAt).length,
    menuMs: summarise(menu),
    sendMs: summarise(sendMs),
    targets: { menuP95Ms: TARGET_MENU_P95_MS, sendP95Ms: TARGET_SEND_P95_MS },
    pass: summarise(menu).p95 <= TARGET_MENU_P95_MS && summarise(sendMs).p95 <= TARGET_SEND_P95_MS
  }
  await writeBenchRecord(`browser-025-send-${name}-${LABEL}`, { summary, environment, samples })
  expect(samples.filter((s) => s.miss !== null), 'every pick found in its trace').toEqual([])
  for (const s of samples) {
    // The stub's clock must be the trace clock: a send cannot arrive before the click or a minute later.
    expect(s.sendMs, `pick ${s.pick}: arrival on the trace clock`).toBeGreaterThan(0)
    expect(s.sendMs, `pick ${s.pick}: arrival on the trace clock`).toBeLessThan(60_000)
  }
}

test.describe('025-NFR-005 bench: send latency', () => {
  test.skip(!IS_POSIX, 'The stub agent is a node program in front of a POSIX shell (macOS and Linux)')

  test('100 picks and Explain on the React app', async ({ appWithTestProject, windowWithTestProject, browserServers, testProject }) => {
    test.setTimeout(1_200_000)
    const { samples, environment } = await runSends(
      {
        name: 'react',
        url: browserServers.sites.react18.url('/'),
        targets: ['.save-label', '.status-card-action', '.item-name', '.status-card-title', '.item-price', '.brand'],
        picks: REACT_PICKS
      },
      { app: appWithTestProject, window: windowWithTestProject, projectRoot: testProject.path, recordFile: test.info().outputPath('agent.bin') }
    )
    await record('react', samples, environment)
  })

  test.describe('worst case', () => {
    test.use({ extraLaunchArgs: [...BROWSER_CHROMIUM_ARGS, '--force-device-scale-factor=2'] })

    test('20 picks and Explain of a 20,000-character element at 1920 × 1080 CSS px, pixel ratio 2', async ({
      appWithTestProject,
      windowWithTestProject,
      browserServers,
      testProject
    }) => {
      test.setTimeout(900_000)
      const { samples, environment } = await runSends(
        {
          name: 'worst',
          url: browserServers.sites.static.url('/long-text.html'),
          targets: ['#exact-20000'],
          picks: WORST_CASE_PICKS,
          viewport: { width: 1920, height: 1080 }
        },
        { app: appWithTestProject, window: windowWithTestProject, projectRoot: testProject.path, recordFile: test.info().outputPath('agent.bin') }
      )
      expect((environment.viewport as { dpr: number }).dpr).toBe(2)
      await record('worst', samples, environment)
    })
  })
})
