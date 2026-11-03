// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The built-in browser's test hooks (spec 025 solution design § 12, T2, T3,
 * T6): `globalThis.__erfanaTestHooks.browser`, reached by e2e tests through
 * `app.evaluate`. Test builds only – reached through `./index`.
 *
 * - **Input harness (T2, S-27).** Pointer and key input goes to a tab's page
 *   through main-side `webContents.sendInputEvent` – the path the input
 *   routers of commit 13 see – with points given in page CSS px and corrected
 *   by the page's zoom. Playwright's page mouse is not used: it is a CDP
 *   client of its own.
 * - **Input probe.** Counts `before-input-event` and `before-mouse-event` on a
 *   tab, so a test can tell which input paths reach them.
 * - **Reads.** Tabs, their state, page script results (bounded), cookies,
 *   DevTools front ends and every `webContents` in a browser session.
 * - **Hook view (025-AC-068).** A view in a browser session that runs
 *   Erfana's own preload at the renderer entry, so a test can show the IPC
 *   gate refuses it by identity. Loading it lifts the renderer-entry refusal
 *   of the browser session's request filter for that one load.
 * - **Dev-server origin.** A test names a fixture origin as the app's dev
 *   server, so the refusal of rule 3 can be shown without a dev server.
 *
 * Never touches a `webContents`' debugger (only `cdp/` may).
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow, WebContentsView, webContents as allWebContents, type WebContents } from 'electron'
import type { TabStateEvent } from '../../shared/ipc/browser-tab-schema'
import type { BrowserRuntime } from '../services/browser/browserAppSetup'
import type { BrowserTab } from '../services/browser/BrowserTab'
import { browserSessionRegistry } from '../services/browser/browserSessionRegistry'

/** Longest a page script may run before the hook gives up. */
const EXEC_CAP_MS = 5_000

export interface HookTab {
  readonly tabId: string
  readonly windowId: number
  readonly webContentsId: number
  readonly url: string
  readonly attached: boolean
  readonly devToolsOpen: boolean
  /** The DevTools front end's `webContents` id, or `null`. */
  readonly devToolsId: number | null
}

export interface BrowserSessionContents {
  readonly id: number
  readonly url: string
  readonly registeredView: boolean
  readonly devToolsFrontEnd: boolean
}

export interface InputProbeCounts {
  readonly keyboard: number
  readonly mouse: number
  readonly mouseTypes: readonly string[]
}

export type KeyModifier = 'shift' | 'control' | 'alt' | 'meta'

export interface BrowserTestHook {
  tabs(): HookTab[]
  state(tabId: string): TabStateEvent
  exec(tabId: string, code: string): Promise<unknown>
  /** Move the pointer to page CSS px (`x`, `y`). */
  move(tabId: string, x: number, y: number): void
  /** Move, press and release the left button at page CSS px (`x`, `y`). */
  click(tabId: string, x: number, y: number): void
  /** Click the centre of the first element `selector` matches; resolves its CSS-px centre. */
  clickSelector(tabId: string, selector: string): Promise<{ x: number; y: number }>
  /** Type `text` as character input. */
  type(tabId: string, text: string): void
  /** Press and release one key (`keyCode` in Electron's accelerator names). */
  key(tabId: string, keyCode: string, modifiers?: KeyModifier[]): void
  /** A wheel turn at page CSS px; positive `deltaY` scrolls down. */
  wheel(tabId: string, x: number, y: number, deltaY: number): void
  startInputProbe(tabId: string): void
  inputProbeCounts(tabId: string): InputProbeCounts
  cookies(tabId: string, url: string): Promise<Array<{ name: string; value: string }>>
  browserSessionContents(): BrowserSessionContents[]
  windowCount(): number
  setDevServerOrigin(origin: string | null): void
  /** Open the 025-AC-068 hook view; resolves its `webContents` id once the renderer entry loaded. */
  openIpcProbeView(): Promise<number>
  /** In the hook view, call a global IPC channel through Erfana's preload. */
  callIpcFromProbeView(): Promise<{ ok: boolean; message: string }>
  closeIpcProbeView(): void
}

function requireRuntime(getRuntime: () => BrowserRuntime | null): BrowserRuntime {
  const runtime = getRuntime()
  if (runtime === null) throw new Error('The browser runtime is not installed')
  return runtime
}

function boundedExec(contents: WebContents, code: string): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const cap = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`page script did not settle within ${EXEC_CAP_MS} ms`)), EXEC_CAP_MS)
  })
  return Promise.race([contents.executeJavaScript(code), cap]).finally(() => clearTimeout(timer))
}

/** Page CSS px → the view's DIP, which `sendInputEvent` takes. */
function toViewPoint(contents: WebContents, x: number, y: number): { x: number; y: number } {
  const zoom = contents.getZoomFactor()
  return { x: Math.round(x * zoom), y: Math.round(y * zoom) }
}

/** Build the browser hook over the runtime `getRuntime` returns at call time. */
export function createBrowserTestHook(getRuntime: () => BrowserRuntime | null): BrowserTestHook {
  const probes = new Map<string, { keyboard: number; mouse: number; mouseTypes: string[] }>()
  let probeView: WebContentsView | null = null

  const tab = (tabId: string): BrowserTab => {
    const found = requireRuntime(getRuntime)
      .tabs.list()
      .find((t) => t.id === tabId)
    if (found === undefined) throw new Error(`No browser tab ${tabId}`)
    return found
  }

  const click = (tabId: string, x: number, y: number): void => {
    const contents = tab(tabId).contents
    const at = toViewPoint(contents, x, y)
    contents.sendInputEvent({ type: 'mouseMove', ...at })
    contents.sendInputEvent({ type: 'mouseDown', ...at, button: 'left', clickCount: 1 })
    contents.sendInputEvent({ type: 'mouseUp', ...at, button: 'left', clickCount: 1 })
  }

  return {
    tabs: () =>
      requireRuntime(getRuntime)
        .tabs.list()
        .map((t) => ({
          tabId: t.id,
          windowId: t.windowId,
          webContentsId: t.contents.id,
          url: t.contents.getURL(),
          attached: t.isAttached(),
          devToolsOpen: t.contents.isDevToolsOpened(),
          devToolsId: t.contents.devToolsWebContents?.id ?? null
        })),
    state: (tabId) => tab(tabId).state(),
    exec: (tabId, code) => boundedExec(tab(tabId).contents, code),
    move: (tabId, x, y) => {
      const contents = tab(tabId).contents
      contents.sendInputEvent({ type: 'mouseMove', ...toViewPoint(contents, x, y) })
    },
    click,
    clickSelector: async (tabId, selector) => {
      const centre = (await boundedExec(
        tab(tabId).contents,
        `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null;
          el.scrollIntoView({ block: 'center', inline: 'center' });
          const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`
      )) as { x: number; y: number } | null
      if (centre === null) throw new Error(`No element matches ${selector}`)
      click(tabId, centre.x, centre.y)
      return centre
    },
    type: (tabId, text) => {
      const contents = tab(tabId).contents
      for (const ch of text) contents.sendInputEvent({ type: 'char', keyCode: ch })
    },
    key: (tabId, keyCode, modifiers = []) => {
      const contents = tab(tabId).contents
      contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
      contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
    },
    wheel: (tabId, x, y, deltaY) => {
      const contents = tab(tabId).contents
      contents.sendInputEvent({ type: 'mouseWheel', ...toViewPoint(contents, x, y), deltaX: 0, deltaY: -deltaY })
    },
    startInputProbe: (tabId) => {
      const contents = tab(tabId).contents
      const counts = { keyboard: 0, mouse: 0, mouseTypes: [] as string[] }
      probes.set(tabId, counts)
      contents.on('before-input-event', () => {
        counts.keyboard += 1
      })
      contents.on('before-mouse-event', (_event, mouse) => {
        counts.mouse += 1
        counts.mouseTypes.push(mouse.type)
      })
    },
    inputProbeCounts: (tabId) => {
      const counts = probes.get(tabId)
      if (counts === undefined) throw new Error(`No input probe on ${tabId}`)
      return { keyboard: counts.keyboard, mouse: counts.mouse, mouseTypes: [...counts.mouseTypes] }
    },
    cookies: async (tabId, url) =>
      (await tab(tabId).contents.session.cookies.get({ url })).map(({ name, value }) => ({ name, value })),
    browserSessionContents: () =>
      allWebContents
        .getAllWebContents()
        .filter((wc) => browserSessionRegistry.isBrowserSession(wc.session))
        .map((wc) => ({
          id: wc.id,
          url: wc.getURL(),
          registeredView: browserSessionRegistry.isRegisteredView(wc),
          devToolsFrontEnd: browserSessionRegistry.isDevToolsFrontEnd(wc)
        })),
    windowCount: () => BrowserWindow.getAllWindows().length,
    setDevServerOrigin: (origin) => {
      requireRuntime(getRuntime).appAddresses.devServerOrigin = origin
    },
    openIpcProbeView: async () => {
      const runtime = requireRuntime(getRuntime)
      // This module may sit in a chunk folder: the paths come from the main bundle's own renderer entry.
      const rendererFile = fileURLToPath(runtime.appAddresses.rendererEntry)
      const opener = runtime.tabs.list()[0]
      if (opener === undefined) throw new Error('Open a browser tab first: the hook view uses its session')
      const session = opener.contents.session
      probeView = browserSessionRegistry.createView(
        session,
        () =>
          new WebContentsView({
            webPreferences: {
              session,
              preload: join(dirname(rendererFile), '..', 'preload', 'index.js'),
              sandbox: true,
              contextIsolation: true,
              nodeIntegration: false
            }
          }),
        (view) => view.webContents
      )
      // The browser session's request filter refuses the renderer entry (025-FR-005
      // rule 3); the hook view must reach it, so the filter forgets it for this load.
      const addresses = runtime.appAddresses as { rendererEntry: string }
      const entry = addresses.rendererEntry
      addresses.rendererEntry = 'file:///erfana-test-hook-view-load/'
      try {
        await probeView.webContents.loadFile(rendererFile)
      } finally {
        addresses.rendererEntry = entry
      }
      return probeView.webContents.id
    },
    callIpcFromProbeView: async () => {
      if (probeView === null) throw new Error('No hook view is open')
      return (await boundedExec(
        probeView.webContents,
        `window.api.settings.getRecentProjects().then(
          () => ({ ok: true, message: 'answered' }),
          (error) => ({ ok: false, message: String(error && error.message || error) }))`
      )) as { ok: boolean; message: string }
    },
    closeIpcProbeView: () => {
      if (probeView !== null && !probeView.webContents.isDestroyed()) probeView.webContents.close()
      probeView = null
    }
  }
}
