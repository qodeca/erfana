// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – e2e reads (docs/designs/comments/html-preview-comments.md
 * §12.4, §13 P3, P4 and P5 exits).
 *
 * Comment state is read main-side through the e2e hook the app installs on
 * `globalThis.__erfanaE2eComments` (`commentE2eHook.ts`; unpackaged build with
 * `ERFANA_E2E_TEST_HOOKS=1`, which the fixtures set), never from the page's
 * markup. The page's own DOM is read with the bounded preview reads
 * (`html-preview.native.ts`, `html-preview.frames.ts`).
 *
 * **The comment stub (P4).** The test can play main's side of the preload's
 * channels: `armCommentStub()` records what the page's frames send on
 * `preview-page:commentPick` and `preview-page:commentAnchors` (on
 * `webContents.ipc`, next to main's own listeners), and `sendCommentState()`
 * sends one frame a `preview-page:commentState`. Since P5 main answers the
 * same channels itself: it sends every frame its state on hello (the pins
 * included), so a stub state lasts until main's next one.
 * `clickAt()` is a trusted click at an element's centre, frame-aware, and
 * `accentPixelsNear()` reads the view's pixels where an element's pin is
 * drawn – the overlay lives in a closed shadow root, so pixels are the only
 * outside view of it.
 *
 * **The real service (P5).** `commentPanels()` / `commentPanelState()` read
 * each view's comment state from the hook (mode, reloads, the last scroll
 * restore, drafts, frames); `setCommentMode()`, `listComments()` and
 * `saveComment()` drive the renderer's real `window.api.previewComments`
 * bridge, and `recordDraftsOpened()` records its draft-opened events.
 *
 * Nothing here waits: callers poll. Condition-based waits only.
 */

import { expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'

import type { CommentLoadView } from '../../src/main/services/preview/comments/ElementTokenTable'
import type { CommentE2ePanelState } from '../../src/main/services/preview/comments/commentServiceTypes'
import type {
  CommentDraftOpened,
  CommentListResult,
  CommentSaveRequest,
  CommentSaveResult,
  CommentSetModeResult,
  PreviewCommentsBridge
} from '../../src/shared/ipc/preview-comment-schema'
import {
  EXEC_ACTION_CAP_MS,
  EXEC_READ_CAP_MS,
  installBoundedExec,
  withLastReadError,
  type BoundedExecGlobal
} from '../utils/bounded-exec'
import { evalInFrame } from './html-preview.frames'
import { evalInPreview, type PreviewTarget } from './html-preview.native'
import { PREVIEW_BUDGET_MS } from './html-preview.page'

export type { CommentE2ePanelState, CommentLoadView }

/** The attribute the served copy marks every eligible element with. */
export const ELEMENT_TOKEN_ATTR = 'data-erfana-el'

/** One file comments are unavailable for, and why. */
export interface CommentUnavailable {
  realPath: string
  reason: string
}

/** Every instrumented load of every live preview view, oldest first; `[]` before the hook exists. */
export async function commentLoads(app: ElectronApplication): Promise<CommentLoadView[]> {
  return app.evaluate(() => {
    const hook = (globalThis as { __erfanaE2eComments?: { loads(): CommentLoadView[] } })
      .__erfanaE2eComments
    return hook ? hook.loads() : []
  })
}

/** Every file comments are unavailable for; `[]` before the hook exists. */
export async function commentUnavailable(app: ElectronApplication): Promise<CommentUnavailable[]> {
  return app.evaluate(() => {
    const hook = (globalThis as { __erfanaE2eComments?: { unavailable(): CommentUnavailable[] } })
      .__erfanaE2eComments
    return hook ? hook.unavailable() : []
  })
}

/** True when `realPath` (any separator) names the project-relative `relPath`. */
export function namesFile(realPath: string, relPath: string): boolean {
  return realPath.replace(/\\/g, '/').endsWith(`/${relPath}`)
}

/**
 * The newest load of `relPath` in `scope`, or `undefined` – the one whose
 * tokens the live document carries.
 */
export function newestLoad(
  loads: readonly CommentLoadView[],
  relPath: string,
  scope: CommentLoadView['scope']
): CommentLoadView | undefined {
  return loads.filter(load => load.scope === scope && namesFile(load.realPath, relPath)).at(-1)
}

/**
 * A page expression: every token left in the live document, as a JSON array,
 * in document order. Since P4 the preload strips them at document start, so
 * a commented page reads `[]` too.
 */
export const DOM_TOKENS_EXPR =
  `JSON.stringify([...document.querySelectorAll('[${ELEMENT_TOKEN_ATTR}]')]` +
  `.map(el => el.getAttribute('${ELEMENT_TOKEN_ATTR}')))`

// ---------------------------------------------------------------------------
// The comment stub (P4): the test plays main's side of the preload's channels
// ---------------------------------------------------------------------------

/** What one frame sent on a comment channel, as the stub recorded it. */
export interface StubMessage<T = Record<string, unknown>> {
  /** The sender was the view's main frame. */
  fromMain: boolean
  /** The sender frame's URL (`''` when Electron could not name it). */
  frameUrl: string
  payload: T
}

/** Everything the stub recorded for one preview. */
export interface StubRecord {
  pick: StubMessage[]
  anchors: StubMessage<{ visible: string[]; hidden: string[]; overlay?: string }>[]
}

/** Where a stub call goes: a preview, and optionally one frame of it. */
export interface StubTarget extends PreviewTarget {
  /** A frame (not the page) whose URL contains this. */
  frameUrlIncludes?: string
  /** That frame's `<iframe>` element id in the page – for page coordinates. */
  iframeId?: string
}

const PICK_CHANNEL = 'preview-page:commentPick'
const ANCHORS_CHANNEL = 'preview-page:commentAnchors'
const STATE_CHANNEL = 'preview-page:commentState'

/**
 * Start recording the preview's picks and anchor reports. Idempotent per web
 * contents. `false` when no matching preview is live.
 */
export async function armCommentStub(app: ElectronApplication, target: PreviewTarget = {}): Promise<boolean> {
  return app.evaluate(({ webContents }, { urlIncludes, channels }) => {
    const wc = webContents.getAllWebContents().find((c) => {
      try {
        const url = c.getURL()
        return url.startsWith('erfana-preview://') && (urlIncludes === undefined || url.includes(urlIncludes))
      } catch {
        return false
      }
    })
    if (!wc) return false
    const g = globalThis as { __erfanaE2eCommentStub?: Record<number, Record<string, unknown[]>> }
    const stub = (g.__erfanaE2eCommentStub ??= {})
    if (stub[wc.id] !== undefined) return true
    const record: Record<string, unknown[]> = { pick: [], anchors: [] }
    stub[wc.id] = record
    const listen = (channel: string, into: unknown[]): void => {
      wc.ipc.on(channel, (event, payload) => {
        const frame = event.senderFrame
        into.push({ fromMain: frame === wc.mainFrame, frameUrl: frame?.url ?? '', payload })
      })
    }
    listen(channels.pick, record.pick)
    listen(channels.anchors, record.anchors)
    return true
  }, { urlIncludes: target.urlIncludes, channels: { pick: PICK_CHANNEL, anchors: ANCHORS_CHANNEL } })
}

/** What the stub recorded for the preview; `null` before {@link armCommentStub}. */
export async function commentStubRecord(app: ElectronApplication, target: PreviewTarget = {}): Promise<StubRecord | null> {
  return app.evaluate(({ webContents }, urlIncludes) => {
    const wc = webContents.getAllWebContents().find((c) => {
      try {
        const url = c.getURL()
        return url.startsWith('erfana-preview://') && (urlIncludes === undefined || url.includes(urlIncludes))
      } catch {
        return false
      }
    })
    const g = globalThis as { __erfanaE2eCommentStub?: Record<number, unknown> }
    return wc ? ((g.__erfanaE2eCommentStub?.[wc.id] as StubRecord | undefined) ?? null) : null
  }, target.urlIncludes)
}

/**
 * Send `state` to the page's main frame, or to the frame `frameUrlIncludes`
 * names, as main will (`WebFrameMain.send`). `false` when the frame is not live.
 */
export async function sendCommentState(
  app: ElectronApplication,
  state: Record<string, unknown>,
  target: StubTarget = {}
): Promise<boolean> {
  return app.evaluate(({ webContents }, { s, urlIncludes, frameUrl, channel }) => {
    const wc = webContents.getAllWebContents().find((c) => {
      try {
        const url = c.getURL()
        return url.startsWith('erfana-preview://') && (urlIncludes === undefined || url.includes(urlIncludes))
      } catch {
        return false
      }
    })
    if (!wc) return false
    const topId = wc.mainFrame.frameTreeNodeId
    const frame =
      frameUrl === undefined
        ? wc.mainFrame
        : wc.mainFrame.framesInSubtree.find((f) => f.frameTreeNodeId !== topId && f.url.includes(frameUrl))
    if (!frame) return false
    frame.send(channel, s)
    return true
  }, { s: state, urlIncludes: target.urlIncludes, frameUrl: target.frameUrlIncludes, channel: STATE_CHANNEL })
}

/**
 * A trusted left click (`sendInputEvent`) at the centre of `elementId` – in
 * the page, or in the frame `frameUrlIncludes` names, offset by its
 * `<iframe id=iframeId>`. `false` when the element or the frame is missing.
 */
export async function clickAt(app: ElectronApplication, elementId: string, target: StubTarget = {}): Promise<boolean> {
  await installBoundedExec(app)
  return app.evaluate(async ({ webContents }, { id, urlIncludes, frameUrl, iframeId, capMs }) => {
    const exec = (globalThis as unknown as BoundedExecGlobal).__erfanaE2eExec
    const wc = webContents.getAllWebContents().find((c) => {
      try {
        const url = c.getURL()
        return url.startsWith('erfana-preview://') && (urlIncludes === undefined || url.includes(urlIncludes))
      } catch {
        return false
      }
    })
    if (!wc) return false
    // An `<iframe>`'s content origin (its border box plus its border), or an
    // element's centre, in its document's viewport.
    const pointOf = (elementIdToFind: string, contentOrigin: boolean): string => `(() => {
      const el = document.getElementById(${JSON.stringify(elementIdToFind)})
      if (!el) return null
      const r = el.getBoundingClientRect()
      return ${contentOrigin ? '{ x: r.left + el.clientLeft, y: r.top + el.clientTop }' : '{ x: r.left + r.width / 2, y: r.top + r.height / 2 }'}
    })()`
    let offset = { x: 0, y: 0 }
    let scope: Parameters<typeof exec>[0] = wc
    if (frameUrl !== undefined && iframeId !== undefined) {
      const topId = wc.mainFrame.frameTreeNodeId
      const frame = wc.mainFrame.framesInSubtree.find((f) => f.frameTreeNodeId !== topId && f.url.includes(frameUrl))
      const at = await exec<{ x: number; y: number } | null>(wc, pointOf(iframeId, true), capMs, `clickAt: #${iframeId}`)
      if (!frame || at === null) return false
      offset = at
      scope = frame
    }
    const point = await exec<{ x: number; y: number } | null>(scope, pointOf(id, false), capMs, `clickAt: #${id}`)
    if (point === null) return false
    const x = Math.round(offset.x + point.x)
    const y = Math.round(offset.y + point.y)
    wc.sendInputEvent({ type: 'mouseMove', x, y })
    wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
    wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
    return true
  }, { id: elementId, urlIncludes: target.urlIncludes, frameUrl: target.frameUrlIncludes, iframeId: target.iframeId, capMs: EXEC_ACTION_CAP_MS })
}

/** The pin's fill (`--color-accent`, `DEFAULT_THEME.accent` in the preload) as red, green, blue. */
export const PIN_ACCENT_RGB = [0xa0, 0xa8, 0xff] as const

/**
 * How many pixels of the pin's fill colour the preview shows around the
 * top-right corner of `elementId`, where its pin is drawn (§10.5: the tail
 * tip 4 px outside that corner, the 24 px bubble above it). Read from
 * `capturePage()`, the overlay's only outside view. `null` when the preview,
 * the element or the capture (an undrawn view) is missing – the caller polls.
 */
export async function accentPixelsNear(
  app: ElectronApplication,
  elementId: string,
  target: PreviewTarget = {}
): Promise<number | null> {
  await installBoundedExec(app)
  return app.evaluate(async ({ webContents }, { id, urlIncludes, capMs, rgb }) => {
    const exec = (globalThis as unknown as BoundedExecGlobal).__erfanaE2eExec
    const wc = webContents.getAllWebContents().find((c) => {
      try {
        const url = c.getURL()
        return url.startsWith('erfana-preview://') && (urlIncludes === undefined || url.includes(urlIncludes))
      } catch {
        return false
      }
    })
    if (!wc) return null
    const corner = await exec<{ right: number; top: number; viewportWidth: number } | null>(
      wc,
      `(() => {
        const el = document.getElementById(${JSON.stringify(id)})
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { right: r.right, top: r.top, viewportWidth: innerWidth }
      })()`,
      capMs,
      `accentPixelsNear: #${id}`
    )
    if (corner === null) return null
    const image = await wc.capturePage()
    if (image.isEmpty()) return null
    const size = image.getSize()
    // CSS px → the capture's pixels: the capture is at the display's scale
    // factor times the page zoom (1.25 on a 125 % display), so measure it.
    const zoom = corner.viewportWidth > 0 ? size.width / corner.viewportWidth : wc.getZoomFactor()
    // The pin's 24 px box sits right of the corner and above it (clamped to
    // the viewport): a 64 × 48 CSS px window holds it with margin.
    const left = Math.max(0, Math.floor((corner.right - 30) * zoom))
    const top = Math.max(0, Math.floor((corner.top - 36) * zoom))
    const width = Math.min(size.width - left, Math.ceil(64 * zoom))
    const height = Math.min(size.height - top, Math.ceil(48 * zoom))
    if (width <= 0 || height <= 0) return 0
    const bitmap = image.crop({ x: left, y: top, width, height }).toBitmap()
    const near = (a: number, b: number): boolean => Math.abs(a - b) <= 24
    let count = 0
    for (let i = 0; i + 3 < bitmap.length; i += 4) {
      // BGRA on every platform Electron ships; RGBA accepted too.
      const bgra = near(bitmap[i], rgb[2]) && near(bitmap[i + 1], rgb[1]) && near(bitmap[i + 2], rgb[0])
      const rgba = near(bitmap[i], rgb[0]) && near(bitmap[i + 1], rgb[1]) && near(bitmap[i + 2], rgb[2])
      if (bgra || rgba) count += 1
    }
    return count
  }, { id: elementId, urlIncludes: target.urlIncludes, capMs: EXEC_READ_CAP_MS, rgb: [...PIN_ACCENT_RGB] })
}

/**
 * A page expression (main world): each `<div>` child of `<html>` – the
 * overlay host is the only one – as whether its shadow root is hidden from
 * the page (`shadowRoot === null`, SEC-21), as a JSON array.
 */
export const OVERLAY_HOSTS_EXPR =
  "JSON.stringify([...document.documentElement.children].filter(el => el.localName === 'div').map(el => el.shadowRoot === null))"

/** A page expression (main world): the overlay host – the one `<div>` child of `<html>` – or `undefined`. */
export const OVERLAY_HOST_EXPR = "[...document.documentElement.children].find(el => el.localName === 'div')"

/**
 * A page expression: whether the overlay host is showing in the top layer, as
 * `'true'` / `'false'` – `'none'` when there is no host.
 */
export const OVERLAY_HOST_OPEN_EXPR = `(() => { const host = ${OVERLAY_HOST_EXPR}; return host ? String(host.matches(':popover-open')) : 'none' })()`

/** Whether the stub has recorded an anchors report saying the overlay is unavailable. */
export async function overlayReportedUnavailable(app: ElectronApplication, target: PreviewTarget = {}): Promise<boolean> {
  const anchors = (await commentStubRecord(app, target))?.anchors ?? []
  return anchors.some(report => report.payload.overlay === 'unavailable')
}

/**
 * Wait for the newest `scope` load of `relPath` with `blockCount` blocks, every
 * one resolved to a token (and passing `isNew`, for a reload).
 */
export async function waitForCommentLoad(
  app: ElectronApplication,
  relPath: string,
  scope: CommentLoadView['scope'],
  blockCount: number,
  isNew: (load: CommentLoadView) => boolean = () => true
): Promise<CommentLoadView> {
  let found: CommentLoadView | undefined
  await expect
    .poll(
      async () => {
        found = newestLoad(await commentLoads(app), relPath, scope)
        return found !== undefined && isNew(found) && found.blocks.every(b => b.token !== undefined)
          ? found.blocks.length
          : -1
      },
      { timeout: PREVIEW_BUDGET_MS, message: `no instrumented ${scope} load of ${relPath}` }
    )
    .toBe(blockCount)
  return found as CommentLoadView
}

/**
 * Turn comment mode on in the page (or one frame) through the stub, and wait
 * until the overlay is up there – so a click that follows is a comment-mode
 * click. Arms the stub first.
 */
export async function enterStubCommentMode(app: ElectronApplication, target: StubTarget = {}): Promise<void> {
  expect(await armCommentStub(app, target)).toBe(true)
  expect(await sendCommentState(app, { mode: true, commentable: true, icons: [] }, target)).toBe(true)
  const { frameUrlIncludes } = target
  await withLastReadError(
    app,
    expect
      .poll(
        async () =>
          frameUrlIncludes === undefined
            ? await evalInPreview(app, OVERLAY_HOSTS_EXPR, target)
            : await evalInFrame(app, frameUrlIncludes, OVERLAY_HOSTS_EXPR, target),
        { timeout: PREVIEW_BUDGET_MS, message: 'the overlay never came up in comment mode' }
      )
      .toBe('[true]')
  )
}

/** Click `elementId` in comment mode and return the pick it sent (the stub must be armed). */
export async function pickAt(
  app: ElectronApplication,
  elementId: string,
  target: StubTarget = {}
): Promise<StubMessage> {
  const before = (await commentStubRecord(app, target))?.pick.length ?? 0
  expect(await clickAt(app, elementId, target), `#${elementId} not found`).toBe(true)
  let picks: StubMessage[] = []
  await expect
    .poll(
      async () => {
        picks = (await commentStubRecord(app, target))?.pick ?? []
        return picks.length
      },
      { timeout: PREVIEW_BUDGET_MS, message: `no pick for #${elementId}` }
    )
    .toBeGreaterThan(before)
  return picks[picks.length - 1]
}

// ---------------------------------------------------------------------------
// The real service (P5): main's comment state and the renderer's bridge
// ---------------------------------------------------------------------------

/** Every live view's comment state (the service, P5); `[]` before the hook exists. */
export async function commentPanels(app: ElectronApplication): Promise<CommentE2ePanelState[]> {
  return app.evaluate(() => {
    const hook = (globalThis as { __erfanaE2eComments?: { panels(): CommentE2ePanelState[] } })
      .__erfanaE2eComments
    return hook ? hook.panels() : []
  })
}

/** One panel's comment state; `undefined` when no live view has that panel. */
export async function commentPanelState(
  app: ElectronApplication,
  panelId: string
): Promise<CommentE2ePanelState | undefined> {
  return app.evaluate((_electron, id) => {
    const hook = (globalThis as { __erfanaE2eComments?: { state(panelId: string): CommentE2ePanelState | undefined } })
      .__erfanaE2eComments
    return hook?.state(id)
  }, panelId)
}

/**
 * Wait for the one live view with comments, once its page has said hello
 * (a commentable frame), and return its state – `panelId` included.
 */
export async function waitForCommentPanel(app: ElectronApplication): Promise<CommentE2ePanelState> {
  let found: CommentE2ePanelState | undefined
  await expect
    .poll(
      async () => {
        const panels = await commentPanels(app)
        found = panels.length === 1 ? panels[0] : undefined
        return found?.commentableFrames ?? 0
      },
      { timeout: PREVIEW_BUDGET_MS, message: 'no single preview with a commentable page' }
    )
    .toBeGreaterThan(0)
  return found as CommentE2ePanelState
}

type BridgeWindow = { api: { previewComments: PreviewCommentsBridge } }

/** Turn comment mode on or off through the renderer's real bridge. */
export async function setCommentMode(
  page: Page,
  panelId: string,
  on: boolean,
  showIcons = true
): Promise<CommentSetModeResult> {
  return page.evaluate(
    request => (window as unknown as BridgeWindow).api.previewComments.setMode(request),
    { panelId, on, showIcons }
  )
}

/** Main's file list for the panel (`preview:commentList`), through the renderer's real bridge. */
export async function listComments(page: Page, panelId: string): Promise<CommentListResult> {
  return page.evaluate(id => (window as unknown as BridgeWindow).api.previewComments.list(id), panelId)
}

/** Save through the renderer's real bridge (`preview:commentSave`). */
export async function saveComment(page: Page, request: CommentSaveRequest): Promise<CommentSaveResult> {
  return page.evaluate(r => (window as unknown as BridgeWindow).api.previewComments.save(r), request)
}

type DraftRecorder = { __erfanaE2eDrafts?: CommentDraftOpened[] }

/** Start recording the window's `preview:commentDraftOpened` events. Idempotent. */
export async function recordDraftsOpened(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as BridgeWindow & DraftRecorder
    if (w.__erfanaE2eDrafts !== undefined) return
    const drafts: CommentDraftOpened[] = []
    w.__erfanaE2eDrafts = drafts
    w.api.previewComments.onDraftOpened(payload => {
      drafts.push(payload)
    })
  })
}

/** Every draft-opened event recorded since {@link recordDraftsOpened}. */
export async function draftsOpened(page: Page): Promise<CommentDraftOpened[]> {
  return page.evaluate(() => (window as unknown as DraftRecorder).__erfanaE2eDrafts ?? [])
}

/** Wait for draft-opened event number `count` (1-based) and return it. */
export async function waitForDraftOpened(page: Page, count: number): Promise<CommentDraftOpened> {
  let drafts: CommentDraftOpened[] = []
  await expect
    .poll(
      async () => {
        drafts = await draftsOpened(page)
        return drafts.length
      },
      { timeout: PREVIEW_BUDGET_MS, message: `draft-opened event ${count} never came` }
    )
    .toBeGreaterThanOrEqual(count)
  return drafts[count - 1]
}

// ---------------------------------------------------------------------------
// The renderer UI (P6): driving the page the way a reviewer does
// ---------------------------------------------------------------------------

/**
 * Hover `elementId`, then a trusted right-click at its centre (`sendInputEvent`
 * – a mouse move, then the right button pressed and released), in the page or
 * in the frame `frameUrlIncludes` names. Blink raises the `contextmenu` event
 * from that press on every platform (on release on Windows), which is what the
 * comment overlay picks on. `false` when the element or the frame is missing.
 */
export async function rightClickAt(app: ElectronApplication, elementId: string, target: StubTarget = {}): Promise<boolean> {
  await installBoundedExec(app)
  return app.evaluate(async ({ webContents }, { id, urlIncludes, frameUrl, iframeId, capMs }) => {
    const exec = (globalThis as unknown as BoundedExecGlobal).__erfanaE2eExec
    const wc = webContents.getAllWebContents().find((c) => {
      try {
        const url = c.getURL()
        return url.startsWith('erfana-preview://') && (urlIncludes === undefined || url.includes(urlIncludes))
      } catch {
        return false
      }
    })
    if (!wc) return false
    const pointOf = (elementIdToFind: string, contentOrigin: boolean): string => `(() => {
      const el = document.getElementById(${JSON.stringify(elementIdToFind)})
      if (!el) return null
      const r = el.getBoundingClientRect()
      return ${contentOrigin ? '{ x: r.left + el.clientLeft, y: r.top + el.clientTop }' : '{ x: r.left + r.width / 2, y: r.top + r.height / 2 }'}
    })()`
    let offset = { x: 0, y: 0 }
    let scope: Parameters<typeof exec>[0] = wc
    if (frameUrl !== undefined && iframeId !== undefined) {
      const topId = wc.mainFrame.frameTreeNodeId
      const frame = wc.mainFrame.framesInSubtree.find((f) => f.frameTreeNodeId !== topId && f.url.includes(frameUrl))
      const at = await exec<{ x: number; y: number } | null>(wc, pointOf(iframeId, true), capMs, `rightClickAt: #${iframeId}`)
      if (!frame || at === null) return false
      offset = at
      scope = frame
    }
    const point = await exec<{ x: number; y: number } | null>(scope, pointOf(id, false), capMs, `rightClickAt: #${id}`)
    if (point === null) return false
    const x = Math.round(offset.x + point.x)
    const y = Math.round(offset.y + point.y)
    wc.sendInputEvent({ type: 'mouseMove', x, y })
    wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'right', clickCount: 1 })
    wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'right', clickCount: 1 })
    return true
  }, { id: elementId, urlIncludes: target.urlIncludes, frameUrl: target.frameUrlIncludes, iframeId: target.iframeId, capMs: EXEC_ACTION_CAP_MS })
}

/**
 * Split `after` against `before`, line by line, into the one run of whole
 * lines a write inserted: the lines both share in front of it, the inserted
 * lines, and the lines both share after it (each part joined with `\n`).
 * `null` when `after` is not `before` with exactly one run of lines inserted
 * (anything removed or changed elsewhere). Whole lines, because a block is
 * written on lines of its own – a character diff would slide the split into
 * the indentation and the `<` the block and the element share.
 */
export function insertedStretch(
  before: string,
  after: string
): { head: string; inserted: string; tail: string } | null {
  const was = before.split(/\r?\n/)
  const now = after.split(/\r?\n/)
  if (now.length <= was.length) return null
  let start = 0
  while (start < was.length && was[start] === now[start]) start += 1
  let end = 0
  while (end < was.length - start && was[was.length - 1 - end] === now[now.length - 1 - end]) end += 1
  if (start + end !== was.length) return null
  return {
    head: was.slice(0, start).join('\n'),
    inserted: now.slice(start, now.length - end).join('\n'),
    tail: was.slice(was.length - end).join('\n')
  }
}
