// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML preview – same-tab navigation helpers (#124, part 3, WI-25).
 *
 * The tab's chrome (Back, the link-mode toggle, the panel-root announcement)
 * is ordinary DOM, reached by test id inside ONE panel: dockview keeps every
 * preview panel mounted, so an unscoped `preview-band-back` would match one
 * per open tab. The panel is found by its placeholder's label, which follows
 * the page the tab shows (`HtmlPreviewPage.panel(basename)`).
 *
 * The page itself runs in a sealed `WebContentsView`, so a link click and a
 * key press inside it are sent main-side as REAL input events
 * (`webContents.sendInputEvent`): the preload only reports a trusted click,
 * and `before-input-event` only sees real input. Real input is also what makes
 * a page's own in-page step a history entry of its own – main pushes one entry
 * per gesture, within a second, and otherwise replaces the current entry
 * (QG-7 S1, QG-8 T1) – so a test about tab history clicks with `clickLink`, never
 * through `executeJavaScript`. Plain functions taking the
 * `ElectronApplication`, like `html-preview.native.ts`, because
 * `HtmlPreviewPage` keeps its app handle private.
 *
 * Nothing here sleeps; the waits are Playwright polls on a condition.
 *
 * @see docs/design/design-issue-124-part3.md
 */

import { expect } from '@playwright/test'
import type { ElectronApplication, Locator, Page } from '@playwright/test'

import { previewNavKeyFor, type PreviewNavAction } from '../../src/shared/previewNavKeys'
import { PREVIEW_BUDGET_MS, type HtmlPreviewPage, type PreviewTarget } from './html-preview.page'

/** How a link is clicked: which button, and whether the platform accelerator is down. */
export interface LinkClick {
  button?: 'left' | 'middle'
  /** Cmd on macOS, Ctrl elsewhere – the "open in a new tab" modifier. */
  accel?: boolean
}

// ---------------------------------------------------------------------------
// Panel chrome (DOM)
// ---------------------------------------------------------------------------

/** Back, inside the panel that shows `basename`. */
export function backButton(preview: HtmlPreviewPage, basename: string): Locator {
  return preview.panel(basename).getByTestId('preview-band-back')
}

/** The link-mode toggle ("Open links in this tab"), inside the panel that shows `basename`. */
export function linkModeToggle(preview: HtmlPreviewPage, basename: string): Locator {
  return preview.panel(basename).getByTestId('preview-band-link-mode')
}

/** The panel-root polite region that says what a move did. */
export function moveAnnouncement(preview: HtmlPreviewPage, basename: string): Locator {
  return preview.panel(basename).getByTestId('preview-move-announcement')
}

/** Every preview tab in the window. */
export function previewTabs(page: Page): Locator {
  return page.locator('.html-preview-tab')
}

/** One toast of a kind (`error`, `info`, …). */
export function toastOf(page: Page, type: 'error' | 'info' | 'success' | 'warning'): Locator {
  return page.getByTestId(`toast-${type}`)
}

/**
 * Dismiss every toast on screen. A toast counts as an overlay and hides the
 * native view while it shows. (Toasts carry `toast-<type>` test ids, so this
 * waits on their dismiss buttons.)
 */
export async function dismissAllToasts(page: Page): Promise<void> {
  const dismiss = page.getByTestId('toast-btn-dismiss')
  await expect(async () => {
    if ((await dismiss.count()) > 0) await dismiss.first().click()
    await expect(dismiss).toHaveCount(0, { timeout: 1000 })
  }).toPass({ timeout: PREVIEW_BUDGET_MS })
}

/** Turn the tab's same-tab mode on, and wait for the toggle to say so. */
export async function turnSameTabOn(preview: HtmlPreviewPage, basename: string): Promise<void> {
  const toggle = linkModeToggle(preview, basename)
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
}

// ---------------------------------------------------------------------------
// The previewed page (main-process reads and real input)
// ---------------------------------------------------------------------------

/** The project-relative paths (no fragment) of every live preview, sorted. */
export async function livePages(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(({ webContents }) => {
    const out: string[] = []
    for (const wc of webContents.getAllWebContents()) {
      try {
        const url = wc.getURL()
        if (wc.isDestroyed() || !url.startsWith('erfana-preview://')) continue
        const parsed = new URL(url)
        out.push(decodeURIComponent(parsed.pathname.replace(/^\//, '')))
      } catch {
        // Gone mid-read: not live.
      }
    }
    return out.sort()
  })
}

/** Wait until the live previews are exactly `relPaths` (order ignored). */
export async function waitForLivePages(app: ElectronApplication, relPaths: string[]): Promise<void> {
  await expect
    .poll(() => livePages(app), { timeout: PREVIEW_BUDGET_MS, message: `live previews never became ${relPaths.join(', ')}` })
    .toEqual([...relPaths].sort())
}

/**
 * Wait until the preview of `relPath` is live and its document carries
 * `sentinel` – the page landed, not just the URL.
 */
export async function waitForPage(preview: HtmlPreviewPage, relPath: string, sentinel: string): Promise<void> {
  await expect
    .poll(() => preview.eval('document.title', { urlIncludes: `/${relPath}` }), {
      timeout: PREVIEW_BUDGET_MS,
      message: `${relPath} never showed ${sentinel}`
    })
    .toContain(sentinel)
}

/** The page's scroll offset and fragment, read inside it. */
export async function scrollState(
  preview: HtmlPreviewPage,
  target: PreviewTarget
): Promise<{ y: number; hash: string } | null> {
  const raw = await preview.eval('JSON.stringify({ y: Math.round(scrollY), hash: location.hash })', target)
  return raw === null ? null : (JSON.parse(raw) as { y: number; hash: string })
}

/**
 * A TRUSTED click on the element `elementId` in the preview matched by
 * `target`: a real mouse event at its centre, with the button and accelerator
 * asked for. `true` only when the page and the element were found.
 */
export async function clickLink(
  app: ElectronApplication,
  elementId: string,
  target: PreviewTarget,
  how: LinkClick = {}
): Promise<boolean> {
  const modifiers = how.accel ? [process.platform === 'darwin' ? 'meta' : 'control'] : []
  return app.evaluate(
    async ({ webContents }, { id, urlIncludes, button, mods }) => {
      const wc = webContents.getAllWebContents().find((c) => {
        try {
          const url = c.getURL()
          return url.startsWith('erfana-preview://') && (urlIncludes === undefined || url.includes(urlIncludes))
        } catch {
          return false
        }
      })
      if (!wc) return false
      const point: { x: number; y: number } | null = await wc.executeJavaScript(
        `(() => {
           const el = document.getElementById(${JSON.stringify(id)})
           if (!el) return null
           el.scrollIntoView({ block: 'center', inline: 'center' })
           const r = el.getBoundingClientRect()
           return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
         })()`
      )
      if (point === null) return false
      // Input is in view pixels, the rectangle in CSS pixels: they differ by the zoom.
      const zoom = wc.getZoomFactor()
      const x = Math.round(point.x * zoom)
      const y = Math.round(point.y * zoom)
      const modifiers = mods as Array<'meta' | 'control'>
      wc.sendInputEvent({ type: 'mouseMove', x, y, modifiers })
      wc.sendInputEvent({ type: 'mouseDown', x, y, button, clickCount: 1, modifiers })
      wc.sendInputEvent({ type: 'mouseUp', x, y, button, clickCount: 1, modifiers })
      return true
    },
    { id: elementId, urlIncludes: target.urlIncludes, button: how.button ?? 'left', mods: modifiers }
  )
}

/** Electron's `keyCode` for the physical keys the Back/Forward table uses. */
const KEY_CODE: Record<string, string> = {
  BracketLeft: '[',
  BracketRight: ']',
  ArrowLeft: 'Left',
  ArrowRight: 'Right'
}

/**
 * Press this platform's Back or Forward key INSIDE the page matched by
 * `target`, as real input (`before-input-event` sees it). `true` when the page
 * was found.
 */
export async function pressNavKeyInPage(
  app: ElectronApplication,
  action: PreviewNavAction,
  target: PreviewTarget
): Promise<boolean> {
  const row = previewNavKeyFor(action, process.platform)
  return app.evaluate(
    ({ webContents }, { urlIncludes, keyCode, modifier }) => {
      const wc = webContents.getAllWebContents().find((c) => {
        try {
          const url = c.getURL()
          return url.startsWith('erfana-preview://') && (urlIncludes === undefined || url.includes(urlIncludes))
        } catch {
          return false
        }
      })
      if (!wc) return false
      wc.focus()
      const modifiers = [modifier as 'meta' | 'alt']
      wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
      wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
      return true
    },
    { urlIncludes: target.urlIncludes, keyCode: KEY_CODE[row.code], modifier: row.modifier }
  )
}

/** The Playwright chord for this platform's Back or Forward key, for focus in Erfana's chrome. */
export function navChord(action: PreviewNavAction): string {
  const row = previewNavKeyFor(action, process.platform)
  return `${row.modifier === 'meta' ? 'Meta' : 'Alt'}+${row.code}`
}

// ---------------------------------------------------------------------------
// Zoom and the PDF save dialog (main process)
// ---------------------------------------------------------------------------

/**
 * Focus the preview matched by `target` and run the View menu's "Zoom In" –
 * the path a reader's Cmd/Ctrl+= takes, which zooms a focused preview.
 */
export async function zoomInPreview(app: ElectronApplication, target: PreviewTarget): Promise<void> {
  await app.evaluate(
    ({ app: electronApp, BrowserWindow, Menu, webContents }, urlIncludes) => {
      const wc = webContents.getAllWebContents().find((c) => {
        try {
          const url = c.getURL()
          return url.startsWith('erfana-preview://') && url.includes(urlIncludes ?? '')
        } catch {
          return false
        }
      })
      if (!wc) throw new Error('no live preview to zoom')
      // The menu zooms a preview only while its web contents has focus, and
      // that needs this app's window to be the key window.
      electronApp.focus({ steal: true })
      BrowserWindow.getAllWindows()[0]?.focus()
      wc.focus()
      if (!wc.isFocused()) throw new Error('the preview could not take focus')
      type Item = { label: string; submenu?: { items: Item[] } | null; click: () => void }
      const find = (items: Item[]): Item | undefined => {
        for (const item of items) {
          if (item.label === 'Zoom In') return item
          const inner = item.submenu ? find(item.submenu.items) : undefined
          if (inner) return inner
        }
        return undefined
      }
      const item = find((Menu.getApplicationMenu()?.items ?? []) as unknown as Item[])
      if (!item) throw new Error('no Zoom In menu item')
      item.click()
    },
    target.urlIncludes
  )
}

/** The zoom level of the preview matched by `target`; `null` when none is live. */
export async function previewZoomLevel(app: ElectronApplication, target: PreviewTarget): Promise<number | null> {
  return app.evaluate(({ webContents }, urlIncludes) => {
    const wc = webContents.getAllWebContents().find((c) => {
      try {
        const url = c.getURL()
        return url.startsWith('erfana-preview://') && url.includes(urlIncludes ?? '')
      } catch {
        return false
      }
    })
    return wc ? wc.getZoomLevel() : null
  }, target.urlIncludes)
}

/**
 * Replace `dialog.showSaveDialog` in this test's app with one that records the
 * suggested file name and answers "cancelled", so an export writes nothing.
 */
export async function recordSaveDialogs(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ dialog }) => {
    const store = globalThis as { __erfanaE2eSaveNames?: string[] }
    store.__erfanaE2eSaveNames = []
    dialog.showSaveDialog = (async (...args: unknown[]) => {
      const options = (args.length > 1 ? args[1] : args[0]) as { defaultPath?: string }
      store.__erfanaE2eSaveNames?.push(options.defaultPath ?? '')
      return { canceled: true, filePath: '' }
    }) as typeof dialog.showSaveDialog
  })
}

/** The file names the save dialog was opened with since `recordSaveDialogs()`. */
export async function savedDialogNames(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => (globalThis as { __erfanaE2eSaveNames?: string[] }).__erfanaE2eSaveNames ?? [])
}
