// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The stable-screenshot loop and the raw output a scene hands to `run.mjs`.
 *
 * A shot is taken full-window at 2× and repeated until two in a row are
 * byte-identical (Playwright's own baseline rule), up to a bounded count; a
 * shot that never settles fails the scene. The crop is recorded, not applied,
 * so the post-process can lay the HTML preview's native view over the page
 * first and crop after (design § Native rows).
 *
 * Next to each raw PNG the scene writes the page's DOM text and the PTY
 * stream so far; `run.mjs` runs the deny-list over both before any image is
 * copied.
 */

import { expect, type Locator, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import type { Capture } from './app'
import { SCALE, WIDTH, HEIGHT } from './app'
import { readPty } from './terminal'
import { TEST_IDS } from '../../../src/renderer/src/constants/testids'

const MAX_ATTEMPTS = 30

/**
 * Applied only while a screenshot is taken (Playwright's `style` option):
 * Monaco's blinking cursor is hidden like a text caret (`caret: 'hide'`),
 * so it cannot keep two screenshots from ever matching.
 */
export const SHOT_STYLE = '.monaco-editor .cursors-layer { visibility: hidden !important; }'

/** Row ids this run captures (`--only`), from `run.mjs`. */
export function selectedRows(): Set<string> {
  const raw = process.env.ERFANA_CAPTURE_ROWS
  if (!raw) throw new Error('ERFANA_CAPTURE_ROWS is not set: run the capture through `npm run docs:screenshots`.')
  return new Set(raw.split(',').filter(Boolean))
}

export function isSelected(id: string): boolean {
  return selectedRows().has(id)
}

/** True when any of these rows is selected (a scene step is worth running). */
export function anySelected(ids: string[]): boolean {
  const s = selectedRows()
  return ids.some((id) => s.has(id))
}

/** File-name stem for a row id in `raw/`. */
export function rawStem(id: string): string {
  return id.replace(/\//g, '__')
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface ShotOptions {
  /** `window` (default), or the element(s) whose union is the crop. */
  crop?: 'window' | Locator | Locator[]
  /** CSS px around the crop. */
  pad?: number
  /** Lay the HTML preview's native view over the shot (design § Native rows). */
  native?: boolean
  /** Scale a window shot to this width (default 1600; the demo still keeps 1280). */
  scaleWidth?: number
  /** Keep toast notifications on screen (by default they are dismissed first). */
  keepToasts?: boolean
  /**
   * Capture the real window with Electron's `capturePage()` instead of
   * `page.screenshot()`. Needed under a zoom factor: Playwright's page
   * screenshot then clips the layout (observed at zoom 1.25).
   */
  windowCapture?: boolean
  /** Keep the mouse where it is (a hover-only toolbar); by default it is moved off every control. */
  keepHover?: boolean
  /** Cut the crop to this many CSS px from its top (a tall, mostly empty panel). */
  maxHeight?: number
}

/** The window as Electron draws it, as PNG, at the device scale. */
async function captureWindow(cap: Capture): Promise<Buffer> {
  const b64 = await cap.app.evaluate(async ({ BrowserWindow }) => {
    const img = await BrowserWindow.getAllWindows()[0].webContents.capturePage()
    return img.toPNG().toString('base64')
  })
  return Buffer.from(b64, 'base64')
}

/** `capturePage()` until two consecutive captures are the same. */
export async function stableWindowCapture(cap: Capture): Promise<Buffer> {
  let prev: Buffer | null = null
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const buf = await captureWindow(cap)
    if (prev && (prev.equals(buf) || (await diffPixels(prev, buf)) <= MAX_DIFF_PIXELS)) return buf
    prev = buf
  }
  throw new Error(`the window never settled: ${MAX_ATTEMPTS} captures, no two in a row the same`)
}

/** Dismiss every toast with its own Close button and wait until none is left. */
export async function clearToasts(page: Page): Promise<void> {
  const dismiss = page.getByTestId(TEST_IDS.TOAST_BTN_DISMISS)
  for (let i = 0; i < 20 && (await dismiss.count()) > 0; i++) {
    await dismiss.first().click({ timeout: 5_000 }).catch(() => undefined)
  }
  await expect(dismiss).toHaveCount(0, { timeout: 10_000 })
}

/**
 * Pixels two shots may differ in and still count as the same: at a fractional
 * zoom Chromium's anti-aliasing flips single pixels between frames (seen on
 * an icon edge at zoom 1.25). Anything that really moves differs in far more.
 */
export const MAX_DIFF_PIXELS = 16

// sharp comes with @llamaindex/liteparse (as in legibility.mjs); CommonJS here.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp = require('sharp') as (input: Buffer) => { raw: () => { toBuffer: () => Promise<Buffer> } }

/** Differing pixels between two PNGs of the same size (a channel off by more than 8). */
export async function diffPixels(a: Buffer, b: Buffer): Promise<number> {
  const [ra, rb] = await Promise.all([sharp(a).raw().toBuffer(), sharp(b).raw().toBuffer()])
  if (ra.length !== rb.length) return Infinity
  let n = 0
  for (let i = 0; i < ra.length; i += 4) {
    if (Math.abs(ra[i] - rb[i]) > 8 || Math.abs(ra[i + 1] - rb[i + 1]) > 8 || Math.abs(ra[i + 2] - rb[i + 2]) > 8) n++
  }
  return n
}

/** Take screenshots until two consecutive ones are the same (within MAX_DIFF_PIXELS). */
export async function stableScreenshot(page: Page): Promise<Buffer> {
  let prev: Buffer | null = null
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const buf = await page.screenshot({ animations: 'disabled', caret: 'hide', scale: 'device', type: 'png', style: SHOT_STYLE })
    if (prev && (prev.equals(buf) || (await diffPixels(prev, buf)) <= MAX_DIFF_PIXELS)) return buf
    if (i === MAX_ATTEMPTS - 1 && prev && process.env.ERFANA_CAPTURE_SANDBOX) {
      // Keep the last two for whoever looks at the failure (the sandbox stays).
      const dir = path.join(process.env.ERFANA_CAPTURE_SANDBOX, 'raw')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'unsettled-a.png'), prev)
      fs.writeFileSync(path.join(dir, 'unsettled-b.png'), buf)
    }
    prev = buf
  }
  throw new Error(`the window never settled: ${MAX_ATTEMPTS} screenshots, no two in a row identical`)
}

async function unionBox(locators: Locator[], pad: number): Promise<Rect> {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const l of locators) {
    const b = await l.boundingBox()
    if (!b) throw new Error(`crop element is not visible: ${l.toString()}`)
    x0 = Math.min(x0, b.x)
    y0 = Math.min(y0, b.y)
    x1 = Math.max(x1, b.x + b.width)
    y1 = Math.max(y1, b.y + b.height)
  }
  x0 = Math.max(0, Math.floor(x0 - pad))
  y0 = Math.max(0, Math.floor(y0 - pad))
  x1 = Math.min(WIDTH, Math.ceil(x1 + pad))
  y1 = Math.min(HEIGHT, Math.ceil(y1 + pad))
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

/**
 * The HTML preview's native view, captured at 2× with its bounds, or null
 * when the app has hidden it (it does while a popover covers it, and then
 * the window shows the page's placeholder).
 */
async function captureNativePreview(cap: Capture): Promise<{ png: Buffer; bounds: Rect } | null> {
  const result = await cap.app.evaluate(async ({ BrowserWindow }) => {
    for (const win of BrowserWindow.getAllWindows()) {
      for (const child of win.contentView.children) {
        const wc = (child as unknown as { webContents?: Electron.WebContents }).webContents
        if (wc && wc.getURL().startsWith('erfana-preview://') && child.getVisible()) {
          const img = await wc.capturePage()
          return { b64: img.toPNG().toString('base64'), bounds: child.getBounds() }
        }
      }
    }
    return null
  })
  if (!result) return null
  return { png: Buffer.from(result.b64, 'base64'), bounds: result.bounds }
}

/**
 * Capture one manifest row, if it is selected. Writes to `raw/`:
 * `<stem>.png`, `<stem>.json` (crop, overlay, scale), `<stem>.dom.txt` and
 * `<stem>.pty.txt`.
 */
export async function shot(cap: Capture, id: string, opts: ShotOptions = {}): Promise<void> {
  if (!isSelected(id)) return
  const { page, sandbox: sb } = cap
  const stem = rawStem(id)
  if (!opts.keepToasts) await clearToasts(page)
  // Park the mouse on the empty strip at the bottom of the right activity
  // bar, so no button keeps a hover highlight.
  if (!opts.keepHover) await page.mouse.move(WIDTH - 4, HEIGHT - 60)
  const png = opts.windowCapture ? await stableWindowCapture(cap) : await stableScreenshot(page)
  const file = (ext: string): string => path.join(sb.raw, `${stem}${ext}`)
  fs.mkdirSync(sb.raw, { recursive: true })
  fs.writeFileSync(file('.png'), png)

  let crop: Rect | null = null
  if (opts.crop && opts.crop !== 'window') {
    const box = await unionBox(Array.isArray(opts.crop) ? opts.crop : [opts.crop], opts.pad ?? 8)
    if (opts.maxHeight) box.height = Math.min(box.height, opts.maxHeight)
    crop = { x: box.x * SCALE, y: box.y * SCALE, width: box.width * SCALE, height: box.height * SCALE }
  }
  let overlay: { file: string; x: number; y: number } | null = null
  if (opts.native) {
    const view = await captureNativePreview(cap)
    if (view) {
      fs.writeFileSync(file('.native.png'), view.png)
      overlay = { file: file('.native.png'), x: view.bounds.x * SCALE, y: view.bounds.y * SCALE }
    }
  }
  const isWindow = crop === null
  const meta = {
    id,
    png: file('.png'),
    crop,
    overlay,
    scaleWidth: isWindow ? (opts.scaleWidth ?? 1600) : null
  }
  fs.writeFileSync(file('.json'), `${JSON.stringify(meta, null, 2)}\n`)
  fs.writeFileSync(file('.dom.txt'), await page.evaluate(() => document.body.innerText))
  fs.writeFileSync(file('.pty.txt'), await readPty(page))
}
