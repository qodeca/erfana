// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML preview – keyboard focus helpers (#124, QG-8 U1 and QG-11a H1).
 *
 * Which web contents holds NATIVE keyboard focus is invisible from the
 * renderer: `document.activeElement` answers for the DOM of one contents and
 * says nothing about whether that contents gets the keys. So focus is read
 * main-side (`webContents.isFocused()`) for both the preview and the window
 * that hosts it.
 *
 * A key "in the page" is sent main-side as REAL input
 * (`webContents.sendInputEvent`), never through Playwright's `page.keyboard`,
 * which drives the host renderer and would skip the page and main's
 * `before-input-event` forwarding altogether.
 *
 * Plain functions taking the `ElectronApplication`, like
 * `html-preview.native.ts`, because `HtmlPreviewPage` keeps its app handle
 * private. Nothing here sleeps; the waits are the caller's polls.
 */

import { expect } from '@playwright/test'
import type { ElectronApplication, Locator } from '@playwright/test'

import { PreviewEvents } from '../../src/shared/ipc/preview-channels'
import type { HtmlPreviewPage, PreviewTarget } from './html-preview.page'

/** Native keyboard focus: the preview's own contents, and its host window's. */
export interface PreviewFocusState {
  preview: boolean
  host: boolean
}

/** The band's permission chip, inside the panel that shows `basename`. */
export function bandChip(preview: HtmlPreviewPage, basename: string): Locator {
  return preview.panel(basename).getByTestId('preview-band-chip')
}

/** How long the OS gets to make this app the key window. */
const KEY_WINDOW_BUDGET_MS = 5_000

/**
 * Make this app the OS key window, and FAIL when the OS will not.
 *
 * Native focus inside a window is observable only while the window itself is
 * key: on a locked screen or in a session with no active console no window is,
 * so every `isFocused()` answers `false` and a focus assertion would report a
 * product bug that is really the host. Failing here names the real cause.
 */
export async function bringAppToFront(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ app: electronApp, BrowserWindow }) => {
    electronApp.focus({ steal: true })
    BrowserWindow.getAllWindows()[0]?.focus()
  })
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isFocused() ?? false), {
      timeout: KEY_WINDOW_BUDGET_MS,
      message:
        'the OS would not make Erfana the key window (locked screen or inactive session?) – ' +
        'native keyboard focus cannot be observed on this host'
    })
    .toBe(true)
}

/**
 * Record, in order, every native focus call on the host window's contents and
 * every forwarded shortcut main sends it (`preview:forwardedShortcut`), for
 * {@link hostFocusTrail}. Wraps both methods on the host's own `webContents`
 * and calls straight through, so the app behaves as before. Needs no OS focus,
 * so it proves the order main uses even where `isFocused()` cannot be read.
 */
export async function recordHostFocusTrail(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }, channel) => {
    const host = BrowserWindow.getAllWindows()[0]?.webContents
    if (!host) throw new Error('no host window to record')
    const store = globalThis as { __erfanaE2eFocusTrail?: string[] }
    store.__erfanaE2eFocusTrail = []
    const focus = host.focus.bind(host)
    const send = host.send.bind(host)
    host.focus = () => {
      store.__erfanaE2eFocusTrail?.push('host-focus')
      focus()
    }
    host.send = (sent: string, ...args: unknown[]) => {
      if (sent === channel) {
        store.__erfanaE2eFocusTrail?.push(`forwarded:${(args[0] as { key?: string })?.key ?? '?'}`)
      }
      send(sent, ...args)
    }
  }, PreviewEvents.FORWARDED_SHORTCUT)
}

/** What {@link recordHostFocusTrail} has seen, in order. */
export async function hostFocusTrail(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => (globalThis as { __erfanaE2eFocusTrail?: string[] }).__erfanaE2eFocusTrail ?? [])
}

/**
 * Whether the preview matched by `target` and the window hosting it hold
 * native keyboard focus; `null` when no such preview is live.
 */
export async function focusState(
  app: ElectronApplication,
  target: PreviewTarget
): Promise<PreviewFocusState | null> {
  return app.evaluate(({ BrowserWindow, webContents }, urlIncludes) => {
    const wc = webContents.getAllWebContents().find((c) => {
      try {
        const url = c.getURL()
        return !c.isDestroyed() && url.startsWith('erfana-preview://') && url.includes(urlIncludes ?? '')
      } catch {
        return false
      }
    })
    if (!wc) return null
    // The host is the window whose content view carries this preview's view.
    const host = BrowserWindow.getAllWindows().find(
      (w) =>
        !w.isDestroyed() &&
        w.contentView.children.some((v) => (v as { webContents?: unknown }).webContents === wc)
    )
    if (!host) return null
    return { preview: wc.isFocused(), host: host.webContents.isFocused() }
  }, target.urlIncludes)
}

/**
 * Press `keyCode` (Electron's accelerator key name, e.g. `Escape`, `Tab`)
 * INSIDE the preview matched by `target`, as real input. Focus is NOT moved
 * first: the test is about where focus already is. `true` when the page was
 * found.
 */
export async function pressKeyInPage(
  app: ElectronApplication,
  keyCode: string,
  target: PreviewTarget
): Promise<boolean> {
  return app.evaluate(
    ({ webContents }, { urlIncludes, key }) => {
      const wc = webContents.getAllWebContents().find((c) => {
        try {
          const url = c.getURL()
          return !c.isDestroyed() && url.startsWith('erfana-preview://') && url.includes(urlIncludes ?? '')
        } catch {
          return false
        }
      })
      if (!wc) return false
      wc.sendInputEvent({ type: 'keyDown', keyCode: key })
      wc.sendInputEvent({ type: 'keyUp', keyCode: key })
      return true
    },
    { urlIncludes: target.urlIncludes, key: keyCode }
  )
}
