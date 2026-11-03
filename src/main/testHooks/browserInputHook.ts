// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The built-in browser's key and mouse routing hooks (spec 025 commit 13,
 * solution design § 12, T2): `globalThis.__erfanaTestHooks.browserInput`,
 * reached by e2e tests through `app.evaluate`. Test builds only – reached
 * through `./index`.
 *
 * Input goes through main-side `webContents.sendInputEvent` – the path the
 * routers see (S-27) – either to a tab's page or to Erfana's own window (the
 * toolbar-focus path of `appWindowBrowserKeys`). Reads give the tab's routing
 * state and whether its page holds keyboard focus (`webContents.isFocused()`,
 * T7: Playwright keeps focus emulation on, so the page's own `document.hasFocus`
 * is not evidence).
 */
import { BrowserWindow, type WebContents } from 'electron'
import type { RoutingState } from '../../shared/browser/routingState'
import { mainClock } from '../utils/mainClock'
import type { BrowserRuntime } from '../services/browser/browserAppSetup'
import type { BrowserTab } from '../services/browser/BrowserTab'

/** Longest a page script may run before the hook gives up. */
const EXEC_CAP_MS = 5_000

export type InputKeyModifier = 'shift' | 'control' | 'alt' | 'meta'

/** What one guarded click did: when it was sent and until when the click guard ran. */
export interface GuardedClick {
  readonly sentAt: number
  readonly guardUntil: number
}

export interface BrowserInputTestHook {
  /** The tab's routing state in main. */
  routingState(tabId: string): RoutingState
  /** Whether the tab's page holds keyboard focus. */
  isPageFocused(tabId: string): boolean
  /** Give keyboard focus to Erfana's own window, out of the page (focus "from outside" afterwards). */
  focusAppWindow(tabId: string): void
  /** Press a key, send `repeats` auto-repeats of it, then release it – to the page. */
  keyWithRepeats(tabId: string, keyCode: string, modifiers: InputKeyModifier[], repeats: number): void
  /** Press and release a key on Erfana's own window (the tab's toolbar path). */
  windowKey(tabId: string, keyCode: string, modifiers?: InputKeyModifier[]): void
  /**
   * Click at page CSS px (`x`, `y`) at once and report the main clock at the
   * send and the click guard's end, so a test knows whether the click fell
   * inside the guard without relying on how long the round trip took.
   */
  clickNow(tabId: string, x: number, y: number): GuardedClick
  /** Run `code` in the page with a user gesture (for `requestFullscreen`). */
  execWithGesture(tabId: string, code: string): Promise<unknown>
  /**
   * One left-button event to the page at page CSS px (`x`, `y`), with the
   * click count the operating system would give it (2 for the second press of
   * a double-click): a press and its release can be sent apart (025-AC-063).
   */
  pageMouse(tabId: string, type: MouseButtonEvent, x: number, y: number, clickCount: number): void
  /**
   * The same to Erfana's own window at its CSS px (`x`, `y`) – where a press
   * or a release lands once the page is covered by its still image.
   */
  windowMouse(tabId: string, type: MouseButtonEvent, x: number, y: number, clickCount: number): void
}

/** A left-button event a test sends on its own. */
export type MouseButtonEvent = 'mouseDown' | 'mouseUp'

function requireRuntime(getRuntime: () => BrowserRuntime | null): BrowserRuntime {
  const runtime = getRuntime()
  if (runtime === null) throw new Error('The browser runtime is not installed')
  return runtime
}

/** Build the input hook over the runtime `getRuntime` returns at call time. */
export function createBrowserInputTestHook(getRuntime: () => BrowserRuntime | null): BrowserInputTestHook {
  const tab = (tabId: string): BrowserTab => {
    const found = requireRuntime(getRuntime)
      .tabs.list()
      .find((t) => t.id === tabId)
    if (found === undefined) throw new Error(`No browser tab ${tabId}`)
    return found
  }

  const routingState = (tabId: string): RoutingState => {
    const input = requireRuntime(getRuntime).tabs.inputFor(tab(tabId))
    if (input === null) throw new Error(`Browser tab ${tabId} has no input routing`)
    return input.state()
  }

  /** The owning window's own `webContents`, or `null` when the window is gone. */
  const windowContents = (owner: BrowserTab): WebContents | null => {
    const window = BrowserWindow.fromId(owner.windowId)
    return window === null || window.isDestroyed() ? null : window.webContents
  }

  return {
    routingState,
    isPageFocused: (tabId) => tab(tabId).contents.isFocused(),
    // The owning window's own webContents takes focus, as a click in the terminal would.
    focusAppWindow: (tabId) => windowContents(tab(tabId))?.focus(),
    keyWithRepeats: (tabId, keyCode, modifiers, repeats) => {
      const contents = tab(tabId).contents
      contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
      for (let i = 0; i < repeats; i += 1) {
        contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers: [...modifiers, 'isautorepeat'] })
      }
      contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
    },
    windowKey: (tabId, keyCode, modifiers = []) => {
      const contents = windowContents(tab(tabId))
      if (contents === null) throw new Error(`The window of ${tabId} is gone`)
      contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
      contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
    },
    clickNow: (tabId, x, y) => {
      const contents = tab(tabId).contents
      const zoom = contents.getZoomFactor()
      const at = { x: Math.round(x * zoom), y: Math.round(y * zoom) }
      const guardUntil = routingState(tabId).clickGuardUntil
      const sentAt = mainClock.now()
      contents.sendInputEvent({ type: 'mouseMove', ...at })
      contents.sendInputEvent({ type: 'mouseDown', ...at, button: 'left', clickCount: 1 })
      contents.sendInputEvent({ type: 'mouseUp', ...at, button: 'left', clickCount: 1 })
      return { sentAt, guardUntil }
    },
    pageMouse: (tabId, type, x, y, clickCount) => {
      const contents = tab(tabId).contents
      const zoom = contents.getZoomFactor()
      const at = { x: Math.round(x * zoom), y: Math.round(y * zoom) }
      contents.sendInputEvent({ type: 'mouseMove', ...at })
      contents.sendInputEvent({ type, ...at, button: 'left', clickCount })
    },
    windowMouse: (tabId, type, x, y, clickCount) => {
      const contents = windowContents(tab(tabId))
      if (contents === null) throw new Error(`The window of ${tabId} is gone`)
      const at = { x: Math.round(x), y: Math.round(y) }
      contents.sendInputEvent({ type: 'mouseMove', ...at })
      contents.sendInputEvent({ type, ...at, button: 'left', clickCount })
    },
    execWithGesture: (tabId, code) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const cap = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`page script did not settle within ${EXEC_CAP_MS} ms`)), EXEC_CAP_MS)
      })
      return Promise.race([tab(tabId).contents.executeJavaScript(code, true), cap]).finally(() => clearTimeout(timer))
    }
  }
}
