// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The popup, leave-page and right-click menu test hooks of the built-in
 * browser (spec 025 commits 12e–g, solution design § 12 T3): reached as
 * `globalThis.__erfanaTestHooks.popup` by e2e tests through `app.evaluate`.
 * Test builds only – reached through `./index`.
 *
 * - **Reads**: every open popup window – its host's window kind and which
 *   channels that kind may use, its page's content size, OS title and
 *   committed address, and the tab that opened it.
 * - **Popup page script** (bounded), so a test can drive the popup's page.
 * - **Right- and middle-click** on a tab's page through `sendInputEvent`, the
 *   path the mouse router sees, so the page's `context-menu` event and a
 *   middle-click open fire as for a user.
 *
 * Never touches a `webContents`' debugger (only `cdp/` may).
 */
import { webContents as allWebContents } from 'electron'
import { appWebContentsKind } from '../ipc/appWebContents'
import { isChannelAllowedForKind } from '../ipc/channelAllowList'
import type { BrowserRuntime } from '../services/browser/browserAppSetup'

/** Longest a popup page script may run before the hook gives up. */
const EXEC_CAP_MS = 5_000

export interface HookPopup {
  readonly hostWebContentsId: number
  readonly pageWebContentsId: number
  readonly openerTabId: string
  readonly title: string
  readonly committedUrl: string | null
  readonly contentWidth: number
  readonly contentHeight: number
  /** The host's registered window kind (`browserPopup`), or `null`. */
  readonly hostKind: string | null
  /** Whether the host's kind may use each probed channel. */
  readonly channels: Record<string, boolean>
}

export interface BrowserPopupTestHook {
  popups(): HookPopup[]
  /** Run `code` in a popup page's main world (bounded). */
  popupExec(pageWebContentsId: number, code: string): Promise<unknown>
  /** Press and release `button` at page CSS px (`x`, `y`) of a tab's page. */
  clickButton(tabId: string, x: number, y: number, button: 'right' | 'middle'): void
  /** The work area the popups of `tabId` are clamped to. */
  workArea(tabId: string): { width: number; height: number }
}

/** Channels probed against a popup host's kind: its own three and two it must never reach. */
const PROBED_CHANNELS = ['browser-tab:popupStrip', 'browser-tab:popupAnswer', 'browser-tab:popupClose', 'browser-tab:create', 'terminal:create']

function requireRuntime(getRuntime: () => BrowserRuntime | null): BrowserRuntime {
  const runtime = getRuntime()
  if (runtime === null) throw new Error('The browser runtime is not installed')
  return runtime
}

/** Build the popup hook over the runtime `getRuntime` returns at call time. */
export function createBrowserPopupTestHook(getRuntime: () => BrowserRuntime | null): BrowserPopupTestHook {
  return {
    popups: () =>
      requireRuntime(getRuntime).popups.list().map((popup) => {
        const kind = appWebContentsKind(popup.host.webContents)
        const size = popup.contentSize()
        return {
          hostWebContentsId: popup.host.webContents.id,
          pageWebContentsId: popup.contents.id,
          openerTabId: popup.openerTabId,
          title: (popup.host as unknown as { getTitle(): string }).getTitle(),
          committedUrl: popup.committed,
          contentWidth: size.width,
          contentHeight: size.height,
          hostKind: kind,
          channels: Object.fromEntries(PROBED_CHANNELS.map((c) => [c, kind !== null && isChannelAllowedForKind(kind, c)]))
        }
      }),
    popupExec: (pageWebContentsId, code) => {
      const contents = allWebContents.fromId(pageWebContentsId)
      if (contents === undefined || contents.isDestroyed()) return Promise.reject(new Error(`No popup page ${pageWebContentsId}`))
      let timer: ReturnType<typeof setTimeout> | undefined
      const cap = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`popup script did not settle within ${EXEC_CAP_MS} ms`)), EXEC_CAP_MS)
      })
      return Promise.race([contents.executeJavaScript(code), cap]).finally(() => clearTimeout(timer))
    },
    clickButton: (tabId, x, y, button) => {
      const tab = requireRuntime(getRuntime)
        .tabs.list()
        .find((t) => t.id === tabId)
      if (tab === undefined) throw new Error(`No browser tab ${tabId}`)
      const zoom = tab.contents.getZoomFactor()
      const at = { x: Math.round(x * zoom), y: Math.round(y * zoom) }
      tab.contents.sendInputEvent({ type: 'mouseMove', ...at })
      tab.contents.sendInputEvent({ type: 'mouseDown', ...at, button, clickCount: 1 })
      tab.contents.sendInputEvent({ type: 'mouseUp', ...at, button, clickCount: 1 })
    },
    workArea: (tabId) => {
      const popup = requireRuntime(getRuntime).popups.popupsOf(tabId)[0]
      if (popup === undefined) throw new Error(`No popup of ${tabId}`)
      return popup.workArea
    }
  }
}
