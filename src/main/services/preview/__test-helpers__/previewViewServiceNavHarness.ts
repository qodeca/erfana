// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Shared harness for the service's same-tab navigation tests (issue #124,
 * WI-17b): `PreviewViewService.navigation.test.ts` and
 * `PreviewViewService.resume.test.ts`, split by topic
 * (docs/windows/contributing.md § "Test-file split policy").
 *
 * The pages live in a real temporary directory, so the navigate gate and the
 * link routing confine against a real file system. Each session gets its own
 * fake page, whose events the tests fire; the failure log is the real one, and
 * the still-frame cache keeps one picture per panel, of the URL last committed.
 *
 * Plain values and builders; there is no `vi.mock()` here.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { vi } from 'vitest'

import { PREVIEW } from '../../../../shared/constants'
import type { PreviewFailureInput, PreviewStillFrame } from '../../../../shared/ipc/preview-types'
import { createPreviewFailureLog, type IPreviewFailureLog } from '../PreviewFailureLog'
import type { ReloadDecision } from '../PreviewReloadPolicy'
import type {
  PreviewSession,
  PreviewSessionCreateContext,
  PreviewSessionLike,
  PreviewViewHandle,
  PreviewWebContentsHandle
} from '../PreviewSessionFactory'
import { PREVIEW_PAGE_LINK_CHANNEL } from '../previewLinkBridge'
import type { PreviewEligibilityCheck } from '../previewLiveTypes'
import {
  PreviewViewService,
  type PreviewViewDeps,
  type PreviewWindowLike
} from '../PreviewViewService'

export const TOKEN = 'deadbeefdeadbeefdeadbeefdeadbeef'
const BOUNDS = { x: 0, y: 0, width: 100, height: 50 }

type Listener = (...args: unknown[]) => void

const projects: string[] = []

/** Remove every project directory the harness made. */
export function removeProjects(): void {
  for (const dir of projects.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * A project with `a.html`, `b.html` and `c.html` at its real root. With
 * `symlinked`, the project path is a symlink to that root, as a project opened
 * through an alias is.
 */
function makeProject(symlinked: boolean): { realRoot: string; projectPath: string } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'erfana-nav-')))
  projects.push(dir)
  const realRoot = join(dir, 'real')
  mkdirSync(realRoot)
  for (const name of ['a.html', 'b.html', 'c.html']) {
    writeFileSync(join(realRoot, name), '<p>page</p>')
  }
  if (!symlinked) {
    return { realRoot, projectPath: realRoot }
  }
  const projectPath = join(dir, 'link')
  symlinkSync(realRoot, projectPath, 'dir')
  return { realRoot, projectPath }
}

/** The picture a capture takes of a page at `url`. */
export const frameOf = (url: string): PreviewStillFrame => ({
  dataUrl: `data:image/png;base64,${Buffer.from(url).toString('base64')}`,
  width: 100,
  height: 50,
  capturedAt: 0
})

/** One preview page: its events, its link channel, and the URL it last committed. */
function makePage() {
  const listeners = new Map<string, Listener[]>()
  const ipcListeners = new Map<string, Listener[]>()
  const mainFrame = { id: 'main-frame' }
  let destroyed = false
  let shown = ''
  const add = (map: Map<string, Listener[]>, key: string, listener: Listener): void => {
    map.set(key, [...(map.get(key) ?? []), listener])
  }
  const remove = (map: Map<string, Listener[]>, key: string, listener: Listener): void => {
    map.set(
      key,
      (map.get(key) ?? []).filter((entry) => entry !== listener)
    )
  }
  const emit = (event: string, ...args: unknown[]): void => {
    for (const listener of listeners.get(event) ?? []) {
      listener(...args)
    }
  }
  const contents = {
    mainFrame,
    /** Chromium's own history; absent unless a test gives it one. */
    navigationHistory: undefined as unknown,
    shownUrl: () => shown,
    ipc: {
      on: (channel: string, listener: Listener) => add(ipcListeners, channel, listener),
      removeListener: (channel: string, listener: Listener) =>
        remove(ipcListeners, channel, listener)
    },
    loadURL: vi.fn<(url: string) => Promise<void>>(() => Promise.resolve()),
    reload: vi.fn<() => void>(),
    reloadIgnoringCache: vi.fn<() => void>(),
    destroy: vi.fn<() => void>(() => {
      destroyed = true
    }),
    close: vi.fn<() => void>(() => {
      destroyed = true
      emit('destroyed')
    }),
    isDestroyed: () => destroyed,
    setWindowOpenHandler: vi.fn(),
    executeJavaScriptInIsolatedWorld: vi.fn(() => Promise.resolve(true)),
    capturePage: vi.fn(),
    isBeingCaptured: vi.fn(() => false),
    printToPDF: vi.fn(() => Promise.resolve(Buffer.from(''))),
    findInPage: vi.fn(() => 1),
    stopFindInPage: vi.fn(),
    setZoomLevel: vi.fn<(level: number) => void>(),
    getZoomLevel: vi.fn(() => 0),
    isFocused: vi.fn(() => false),
    /** `preview:focusPage` (issue #124, QG-8 U1) calls this on the live page. */
    focus: vi.fn<() => void>(),
    on: (event: string, listener: Listener) => add(listeners, event, listener),
    once: (event: string, listener: Listener) => add(listeners, event, listener),
    removeListener: (event: string, listener: Listener) => remove(listeners, event, listener)
  }
  return {
    contents,
    emit,
    /** The main frame commits `url` (S15: a refused page commits with 404). */
    commit(url: string, status = 200): void {
      shown = url
      emit('did-navigate', {}, url, status, status === 200 ? 'OK' : 'Not Found')
    },
    /** A main-frame same-document step. */
    inPage(url: string): void {
      emit('did-navigate-in-page', {}, url, true, 1, 1)
    },
    /** Real input reaching the page (`input-event`); a `mouseDown` is a user gesture (QG-7 S1). */
    input(type = 'mouseDown'): void {
      emit('input-event', {}, { type })
    },
    finish: (): void => emit('did-finish-load'),
    stop: (): void => emit('did-stop-loading'),
    /** A link the preload reports; `button` 1 is a middle click. */
    click(href: string, button = 0): void {
      for (const listener of ipcListeners.get(PREVIEW_PAGE_LINK_CHANNEL) ?? []) {
        listener({ senderFrame: mainFrame }, { href, target: '', download: false, button })
      }
    }
  }
}

export type FakePage = ReturnType<typeof makePage>
type SpiedLog = IPreviewFailureLog & { drop: ReturnType<typeof vi.fn> }

/** The service over fake sessions for a real project directory. */
export function makeHarness(
  options: {
    symlinked?: boolean
    /** Main's forwarded-key sink (`deps.onForwardedShortcut`); absent by default. */
    onForwardedShortcut?: PreviewViewDeps['onForwardedShortcut']
  } = {}
) {
  const { realRoot, projectPath } = makeProject(options.symlinked === true)
  const pages: FakePage[] = []
  const contexts: PreviewSessionCreateContext[] = []
  const logs: SpiedLog[] = []
  const decisions: Array<(decision: ReloadDecision) => void> = []
  const entryWatchers: Array<{ filePath: string; close: ReturnType<typeof vi.fn> }> = []
  const frames = new Map<string, PreviewStillFrame>()
  let clock = 0
  /** The host window's own page: a forwarded focus-moving key focuses it (QG-11a H1). */
  const hostContents = {
    getZoomFactor: () => 1,
    focus: vi.fn<() => void>(),
    isDestroyed: vi.fn(() => false)
  }
  const window = {
    id: 1,
    isDestroyed: () => false,
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    getContentBounds: () => ({ x: 0, y: 0, width: 1000, height: 800 }),
    webContents: hostContents
  } as unknown as PreviewWindowLike

  const sessionCreate = vi.fn(async (ctx: PreviewSessionCreateContext): Promise<PreviewSession> => {
    contexts.push(ctx)
    const page = makePage()
    pages.push(page)
    return {
      view: {
        webContents: page.contents as unknown as PreviewWebContentsHandle,
        setBounds: vi.fn(),
        setBackgroundColor: vi.fn(),
        setVisible: vi.fn()
      } as unknown as PreviewViewHandle,
      session: { storagePath: null, isPersistent: () => false } as unknown as PreviewSessionLike,
      token: TOKEN,
      realRoot,
      partition: 'erfana-preview-test',
      teardown: vi.fn(),
      release: vi.fn(() => Promise.resolve())
    }
  })
  const stillFrameCache = {
    captureIfStale: vi.fn(async (wc: unknown, panelId: string) => {
      frames.set(panelId, frameOf((wc as { shownUrl(): string }).shownUrl()))
    }),
    get: vi.fn((panelId: string) => frames.get(panelId)),
    invalidate: vi.fn((panelId: string) => {
      frames.delete(panelId)
    }),
    markStale: vi.fn()
  }
  const emit = {
    failuresChanged:
      vi.fn<
        (panelId: string, failures: readonly PreviewFailureInput[], truncated: boolean) => void
      >(),
    hostBlocked: vi.fn(),
    allowlistChanged: vi.fn(),
    visibilityApplied: vi.fn(),
    openFileRequested: vi.fn(),
    findResult: vi.fn(),
    stillFrameChanged: vi.fn(),
    backdropChanged: vi.fn(),
    loadStateChanged: vi.fn(),
    boundsApplied: vi.fn(),
    pageChanged: vi.fn()
  }
  const checkEligibility = vi.fn<PreviewEligibilityCheck>(async () => ({ eligible: true }))
  const readEntryHtml = vi.fn(async (filePath: string) => {
    // Each page links its own stylesheet, so the watch set shows which page was read.
    return `<link rel="stylesheet" href="${basename(filePath, '.html')}.css">`
  })

  const deps: PreviewViewDeps = {
    sessionFactory: { create: sessionCreate, forgetRecycled: vi.fn() },
    registry: { rebuildCsp: vi.fn(), revoke: vi.fn() },
    stillFrameCache,
    exportController: {
      exportToPdf: vi.fn(() => Promise.resolve({ ok: true as const, path: '/x.pdf' }))
    },
    storageSeal: { purge: vi.fn(() => Promise.resolve()) },
    getAllowedHosts: () => [],
    emit,
    createWatchCoordinator: () => ({
      setWatchSet: vi.fn(() => Promise.resolve({ watched: [], dropped: [] })),
      dispose: vi.fn(() => Promise.resolve())
    }),
    createReloadPolicy: (onDecision) => {
      decisions.push(onDecision)
      return { record: vi.fn(), flush: vi.fn(), cancel: vi.fn(), dispose: vi.fn() }
    },
    createFindController: () => ({ find: vi.fn(), clearHighlights: vi.fn(), dispose: vi.fn() }),
    createFailureLog: (onEmit) => {
      const log = createPreviewFailureLog({ onEmit })
      vi.spyOn(log, 'drop')
      logs.push(log as SpiedLog)
      return log
    },
    createEntryWatcher: (filePath) => {
      const watcher = { filePath, close: vi.fn(() => Promise.resolve()) }
      entryWatchers.push(watcher)
      return watcher
    },
    getProjectPath: () => projectPath,
    getZoomFactor: () => 1,
    now: () => clock,
    readEntryHtml,
    platform: 'darwin',
    checkEligibility,
    onForwardedShortcut: options.onForwardedShortcut
  }
  const service = new PreviewViewService(deps)

  /** A page's project path, as the tree names it. */
  const file = (name: string): string => join(projectPath, name)
  /** A page's preview URL. */
  const url = (name: string, fragment = ''): string =>
    `erfana-preview://${TOKEN}/${name}${fragment}`
  const request = (panelId: string, name: string) => ({
    panelId,
    filePath: file(name),
    bounds: BOUNDS
  })

  return {
    service,
    window,
    hostContents,
    realRoot,
    projectPath,
    pages,
    contexts,
    logs,
    entryWatchers,
    stillFrameCache,
    emit,
    checkEligibility,
    readEntryHtml,
    file,
    url,
    request,
    /** The last snapshot of failures sent to the renderer. */
    lastSnapshot: (): readonly PreviewFailureInput[] | undefined =>
      emit.failuresChanged.mock.calls.at(-1)?.[1],
    /** The load states sent for `panelId`, in order. */
    loadStates: (panelId = 'panel-A'): unknown[] =>
      emit.loadStateChanged.mock.calls.filter(([id]) => id === panelId).map(([, state]) => state),
    /** The newest view's reload policy decides. */
    decide: (decision: ReloadDecision): void => decisions.at(-1)?.(decision),
    /** Set the service's clock (`deps.now`), which starts at 0. */
    setNow: (ms: number): void => {
      clock = ms
    },
    /** Open `panelId` on `name`, and let its first load commit and finish. */
    async openCommitted(name: string, panelId = 'panel-A'): Promise<FakePage> {
      await service.open(request(panelId, name), window)
      const page = pages.at(-1)!
      page.commit(url(name))
      page.finish()
      await vi.advanceTimersByTimeAsync(0)
      return page
    },
    /** `preview:navigate` commit of an `open` onto `name`, from window 1. */
    move: (name: string, anchor: string | null = null, panelId = 'panel-A') =>
      service.navigate(
        { panelId, phase: 'commit', action: 'open', filePath: file(name), anchor },
        1
      ),
    /** Suspend `panelId` by opening three other previews over the live-view budget. */
    async suspendByBudget(panelId = 'panel-A'): Promise<void> {
      for (let index = 0; index < PREVIEW.MAX_LIVE_VIEWS; index += 1) {
        await service.open(request(`filler-${index}`, 'c.html'), window)
      }
      await vi.advanceTimersByTimeAsync(0)
      if (
        !emit.loadStateChanged.mock.calls.some(
          ([id, state]) => id === panelId && state === 'suspended'
        )
      ) {
        throw new Error(`${panelId} was not suspended`)
      }
    }
  }
}

export type NavHarness = ReturnType<typeof makeHarness>

/** A Chromium history over `urls`, active on the last. */
export function nativeHistory(urls: readonly string[]) {
  return {
    getActiveIndex: () => urls.length - 1,
    getEntryAtIndex: (index: number) => (urls[index] === undefined ? null : { url: urls[index] }),
    goToIndex: vi.fn<(index: number) => void>()
  }
}
