// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Engine probes of the built-in browser (spec 025 solution design § 13
 * commit 8, design list T25): what Electron and Chromium actually do where
 * ADRs 0007, 0008, 0011 and 0012 rest on an assumption. Kept as permanent
 * regression tests, so an Electron update that changes an answer fails here
 * first. The results are recorded in each ADR's "Probe results (commit 8)".
 *
 * Most probes run in a **probe view** (`src/main/testHooks/browserProbeHook.ts`):
 * a page view built like a tab's – same pinned web preferences, hardening and
 * request filter, its own tab-kind `BrowserCdpSession` – because a tab's CDP
 * session is not reachable from the test hooks. Every CDP command still goes
 * through `BrowserCdpSession.send` and its allow-list. The two probes that
 * need a method outside the allow-list (`Overlay.setInspectMode`, and
 * `Input.dispatchMouseEvent` for real frame routing) use Playwright's own CDP
 * client on the view's page instead – a test-side client, never Erfana code.
 *
 * Playwright is itself attached as a CDP client to every page in these runs;
 * results that could depend on that say so in the ADRs.
 *
 * Measurements are attached as `probe …` annotations (in the HTML report).
 * Condition-based waits only.
 */
import * as path from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { test, expect } from './fixtures/browserHarness'
import { BROWSER_CHROMIUM_ARGS } from './fixtures/browser/serve'
import { browserHook } from './pages/browser-page.page'
import {
  HANG_PROBE_EVALUATE_PARAMS,
  ISOLATED_WORLD_NAME,
  OUTER_HTML_CUT,
  PICK_OBJECT_GROUP,
  pickHighlightConfig
} from '../src/main/services/browser/cdp/cdpPinned'

/** Where a probe view sits, in the window's content DIP; the probe pages are 820 × 600. */
const PROBE_BOUNDS = { x: 40, y: 40, width: 840, height: 620 } as const
const WAIT_MS = 15_000
/** ADR 0008 decision 3: a main-world call while frozen must answer within this. */
const FROZEN_CALL_BUDGET_MS = 100
/** Long enough to tell "answers late" from "never answers" for a call that hangs. */
const HUNG_CALL_CAP_MS = 1_000
const LOCAL_FOLDER = path.join(__dirname, 'fixtures', 'browser', 'apps', 'static', 'probes', 'local')

interface CdpAnswer {
  ok: boolean
  timedOut: boolean
  ms: number
  result?: unknown
  error?: string
}

interface MouseRecord {
  type: string
  x: number
  y: number
  globalX: number | null
  globalY: number | null
}

interface DetachRecord {
  cause: string
  reason: string
  devToolsOpenAtEvent: boolean
  destroyedAtEvent: boolean
}

interface FrameMove {
  x: number
  y: number
  screenX: number
  screenY: number
}

/** Attach a measurement to the test's report. */
function note(type: string, value: unknown): void {
  test.info().annotations.push({ type: `probe ${type}`, description: typeof value === 'string' ? value : JSON.stringify(value) })
}

/** A probe view: a page view built like a tab's, driven through the probe hooks. */
class ProbeView {
  private constructor(
    readonly app: ElectronApplication,
    readonly id: number
  ) {}

  static async open(app: ElectronApplication, options: Record<string, unknown> = {}): Promise<ProbeView> {
    return new ProbeView(app, await browserHook<number>(app, 'probeOpen', { bounds: PROBE_BOUNDS, ...options }))
  }

  hook<T>(name: string, ...args: unknown[]): Promise<T> {
    return browserHook<T>(this.app, name, this.id, ...args)
  }

  /** Load `url` and wait until the page says it finished loading. */
  async load(url: string): Promise<void> {
    await this.hook('probeLoad', url)
    await this.waitFor(`location.href === ${JSON.stringify(url)} && document.readyState === 'complete'`, `loaded ${url}`)
  }

  eval<T>(code: string): Promise<T> {
    return this.hook<T>('probeExec', code)
  }

  frameEval<T>(urlPart: string, code: string): Promise<T> {
    return this.hook<T>('probeFrameExec', urlPart, code)
  }

  async waitFor(code: string, message: string): Promise<void> {
    await expect.poll(async () => this.eval<unknown>(code).catch(() => false), { timeout: WAIT_MS, message }).toBeTruthy()
  }

  setPhase(phase: string): Promise<unknown> {
    return this.eval(`window.__probe.phase = ${JSON.stringify(phase)}; 0`)
  }

  cdp(method: string, params?: unknown, sessionKey = '', capMs?: number): Promise<CdpAnswer> {
    return this.hook<CdpAnswer>('probeCdp', method, params, sessionKey, capMs)
  }

  async cdpOk<T>(method: string, params?: unknown): Promise<T> {
    const answer = await this.cdp(method, params)
    if (!answer.ok) throw new Error(`${method} failed: ${answer.error}`)
    return answer.result as T
  }

  protocolEvents<T = { params: unknown }>(method: string): Promise<T[]> {
    return this.hook<T[]>('probeProtocolEvents', method)
  }

  /** `DOM.querySelectorAll` from the document root (pick domains must be on). */
  async nodeId(selector: string): Promise<number> {
    const doc = await this.cdpOk<{ root: { nodeId: number } }>('DOM.getDocument', { depth: 0 })
    const found = await this.cdpOk<{ nodeIds: number[] }>('DOM.querySelectorAll', { nodeId: doc.root.nodeId, selector })
    if (found.nodeIds.length === 0) throw new Error(`No node for ${selector}`)
    return found.nodeIds[0]
  }

  /** The outer-HTML cut (ADR 0007 decision 3) on `objectId`, exactly as the allow-list pins it. */
  outerHtml(objectId: string, capMs?: number): Promise<CdpAnswer> {
    return this.cdp(
      'Runtime.callFunctionOn',
      { functionDeclaration: OUTER_HTML_CUT.source, objectId, throwOnSideEffect: true, returnByValue: true, objectGroup: PICK_OBJECT_GROUP },
      '',
      capMs
    )
  }

  /** `#target` as a remote object in the main world and in Erfana's isolated world. */
  async targetObjects(): Promise<{ main: string; isolated: string }> {
    const nodeId = await this.nodeId('#target')
    const main = await this.cdpOk<{ object: { objectId: string } }>('DOM.resolveNode', { nodeId, objectGroup: PICK_OBJECT_GROUP })
    const tree = await this.cdpOk<{ frameTree: { frame: { id: string } } }>('Page.getFrameTree')
    const world = await this.cdpOk<{ executionContextId: number }>('Page.createIsolatedWorld', {
      frameId: tree.frameTree.frame.id,
      worldName: ISOLATED_WORLD_NAME
    })
    const isolated = await this.cdpOk<{ object: { objectId: string } }>('DOM.resolveNode', {
      nodeId,
      executionContextId: world.executionContextId,
      objectGroup: PICK_OBJECT_GROUP
    })
    return { main: main.object.objectId, isolated: isolated.object.objectId }
  }

  /** The Playwright page of this view (Playwright attaches to browser views too). */
  async playwrightPage(url: string): Promise<Page> {
    let found: Page | undefined
    await expect
      .poll(() => (found = this.app.context().pages().find((p) => p.url() === url)) !== undefined, {
        timeout: WAIT_MS,
        message: `Playwright page ${url}`
      })
      .toBe(true)
    return found as Page
  }

  /** Wait for Electron's one-time `ready-to-show` (first paint), so it cannot fall into a later event window. */
  async waitForFirstPaint(): Promise<void> {
    await expect
      .poll(async () => (await this.hook<string[]>('probeContentsEvents')).includes('ready-to-show'), { timeout: WAIT_MS, message: 'ready-to-show' })
      .toBe(true)
  }

  frameMoves(frame: string | null): Promise<FrameMove[]> {
    return frame === null ? this.eval('window.__probe.moves') : this.frameEval(frame, 'window.__probe.moves')
  }
}

const outerHtmlValue = (answer: CdpAnswer): unknown =>
  (answer.result as { result?: { value?: unknown } } | undefined)?.result?.value

const exceptionOf = (answer: CdpAnswer): unknown => (answer.result as { exceptionDetails?: unknown } | undefined)?.exceptionDetails

/** Wait until the page painted `n` animation frames; resolves its visibility state then. */
function framesPainted(view: ProbeView, n: number): Promise<string> {
  return view.eval<string>(`window.__probe.frames(${n})`)
}

test.describe('spec 025 engine probes: input and frames', () => {
  test('ADR 0007: before-mouse-event in out-of-process frames – offset frame gives usable globalX/globalY, transformed frame does not', async ({
    appWithTestProject,
    windowWithTestProject: _window,
    browserServers
  }) => {
    // No CDP session on this view, so the measured coordinates come from Electron alone.
    const view = await ProbeView.open(appWithTestProject, { withoutCdp: true })
    const url = browserServers.sites.static.url('/probes/frames.html')
    await view.load(url)
    const frames = await view.hook<Array<{ url: string; isMain: boolean; processId: number }>>('probeFrames')
    const mainProcess = frames.find((f) => f.isMain)?.processId
    for (const host of ['other.test', 'third.test']) {
      expect(frames.find((f) => f.url.includes(host))?.processId, `${host} is out of process`).not.toBe(mainProcess)
    }
    const origin = await view.hook<{ x: number; y: number }>('probeViewScreenOrigin')
    // Playwright's mouse is CDP Input.dispatchMouseEvent: routed by Chromium's frame router like OS input.
    const pointer = (await view.playwrightPage(url)).mouse

    const sample = async (x: number, y: number, frame: string | null): Promise<{ record: MouseRecord; move: FrameMove }> => {
      const before = (await view.frameMoves(frame)).length
      let step = 0
      await expect
        .poll(
          async () => {
            step += 1
            await pointer.move(x + (step % 2), y)
            return (await view.frameMoves(frame)).length > before
          },
          { timeout: WAIT_MS, message: `the ${frame ?? 'top'} document gets the pointer` }
        )
        .toBe(true)
      const record = (await view.hook<MouseRecord[]>('probeMouseRecords')).at(-1) as MouseRecord
      const move = (await view.frameMoves(frame)).at(-1) as FrameMove
      return { record, move }
    }

    // Top document: x/y are view coordinates; globalX/globalY minus the view origin give them back.
    const top = await sample(675, 350, null)
    note('top', top)
    expect(Math.abs(top.record.globalX! - origin.x - top.record.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(top.record.globalY! - origin.y - top.record.y)).toBeLessThanOrEqual(1)

    // Offset frame (left 240, top 60): the event fires on the top webContents with
    // frame-local x/y, and globalX/globalY minus the view origin is the view point.
    const offset = await sample(390, 160, 'other.test')
    note('offset', offset)
    expect(Math.abs(offset.record.x - offset.move.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(offset.record.y - offset.move.y)).toBeLessThanOrEqual(1)
    expect(Math.abs(offset.record.globalX! - origin.x - (offset.record.x + 240))).toBeLessThanOrEqual(1)
    expect(Math.abs(offset.record.globalY! - origin.y - (offset.record.y + 60))).toBeLessThanOrEqual(1)

    // Transformed frame (rotate 12deg, scale 0.8 about its top-left at 80, 300):
    // x/y are frame-local, but globalX/globalY are not where the pointer is.
    const sent = { x: 181, y: 403 }
    const transformed = await sample(sent.x, sent.y, 'third.test')
    note('transformed', { sent, ...transformed })
    expect(Math.abs(transformed.record.x - transformed.move.x)).toBeLessThanOrEqual(1)
    const globalError = Math.hypot(transformed.record.globalX! - origin.x - sent.x, transformed.record.globalY! - origin.y - sent.y)
    note('transformedGlobalErrorPx', globalError)
    expect(globalError).toBeGreaterThan(5)
  })

  test('T2 harness limit: sendInputEvent mouse events carry no screen position and never reach an out-of-process frame', async ({
    appWithTestProject,
    windowWithTestProject: _window,
    browserServers
  }) => {
    const view = await ProbeView.open(appWithTestProject, { withoutCdp: true })
    const url = browserServers.sites.static.url('/probes/frames.html')
    await view.load(url)
    const pointer = (await view.playwrightPage(url)).mouse
    // Synthetic moves aimed at the offset frame, then routed moves at another point of it:
    // once a routed one has arrived, the earlier synthetic ones would have too.
    for (let i = 0; i < 4; i += 1) await view.hook('probeMouse', 'mouseMove', 390 + (i % 2), 163)
    const synthetic = (await view.hook<MouseRecord[]>('probeMouseRecords')).at(-1)
    note('syntheticRecord', synthetic)
    expect(synthetic).toMatchObject({ type: 'mouseMove', globalX: 0, globalY: 0 })
    let step = 0
    await expect
      .poll(async () => {
        step += 1
        await pointer.move(300 + (step % 2), 200)
        return (await view.frameMoves('other.test')).length
      }, { timeout: WAIT_MS })
      .toBeGreaterThan(0)
    const moves = await view.frameMoves('other.test')
    note('frameMoves', moves)
    // Frame-local y 103 would be a synthetic move (163 - 60); the routed moves are at y 140.
    expect(moves.filter((m) => m.y === 103)).toEqual([])
  })

  test('ADR 0007 decision 5: Overlay.setInspectMode swallows hover and confirms on its own click', async ({
    appWithTestProject,
    windowWithTestProject: _window,
    browserServers
  }) => {
    const view = await ProbeView.open(appWithTestProject)
    const url = browserServers.sites.static.url('/probes/page.html')
    await view.load(url)
    // setInspectMode is outside Erfana's allow-list (as it should be): Playwright's own CDP client sends it.
    const cdp = await appWithTestProject.context().newCDPSession(await view.playwrightPage(url))
    const requested: unknown[] = []
    cdp.on('Overlay.inspectNodeRequested', (event) => requested.push(event))

    // Control: without inspect mode, hover reaches the page.
    await view.setPhase('control')
    let step = 0
    await expect
      .poll(async () => {
        step += 1
        await view.hook('probeMouse', 'mouseMove', 200 + (step % 5), 200)
        return view.eval<number>(`window.__probe.count('mouseover', 'control')`)
      }, { timeout: WAIT_MS })
      .toBeGreaterThan(0)
    await view.hook('probeMouse', 'mouseMove', 20, 20)

    await cdp.send('DOM.enable')
    await cdp.send('Overlay.enable')
    await cdp.send('Overlay.setInspectMode', { mode: 'searchForNode', highlightConfig: { contentColor: { r: 0, g: 0, b: 255, a: 0.3 } } })
    await view.setPhase('inspect')
    for (let i = 0; i < 6; i += 1) await view.hook('probeMouse', 'mouseMove', 150 + i * 20, 180)
    await view.hook('probeMouse', 'mouseDown', 250, 180)
    await view.hook('probeMouse', 'mouseUp', 250, 180)
    // The click is the last input sent; once the engine reports it, every move before it was handled.
    await expect.poll(() => requested.length, { timeout: WAIT_MS, message: 'inspect mode took the click' }).toBeGreaterThan(0)
    const seen = await view.eval<string[]>(`window.__probe.events.filter(e => e.phase === 'inspect').map(e => e.type)`)
    note('pageEventsInInspectMode', seen)
    expect(seen).toEqual([])
    await cdp.send('Overlay.setInspectMode', { mode: 'none', highlightConfig: {} })
    await cdp.detach()
  })

  test('ADR 0011 decision 14: Tab from the last focusable element wraps to the first, inside the page', async ({
    appWithTestProject,
    windowWithTestProject: _window,
    browserServers
  }) => {
    const view = await ProbeView.open(appWithTestProject)
    await view.load(browserServers.sites.static.url('/probes/page.html'))
    const box = await view.eval<{ x: number; y: number }>(
      `(() => { const r = document.getElementById('last').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`
    )
    await expect
      .poll(async () => {
        for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) await view.hook('probeMouse', type, box.x, box.y)
        return view.eval(`document.activeElement && document.activeElement.id`)
      }, { timeout: WAIT_MS, message: '#last focused' })
      .toBe('last')

    await view.setPhase('tab1')
    await view.hook('probeKey', 'Tab')
    await view.waitFor(`document.activeElement && document.activeElement.id === 'first'`, 'Tab from #last lands on #first')
    const events = await view.eval<string[]>(`window.__probe.events.filter(e => e.phase === 'tab1').map(e => e.type)`)
    note('tab1Events', events)
    note('focusState', await view.hook('probeFocusState'))
    // The document loses focus for a moment (Chromium offers focus to the embedder, which does not take it).
    expect(events).toEqual(['blur:last', 'window-blur', 'window-focus', 'focus:first'])

    await view.setPhase('tab2')
    await view.hook('probeKey', 'Tab')
    await view.waitFor(`document.activeElement && document.activeElement.id === 'last'`, 'Tab from #first lands on #last')
  })
})

test.describe('spec 025 engine probes: the CDP session', () => {
  test('ADR 0007 decision 11: opening and closing DevTools does not detach the CDP session, and its commands keep working', async ({
    appWithTestProject,
    windowWithTestProject: _window,
    browserServers
  }) => {
    const view = await ProbeView.open(appWithTestProject)
    await view.load(browserServers.sites.static.url('/probes/page.html'))
    expect((await view.cdp('Runtime.evaluate', HANG_PROBE_EVALUATE_PARAMS)).ok).toBe(true)

    await view.hook('probeDevTools', true)
    await expect
      .poll(async () => {
        const s = await view.hook<{ open: boolean; frontEndId: number | null; frontEndLoading: boolean; frontEndUrl: string }>('probeDevToolsState')
        return s.open && s.frontEndId !== null && !s.frontEndLoading && s.frontEndUrl.startsWith('devtools://')
      }, { timeout: WAIT_MS, message: 'DevTools front end loaded' })
      .toBe(true)
    // A round trip after the front end loaded: a detach would have come before it.
    const whileOpen = await view.cdp('Runtime.evaluate', HANG_PROBE_EVALUATE_PARAMS)
    note('whileOpen', whileOpen)
    expect(whileOpen.ok).toBe(true)
    expect(await view.hook('probeCdpState')).toEqual({ attached: true, detaches: [] })

    await view.hook('probeDevTools', false)
    await expect.poll(async () => (await view.hook<{ open: boolean }>('probeDevToolsState')).open, { timeout: WAIT_MS }).toBe(false)
    expect((await view.cdp('Runtime.evaluate', HANG_PROBE_EVALUATE_PARAMS)).ok).toBe(true)
    expect(await view.hook('probeCdpState')).toEqual({ attached: true, detaches: [] })
  })

  test('cdpSessionTypes: closing the view detaches with reason "target closed" while the webContents is not yet destroyed', async ({
    appWithTestProject,
    windowWithTestProject: _window,
    browserServers
  }) => {
    const view = await ProbeView.open(appWithTestProject)
    await view.load(browserServers.sites.static.url('/probes/page.html'))
    await view.hook('probeClose', true)
    await expect
      .poll(async () => (await view.hook<{ detaches: DetachRecord[] }>('probeCdpState')).detaches.length, { timeout: WAIT_MS })
      .toBeGreaterThan(0)
    const state = await view.hook<{ attached: boolean; detaches: DetachRecord[] }>('probeCdpState')
    note('detachOnClose', state)
    expect(state.attached).toBe(false)
    // BrowserCdpSession reads the cause from the view's state at the event; here that state says "not destroyed".
    expect(state.detaches[0]).toMatchObject({ reason: 'target closed', destroyedAtEvent: false, devToolsOpenAtEvent: false })
  })

  test('ADR 0008 decision 3: on an idle page a pending Debugger.pause hangs callFunctionOn in either world; once it has paused, calls answer within 100 ms', async ({
    appWithTestProject,
    windowWithTestProject: _window,
    browserServers
  }) => {
    const view = await ProbeView.open(appWithTestProject)
    await view.load(browserServers.sites.static.url('/probes/page.html'))
    await view.hook('probeEnablePick')
    const objects = await view.targetObjects()
    expect((await view.cdp('Debugger.enable')).ok).toBe(true)
    expect((await view.cdp('Debugger.pause')).ok).toBe(true)
    expect(await view.protocolEvents('Debugger.paused')).toEqual([])

    // Erfana's call is the first script to run on the idle page: it stops inside its own function –
    // the isolated world gives no way round it.
    const first = await view.outerHtml(objects.isolated, HUNG_CALL_CAP_MS)
    note('isolatedWhilePending', first)
    expect(first.timedOut).toBe(true)
    await expect.poll(async () => (await view.protocolEvents('Debugger.paused')).length, { timeout: WAIT_MS }).toBe(1)

    // Now really paused (on Erfana's own frame): a further call answers at once.
    const second = await view.outerHtml(objects.main, HUNG_CALL_CAP_MS)
    note('mainWhilePaused', second)
    expect(second.ok).toBe(true)
    expect(second.ms).toBeLessThan(FROZEN_CALL_BUDGET_MS)
    expect(outerHtmlValue(second)).toBe('<div id="target"><span id="inner">target</span></div>')

    expect((await view.cdp('Debugger.resume')).ok).toBe(true)
    expect((await view.cdp('Debugger.disable')).ok).toBe(true)
    // Unfrozen, the page paints again.
    expect(await framesPainted(view, 2)).toBe('visible')
  })

  test('ADR 0008 decision 3: on a timer page, once Debugger.paused has arrived, a main-world callFunctionOn answers within 100 ms', async ({
    appWithTestProject,
    windowWithTestProject: _window,
    browserServers
  }) => {
    const view = await ProbeView.open(appWithTestProject)
    await view.load(browserServers.sites.static.url('/probes/page.html?timer=1'))
    await view.hook('probeEnablePick')
    const objects = await view.targetObjects()
    expect((await view.cdp('Debugger.enable')).ok).toBe(true)
    expect((await view.cdp('Debugger.pause')).ok).toBe(true)
    await expect.poll(async () => (await view.protocolEvents('Debugger.paused')).length, { timeout: WAIT_MS }).toBe(1)

    const main = await view.outerHtml(objects.main, HUNG_CALL_CAP_MS)
    const isolated = await view.outerHtml(objects.isolated, HUNG_CALL_CAP_MS)
    note('whilePaused', { main, isolated })
    for (const answer of [main, isolated]) {
      expect(answer.ok).toBe(true)
      expect(answer.ms).toBeLessThan(FROZEN_CALL_BUDGET_MS)
    }
    expect((await view.cdp('Debugger.resume')).ok).toBe(true)
    expect((await view.cdp('Debugger.disable')).ok).toBe(true)
  })

  test('ADR 0007 decision 3: the outerHTML read passes throwOnSideEffect: true in the main and the isolated world', async ({
    appWithTestProject,
    windowWithTestProject: _window,
    browserServers
  }) => {
    const view = await ProbeView.open(appWithTestProject)
    await view.load(browserServers.sites.static.url('/probes/page.html'))
    await view.hook('probeEnablePick')
    const objects = await view.targetObjects()
    for (const [world, objectId] of Object.entries(objects)) {
      const answer = await view.outerHtml(objectId)
      note(world, answer)
      expect(exceptionOf(answer), `${world} world: no side-effect exception`).toBeUndefined()
      expect(outerHtmlValue(answer)).toBe('<div id="target"><span id="inner">target</span></div>')
    }
  })

  test('ADR 0007 decision 6: the Overlay highlight is in capturePage, and gone after hideHighlight', async ({
    appWithTestProject,
    windowWithTestProject: _window,
    browserServers
  }) => {
    const view = await ProbeView.open(appWithTestProject)
    await view.load(browserServers.sites.static.url('/probes/page.html'))
    expect(await framesPainted(view, 3)).toBe('visible')
    await view.hook('probeEnablePick')
    await view.hook('probeCapture', 'before')
    const highlight = await view.cdp('Overlay.highlightNode', { highlightConfig: pickHighlightConfig(), nodeId: await view.nodeId('#target') })
    expect(highlight.ok).toBe(true)
    // #target is 300 × 200 at (100, 100); the margin band reaches a little outside it.
    const rect = { x: 90, y: 90, width: 320, height: 220 }
    let diff = { changed: 0, total: 0 }
    await expect
      .poll(async () => {
        await view.hook('probeCapture', 'highlighted')
        diff = await view.hook('probeCaptureDiff', 'before', 'highlighted', rect)
        return diff.changed / diff.total
      }, { timeout: WAIT_MS, message: 'the highlight shows in the capture' })
      .toBeGreaterThan(0.5)
    note('highlighted', diff)
    expect((await view.cdp('Overlay.hideHighlight')).ok).toBe(true)
    await expect
      .poll(async () => {
        await view.hook('probeCapture', 'hidden')
        diff = await view.hook('probeCaptureDiff', 'before', 'hidden', rect)
        return diff.changed
      }, { timeout: WAIT_MS, message: 'the highlight leaves the capture' })
      .toBe(0)
  })

  test('ADR 0007 decision 2: failed requests – Network reports the worker request that Log misses; both skip the cancelled one', async ({
    appWithTestProject,
    windowWithTestProject: _window,
    browserServers
  }) => {
    const statuses: Record<string, Record<string, string>> = {}
    for (const source of ['log', 'network'] as const) {
      const view = await ProbeView.open(appWithTestProject, { failedRequestSource: source })
      await view.load(browserServers.sites.static.url('/probes/requests.html'))
      await view.eval('window.__probe.run()')
      await view.waitFor(
        `['500', 'invalid-host', '404', 'cors-blocked', 'cancelled', 'worker'].every(l => l in window.__probe.settled)`,
        'every request settled'
      )
      // One answered command per attached target, so every event sent before it has arrived.
      for (const target of await view.hook<Array<{ sessionKey: string }>>('probeTargets')) {
        if (target.sessionKey !== '') await view.cdp('Runtime.runIfWaitingForDebugger', undefined, target.sessionKey)
      }
      await view.cdp('Runtime.evaluate', HANG_PROBE_EVALUATE_PARAMS)
      const failed = (await view.hook<{ failedRequests: Array<{ url: string; status: string }> }>('probeLogSnapshot')).failedRequests
      statuses[source] = Object.fromEntries(
        failed.map((f) => {
          const params = new URL(f.url).searchParams
          return [params.get('probe') ?? params.get('from') ?? f.url, f.status]
        })
      )
      await view.hook('probeClose')
    }
    note('failedRequests', statuses)
    expect(statuses.log).toEqual({ 500: '500', 404: '404', invalid: 'net::ERR_NAME_NOT_RESOLVED', cors: 'net::ERR_FAILED' })
    expect(statuses.network).toEqual({
      500: '500',
      404: '404',
      invalid: 'net::ERR_NAME_NOT_RESOLVED',
      cors: 'cors:MissingAllowOriginHeader',
      worker: '404'
    })
  })

  test('ADR 0007 decision 1: with the tab-kind CDP session attached, a page with cross-site frames finishes loading', async ({
    browserTabs,
    browserServers
  }) => {
    // Commit 8 found the cross-site frames never committed: Electron emits
    // Target.attachedToTarget from inside Chromium's navigation throttle, and a
    // runIfWaitingForDebugger sent from that call stack was lost. The session now
    // resumes on a later task (RESUME_DELAY_MS); this guards against a regression.
    const page = await browserTabs.open()
    const url = browserServers.sites.static.url('/probes/frames.html')
    await browserTabs.navigate(page.tabId, url)
    await browserTabs.waitForState(page.tabId, { committedUrl: url })
    await browserTabs.waitForState(page.tabId, { loading: false })
  })
})

test.describe('spec 025 engine probes: the view on screen', () => {
  test('ADR 0011 decision 3: a view moved off-screen stays visible and keeps painting', async ({
    appWithTestProject,
    windowWithTestProject: _window,
    browserServers
  }) => {
    const view = await ProbeView.open(appWithTestProject)
    await view.load(browserServers.sites.static.url('/probes/page.html'))
    expect(await framesPainted(view, 2)).toBe('visible')
    const size = await browserHook<{ width: number; height: number }>(appWithTestProject, 'probeContentSize')
    await view.setPhase('offscreen')
    await view.hook('probeSetBounds', { ...PROBE_BOUNDS, x: size.width + 100 })
    // Ten painted frames off-screen: a hidden page would paint none.
    expect(await framesPainted(view, 10)).toBe('visible')
    expect(await view.eval(`window.__probe.events.filter(e => e.phase === 'offscreen').map(e => e.type)`)).toEqual([])
  })

  test('ADR 0011 decision 3: a detached view (removeChildView) also stays visible and keeps painting', async ({
    appWithTestProject,
    windowWithTestProject: _window,
    browserServers
  }) => {
    const view = await ProbeView.open(appWithTestProject)
    await view.load(browserServers.sites.static.url('/probes/page.html'))
    expect(await framesPainted(view, 2)).toBe('visible')
    await view.setPhase('detached')
    await view.hook('probeDetachView')
    expect(await framesPainted(view, 10)).toBe('visible')
    expect(await view.eval(`window.__probe.events.filter(e => e.phase === 'detached').map(e => e.type)`)).toEqual([])
  })

  test('ADR 0011 decision 3: still-image drop delay – time from re-attaching the view to its second animation frame', async ({
    appWithTestProject,
    windowWithTestProject: _window,
    browserServers
  }) => {
    const view = await ProbeView.open(appWithTestProject)
    await view.load(browserServers.sites.static.url('/probes/page.html'))
    await view.eval('window.__probe.logFrames()')
    const delays: number[] = []
    for (let i = 0; i < 5; i += 1) {
      await view.hook('probeDetachView')
      const attachedAt = await view.hook<number>('probeAttachView')
      await view.waitFor(`window.__probe.frameLog.filter(t => t >= ${attachedAt}).length >= 2`, 'two frames after re-attach')
      const after = await view.eval<number[]>(`window.__probe.frameLog.filter(t => t >= ${attachedAt})`)
      delays.push(after[1] - attachedAt)
    }
    note('attachToSecondFrameMs', delays)
    note('maxMs', Math.max(...delays))
    expect(delays).toHaveLength(5)
  })

  test('ADR 0007 decision 8: insertCSS with cssOrigin user sets the crosshair in the top document only, not in frames', async ({
    appWithTestProject,
    windowWithTestProject: _window,
    browserServers
  }) => {
    const view = await ProbeView.open(appWithTestProject, { withoutCdp: true })
    await view.load(browserServers.sites.static.url('/probes/frames.html'))
    await view.hook('probeInsertCss', '* { cursor: crosshair !important }')
    const read = (id: string): string => `getComputedStyle(document.getElementById('${id}')).cursor`
    const cursors = {
      top: await view.eval<string>(read('top-target')),
      sameOriginFrame: await view.frameEval<string>('name=same', read('target')),
      crossSiteFrame: await view.frameEval<string>('other.test', read('target'))
    }
    note('cursors', cursors)
    expect(cursors).toEqual({ top: 'crosshair', sameOriginFrame: 'auto', crossSiteFrame: 'auto' })
  })
})

test.describe('spec 025 engine probes: site behaviour', () => {
  test('ADR 0012 decision 1: no Sec-Fetch-* header reaches an erfana-local handler; XHR still reads the folder', async ({
    appWithTestProject,
    windowWithTestProject: _window,
    browserServers
  }) => {
    // The production handler arrives with commit 11; a test-only handler on the probe session records the headers.
    await browserHook(appWithTestProject, 'probeServeLocalScheme', LOCAL_FOLDER)
    const view = await ProbeView.open(appWithTestProject)
    await view.load('erfana-local://probe-folder/index.html')
    await view.waitFor('window.__probe && window.__probe.done', 'local page settled')
    const attempts = await view.eval<Record<string, string>>('window.__probe.attempts')
    note('localAttempts', attempts)
    expect(attempts).toMatchObject({ fetch: 'failed TypeError', xhr: 'ok 200', worker: 'ok worker ran', serviceWorker: 'failed TypeError' })
    expect(await view.eval('({ classic: window.__classicScriptRan === true, module: window.__moduleScriptRan === true })')).toEqual({
      classic: true,
      module: true
    })

    await view.load(browserServers.sites.static.url('/probes/local-include.html'))
    await view.waitFor('window.__probe && window.__probe.done', 'include page settled')
    expect(await view.eval('window.__probe.attempts')).toEqual({ fetch: 'failed TypeError' })

    const requests = await browserHook<Array<{ url: string; dest: string | null; site: string | null; mode: string | null; origin: string | null }>>(
      appWithTestProject,
      'probeLocalRequests'
    )
    note('localRequests', requests)
    const seen = requests.map((r) => new URL(r.url).pathname + new URL(r.url).search)
    const expected = ['/index.html', '/style.css', '/script.js', '/module.mjs', '/image.svg', '/frame.html', '/canary.txt?via=xhr', '/worker.js']
    for (const pathname of [...expected, '/image.svg?via=web-image']) expect(seen).toContain(pathname)
    expect(requests.filter((r) => r.dest !== null || r.site !== null || r.mode !== null)).toEqual([])
  })

  test('ADR 0011 decision 7: alert and confirm reach CDP with hasBrowserHandler; Electron still opens its own box; prompt throws', async ({
    appWithTestProject,
    windowWithTestProject: _window,
    browserServers
  }) => {
    const view = await ProbeView.open(appWithTestProject)
    const url = browserServers.sites.static.url('/probes/site.html')
    await view.load(url)
    // Playwright would answer the dialog itself without a listener (T6).
    ;(await view.playwrightPage(url)).on('dialog', () => undefined)
    expect((await view.cdp('Page.enable')).ok).toBe(true)

    await view.eval('window.__probe.prompt()')
    await view.waitFor(`window.__probe.results.some(r => r.name === 'prompt')`, 'prompt returned')
    expect(await view.eval(`window.__probe.results.find(r => r.name === 'prompt').value`)).toBe('threw Error')
    expect(await view.protocolEvents('Page.javascriptDialogOpening')).toEqual([])

    for (const [kind, expected] of [
      ['alert', null],
      ['confirm', true]
    ] as const) {
      const before = (await view.protocolEvents('Page.javascriptDialogOpening')).length
      await view.eval(`window.__probe.${kind}()`)
      await expect.poll(async () => (await view.protocolEvents('Page.javascriptDialogOpening')).length, { timeout: WAIT_MS }).toBe(before + 1)
      const opening = (await view.protocolEvents<{ params: { type: string; hasBrowserHandler: boolean } }>('Page.javascriptDialogOpening')).at(-1)
      note(`${kind}Opening`, opening?.params)
      expect(opening?.params).toMatchObject({ type: kind, hasBrowserHandler: true })
      expect((await view.cdp('Page.handleJavaScriptDialog', { accept: true })).ok).toBe(true)
      await view.waitFor(`window.__probe.results.some(r => r.name === '${kind}')`, `${kind} returned`)
      expect(await view.eval(`window.__probe.results.find(r => r.name === '${kind}').value`)).toBe(expected)
    }
    const hostEvents = await browserHook<string[]>(appWithTestProject, 'probeHostEvents')
    note('hostWindowSheetEvents', hostEvents)
    // macOS shows Electron's box as a sheet on the window; it stays after CDP answered (no sheet-end).
    if (process.platform === 'darwin') expect(hostEvents).toEqual(['sheet-begin'])
  })

  test('ADR 0011 decision 7: window.print blocks the page, with no event for Erfana and no answer to the hang probe', async ({
    appWithTestProject,
    windowWithTestProject: _window,
    browserServers
  }) => {
    const view = await ProbeView.open(appWithTestProject)
    await view.load(browserServers.sites.static.url('/probes/site.html'))
    await view.waitForFirstPaint()
    const eventsBefore = (await view.hook<string[]>('probeContentsEvents')).length
    await view.eval('window.__probe.print()')
    // The hang probe's own command, capped: a page blocked in print never answers it.
    const probe = await view.cdp('Runtime.evaluate', HANG_PROBE_EVALUATE_PARAMS, '', HUNG_CALL_CAP_MS)
    note('hangProbeDuringPrint', probe)
    expect(probe.timedOut).toBe(true)
    const emitted = (await view.hook<string[]>('probeContentsEvents')).slice(eventsBefore)
    note('contentsEventsDuringPrint', emitted)
    expect(emitted.filter((name) => !['newListener', 'removeListener'].includes(name))).toEqual([])
    expect(await browserHook(appWithTestProject, 'probeHostEvents')).toEqual([])
  })

  test('025-FR-019 test CA: the fixture HTTPS certificate is untrusted by default in a tab', async ({ browserTabs, browserServers }) => {
    const page = await browserTabs.open()
    await browserHook(browserTabs.app, 'watchCertificates', page.tabId)
    const url = browserServers.sites.static.url('/index.html', { secure: true })
    await browserTabs.navigate(page.tabId, url)
    await expect
      .poll(async () => (await browserHook<{ failures: unknown[] }>(browserTabs.app, 'certificateEvents', page.tabId)).failures.length, {
        timeout: WAIT_MS
      })
      .toBeGreaterThan(0)
    const events = await browserHook<{ errors: Array<Record<string, unknown>>; failures: Array<Record<string, unknown>> }>(
      browserTabs.app,
      'certificateEvents',
      page.tabId
    )
    note('certificate', events)
    expect(events.errors).toEqual([
      { error: 'net::ERR_CERT_AUTHORITY_INVALID', url, spkiSha256: browserServers.tls.validSpkiSha256, issuer: 'Erfana e2e test CA (test only)' }
    ])
    expect(events.failures).toEqual([{ code: -202, description: 'ERR_CERT_AUTHORITY_INVALID', url, isMainFrame: true }])
  })
})

test.describe('spec 025 engine probes: capture end (fake camera)', () => {
  test.use({ extraLaunchArgs: [...BROWSER_CHROMIUM_ARGS, '--use-fake-device-for-media-stream'] })

  test('025-FR-019 / S-32: stopping a camera capture emits no webContents event', async ({
    appWithTestProject,
    windowWithTestProject: _window,
    browserServers
  }) => {
    // The probe session grants the camera (test only); getUserMedia needs a secure context, so localhost.
    const view = await ProbeView.open(appWithTestProject, { grantMedia: true })
    await view.load(browserServers.sites.static.url('/probes/site.html', { host: 'localhost' }))
    await view.waitForFirstPaint()
    await view.eval('window.__probe.startCamera()')
    await view.waitFor(`window.__probe.results.some(r => r.name === 'camera')`, 'camera answered')
    expect(await view.eval(`window.__probe.results.find(r => r.name === 'camera').value`)).toBe('live 1')
    const mark = (await view.hook<string[]>('probeContentsEvents')).length
    await view.eval('window.__probe.stopCamera()')
    await view.waitFor(`window.__probe.results.some(r => r.name === 'camera-stopped')`, 'camera stopped')
    expect(await view.eval(`window.__probe.results.find(r => r.name === 'camera-stopped').value`)).toBe('ended')
    // An answered command after the stop: anything the stop emitted in main came before it.
    expect((await view.cdp('Runtime.evaluate', HANG_PROBE_EVALUATE_PARAMS)).ok).toBe(true)
    const emitted = (await view.hook<string[]>('probeContentsEvents')).slice(mark)
    note('contentsEventsOnStop', emitted)
    expect(emitted).toEqual([])
  })
})
