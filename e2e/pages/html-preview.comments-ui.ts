// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – the reviewer's journeys in e2e
 * (docs/designs/html-preview-comments.md §12.4, §13 P7).
 *
 * The P7 specs (`html-preview-comments{,.frames,.safety,.perf}.e2e.ts`) drive
 * the real UI the way a reviewer does. This module holds what they share, on
 * top of the P3–P6 reads in `html-preview.comments.ts`:
 *
 * - **Where an element is** ({@link elementBox}): its box in the preview's
 *   top-level viewport, through any chain of same-project frames – each
 *   frame's offset is its `<iframe>`'s content origin in the parent.
 * - **Trusted input** at that box: {@link mouseAt} (hover, left or right
 *   click), {@link clickPin} (the speech bubble at the element's top-right),
 *   {@link pressInPage} (a key with modifiers, native focus in the page first).
 * - **Pixels** ({@link pinCoverage}, {@link accentInStill}): the overlay lives in
 *   a closed shadow root, so a pin or an outline is seen only in the view's
 *   capture, or in the still frame the renderer shows while a popup is open.
 * - **Erfana's chrome** ({@link CommentChrome}): the toolbar tools and the
 *   drawer scoped to one preview tab, the menu and the window (portals).
 * - **The disk oracle** ({@link singleBlockInsert}): `after` is `before` with
 *   exactly one comment block inserted, byte for byte, found without
 *   `splice.ts` (§12.4 "Independent disk oracle").
 * - **The identity** ({@link setGlobalSetting}, {@link resetCommentSettings}):
 *   the worker's home outlives the app, so a spec that sets the identity or
 *   turns the feature off puts it back in `afterEach`.
 *
 * Nothing here sleeps: callers poll, and every wait is condition-based.
 */

import * as fsp from 'fs/promises'
import { expect } from '@playwright/test'
import type { ElectronApplication, Locator, Page } from '@playwright/test'

import {
  EXEC_READ_CAP_MS,
  installBoundedExec,
  type BoundedExecGlobal
} from '../utils/bounded-exec'
import {
  PIN_BOX_PX,
  PIN_EDGE_INSET_PX,
  PIN_TIP,
  PIN_TIP_OFFSET_PX
} from '../../src/preload/previewPageComments/constants'
import { evalInFrame } from './html-preview.frames'
import { evalInPreview } from './html-preview.native'
import { HtmlPreviewPage, PREVIEW_BUDGET_MS, type PreviewTarget } from './html-preview.page'
import {
  OVERLAY_HOSTS_EXPR,
  PIN_ACCENT_RGB,
  commentPanelState,
  commentPanels,
  waitForCommentPanel
} from './html-preview.comments'

// ---------------------------------------------------------------------------
// Settings: identity and the feature flag
// ---------------------------------------------------------------------------

type SettingsWindow = {
  api: { globalSettings: { set(key: string, value: unknown): Promise<{ success: boolean }> } }
}

/** Set one app-level setting through the renderer's real bridge. */
export async function setGlobalSetting(page: Page, key: string, value: unknown): Promise<void> {
  const result = await page.evaluate(
    ({ k, v }) => (window as unknown as SettingsWindow).api.globalSettings.set(k, v),
    { k: key, v: value }
  )
  expect(result, `globalSettings.set('${key}')`).toEqual({ success: true })
}

type SettingsReadWindow = {
  api: { globalSettings: { get(): Promise<{ success: boolean; settings?: Record<string, unknown> }> } }
}

/** One app-level setting as main holds it now, through the renderer's real bridge. */
export async function globalSetting(page: Page, key: string): Promise<unknown> {
  return page.evaluate(async k => {
    const result = await (window as unknown as SettingsReadWindow).api.globalSettings.get()
    return result.settings?.[k]
  }, key)
}

/** A reviewer identity whose privacy notice was already seen: no identity step. */
export function reviewer(name: string, email?: string): Record<string, unknown> {
  return { authorName: name, ...(email === undefined ? {} : { authorEmail: email }), identityNoticeSeen: true }
}

/**
 * Put the worker home's comment settings back: identity unset (so a later
 * spec still sees the first-comment identity step, E-001) and the feature on.
 */
export async function resetCommentSettings(page: Page): Promise<void> {
  await setGlobalSetting(page, 'comments', { identityNoticeSeen: false })
  await setGlobalSetting(page, 'htmlPreview', { enabled: true, comments: { enabled: true } })
}

// ---------------------------------------------------------------------------
// Opening a page and comment mode
// ---------------------------------------------------------------------------

/**
 * Open `relPath`, wait until its document carries `title`, and return the
 * panel id of the comment panel it added – the one not live before.
 */
export async function openCommentPage(
  preview: HtmlPreviewPage,
  app: ElectronApplication,
  relPath: string,
  title: string
): Promise<string> {
  const known = new Set((await commentPanels(app)).map(panel => panel.panelId))
  await preview.open(relPath)
  await preview.withReadError(
    expect
      .poll(async () => (await preview.snapshot(HtmlPreviewPage.target(relPath)))?.docTitle, {
        timeout: PREVIEW_BUDGET_MS,
        message: `${relPath} never showed its ${title} title`
      })
      .toBe(title)
  )
  let panelId: string | undefined
  await expect
    .poll(
      async () => {
        const fresh = (await commentPanels(app)).filter(panel => !known.has(panel.panelId))
        panelId = fresh.length === 1 ? fresh[0].panelId : undefined
        return panelId !== undefined
      },
      { timeout: PREVIEW_BUDGET_MS, message: `no comment panel for ${relPath}` }
    )
    .toBe(true)
  return panelId as string
}

/** The overlay host is up in the page (or in the frame `frameUrlIncludes` names). */
export async function waitForOverlay(
  preview: HtmlPreviewPage,
  app: ElectronApplication,
  target: PreviewTarget,
  frameUrlIncludes?: string
): Promise<void> {
  await preview.withReadError(
    expect
      .poll(
        () =>
          frameUrlIncludes === undefined
            ? preview.eval(OVERLAY_HOSTS_EXPR, target)
            : evalInFrame(app, frameUrlIncludes, OVERLAY_HOSTS_EXPR, target),
        { timeout: PREVIEW_BUDGET_MS, message: 'the overlay never came up' }
      )
      .toBe('[true]')
  )
}

/** Erfana's own chrome for one preview tab (`basename` names the tab). */
export class CommentChrome {
  constructor(
    private readonly page: Page,
    private readonly preview: HtmlPreviewPage,
    private readonly basename: string
  ) {}

  private panel(): Locator {
    return this.preview.panel(this.basename)
  }

  modeButton(): Locator {
    return this.panel().getByTestId('preview-band-comment-mode')
  }

  listButton(): Locator {
    return this.panel().getByTestId('preview-band-comments')
  }

  iconsButton(): Locator {
    return this.panel().getByTestId('preview-band-comment-icons')
  }

  drawer(): Locator {
    return this.panel().getByTestId('comment-drawer')
  }

  drawerRows(): Locator {
    return this.drawer().getByTestId('comment-drawer-row')
  }

  filter(key: 'open' | 'resolved' | 'attention'): Locator {
    return this.drawer().getByTestId(`comment-filter-${key}`)
  }

  announce(): Locator {
    return this.panel().getByTestId('comment-announce')
  }

  /** The element menu (a portal: one at a time in the window). */
  menu(): Locator {
    return this.page.getByTestId('comment-context-menu')
  }

  /** The comment window (a portal: one at a time in the window). */
  window(): Locator {
    return this.page.getByTestId('comment-window')
  }

  /** Comment mode on with the toolbar toggle; main agrees and the page is commentable. */
  async modeOn(app: ElectronApplication, panelId: string, target: PreviewTarget): Promise<void> {
    const button = this.modeButton()
    await expect(button).not.toHaveAttribute('aria-disabled', 'true', { timeout: PREVIEW_BUDGET_MS })
    if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click()
    await expect(button).toHaveAttribute('aria-pressed', 'true', { timeout: PREVIEW_BUDGET_MS })
    await expect
      .poll(async () => (await commentPanelState(app, panelId))?.mode, {
        timeout: PREVIEW_BUDGET_MS,
        message: 'main never turned comment mode on'
      })
      .toBe(true)
    // Main reloads a page without blocks instrumented; it says hello as commentable.
    await expect
      .poll(async () => (await commentPanelState(app, panelId))?.commentableFrames ?? 0, {
        timeout: PREVIEW_BUDGET_MS,
        message: 'the page never said hello as a commentable frame'
      })
      .toBeGreaterThan(0)
    await waitForOverlay(this.preview, app, target)
  }

  /** Open the drawer from the toolbar and wait for its list to be read. */
  async openDrawer(): Promise<void> {
    if ((await this.drawer().count()) === 0) await this.listButton().click()
    await expect(this.drawer()).toBeVisible({ timeout: PREVIEW_BUDGET_MS })
    await expect(this.drawer().getByRole('status')).toHaveCount(0, { timeout: PREVIEW_BUDGET_MS })
  }

  /**
   * In an open new-comment window: answer the identity step when it shows
   * (`name`), type `text` and Save; wait until the window has closed and the
   * polite region says where the comment went.
   */
  async saveNewComment(text: string, file: string, name = 'Reviewer P7'): Promise<void> {
    const win = this.window()
    await expect(win).toHaveAttribute('data-view', /^(identity|new)$/, { timeout: PREVIEW_BUDGET_MS })
    if ((await win.getAttribute('data-view')) === 'identity') {
      await this.page.getByTestId('comment-identity-name').fill(name)
      await this.page.getByTestId('comment-identity-continue').click()
    }
    await expect(win).toHaveAttribute('data-view', 'new', { timeout: PREVIEW_BUDGET_MS })
    await this.page.getByTestId('comment-new-field').fill(text)
    await this.page.getByTestId('comment-save').click()
    await expect(win).toHaveCount(0, { timeout: PREVIEW_BUDGET_MS })
    await expect(this.announce()).toHaveText(`Comment saved to ${file}.`, { timeout: PREVIEW_BUDGET_MS })
  }

  /** Open a message's `…` menu in the window and choose `item` ("Edit" or "Delete…"). */
  async messageAction(index: number, item: 'Edit' | 'Delete…'): Promise<void> {
    await this.window().getByTestId('comment-message-actions').nth(index).click()
    await this.page.getByRole('menuitem', { name: item }).click()
  }
}

/** Wait for main's comment panel of the one live preview, and return its id. */
export async function onlyCommentPanel(app: ElectronApplication): Promise<string> {
  return (await waitForCommentPanel(app)).panelId
}

// ---------------------------------------------------------------------------
// Where an element is, and trusted input there
// ---------------------------------------------------------------------------

/** One hop into a same-project frame: its `<iframe id>` in the parent, and a substring of its URL. */
export interface FrameStep {
  iframeId: string
  frameUrlIncludes: string
}

/** A preview, and the chain of frames (outermost first) the element lives in. */
export interface ElementPlace extends PreviewTarget {
  frames?: FrameStep[]
  /**
   * Read the element's first client rect (`getClientRects()[0]`) instead of
   * `getBoundingClientRect()` – for a hostile page that overrides the latter
   * in its own world, which the e2e reads share.
   */
  clientRects?: boolean
}

/** An element's box in the preview's top-level viewport (CSS px), and that viewport's size. */
export interface ElementBox {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
  /** `innerWidth` / `innerHeight`: scrollbars included, as the view's capture is. */
  viewportWidth: number
  viewportHeight: number
  /**
   * The visible viewport, scrollbars excluded – what the overlay clamps a pin
   * to (`viewportOf`, §19 Rev 4 "pins at the right edge").
   */
  visibleWidth: number
  visibleHeight: number
}

/**
 * The box of `#elementId` in the preview's top-level viewport, through the
 * frames `place.frames` names. `null` when the preview, a frame or the
 * element is missing (or mid-load) – the caller polls.
 */
export async function elementBox(
  app: ElectronApplication,
  elementId: string,
  place: ElementPlace = {}
): Promise<ElementBox | null> {
  await installBoundedExec(app)
  return app.evaluate(async ({ webContents }, { id, urlIncludes, frames, capMs, clientRects }) => {
    const { __erfanaE2eExec: exec, __erfanaE2eTolerable: tolerable } =
      globalThis as unknown as BoundedExecGlobal
    const wc = webContents.getAllWebContents().find((c) => {
      try {
        const url = c.getURL()
        return url.startsWith('erfana-preview://') && (urlIncludes === undefined || url.includes(urlIncludes))
      } catch {
        return false
      }
    })
    if (!wc) return null
    const rectOf = (target: string, contentOrigin: boolean): string => `(() => {
      const el = document.getElementById(${JSON.stringify(target)})
      if (!el) return null
      const r = ${clientRects ? 'el.getClientRects()[0]' : 'el.getBoundingClientRect()'}
      if (!r) return null
      return ${contentOrigin ? '{ x: r.left + el.clientLeft, y: r.top + el.clientTop }' : '{ left: r.left, top: r.top, width: r.width, height: r.height }'}
    })()`
    // The visible size as the overlay's `viewportOf` reads it: the scrolling
    // root's client size, never past the inner size, the inner size when 0.
    const viewExpr = `(() => {
      const root = document.compatMode === 'BackCompat' ? document.body : document.documentElement
      const visible = (client, inner) => (client > 0 ? Math.min(client, inner) : inner)
      return {
        w: innerWidth,
        h: innerHeight,
        vw: visible(root ? root.clientWidth : 0, innerWidth),
        vh: visible(root ? root.clientHeight : 0, innerHeight)
      }
    })()`
    try {
      const view = await exec<{ w: number; h: number; vw: number; vh: number }>(wc, viewExpr, capMs, 'elementBox: viewport')
      let x = 0
      let y = 0
      let scope: Parameters<typeof exec>[0] = wc
      const topId = wc.mainFrame.frameTreeNodeId
      for (const step of frames) {
        const at = await exec<{ x: number; y: number } | null>(scope, rectOf(step.iframeId, true), capMs, `elementBox: #${step.iframeId}`)
        const frame = wc.mainFrame.framesInSubtree.find((f) => f.frameTreeNodeId !== topId && f.url.includes(step.frameUrlIncludes))
        if (at === null || !frame) return null
        x += at.x
        y += at.y
        scope = frame
      }
      const r = await exec<{ left: number; top: number; width: number; height: number } | null>(scope, rectOf(id, false), capMs, `elementBox: #${id}`)
      if (r === null) return null
      return {
        left: x + r.left,
        top: y + r.top,
        right: x + r.left + r.width,
        bottom: y + r.top + r.height,
        width: r.width,
        height: r.height,
        viewportWidth: view.w,
        viewportHeight: view.h,
        visibleWidth: view.vw,
        visibleHeight: view.vh
      }
    } catch (err) {
      if (tolerable(err)) return null
      throw err
    }
  }, { id: elementId, urlIncludes: place.urlIncludes, frames: place.frames ?? [], capMs: EXEC_READ_CAP_MS, clientRects: place.clientRects === true })
}

/** {@link elementBox}, polled until the element is there. */
export async function waitForBox(app: ElectronApplication, elementId: string, place: ElementPlace = {}): Promise<ElementBox> {
  let box: ElementBox | null = null
  await expect
    .poll(async () => (box = await elementBox(app, elementId, place)) !== null, {
      timeout: PREVIEW_BUDGET_MS,
      message: `#${elementId} never appeared in the preview`
    })
    .toBe(true)
  return box as unknown as ElementBox
}

/** The centre of a box, in whole CSS px. */
export function centreOf(box: ElementBox): { x: number; y: number } {
  return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) }
}

/**
 * Trusted pointer input at `point` (top-level viewport CSS px): a move, and a
 * press and release of `button` unless it is `'none'` (a hover). The screen
 * point travels too (`globalX`/`globalY`), as R3-5 needs for the menu point.
 */
export async function mouseAt(
  app: ElectronApplication,
  point: { x: number; y: number },
  button: 'left' | 'right' | 'none',
  target: PreviewTarget = {}
): Promise<boolean> {
  return app.evaluate(({ webContents, BrowserWindow }, { x, y, which, urlIncludes }) => {
    const wc = webContents.getAllWebContents().find((c) => {
      try {
        const url = c.getURL()
        return url.startsWith('erfana-preview://') && (urlIncludes === undefined || url.includes(urlIncludes))
      } catch {
        return false
      }
    })
    if (!wc) return false
    // The view's place on screen: the host window's content origin plus the view's bounds.
    let globalX = x
    let globalY = y
    for (const win of BrowserWindow.getAllWindows()) {
      const view = win.contentView.children.find((v) => (v as { webContents?: unknown }).webContents === wc) as
        | { getBounds(): { x: number; y: number } }
        | undefined
      if (view === undefined) continue
      const content = win.getContentBounds()
      const bounds = view.getBounds()
      const zoom = wc.getZoomFactor()
      globalX = Math.round(content.x + bounds.x + x * zoom)
      globalY = Math.round(content.y + bounds.y + y * zoom)
    }
    wc.sendInputEvent({ type: 'mouseMove', x, y, globalX, globalY })
    if (which === 'none') return true
    wc.sendInputEvent({ type: 'mouseDown', x, y, globalX, globalY, button: which, clickCount: 1 })
    wc.sendInputEvent({ type: 'mouseUp', x, y, globalX, globalY, button: which, clickCount: 1 })
    return true
  }, { x: point.x, y: point.y, which: button, urlIncludes: target.urlIncludes })
}

/**
 * Whether the preview's native view is shown (`View.getVisible()`), for the
 * preview `target` names; `null` when no view serves it.
 */
export async function viewShown(app: ElectronApplication, target: PreviewTarget = {}): Promise<boolean | null> {
  return app.evaluate(({ BrowserWindow }, urlIncludes) => {
    for (const win of BrowserWindow.getAllWindows()) {
      for (const child of win.contentView.children) {
        const wc = (child as { webContents?: { getURL(): string; isDestroyed(): boolean } }).webContents
        try {
          if (wc && !wc.isDestroyed() && wc.getURL().startsWith('erfana-preview://') && (urlIncludes === undefined || wc.getURL().includes(urlIncludes))) {
            return child.getVisible()
          }
        } catch {
          // View mid-teardown; keep scanning.
        }
      }
    }
    return null
  }, target.urlIncludes)
}

/**
 * Wait until the view is shown again: input sent to a view still hidden
 * behind its still frame (a popup just closed) never reaches the page.
 */
export async function waitForViewShown(app: ElectronApplication, target: PreviewTarget = {}): Promise<void> {
  await expect
    .poll(() => viewShown(app, target), { timeout: PREVIEW_BUDGET_MS, message: 'the preview stayed hidden' })
    .toBe(true)
}

/** Hover, then press `button` at the centre of `#elementId` (frame-aware), once the view is shown. */
export async function clickElement(
  app: ElectronApplication,
  elementId: string,
  button: 'left' | 'right' | 'none',
  place: ElementPlace = {}
): Promise<void> {
  await waitForViewShown(app, place)
  const point = centreOf(await waitForBox(app, elementId, place))
  expect(await mouseAt(app, point, 'none', place), 'no preview to hover').toBe(true)
  if (button !== 'none') expect(await mouseAt(app, point, button, place), 'no preview to click').toBe(true)
}

/**
 * Where the pin of an element is drawn (§10.5): the bubble's 24 px box with
 * its tail 4 px outside the element's top-right corner, clamped to the page's
 * visible viewport – scrollbars excluded – 4 px inside its edges (§19 Rev 4
 * "pins at the right edge"). Page only: a frame's pins sit in the frame's
 * viewport. The box's top-left corner, in CSS px.
 */
export function pinBoxOf(box: ElementBox): { left: number; top: number } {
  const clamp = (v: number, max: number): number => Math.min(Math.max(v, PIN_EDGE_INSET_PX), max)
  return {
    left: clamp(box.right + PIN_TIP_OFFSET_PX - PIN_TIP.x, box.visibleWidth - PIN_BOX_PX - PIN_EDGE_INSET_PX),
    top: clamp(box.top - PIN_TIP_OFFSET_PX - PIN_TIP.y, box.visibleHeight - PIN_BOX_PX - PIN_EDGE_INSET_PX)
  }
}

/** The middle of the pin's body ({@link pinBoxOf}). */
export function pinPoint(box: ElementBox): { x: number; y: number } {
  const pin = pinBoxOf(box)
  return { x: Math.round(pin.left + 12), y: Math.round(pin.top + 10) }
}

/** A page expression: resolves `'painted'` once the page has drawn two frames. */
const TWO_FRAMES_EXPR = "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve('painted'))))"

/**
 * A trusted click on the pin of `#elementId` (page only: a frame's pins sit in
 * the frame's viewport). Hover first, and let the page paint: in comment mode
 * the hover re-draws the pin, and a press sent in the same task as the move
 * would land on the pin being replaced – a reviewer's hand never moves and
 * clicks within one frame.
 */
export async function clickPin(app: ElectronApplication, elementId: string, place: ElementPlace = {}): Promise<void> {
  await waitForViewShown(app, place)
  const box = await waitForBox(app, elementId, place)
  const point = pinPoint(box)
  expect(await mouseAt(app, point, 'none', place)).toBe(true)
  await expect
    .poll(() => evalInPreview(app, TWO_FRAMES_EXPR, place), { timeout: PREVIEW_BUDGET_MS, message: 'the page never painted after the hover' })
    .toBe('painted')
  expect(await mouseAt(app, point, 'left', place)).toBe(true)
}

/**
 * Press `keyCode` (an Electron accelerator key name: `Tab`, `Enter`, `Up`,
 * `Escape`, `M` …) in the preview as real input, with `modifiers`; native
 * focus goes into the page first, as `preview:focusPage` does.
 */
export async function pressInPage(
  app: ElectronApplication,
  keyCode: string,
  modifiers: Array<'shift' | 'control' | 'alt' | 'meta'> = [],
  target: PreviewTarget = {}
): Promise<boolean> {
  return app.evaluate(({ webContents }, { key, mods, urlIncludes }) => {
    const wc = webContents.getAllWebContents().find((c) => {
      try {
        const url = c.getURL()
        return url.startsWith('erfana-preview://') && (urlIncludes === undefined || url.includes(urlIncludes))
      } catch {
        return false
      }
    })
    if (!wc) return false
    if (!wc.isFocused()) wc.focus()
    wc.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers: mods })
    wc.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers: mods })
    return true
  }, { key: keyCode, mods: modifiers, urlIncludes: target.urlIncludes })
}

// ---------------------------------------------------------------------------
// Pixels: pins in the view, the outline in the still frame
// ---------------------------------------------------------------------------

/**
 * The share of the pin's drawn body (the 20 × 15 CSS px bubble inside its
 * 24 px box, placed as §10.5 says – see {@link pinBoxOf}) that shows the pin's
 * fill colour in the view's capture, 0–1. Only the body is read: the selected
 * outline (on the element's edge) and the hover label (1 px accent border)
 * never fill more than a sliver of it, and a pin fills most of it. `null` when
 * the capture is empty (an undrawn view) – the caller polls.
 */
export async function pinCoverage(app: ElectronApplication, box: ElementBox, target: PreviewTarget = {}): Promise<number | null> {
  return app.evaluate(async ({ webContents }, { b, pin, urlIncludes, rgb }) => {
    const wc = webContents.getAllWebContents().find((c) => {
      try {
        const url = c.getURL()
        return url.startsWith('erfana-preview://') && (urlIncludes === undefined || url.includes(urlIncludes))
      } catch {
        return false
      }
    })
    if (!wc) return null
    let image: Awaited<ReturnType<typeof wc.capturePage>>
    try {
      image = await wc.capturePage()
    } catch {
      // A view between frames (hidden for a popup, mid-reload) can fail to capture: poll again.
      return null
    }
    if (image.isEmpty()) return null
    const size = image.getSize()
    // The capture holds the whole view, scrollbars included: `innerWidth` scales it.
    const zoom = b.viewportWidth > 0 ? size.width / b.viewportWidth : 1
    const left = Math.round((pin.left + 3) * zoom)
    const top = Math.round((pin.top + 3) * zoom)
    const width = Math.min(size.width - left, Math.round(18 * zoom))
    const height = Math.min(size.height - top, Math.round(13 * zoom))
    if (width <= 0 || height <= 0) return 0
    const bitmap = image.crop({ x: left, y: top, width, height }).toBitmap()
    const near = (a: number, c: number): boolean => Math.abs(a - c) <= 24
    let count = 0
    for (let i = 0; i + 3 < bitmap.length; i += 4) {
      const bgra = near(bitmap[i], rgb[2]) && near(bitmap[i + 1], rgb[1]) && near(bitmap[i + 2], rgb[0])
      const rgba = near(bitmap[i], rgb[0]) && near(bitmap[i + 1], rgb[1]) && near(bitmap[i + 2], rgb[2])
      if (bgra || rgba) count += 1
    }
    return count / (width * height)
  }, { b: box, pin: pinBoxOf(box), urlIncludes: target.urlIncludes, rgb: [...PIN_ACCENT_RGB] })
}

/** A pin is drawn when its fill covers at least this share of its body (its ink "text lines" or number take the rest). */
export const PIN_DRAWN_COVERAGE = 0.35
/** No pin: at most a sliver of accent (a label's 1 px border) where its body would be. */
export const PIN_GONE_COVERAGE = 0.08

/** The pointer leaves the view: no hover outline, label or hover colour while pixels are read. */
export async function pointerOut(app: ElectronApplication, target: PreviewTarget = {}): Promise<void> {
  await app.evaluate(({ webContents }, urlIncludes) => {
    const wc = webContents.getAllWebContents().find((c) => {
      try {
        const url = c.getURL()
        return url.startsWith('erfana-preview://') && (urlIncludes === undefined || url.includes(urlIncludes))
      } catch {
        return false
      }
    })
    wc?.sendInputEvent({ type: 'mouseLeave', x: -1, y: -1 })
  }, target.urlIncludes)
}

/**
 * Wait until the pin of `#elementId` is drawn, or gone. The pointer is moved
 * out of the view first, so the pin is read in its resting colours.
 */
export async function expectPin(
  app: ElectronApplication,
  elementId: string,
  drawn: boolean,
  place: ElementPlace = {}
): Promise<void> {
  await pointerOut(app, place)
  await expect
    .poll(
      async () => {
        const box = await elementBox(app, elementId, place)
        if (box === null) return null
        const coverage = await pinCoverage(app, box, place)
        if (coverage === null) return null
        return drawn ? coverage >= PIN_DRAWN_COVERAGE : coverage <= PIN_GONE_COVERAGE
      },
      { timeout: PREVIEW_BUDGET_MS, message: `the pin at #${elementId} was never ${drawn ? 'drawn' : 'gone'}` }
    )
    .toBe(true)
}

/**
 * How many accent pixels the panel's still frame (`<img>`, a data URL) holds
 * inside `box` grown by 4 CSS px – the selected outline is a 2 px accent ring
 * on the element's border box. Decoded main-side with `nativeImage`. `null`
 * when no still frame is shown.
 */
export async function accentInStill(
  app: ElectronApplication,
  stillFrame: Locator,
  box: ElementBox
): Promise<number | null> {
  if ((await stillFrame.count()) === 0) return null
  const dataUrl = await stillFrame.getAttribute('src')
  if (dataUrl === null || !dataUrl.startsWith('data:image/')) return null
  return app.evaluate(({ nativeImage }, { url, b, rgb }) => {
    const image = nativeImage.createFromDataURL(url)
    if (image.isEmpty()) return null
    const size = image.getSize()
    const zoom = b.viewportWidth > 0 ? size.width / b.viewportWidth : 1
    const left = Math.max(0, Math.floor((b.left - 4) * zoom))
    const top = Math.max(0, Math.floor((b.top - 4) * zoom))
    const width = Math.min(size.width - left, Math.ceil((b.width + 8) * zoom))
    const height = Math.min(size.height - top, Math.ceil((b.height + 8) * zoom))
    if (width <= 0 || height <= 0) return 0
    const bitmap = image.crop({ x: left, y: top, width, height }).toBitmap()
    const near = (a: number, c: number): boolean => Math.abs(a - c) <= 24
    let count = 0
    for (let i = 0; i + 3 < bitmap.length; i += 4) {
      const bgra = near(bitmap[i], rgb[2]) && near(bitmap[i + 1], rgb[1]) && near(bitmap[i + 2], rgb[0])
      const rgba = near(bitmap[i], rgb[0]) && near(bitmap[i + 1], rgb[1]) && near(bitmap[i + 2], rgb[2])
      if (bgra || rgba) count += 1
    }
    return count
  }, { url: dataUrl, b: box, rgb: [...PIN_ACCENT_RGB] })
}

// ---------------------------------------------------------------------------
// The disk oracle
// ---------------------------------------------------------------------------

/** A file's bytes. */
export function diskBytes(file: string): Promise<Buffer> {
  return fsp.readFile(file)
}

/** What {@link singleBlockInsert} found: where the block went, and its bytes. */
export interface InsertedBlock {
  /** Byte offset in `before` where the insert happened. */
  offset: number
  /** The inserted bytes (the block, plus its EOL and indent when it took its own lines). */
  inserted: Buffer
}

const BLOCK_HEAD = Buffer.from('<!-- erfana:comment v1 id=c-')

/**
 * `after` as `before` with exactly one stretch of bytes inserted, that stretch
 * being one `<!-- erfana:comment v1 … -->` block (plus, for a block on its own
 * lines, the line's EOL and indent). `null` when it is anything else. Byte
 * work only – it never imports the writer's splice.
 */
export function singleBlockInsert(before: Buffer, after: Buffer): InsertedBlock | null {
  const added = after.length - before.length
  if (added <= 0) return null
  let prefix = 0
  while (prefix < before.length && before[prefix] === after[prefix]) prefix += 1
  // The insert may sit anywhere the shared prefix allows (its first bytes can
  // repeat the bytes before it); take the start where the block head is.
  for (let at = prefix; at >= 0; at -= 1) {
    if (!after.subarray(at, at + BLOCK_HEAD.length).equals(BLOCK_HEAD)) continue
    if (!after.subarray(at + added).equals(before.subarray(at))) continue
    if (!after.subarray(0, at).equals(before.subarray(0, at))) continue
    const inserted = after.subarray(at, at + added)
    const text = inserted.toString('utf-8')
    if (text.split('erfana:comment').length !== 2) return null
    if (!/^<!-- erfana:comment v1 id=c-[a-z2-7]{16}(\r\n|\n|\r)[\s\S]*-->((\r\n|\n|\r)[ \t]*)?$/.test(text)) return null
    return { offset: at, inserted: Buffer.from(inserted) }
  }
  return null
}
