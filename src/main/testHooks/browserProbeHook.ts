// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The engine-probe hooks of the built-in browser (spec 025 solution design
 * § 13 commit 8, design list T25): merged into `browserHook.ts`'s object, so
 * tests reach them as `__erfanaTestHooks.browser.probe…`. Test builds only.
 *
 * A **probe view** is a page view built the way a tab's is – the pinned
 * `buildBrowserWebPreferences`, `hardenBrowserContents`, a registered view in
 * a hardened browser session with the app request filter – with its own
 * tab-kind `BrowserCdpSession`. It exists because a tab's CDP session is
 * private to `browserAppSetup.ts` and the tab's debugger takes one client:
 * every CDP command here still goes through `BrowserCdpSession.send`, so the
 * production allow-list applies to the probes too. The probe views live in
 * their own in-memory session (`erfana-engine-probe`), so a probe that grants
 * the camera or handles `erfana-local` never touches a project's session.
 *
 * Never touches a `webContents`' debugger directly (only `cdp/` may).
 */
import { performance } from 'node:perf_hooks'
import { BrowserWindow, session as electronSession, WebContentsView, type Session, type WebContents } from 'electron'
import type { BrowserRuntime } from '../services/browser/browserAppSetup'
import { createBrowserProbeSiteHook, type BrowserProbeSiteHook } from './browserProbeSiteHook'
import { installAppRequestFilter } from '../services/browser/browserAppRequestFilter'
import { browserSessionRegistry } from '../services/browser/browserSessionRegistry'
import { hardenBrowserContents, hardenBrowserSession } from '../services/browser/browserSessionPolicy'
import { buildBrowserWebPreferences } from '../services/browser/browserWebPreferences'
import { BrowserCdpSession, type CdpDetachInfo, type LogSnapshot } from '../services/browser/cdp/BrowserCdpSession'

/** The probe views' own in-memory browser session. */
const PROBE_PARTITION = 'erfana-engine-probe'
/** Default cap on one probe CDP command, so a hung command answers `timedOut`. */
const DEFAULT_CDP_CAP_MS = 3_000
/** Longest a probe page script may run. */
const EXEC_CAP_MS = 5_000
/** Records kept per list; a probe that floods them is broken. */
const RECORD_CAP = 2_000

export interface ProbeRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface ProbeOpenOptions {
  /** Where the view sits, in the window's content DIP. */
  readonly bounds: ProbeRect
  readonly failedRequestSource?: 'log' | 'network'
  /** Grant camera and microphone in the probe session (the capture-end probe only). */
  readonly grantMedia?: boolean
  /** Build the view without a CDP session. */
  readonly withoutCdp?: boolean
}

export interface ProbeCdpAnswer {
  readonly ok: boolean
  readonly timedOut: boolean
  readonly ms: number
  readonly result?: unknown
  readonly error?: string
}

export interface ProbeProtocolRecord {
  readonly method: string
  readonly sessionKey: string
  readonly targetType: string
  readonly params: unknown
}

/** A detach the session did not ask for, with the view's state at the event. */
export interface ProbeDetachRecord extends CdpDetachInfo {
  readonly devToolsOpenAtEvent: boolean
  readonly destroyedAtEvent: boolean
}

export interface ProbeMouseRecord {
  readonly type: string
  readonly x: number
  readonly y: number
  readonly globalX: number | null
  readonly globalY: number | null
}

export interface ProbeFrame {
  readonly url: string
  readonly isMain: boolean
  readonly processId: number
  readonly osProcessId: number
}

export interface BrowserProbeHook extends BrowserProbeSiteHook {
  probeOpen(options: ProbeOpenOptions): Promise<number>
  /** Close the view; `keepCdp` closes the page without detaching its CDP session first (the detach-cause probe). */
  probeClose(id: number, keepCdp?: boolean): void
  /** Start loading `url`; the test waits on the page for the outcome. */
  probeLoad(id: number, url: string): void
  probeExec(id: number, code: string): Promise<unknown>
  /** Run `code` in the first frame whose URL contains `urlPart` (out-of-process frames too). */
  probeFrameExec(id: number, urlPart: string, code: string): Promise<unknown>
  probeFrames(id: number): ProbeFrame[]
  /** Send one command through the probe's `BrowserCdpSession` (allow-list applies). */
  probeCdp(id: number, method: string, params?: unknown, sessionKey?: string, capMs?: number): Promise<ProbeCdpAnswer>
  probeEnablePick(id: number): Promise<void>
  probeDisablePick(id: number): Promise<void>
  probeProtocolEvents(id: number, method?: string): ProbeProtocolRecord[]
  probeTargets(id: number): Array<{ sessionKey: string; type: string; url: string }>
  probeCdpState(id: number): { attached: boolean; detaches: ProbeDetachRecord[] }
  /** Attach a fresh `BrowserCdpSession` (after a detach); the answer says whether Electron let it. */
  probeReattach(id: number): { ok: boolean; error?: string }
  probeLogSnapshot(id: number): LogSnapshot
  /** A mouse event at view DIP (`x`, `y`) through `sendInputEvent`. */
  probeMouse(id: number, type: 'mouseMove' | 'mouseDown' | 'mouseUp', x: number, y: number): void
  probeKey(id: number, keyCode: string, modifiers?: Array<'shift' | 'control' | 'alt' | 'meta'>): void
  probeMouseRecords(id: number): ProbeMouseRecord[]
  /** The view's top-left corner in screen DIP. */
  probeViewScreenOrigin(id: number): { x: number; y: number }
  probeContentSize(): { width: number; height: number }
  probeSetBounds(id: number, bounds: ProbeRect): void
  /** Take the view out of the window (a hidden tab); returns `Date.now()` at the call. */
  probeDetachView(id: number): number
  /** Put the view back; returns `Date.now()` at the call. */
  probeAttachView(id: number): number
  /** `capturePage` kept under `name`; resolves its pixel size. */
  probeCapture(id: number, name: string): Promise<{ width: number; height: number }>
  /** Pixels that differ by more than `tolerance` per channel between two captures, inside `rect` (view DIP). */
  probeCaptureDiff(id: number, a: string, b: string, rect: ProbeRect, tolerance?: number): { changed: number; total: number }
  probeInsertCss(id: number, css: string): Promise<string>
  /** Names of every event the view's `webContents` emitted since it opened, in order. */
  probeContentsEvents(id: number): string[]
  /** Names of the host window's sheet events (`sheet-begin`, `sheet-end`, macOS). */
  probeHostEvents(): string[]
  probeDevTools(id: number, open: boolean): void
  probeDevToolsState(id: number): { open: boolean; frontEndId: number | null; frontEndLoading: boolean; frontEndUrl: string }
  probeFocusState(id: number): { viewFocused: boolean; hostFocused: boolean }
}

interface ProbeView {
  readonly view: WebContentsView
  readonly contents: WebContents
  readonly host: BrowserWindow
  readonly source: 'log' | 'network'
  cdp: BrowserCdpSession | null
  attached: boolean
  readonly events: ProbeProtocolRecord[]
  readonly detaches: ProbeDetachRecord[]
  readonly mouse: ProbeMouseRecord[]
  readonly emitted: string[]
  readonly captures: Map<string, { bitmap: Buffer; width: number; height: number }>
  withdrawDevTools: (() => void) | null
}

function push<T>(list: T[], item: T): void {
  if (list.length < RECORD_CAP) list.push(item)
}

function capped<T>(work: Promise<T>, capMs: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const cap = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not settle within ${capMs} ms`)), capMs)
  })
  return Promise.race([work, cap]).finally(() => clearTimeout(timer))
}

/** The Erfana window probe views go in: the oldest live window. */
function hostWindow(): BrowserWindow {
  const host = BrowserWindow.getAllWindows()
    .filter((w) => !w.isDestroyed())
    .sort((a, b) => a.id - b.id)[0]
  if (host === undefined) throw new Error('No Erfana window to hold a probe view')
  return host
}

/** Build the probe hooks over the runtime `getRuntime` returns at call time. */
export function createBrowserProbeHook(getRuntime: () => BrowserRuntime | null): BrowserProbeHook {
  const probes = new Map<number, ProbeView>()
  const hostEvents: string[] = []
  const watchedHosts = new WeakSet<BrowserWindow>()
  let probeSession: Session | null = null

  const runtime = (): BrowserRuntime => {
    const found = getRuntime()
    if (found === null) throw new Error('The browser runtime is not installed')
    return found
  }

  const sessionForProbes = (): Session => {
    if (probeSession !== null) return probeSession
    const ses = electronSession.fromPartition(PROBE_PARTITION)
    browserSessionRegistry.registerSession(ses)
    hardenBrowserSession(ses, { platform: process.platform, chromeVersion: process.versions.chrome })
    installAppRequestFilter(ses, () => runtime().appAddresses)
    probeSession = ses
    return ses
  }

  const probe = (id: number): ProbeView => {
    const found = probes.get(id)
    if (found === undefined || found.contents.isDestroyed()) throw new Error(`No probe view ${id}`)
    return found
  }

  const cdpOf = (id: number): BrowserCdpSession => {
    const cdp = probe(id).cdp
    if (cdp === null || !cdp.attached) throw new Error(`Probe view ${id} has no attached CDP session`)
    return cdp
  }

  const attachCdp = (p: ProbeView): BrowserCdpSession => {
    const cdp = new BrowserCdpSession({ kind: 'tab', failedRequestSource: p.source })
    cdp.on('protocolEvent', (e) =>
      push(p.events, { method: e.method, sessionKey: e.target.sessionKey, targetType: e.target.type, params: e.params })
    )
    cdp.on('detached', (info) => {
      const destroyedAtEvent = p.contents.isDestroyed()
      push(p.detaches, { ...info, destroyedAtEvent, devToolsOpenAtEvent: !destroyedAtEvent && p.contents.isDevToolsOpened() })
    })
    cdp.attach(p.contents)
    p.cdp = cdp
    return cdp
  }

  const watchHost = (host: BrowserWindow): void => {
    if (watchedHosts.has(host)) return
    watchedHosts.add(host)
    host.on('sheet-begin', () => push(hostEvents, 'sheet-begin'))
    host.on('sheet-end', () => push(hostEvents, 'sheet-end'))
  }

  const recordContents = (p: ProbeView): void => {
    const contents = p.contents
    const emit = contents.emit.bind(contents)
    contents.emit = (name: string | symbol, ...args: unknown[]): boolean => {
      if (typeof name === 'string') push(p.emitted, name)
      return emit(name, ...args)
    }
    contents.on('before-mouse-event', (_event, mouse) =>
      push(p.mouse, {
        type: mouse.type,
        x: mouse.x,
        y: mouse.y,
        globalX: mouse.globalX ?? null,
        globalY: mouse.globalY ?? null
      })
    )
  }

  const grantMedia = (ses: Session): void => {
    // Test only: the hardened session denies `media`; the capture-end probe needs a live capture.
    const granted = (permission: string): boolean => permission === 'media' || permission === 'clipboard-sanitized-write'
    ses.setPermissionRequestHandler((_contents, permission, callback) => callback(granted(permission)))
    ses.setPermissionCheckHandler((_contents, permission) => granted(permission))
  }

  return {
    probeOpen: async (options) => {
      const ses = sessionForProbes()
      if (options.grantMedia === true) grantMedia(ses)
      const host = hostWindow()
      watchHost(host)
      const view = browserSessionRegistry.createView(
        ses,
        () => new WebContentsView({ webPreferences: buildBrowserWebPreferences(ses, process.platform) }),
        (v) => v.webContents
      )
      const contents = view.webContents
      contents.setWindowOpenHandler(() => ({ action: 'deny' }))
      hardenBrowserContents(contents)
      const p: ProbeView = {
        view,
        contents,
        host,
        source: options.failedRequestSource ?? 'log',
        cdp: null,
        attached: false,
        events: [],
        detaches: [],
        mouse: [],
        emitted: [],
        captures: new Map(),
        withdrawDevTools: null
      }
      recordContents(p)
      contents.on('devtools-opened', () => {
        p.withdrawDevTools?.()
        p.withdrawDevTools = null
      })
      if (options.withoutCdp !== true) attachCdp(p)
      view.setBounds(options.bounds)
      host.contentView.addChildView(view)
      p.attached = true
      probes.set(contents.id, p)
      return contents.id
    },
    probeClose: (id, keepCdp = false) => {
      const p = probes.get(id)
      if (p === undefined) return
      if (!keepCdp) probes.delete(id)
      p.withdrawDevTools?.()
      if (!keepCdp) p.cdp?.detach()
      if (p.attached && !p.host.isDestroyed()) p.host.contentView.removeChildView(p.view)
      if (!p.contents.isDestroyed()) {
        if (p.contents.isDevToolsOpened()) p.contents.closeDevTools()
        p.contents.close({ waitForBeforeUnload: false })
      }
    },
    probeLoad: (id, url) => {
      // Not awaited: a load that never finishes is itself a probe result, read from the page.
      probe(id)
        .contents.loadURL(url)
        .catch(() => undefined)
    },
    probeExec: (id, code) => capped(probe(id).contents.executeJavaScript(code), EXEC_CAP_MS, 'probe page script'),
    probeFrameExec: (id, urlPart, code) => {
      const frame = probe(id).contents.mainFrame.framesInSubtree.find((f) => f.url.includes(urlPart))
      if (frame === undefined) throw new Error(`No frame whose URL contains ${urlPart}`)
      return capped(frame.executeJavaScript(code), EXEC_CAP_MS, 'probe frame script')
    },
    probeFrames: (id) => {
      const main = probe(id).contents.mainFrame
      return main.framesInSubtree.map((f) => ({
        url: f.url,
        isMain: f === main,
        processId: f.processId,
        osProcessId: f.osProcessId
      }))
    },
    probeCdp: async (id, method, params, sessionKey = '', capMs = DEFAULT_CDP_CAP_MS) => {
      const started = performance.now()
      const elapsed = (): number => Math.round((performance.now() - started) * 10) / 10
      try {
        const result = await capped(cdpOf(id).send(method, params, sessionKey), capMs, method)
        return { ok: true, timedOut: false, ms: elapsed(), result }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { ok: false, timedOut: message.includes('did not settle'), ms: elapsed(), error: message }
      }
    },
    probeEnablePick: (id) => cdpOf(id).enablePickDomains(),
    probeDisablePick: (id) => cdpOf(id).disablePickDomains(),
    probeProtocolEvents: (id, method) => probe(id).events.filter((e) => method === undefined || e.method === method),
    probeTargets: (id) => cdpOf(id).attachedTargets().map(({ sessionKey, type, url }) => ({ sessionKey, type, url })),
    probeCdpState: (id) => {
      const p = probes.get(id)
      if (p === undefined) throw new Error(`No probe view ${id}`)
      return { attached: p.cdp?.attached ?? false, detaches: [...p.detaches] }
    },
    probeReattach: (id) => {
      const p = probe(id)
      p.cdp?.detach()
      p.cdp = null
      try {
        attachCdp(p)
        return { ok: true }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
    probeLogSnapshot: (id) => cdpOf(id).logSnapshot(),
    probeMouse: (id, type, x, y) => {
      const button = type === 'mouseMove' ? {} : { button: 'left' as const, clickCount: 1 }
      probe(id).contents.sendInputEvent({ type, x, y, ...button })
    },
    probeKey: (id, keyCode, modifiers = []) => {
      const contents = probe(id).contents
      contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
      contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
    },
    probeMouseRecords: (id) => [...probe(id).mouse],
    probeViewScreenOrigin: (id) => {
      const p = probe(id)
      const content = p.host.getContentBounds()
      const bounds = p.view.getBounds()
      return { x: content.x + bounds.x, y: content.y + bounds.y }
    },
    probeContentSize: () => {
      const { width, height } = hostWindow().getContentBounds()
      return { width, height }
    },
    probeSetBounds: (id, bounds) => probe(id).view.setBounds(bounds),
    probeDetachView: (id) => {
      const p = probe(id)
      const at = Date.now()
      if (p.attached) p.host.contentView.removeChildView(p.view)
      p.attached = false
      return at
    },
    probeAttachView: (id) => {
      const p = probe(id)
      const at = Date.now()
      if (!p.attached) p.host.contentView.addChildView(p.view)
      p.attached = true
      return at
    },
    probeCapture: async (id, name) => {
      const p = probe(id)
      const image = await p.contents.capturePage()
      const { width, height } = image.getSize()
      p.captures.set(name, { bitmap: image.toBitmap(), width, height })
      return { width, height }
    },
    probeCaptureDiff: (id, a, b, rect, tolerance = 8) => {
      const p = probe(id)
      const first = p.captures.get(a)
      const second = p.captures.get(b)
      if (first === undefined || second === undefined) throw new Error(`No capture ${a} or ${b}`)
      if (first.width !== second.width || first.height !== second.height) throw new Error('Captures differ in size')
      const scale = first.width / Math.max(1, p.view.getBounds().width)
      const x0 = Math.max(0, Math.floor(rect.x * scale))
      const y0 = Math.max(0, Math.floor(rect.y * scale))
      const x1 = Math.min(first.width, Math.ceil((rect.x + rect.width) * scale))
      const y1 = Math.min(first.height, Math.ceil((rect.y + rect.height) * scale))
      let changed = 0
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const at = (y * first.width + x) * 4
          for (let c = 0; c < 3; c += 1) {
            if (Math.abs(first.bitmap[at + c] - second.bitmap[at + c]) > tolerance) {
              changed += 1
              break
            }
          }
        }
      }
      return { changed, total: Math.max(0, x1 - x0) * Math.max(0, y1 - y0) }
    },
    probeInsertCss: (id, css) => probe(id).contents.insertCSS(css, { cssOrigin: 'user' }),
    probeContentsEvents: (id) => [...probe(id).emitted],
    probeHostEvents: () => [...hostEvents],
    probeDevTools: (id, open) => {
      const p = probe(id)
      if (!open) {
        if (p.contents.isDevToolsOpened()) p.contents.closeDevTools()
        return
      }
      if (p.contents.isDevToolsOpened()) return
      p.withdrawDevTools?.()
      p.withdrawDevTools = browserSessionRegistry.expectDevTools(p.contents.session)
      p.contents.openDevTools({ mode: 'detach', activate: false })
    },
    probeDevToolsState: (id) => {
      const contents = probe(id).contents
      const front = contents.devToolsWebContents
      const live = front !== null && !front.isDestroyed()
      return {
        open: contents.isDevToolsOpened(),
        frontEndId: live ? front.id : null,
        frontEndLoading: live ? front.isLoading() : false,
        frontEndUrl: live ? front.getURL() : ''
      }
    },
    probeFocusState: (id) => {
      const p = probe(id)
      return { viewFocused: p.contents.isFocused(), hostFocused: p.host.webContents.isFocused() }
    },
    ...createBrowserProbeSiteHook(getRuntime, sessionForProbes)
  }
}
