// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML preview – native-view helpers (#111, split out for #124).
 *
 * The previewed page runs in a sealed native `WebContentsView` in its own web
 * contents, so nothing about it is readable from the renderer DOM. Every helper
 * here reads it through the main process (`app.evaluate`), finding the
 * `erfana-preview://` web contents – the same identity the app serves it under.
 *
 * Plain functions taking the `ElectronApplication`, so the class in
 * `html-preview.page.ts` keeps its public methods as one-line delegates and
 * page-object modules added later can call these without growing that class.
 *
 * Each `app.evaluate` callback is serialised into the main process, so it
 * cannot call a shared helper: the preview lookup is repeated in each one on
 * purpose.
 *
 * Condition-based waits only – never a sleep. Nothing here waits: callers poll.
 *
 * @see e2e/pages/html-preview.page.ts
 */

import type { ElectronApplication } from '@playwright/test'

/** A snapshot of one live preview's own web contents, read from the main process. */
export interface PreviewSnapshot {
  /** `webContents.getTitle()` — may fall back to the URL until the doc is read. */
  title: string
  /** `document.title` read inside the page — the authoritative title sentinel. */
  docTitle: string
  /** True once the inline script has run (its `#js-output.pending` marker is gone). */
  jsRan: boolean
  url: string
  destroyed: boolean
}

/** One live preview's URL and document title. */
export interface LivePreview {
  url: string
  docTitle: string
}

/**
 * Which live preview a main-side read addresses. `urlIncludes` is matched
 * against the `erfana-preview://<token>/<project-relative path>` URL, so a
 * project-relative path such as `multi-file/index.html` picks exactly that
 * file. Omitted, the first live preview is used — fine for a spec that opens
 * one at a time.
 */
export interface PreviewTarget {
  urlIncludes?: string
}

/**
 * The native preview view's rectangle, in window content coordinates (DIP),
 * plus whether the view is shown (`View.getVisible()`).
 *
 * `x` and `y` are there for the bounds checks of #124 (P1-AC2): a view can
 * keep the right size at the wrong place, and a size-only read cannot see it.
 */
export interface ViewBounds {
  x: number
  y: number
  width: number
  height: number
  visible: boolean
}

/**
 * Find one live preview's web contents (served under `erfana-preview://`) and
 * read its title/liveness from the main process. `null` when none is live.
 *
 * The document title is read via `executeJavaScript` (the page's own DOM), not
 * `getTitle()` — for a sealed, custom-protocol `WebContentsView`, `getTitle()`
 * can stay the URL, so it is not a reliable sentinel. Injection from the main
 * process is not subject to the page CSP, so it reads the real `document.title`.
 */
export async function previewSnapshot(
  app: ElectronApplication,
  target: PreviewTarget = {}
): Promise<PreviewSnapshot | null> {
  return app.evaluate(async ({ webContents }, urlIncludes) => {
    const previews = webContents.getAllWebContents().filter((wc) => {
      try {
        const url = wc.getURL()
        return (
          url.startsWith('erfana-preview://') &&
          (urlIncludes === undefined || url.includes(urlIncludes))
        )
      } catch {
        return false
      }
    })
    if (previews.length === 0) return null
    const wc = previews[0]
    // Every read can throw "Object has been destroyed" — eviction can take
    // this view at any point, including on the synchronous `getURL()`. A
    // snapshot of a view that vanished is `null`, which the caller polls on.
    try {
      const url = wc.getURL()
      let docTitle = ''
      let jsRan = false
      try {
        docTitle = await wc.executeJavaScript('document.title')
        // The self-contained fixture drops the `pending` class on DOMContentLoaded.
        jsRan = await wc.executeJavaScript('!document.querySelector("#js-output.pending")')
      } catch {
        // Page may be mid-load / navigating — leave the defaults, the caller polls.
      }
      const destroyed = wc.isDestroyed()
      return {
        title: destroyed ? '' : wc.getTitle(),
        docTitle,
        jsRan,
        url,
        destroyed
      }
    } catch {
      return null
    }
  }, target.urlIncludes)
}

/** Every live preview's URL and document title, read from the main process. */
export async function livePreviews(app: ElectronApplication): Promise<LivePreview[]> {
  return app.evaluate(async ({ webContents }) => {
    const previews = webContents.getAllWebContents().filter((wc) => {
      try {
        return wc.getURL().startsWith('erfana-preview://') && !wc.isDestroyed()
      } catch {
        return false
      }
    })
    const out: Array<{ url: string; docTitle: string }> = []
    for (const wc of previews) {
      // EVERY read here can throw "Object has been destroyed": eviction runs
      // on its own schedule and can take this view between the filter above
      // and any line below, including the synchronous `getURL()` — seen once
      // in a full-suite run under load. A view that vanished mid-read is not
      // live, so skip it and let the caller poll again.
      try {
        const url = wc.getURL()
        let docTitle = ''
        try {
          docTitle = await wc.executeJavaScript('document.title')
        } catch {
          // Mid-load; the caller polls.
        }
        if (wc.isDestroyed()) continue
        out.push({ url, docTitle })
      } catch {
        continue
      }
    }
    return out
  })
}

/**
 * Evaluate an expression inside a live preview page's DOM (main-process
 * read). `null` when no matching preview is live or the page is mid-load.
 */
export async function evalInPreview(
  app: ElectronApplication,
  expr: string,
  target: PreviewTarget = {}
): Promise<string | null> {
  return app.evaluate(
    async ({ webContents }, { e, urlIncludes }) => {
      const wc = webContents.getAllWebContents().find((c) => {
        try {
          const url = c.getURL()
          return (
            url.startsWith('erfana-preview://') &&
            (urlIncludes === undefined || url.includes(urlIncludes))
          )
        } catch {
          return false
        }
      })
      if (!wc) return null
      try {
        return await wc.executeJavaScript(e)
      } catch {
        return null
      }
    },
    { e: expr, urlIncludes: target.urlIncludes }
  )
}

/**
 * Click an element by id inside the live preview page whose title matches,
 * via `HTMLElement.click()` — an UNTRUSTED click (`isTrusted === false`),
 * which is precisely what the preload refuses, so this drives the
 * `will-navigate` fallback path. For a trusted click see {@link clickTrusted}.
 *
 * @returns `true` only when the page WAS found and the element WAS clicked.
 *
 * The return value is the point: a renamed fixture id, or an element that
 * never rendered, must not produce a test that quietly clicks nothing.
 */
export async function clickInPreview(
  app: ElectronApplication,
  docTitle: string,
  elementId: string
): Promise<boolean> {
  return app.evaluate(
    async ({ webContents }, { title, id }) => {
      for (const wc of webContents.getAllWebContents()) {
        if (!wc.getURL().startsWith('erfana-preview://')) continue
        let found = ''
        try {
          found = await wc.executeJavaScript('document.title')
        } catch {
          // Mid-load or already gone: this is not the page we are looking for.
          // Only the IDENTIFICATION probe is allowed to fail quietly.
          continue
        }
        if (!found.includes(title)) continue
        return await wc.executeJavaScript(
          `(() => {
             const el = document.getElementById(${JSON.stringify(id)})
             if (!el) return false
             el.click()
             return true
           })()`
        )
      }
      return false
    },
    { title: docTitle, id: elementId }
  )
}

/**
 * Click an element by id inside a live preview page with a REAL input event
 * (`webContents.sendInputEvent`), so the page sees `isTrusted === true` and
 * the preload reports it as a gesture. This is the only way from a test to
 * reach the paths that demand a gesture — an external link, for one.
 *
 * @returns `true` only when the page and the element were found; the click
 * is dispatched at the element's centre after scrolling it into view.
 */
export async function clickTrusted(
  app: ElectronApplication,
  elementId: string,
  target: PreviewTarget = {}
): Promise<boolean> {
  return app.evaluate(
    async ({ webContents }, { id, urlIncludes }) => {
      const wc = webContents.getAllWebContents().find((c) => {
        try {
          const url = c.getURL()
          return (
            url.startsWith('erfana-preview://') &&
            (urlIncludes === undefined || url.includes(urlIncludes))
          )
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
           return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
         })()`
      )
      if (point === null) return false
      wc.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y })
      wc.sendInputEvent({
        type: 'mouseDown',
        x: point.x,
        y: point.y,
        button: 'left',
        clickCount: 1
      })
      wc.sendInputEvent({
        type: 'mouseUp',
        x: point.x,
        y: point.y,
        button: 'left',
        clickCount: 1
      })
      return true
    },
    { id: elementId, urlIncludes: target.urlIncludes }
  )
}

/**
 * The on-screen rectangle of the live preview's native `WebContentsView`,
 * read from the main process, and whether the view is shown. `null` when no
 * preview view is attached.
 *
 * This is the ONE thing every other read here misses: they all read the
 * preview's web contents, which loads and runs its JavaScript whether or not
 * the view has ever been given a size. A view left at 0x0 executes its page
 * perfectly and shows the user a black rectangle.
 */
export async function viewBounds(app: ElectronApplication): Promise<ViewBounds | null> {
  return app.evaluate(({ BrowserWindow }) => {
    for (const win of BrowserWindow.getAllWindows()) {
      for (const child of win.contentView.children) {
        const wc = (child as { webContents?: { getURL(): string } }).webContents
        try {
          if (wc && wc.getURL().startsWith('erfana-preview://')) {
            const b = child.getBounds()
            return {
              x: b.x,
              y: b.y,
              width: b.width,
              height: b.height,
              visible: child.getVisible()
            }
          }
        } catch {
          // View mid-teardown; keep scanning.
        }
      }
    }
    return null
  })
}
