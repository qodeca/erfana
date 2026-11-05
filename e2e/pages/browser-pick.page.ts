// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pick-and-send driver for one built-in browser tab (spec 025 commits 14–15).
 *
 * There is no pick UI before commit 19, so the driver calls what the renderer
 * will call – `window.api.browserTab.pickMode`, `refine`, `closePick`,
 * `writeCapture`, `discardCaptureFiles`, `targetStatus` – and reads main
 * through the `pick` test hook (`src/main/testHooks/browserPickHook.ts`):
 * the highlight Erfana asked for (S-1), the pick state and the faults.
 * `browser-tab:pick` events are recorded in the app window.
 *
 * Pointer and keys go through main-side `sendInputEvent` (S-27).
 * Condition-based waits only.
 */
import type { ElectronApplication, Page } from '@playwright/test'
import { expect } from '../fixtures/browserHarness'
import { browserHook, type BrowserPagePage } from './browser-page.page'
import type { BrowserTabPage } from './browser-tab.page'

export const PICK_WAIT_MS = 15_000
/** How long one aim at an element waits for its label before the box is read and the pointer moved again. */
const HOVER_SETTLE_MS = 2_000

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export interface HookHighlight {
  label: string
  box: Box | null
  sessionKey: string
  backendNodeId: number
  frameId: string
}

export interface PickSummaryRecord {
  name: string
  ancestors: string[]
  atTop: boolean
  atStart: boolean
  gone: boolean
}

export interface PickEventRecord {
  tabId: string
  kind: string
  label?: string | null
  note?: string
  on?: boolean
  captureId?: string
  summary?: PickSummaryRecord
  reason?: string
  frozen?: boolean
}

export interface HookPickState {
  active: boolean
  frozen: boolean
  capture: {
    id: string
    index: number
    firstIndex: number
    summary: PickSummaryRecord
    afterNavigation: boolean
    written: string[]
    pickPoint: { x: number; y: number }
  } | null
}

export type WriteCaptureAnswer =
  | { paths: { context: string; screenshot: string; crop: string } }
  | { guard: { kind: string; process: string | null } }
  | { error: string }

interface Recorder {
  __pickEvents?: PickEventRecord[]
  api: {
    browserTab: {
      onPick(cb: (e: PickEventRecord) => void): () => void
      pickMode(tabId: string, on: boolean): Promise<{ ok: boolean }>
      refine(request: { tabId: string; captureId: string; move: unknown }): Promise<{ ok: boolean }>
      closePick(request: { tabId: string; captureId: string; reason: string }): Promise<{ ok: boolean }>
      writeCapture(request: { tabId: string; captureId: string; terminalId: string; sendAnyway?: true }): Promise<WriteCaptureAnswer>
      discardCaptureFiles(tabId: string, captureId: string): Promise<{ ok: boolean }>
      targetStatus(terminalId: string): Promise<{ kind: string; process: string | null; fresh: boolean }>
    }
  }
}

/** Call `<hook>.<name>(...args)` on the main-process test hooks. */
export async function mainHook<T>(app: ElectronApplication, hook: string, name: string, ...args: unknown[]): Promise<T> {
  return (await app.evaluate(
    async (_electron, [hookName, fnName, fnArgs]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the hooks live on main's globalThis, untyped there
      const hooks = (globalThis as any).__erfanaTestHooks
      if (!hooks?.[hookName as string]) throw new Error('Test hooks are not installed (build with npm run build:e2e)')
      return hooks[hookName as string][fnName as string](...(fnArgs as unknown[]))
    },
    [hook, name, args] as const
  )) as T
}

async function installRecorder(appWindow: Page): Promise<void> {
  await appWindow.evaluate(() => {
    const w = window as unknown as Recorder
    if (w.__pickEvents) return
    const events: PickEventRecord[] = []
    w.__pickEvents = events
    // The still is large and not asserted here.
    w.api.browserTab.onPick((e) => events.push({ ...e, ...(e.kind === 'captured' ? { still: undefined } : {}) }))
  })
}

export function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function expectBoxNear(actual: Box | null, expected: Box, tolerance = 1): void {
  expect(actual).not.toBeNull()
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    expect(Math.abs(actual![key] - expected[key]), `${key}: ${actual![key]} vs ${expected[key]}`).toBeLessThanOrEqual(tolerance)
  }
}

/** The pick driver for one tab: the bridge calls, the hook reads and the pointer. */
export class PickDriver {
  constructor(
    readonly app: ElectronApplication,
    readonly window: Page,
    readonly page: BrowserPagePage
  ) {}

  get tabId(): string {
    return this.page.tabId
  }

  mode(on: boolean): Promise<{ ok: boolean }> {
    return this.window.evaluate(([id, flag]) => (window as unknown as Recorder).api.browserTab.pickMode(id, flag), [this.tabId, on] as const)
  }

  refine(captureId: string, move: unknown): Promise<{ ok: boolean }> {
    return this.window.evaluate(
      ([id, cid, m]) => (window as unknown as Recorder).api.browserTab.refine({ tabId: id, captureId: cid, move: m }),
      [this.tabId, captureId, move] as const
    )
  }

  close(captureId: string, reason: string): Promise<{ ok: boolean }> {
    return this.window.evaluate(
      ([id, cid, r]) => (window as unknown as Recorder).api.browserTab.closePick({ tabId: id, captureId: cid, reason: r }),
      [this.tabId, captureId, reason] as const
    )
  }

  write(captureId: string, terminalId: string, sendAnyway = false): Promise<WriteCaptureAnswer> {
    return this.window.evaluate(
      ([id, cid, tid, anyway]) =>
        (window as unknown as Recorder).api.browserTab.writeCapture({
          tabId: id,
          captureId: cid,
          terminalId: tid,
          ...(anyway ? { sendAnyway: true as const } : {})
        }),
      [this.tabId, captureId, terminalId, sendAnyway] as const
    )
  }

  discard(captureId: string): Promise<{ ok: boolean }> {
    return this.window.evaluate(
      ([id, cid]) => (window as unknown as Recorder).api.browserTab.discardCaptureFiles(id, cid),
      [this.tabId, captureId] as const
    )
  }

  targetStatus(terminalId: string): Promise<{ kind: string; process: string | null; fresh: boolean }> {
    return this.window.evaluate((tid) => (window as unknown as Recorder).api.browserTab.targetStatus(tid), terminalId)
  }

  highlight(): Promise<HookHighlight | null> {
    return mainHook(this.app, 'pick', 'highlight', this.tabId)
  }

  state(): Promise<HookPickState> {
    return mainHook(this.app, 'pick', 'state', this.tabId)
  }

  hook<T>(name: string, ...args: unknown[]): Promise<T> {
    return mainHook(this.app, 'pick', name, ...args)
  }

  events(): Promise<PickEventRecord[]> {
    return this.window.evaluate((id) => ((window as unknown as Recorder).__pickEvents ?? []).filter((e) => e.tabId === id), this.tabId)
  }

  async waitForEvent(match: (e: PickEventRecord) => boolean, after = 0): Promise<PickEventRecord> {
    await expect.poll(async () => (await this.events()).slice(after).some(match), { timeout: PICK_WAIT_MS }).toBe(true)
    return (await this.events()).slice(after).find(match)!
  }

  /** The CSS-px box of `selector` in the top document (or in the same-origin frame `frame`). */
  rect(selector: string, frame?: string): Promise<Box> {
    const doc = frame === undefined ? 'document' : `document.getElementById(${JSON.stringify(frame)}).contentDocument`
    return this.page.eval<Box>(
      `(() => { const r = ${doc}.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`
    )
  }

  async move(x: number, y: number): Promise<void> {
    await browserHook(this.app, 'move', this.tabId, x, y)
  }

  async key(keyCode: string, modifiers: string[] = []): Promise<void> {
    await browserHook(this.app, 'key', this.tabId, keyCode, modifiers)
  }

  /** Hover the centre of `box` and wait until the highlight shows a label starting with `prefix`. */
  async hover(box: Box, prefix: string): Promise<HookHighlight> {
    await this.move(Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2))
    return this.waitForLabel(prefix)
  }

  /**
   * Hover the centre of `selector` and wait until the highlight shows a label
   * starting with `prefix`. The box is read again and the pointer moved again
   * on every try: a layout shift between a read and the move (a late reflow,
   * a strip row) would otherwise leave the pointer on a neighbour – seen as
   * `div#:r1: 144 × 40` where `span#save-label` was meant. The label must
   * still match; only the aim is retried.
   */
  async hoverSelector(selector: string, prefix: string, frame?: string): Promise<HookHighlight> {
    const wanted = new RegExp(`^${escapeRe(prefix)}`)
    let shown: HookHighlight | null = null
    await expect(async () => {
      const box = await this.rect(selector, frame)
      await this.move(Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2))
      await expect.poll(async () => (shown = await this.highlight())?.label ?? '', { timeout: HOVER_SETTLE_MS }).toMatch(wanted)
    }, `the highlight on ${selector} reads ${prefix}`).toPass({ timeout: PICK_WAIT_MS })
    return shown!
  }

  async waitForLabel(prefix: string): Promise<HookHighlight> {
    await expect.poll(async () => (await this.highlight())?.label ?? '', { timeout: PICK_WAIT_MS }).toMatch(new RegExp(`^${escapeRe(prefix)}`))
    return (await this.highlight())!
  }
}

/** Open a tab on `url`, wait for it to load and record its pick events. */
export async function openPicker(browserTabs: BrowserTabPage, url: string): Promise<PickDriver> {
  const page = await browserTabs.open()
  await browserTabs.navigate(page.tabId, url)
  await page.waitForLoaded(url)
  await installRecorder(browserTabs.window)
  return new PickDriver(browserTabs.app, browserTabs.window, page)
}
