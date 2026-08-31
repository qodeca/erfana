// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * PreviewViewService + PreviewLiveView tests (Issue #74, work item 39).
 *
 * Every electron surface is a typed fake injected through the deps, so the suite
 * runs with no real `WebContentsView`, `Session` or `BrowserWindow`. Each indexed
 * `vi.fn` carries an explicit function-type parameter so the test file is
 * type-clean even though test files are outside `npm run typecheck`.
 */
import { dirname, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ErrorCode } from '../../../shared/errors'
import { PREVIEW } from '../../../shared/constants'
import type { PreviewFailureInput } from '../../../shared/ipc/preview-types'
import type { IPreviewFailureLog, PreviewFailureEmit } from './PreviewFailureLog'
import type { IPreviewWatchCoordinator, WatchSetResult } from './PreviewWatchCoordinator'
import type { IPreviewReloadPolicy, ReloadDecision } from './PreviewReloadPolicy'
import type { IPreviewFindController, PreviewFindCount } from './PreviewFindController'
import type {
  PreviewSession,
  PreviewSessionLike,
  PreviewViewHandle,
  PreviewWebContentsHandle
} from './PreviewSessionFactory'
import type { PreviewFileWatcherHandle } from './previewViewLifecycle'
import type { PreviewWindowLike } from './PreviewLiveView'
import { PREVIEW_PAGE_CSP_VIOLATION_CHANNEL } from './previewCspViolationBridge'
import { PreviewViewService, type PreviewOpenRequest, type PreviewViewDeps } from './PreviewViewService'

type Listener = (...args: unknown[]) => void
type EntryHandlers = { onChange(): void; onUnlink(): void; onError(error: unknown): void }

/** An event-registering fake `WebContents` the lifecycle wiring attaches to. */
interface FakeWc {
  wc: PreviewWebContentsHandle
  emit(event: string, ...args: unknown[]): void
  loadURL: ReturnType<typeof vi.fn<(url: string) => Promise<void>>>
  reload: ReturnType<typeof vi.fn<() => void>>
  reloadIgnoringCache: ReturnType<typeof vi.fn<() => void>>
  setZoomLevel: ReturnType<typeof vi.fn<(level: number) => void>>
  getZoomLevel: ReturnType<typeof vi.fn<() => number>>
  isFocused: ReturnType<typeof vi.fn<() => boolean>>
  destroy: ReturnType<typeof vi.fn<() => void>>
  close: ReturnType<typeof vi.fn<() => void>>
  executeJavaScriptInIsolatedWorld: ReturnType<
    typeof vi.fn<(worldId: number, scripts: { code: string }[]) => Promise<unknown>>
  >
  /**
   * Deliver a payload on a WebContents-scoped channel, as the previewed page's
   * preload does.
   *
   * The page→main channels are registered on `wc.ipc`, never on global
   * `ipcMain`. Without this the registration in `wirePreviewLifecycle` was
   * optional-chained away (`wc.ipc?.on(...)`) against a fake that had no `ipc`
   * at all, so the whole CSP-violation path existed unexercised.
   */
  emitIpc(channel: string, payload: unknown, senderFrame?: unknown): void
  setDestroyed(value: boolean): void
}

function makeFakeWc(): FakeWc {
  const listeners = new Map<string, Listener[]>()
  const ipcListeners = new Map<string, Listener[]>()
  let destroyed = false
  const mainFrame = { id: 'main-frame' }

  const on = vi.fn<(event: string, listener: Listener) => void>((event, listener) => {
    const arr = listeners.get(event) ?? []
    arr.push(listener)
    listeners.set(event, arr)
  })
  const once = vi.fn<(event: string, listener: Listener) => void>((event, listener) => {
    on(event, listener)
  })
  const removeListener = vi.fn<(event: string, listener: Listener) => void>()

  const loadURL = vi.fn<(url: string) => Promise<void>>(() => Promise.resolve())
  const reload = vi.fn<() => void>()
  const reloadIgnoringCache = vi.fn<() => void>()
  const destroy = vi.fn<() => void>(() => {
    destroyed = true
  })
  const close = vi.fn<() => void>()
  const executeJavaScriptInIsolatedWorld = vi.fn<
    (worldId: number, scripts: { code: string }[]) => Promise<unknown>
  >(() => Promise.resolve(true))
  const setZoomLevel = vi.fn<(level: number) => void>()
  const getZoomLevel = vi.fn<() => number>(() => 0)
  const isFocused = vi.fn<() => boolean>(() => false)

  const wc = {
    loadURL,
    reload,
    reloadIgnoringCache,
    setZoomLevel,
    getZoomLevel,
    isFocused,
    destroy,
    close,
    isDestroyed: () => destroyed,
    setWindowOpenHandler: vi.fn(),
    executeJavaScriptInIsolatedWorld,
    capturePage: vi.fn(() =>
      Promise.resolve({
        isEmpty: () => true,
        getSize: () => ({ width: 0, height: 0 }),
        resize: () => ({}) as never,
        toDataURL: () => ''
      })
    ),
    isBeingCaptured: vi.fn(() => false),
    printToPDF: vi.fn(() => Promise.resolve(Buffer.from(''))),
    findInPage: vi.fn(() => 1),
    stopFindInPage: vi.fn(),
    setZoomLevel,
    getZoomLevel,
    isFocused,
    on: on as unknown as PreviewWebContentsHandle['on'],
    once: once as unknown as PreviewWebContentsHandle['once'],
    removeListener: removeListener as unknown as PreviewWebContentsHandle['removeListener'],
    mainFrame,
    ipc: {
      on: (channel: string, listener: Listener) => {
        const arr = ipcListeners.get(channel) ?? []
        arr.push(listener)
        ipcListeners.set(channel, arr)
      },
      removeListener: (channel: string, listener: Listener) => {
        const arr = ipcListeners.get(channel) ?? []
        ipcListeners.set(
          channel,
          arr.filter((entry) => entry !== listener)
        )
      }
    }
  } as unknown as PreviewWebContentsHandle

  return {
    wc,
    emit: (event, ...args) => {
      for (const listener of listeners.get(event) ?? []) {
        listener(...args)
      }
    },
    loadURL,
    reload,
    reloadIgnoringCache,
    setZoomLevel,
    getZoomLevel,
    isFocused,
    destroy,
    close,
    executeJavaScriptInIsolatedWorld,
    emitIpc: (channel, payload, senderFrame = mainFrame) => {
      for (const listener of ipcListeners.get(channel) ?? []) {
        listener({ senderFrame }, payload)
      }
    },
    setDestroyed: (value) => {
      destroyed = value
    }
  }
}

/** A fake failure log capturing its records. */
function makeFailureLog(): IPreviewFailureLog & {
  records: PreviewFailureInput[]
  clear: ReturnType<typeof vi.fn<() => void>>
  drop: ReturnType<typeof vi.fn<() => void>>
} {
  const records: PreviewFailureInput[] = []
  return {
    records,
    record: vi.fn<(input: PreviewFailureInput) => void>((input) => {
      records.push(input)
    }),
    list: vi.fn<() => never[]>(() => []),
    clear: vi.fn<() => void>(),
    drop: vi.fn<() => void>()
  }
}

interface Harness {
  service: PreviewViewService
  deps: PreviewViewDeps
  window: PreviewWindowLike
  otherWindow: PreviewWindowLike
  factory: FakeWc
  session: PreviewSession
  view: PreviewViewHandle
  /** Flip the host window to destroyed, modelling the quit ordering. */
  setWindowDestroyed(value: boolean): void
  /** The view double's `setBackgroundColor`, typed so its calls are readable. */
  setBackgroundColor: ReturnType<typeof vi.fn<(color: string) => void>>
  backdropChanged: ReturnType<typeof vi.fn<(panelId: string, color: string) => void>>
  sessionCreate: ReturnType<typeof vi.fn<() => Promise<PreviewSession>>>
  addChildView: ReturnType<typeof vi.fn<(view: PreviewViewHandle) => void>>
  removeChildView: ReturnType<typeof vi.fn<(view: PreviewViewHandle) => void>>
  rebuildCsp: ReturnType<typeof vi.fn<(token: string, hosts: readonly string[]) => void>>
  revoke: ReturnType<typeof vi.fn<(token: string) => void>>
  purge: ReturnType<typeof vi.fn<(session: PreviewSessionLike) => Promise<void>>>
  setWatchSet: ReturnType<typeof vi.fn<(paths: readonly string[]) => Promise<WatchSetResult>>>
  loadStateChanged: ReturnType<
    typeof vi.fn<(panelId: string, state: string, dropped: number) => void>
  >
  hostBlocked: ReturnType<
    typeof vi.fn<
      (
        panelId: string,
        host: string,
        approvable: boolean,
        kinds: readonly string[],
        notify: boolean
      ) => void
    >
  >
  /** The context `sessionFactory.create` was handed, for reaching `onBlocked`. */
  sessionCreate: ReturnType<typeof vi.fn>
  reloadRecord: ReturnType<typeof vi.fn<(path: string) => void>>
  readEntryHtml: ReturnType<typeof vi.fn<(path: string) => Promise<string>>>
  entryHandlers(): EntryHandlers
  failureLog(): ReturnType<typeof makeFailureLog>
  token: string
}

function makeHarness(
  options: { zoom?: number; now?: () => number; windowId?: number } = {}
): Harness {
  const backdropChanged = vi.fn<(panelId: string, color: string) => void>()
  const boundsApplied = vi.fn<(panelId: string, seq: number) => void>()
  const factory = makeFakeWc()
  // Held as its own typed reference: the `as unknown as PreviewViewHandle` cast
  // below erases the `vi.fn` typing, so a test that wants to read the colours
  // this was called with cannot get at them through `harness.view`.
  const setBackgroundColor = vi.fn<(color: string) => void>()
  const view = {
    webContents: factory.wc,
    setBounds: vi.fn<(bounds: { x: number; y: number; width: number; height: number }) => void>(),
    setBackgroundColor,
    setVisible: vi.fn<(visible: boolean) => void>()
  } as unknown as PreviewViewHandle

  const token = 'deadbeefdeadbeefdeadbeefdeadbeef'
  const sessionLike = {
    storagePath: null,
    isPersistent: () => false,
    clearStorageData: () => Promise.resolve(),
    clearCache: () => Promise.resolve()
  } as unknown as PreviewSessionLike

  const session: PreviewSession = {
    view,
    session: sessionLike,
    token,
    realRoot: '/proj',
    teardown: vi.fn<() => void>()
  }

  const sessionCreate = vi.fn<() => Promise<PreviewSession>>(() => Promise.resolve(session))

  const addChildView = vi.fn<(v: PreviewViewHandle) => void>()
  const removeChildView = vi.fn<(v: PreviewViewHandle) => void>()
  // `windowDestroyed` is settable so a test can model the quit ordering: the
  // window dies first, previews are torn down afterwards.
  let windowDestroyed = false
  const window = {
    id: options.windowId ?? 1,
    isDestroyed: () => windowDestroyed,
    contentView: { addChildView, removeChildView },
    getContentBounds: () => ({ x: 0, y: 0, width: 1000, height: 800 })
  } as unknown as PreviewWindowLike
  /** A second window for the cross-window panel-id collision case. */
  const otherWindow = {
    id: (options.windowId ?? 1) + 1,
    isDestroyed: () => false,
    contentView: { addChildView, removeChildView },
    getContentBounds: () => ({ x: 0, y: 0, width: 1000, height: 800 })
  } as unknown as PreviewWindowLike

  const rebuildCsp = vi.fn<(t: string, hosts: readonly string[]) => void>()
  const revoke = vi.fn<(t: string) => void>()
  const purge = vi.fn<(s: PreviewSessionLike) => Promise<void>>(() => Promise.resolve())

  const setWatchSet = vi.fn<(paths: readonly string[]) => Promise<WatchSetResult>>(() =>
    Promise.resolve({ watched: [], dropped: [] })
  )
  const watchCoordinator: IPreviewWatchCoordinator = {
    setWatchSet,
    dispose: vi.fn<() => Promise<void>>(() => Promise.resolve())
  }

  const reloadRecord = vi.fn<(path: string) => void>()
  const reloadPolicy: IPreviewReloadPolicy = {
    record: reloadRecord,
    flush: vi.fn<() => void>(),
    cancel: vi.fn<() => void>(),
    dispose: vi.fn<() => void>()
  }

  const findController: IPreviewFindController = {
    find: vi.fn(),
    clearHighlights: vi.fn<() => void>(),
    dispose: vi.fn<() => void>()
  }

  const loadStateChanged = vi.fn<(panelId: string, state: string, dropped: number) => void>()
  const hostBlocked =
    vi.fn<
      (
        panelId: string,
        host: string,
        approvable: boolean,
        kinds: readonly string[],
        notify: boolean
      ) => void
    >()

  const readEntryHtml = vi.fn<(path: string) => Promise<string>>(() =>
    Promise.resolve('<html></html>')
  )

  let capturedFailureLog: ReturnType<typeof makeFailureLog> | null = null
  let capturedEntryHandlers: EntryHandlers | null = null

  const deps: PreviewViewDeps = {
    sessionFactory: { create: sessionCreate as unknown as PreviewViewDeps['sessionFactory']['create'] },
    registry: { rebuildCsp, revoke },
    stillFrameCache: {
      captureIfStale: vi.fn(() => Promise.resolve()),
      get: vi.fn(() => undefined),
      invalidate: vi.fn<(panelId: string) => void>()
    },
    exportController: { exportToPdf: vi.fn(() => Promise.resolve({ ok: true as const, path: '/x.pdf' })) },
    storageSeal: { purge },
    hostBlockNotifier: {
      shouldNotify: vi.fn<(projectPath: string, host: string) => boolean>(() => true),
      clear: vi.fn<(projectPath?: string) => void>()
    },
    emit: {
      failuresChanged: vi.fn(),
      hostBlocked,
      findResult: vi.fn(),
      stillFrameChanged: vi.fn(),
      backdropChanged,
      loadStateChanged,
      boundsApplied
    },
    createWatchCoordinator: vi.fn<
      (realRoot: string, onChanged: (paths: readonly string[]) => void) => IPreviewWatchCoordinator
    >(() => watchCoordinator),
    createReloadPolicy: vi.fn<
      (onDecision: (d: ReloadDecision) => void) => IPreviewReloadPolicy
    >(() => reloadPolicy),
    createFindController: vi.fn<
      (wc: PreviewWebContentsHandle, onCount: (c: PreviewFindCount) => void) => IPreviewFindController
    >(() => findController),
    createFailureLog: vi.fn<(onEmit: PreviewFailureEmit) => IPreviewFailureLog>(() => {
      capturedFailureLog = makeFailureLog()
      return capturedFailureLog
    }),
    createEntryWatcher: vi.fn<
      (filePath: string, handlers: EntryHandlers) => PreviewFileWatcherHandle
    >((_filePath, handlers) => {
      capturedEntryHandlers = handlers
      return { close: vi.fn<() => Promise<void>>(() => Promise.resolve()) }
    }),
    getProjectPath: () => '/proj',
    getZoomFactor: () => options.zoom ?? 1,
    now: options.now ?? (() => 0),
    readEntryHtml,
    platform: 'darwin'
  }

  const service = new PreviewViewService(deps)

  return {
    service,
    deps,
    window,
    otherWindow,
    factory,
    session,
    view,
    sessionCreate,
    addChildView,
    removeChildView,
    rebuildCsp,
    revoke,
    purge,
    setWatchSet,
    loadStateChanged,
    setWindowDestroyed: (value: boolean) => {
      windowDestroyed = value
    },
    setBackgroundColor,
    backdropChanged,
    boundsApplied,
    hostBlocked,
    sessionCreate,
    reloadRecord,
    readEntryHtml,
    entryHandlers: () => {
      if (capturedEntryHandlers === null) throw new Error('entry watcher not wired')
      return capturedEntryHandlers
    },
    failureLog: () => {
      if (capturedFailureLog === null) throw new Error('failure log not created')
      return capturedFailureLog
    },
    token
  }
}

const REQUEST_A: PreviewOpenRequest = {
  panelId: 'panel-A',
  filePath: '/proj/page.html',
  bounds: { x: 10, y: 20, width: 100, height: 50 }
}

describe('PreviewViewService — independent views + replace-not-refuse', () => {
  it('refuses NO project with PROJECT_NOT_FOUND', async () => {
    const h = makeHarness()
    ;(h.deps as { getProjectPath: () => string | null }).getProjectPath = () => null
    const service = new PreviewViewService(h.deps)
    const result = await service.open(REQUEST_A, h.window)
    expect(result).toEqual({ ok: false, errorCode: ErrorCode.PROJECT_NOT_FOUND })
  })

  it('opens the first view', async () => {
    const h = makeHarness()
    const result = await h.service.open(REQUEST_A, h.window)
    expect(result).toEqual({ ok: true })
    expect(h.sessionCreate).toHaveBeenCalledTimes(1)
    expect(h.addChildView).toHaveBeenCalledWith(h.view)
    expect(h.factory.loadURL).toHaveBeenCalledWith('erfana-preview://' + h.token + '/page.html')
  })

  it('OPENS a second, DIFFERENT panel as its own independent view', async () => {
    // Inverted by sd-074b D5: the one-live-view refusal is gone. Each panel gets
    // its own sealed session, so two previews run side by side.
    const h = makeHarness()
    await h.service.open(REQUEST_A, h.window)
    const result = await h.service.open({ ...REQUEST_A, panelId: 'panel-B' }, h.window)
    expect(result).toEqual({ ok: true })
    expect(h.sessionCreate).toHaveBeenCalledTimes(2)
    // The first view is NOT torn down to make room.
    expect(h.factory.destroy).not.toHaveBeenCalled()
  })

  it('REFUSES the same panel id from a DIFFERENT window', async () => {
    // Panel ids are path-derived, so two windows previewing one file collide.
    // Replacing would destroy the other window's running view.
    const h = makeHarness()
    await h.service.open(REQUEST_A, h.window)
    const result = await h.service.open(REQUEST_A, h.otherWindow)
    expect(result).toEqual({
      ok: false,
      errorCode: ErrorCode.PREVIEW_VIEW_LIMIT_REACHED,
      holderPanelId: 'panel-A'
    })
    expect(h.sessionCreate).toHaveBeenCalledTimes(1)
  })

  it('REPLACES on the SAME panel (tears the old view down, opens fresh)', async () => {
    const h = makeHarness()
    await h.service.open(REQUEST_A, h.window)
    const result = await h.service.open(REQUEST_A, h.window)
    expect(result).toEqual({ ok: true })
    expect(h.sessionCreate).toHaveBeenCalledTimes(2)
    // The stale view was destroyed as part of the replace.
    expect(h.factory.destroy).toHaveBeenCalled()
    expect(h.revoke).toHaveBeenCalledWith(h.token)
  })
})

describe('PreviewViewService — open epoch guard', () => {
  it('discards a session whose open was superseded by a project change mid-build', async () => {
    const h = makeHarness()
    let resolveCreate: (s: PreviewSession) => void = () => {}
    h.sessionCreate.mockImplementationOnce(
      () =>
        new Promise<PreviewSession>((resolve) => {
          resolveCreate = resolve
        })
    )

    // Start the open; it suspends on `sessionFactory.create`.
    const opening = h.service.open(REQUEST_A, h.window)
    // A project switch lands while the session is still building.
    await h.service.onProjectChanged('/proj', '/other')
    // Now the session resolves — too late to install.
    resolveCreate(h.session)
    const result = await opening

    // Supersession has its OWN code now. It used to share PROJECT_NOT_FOUND
    // with the genuine "no project open" case, which left the renderer unable
    // to tell a benign race from a real failure and latched a banner it never
    // cleared (lens review F27).
    expect(result).toEqual({ ok: false, errorCode: ErrorCode.PREVIEW_OPEN_SUPERSEDED })
    // The built-but-unused session is torn down, its token revoked, view destroyed.
    expect(h.session.teardown).toHaveBeenCalledTimes(1)
    expect(h.revoke).toHaveBeenCalledWith(h.token)
    expect(h.factory.destroy).toHaveBeenCalledTimes(1)
    expect(h.addChildView).not.toHaveBeenCalled()

    // The slot is free: a fresh open now succeeds.
    const next = await h.service.open({ ...REQUEST_A, panelId: 'panel-B' }, h.window)
    expect(next).toEqual({ ok: true })
  })
})

describe('PreviewViewService — window teardown', () => {
  it('drains a window\'s previews when that window closes', async () => {
    const h = makeHarness()
    await h.service.open(REQUEST_A, h.window)

    await h.service.closeWindow(h.window.id)

    // Nothing reaped a window's views before this: the app-level disposer only
    // runs at quit, so a second window's previews simply leaked.
    expect(h.factory.destroy).toHaveBeenCalled()
    expect(h.revoke).toHaveBeenCalled()
  })

  it('leaves another window\'s previews alone', async () => {
    const h = makeHarness()
    await h.service.open(REQUEST_A, h.window)

    await h.service.closeWindow(h.otherWindow.id)

    expect(h.factory.destroy).not.toHaveBeenCalled()
  })

  it('is a no-op for a window with no previews', async () => {
    const h = makeHarness()
    await expect(h.service.closeWindow(h.window.id)).resolves.toBeUndefined()
  })

  it('does not detach from a window that is already destroyed', async () => {
    const h = makeHarness()
    await h.service.open(REQUEST_A, h.window)

    // The quit ordering: `mainWindowRef.destroy()` runs before `before-quit`
    // disposes the preview handlers, so teardown used to detach from a dead
    // window and log a warning on EVERY clean exit.
    //
    // The fake THROWS the way Electron does. A bare `vi.fn()` returns undefined
    // and never throws, so "no warning" would be the harness's default state and
    // this test would pass against unfixed code — which is the whole failure
    // mode this branch keeps finding.
    h.removeChildView.mockImplementation(() => {
      throw new Error('Object has been destroyed')
    })
    h.setWindowDestroyed(true)

    await h.service.close('panel-A')

    expect(h.removeChildView).not.toHaveBeenCalled()
  })

  it('still detaches — and still reports a failure — while the window is alive', async () => {
    const h = makeHarness()
    await h.service.open(REQUEST_A, h.window)

    // A throw from a LIVE window is a real signal: `close()`, budget eviction,
    // replace-on-reopen, the global off-switch and a project switch all detach
    // while the window is up. The guard must be on window liveness, never on the
    // step itself.
    h.removeChildView.mockImplementation(() => {
      throw new Error('boom')
    })

    await h.service.close('panel-A')

    expect(h.removeChildView).toHaveBeenCalled()
    // The teardown completes regardless — a failed step never skips the destroy.
    expect(h.factory.destroy).toHaveBeenCalled()
  })
})

describe('PreviewViewService — page zoom', () => {
  async function openOne(h: ReturnType<typeof makeHarness>): Promise<void> {
    await h.service.open(REQUEST_A, h.window)
  }

  it('zooms the PAGE, not the host window', async () => {
    const h = makeHarness()
    await openOne(h)

    await h.service.setZoom('panel-A', 1)

    // The host's zoom only scales the view's rectangle, which makes the page's
    // text relatively SMALLER. WCAG 2.2 SC 1.4.4 needs the text itself to grow.
    expect(h.factory.setZoomLevel).toHaveBeenLastCalledWith(1)
  })

  it('steps up and down from where it was', async () => {
    const h = makeHarness()
    await openOne(h)

    await h.service.setZoom('panel-A', 1)
    await h.service.setZoom('panel-A', 1)
    await h.service.setZoom('panel-A', -1)

    expect(h.factory.setZoomLevel).toHaveBeenLastCalledWith(1)
  })

  it('returns to 100% on reset', async () => {
    const h = makeHarness()
    await openOne(h)

    await h.service.setZoom('panel-A', 1)
    await h.service.setZoom('panel-A', 0)

    expect(h.factory.setZoomLevel).toHaveBeenLastCalledWith(0)
  })

  it('clamps a held-down key rather than zooming without limit', async () => {
    const h = makeHarness()
    await openOne(h)

    for (let i = 0; i < 50; i += 1) {
      await h.service.setZoom('panel-A', 1)
    }

    expect(h.factory.setZoomLevel).toHaveBeenLastCalledWith(PREVIEW.MAX_ZOOM_LEVEL)

    for (let i = 0; i < 100; i += 1) {
      await h.service.setZoom('panel-A', -1)
    }
    expect(h.factory.setZoomLevel).toHaveBeenLastCalledWith(PREVIEW.MIN_ZOOM_LEVEL)
  })

  it('remembers the zoom when a panel sleeps and comes back', async () => {
    const h = makeHarness()
    await openOne(h)
    await h.service.setZoom('panel-A', 1)

    // A preview evicted by the live-view budget is torn down and REBUILT when
    // its tab returns, so a level held on the view itself would silently reset
    // every time the reader looked away.
    await h.service.close('panel-A')
    // The harness shares ONE fake webContents across every view it builds, so
    // the close leaves it flagged destroyed and the rebuilt view would refuse
    // every call. Real Electron hands the new view a fresh one.
    h.factory.setDestroyed(false)
    h.factory.setZoomLevel.mockClear()
    await openOne(h)

    expect(h.factory.setZoomLevel).toHaveBeenCalledWith(1)
  })

  it('does not touch zoom on a fresh panel that was never zoomed', async () => {
    const h = makeHarness()
    await openOne(h)

    expect(h.factory.setZoomLevel).not.toHaveBeenCalled()
  })

  it('zooms whichever preview has focus, and reports when none does', async () => {
    const h = makeHarness()
    await openOne(h)

    h.factory.isFocused.mockReturnValue(false)
    expect(await h.service.zoomFocused(1)).toBe(false)

    h.factory.isFocused.mockReturnValue(true)
    expect(await h.service.zoomFocused(1)).toBe(true)
    expect(h.factory.setZoomLevel).toHaveBeenLastCalledWith(1)
  })
})

describe('PreviewViewService — backdrop', () => {
  /** Open one preview through the real service path. */
  async function openOne(h: ReturnType<typeof makeHarness>): Promise<void> {
    await h.service.open(REQUEST_A, h.window)
  }

  /** Let the isolated-world read and its follow-up repaint settle. */
  async function flush(): Promise<void> {
    await new Promise((resolve) => setImmediate(resolve))
  }

  it('paints chrome black before the page has painted', async () => {
    const h = makeHarness()
    await openOne(h)

    // The constructor runs before load(): at this point the DOM placeholder is
    // the only thing on screen and the two must be indistinguishable.
    expect(h.setBackgroundColor).toHaveBeenNthCalledWith(1, '#FF161312')
  })

  it("hands the page its own paper when the load stops", async () => {
    const h = makeHarness()
    h.factory.executeJavaScriptInIsolatedWorld.mockResolvedValue('rgb(255, 255, 255)')
    await openOne(h)

    h.factory.emit('did-stop-loading')
    await flush()

    expect(h.setBackgroundColor).toHaveBeenLastCalledWith('#FFFFFFFF')
  })

  it('respects a page that paints itself dark', async () => {
    const h = makeHarness()
    h.factory.executeJavaScriptInIsolatedWorld.mockResolvedValue('rgb(18, 18, 18)')
    await openOne(h)

    h.factory.emit('did-stop-loading')
    await flush()

    // Forcing white here would put the page's own light text on white — the
    // unreadable bug, mirrored.
    expect(h.setBackgroundColor).toHaveBeenLastCalledWith('#FF121212')
  })

  it('falls back to the browser default when the page declares nothing', async () => {
    const h = makeHarness()
    h.factory.executeJavaScriptInIsolatedWorld.mockResolvedValue(null)
    await openOne(h)

    h.factory.emit('did-stop-loading')
    await flush()

    expect(h.setBackgroundColor).toHaveBeenLastCalledWith('#FFFFFFFF')
  })

  it('gives a FAILED load paper too, so an error page is readable', async () => {
    const h = makeHarness()
    h.factory.executeJavaScriptInIsolatedWorld.mockResolvedValue(null)
    await openOne(h)

    // `did-finish-load` never fires for a failed load. Waiting for it would
    // leave Chromium's dark error text on the dark chrome backdrop — the
    // original defect, relocated to the failure path.
    h.factory.emit('did-fail-load')
    await flush()

    expect(h.setBackgroundColor).toHaveBeenLastCalledWith('#FFFFFFFF')
  })

  it('does NOT repaint chrome on a reload, so a save never flashes dark', async () => {
    const h = makeHarness()
    h.factory.executeJavaScriptInIsolatedWorld.mockResolvedValue('rgb(255, 255, 255)')
    await openOne(h)
    h.factory.emit('did-stop-loading')
    await flush()

    // A reload keeps the previous document on screen until the new one commits,
    // and `setBackgroundColor` is not deferred to the next paint — so painting
    // chrome here would flash the CURRENT page dark on every autosave.
    h.factory.emit('did-start-loading')
    await flush()

    // Asserted as "the paper is STILL what is painted", not as "chrome was not
    // painted": the latter passes against code that never repaints at all.
    expect(h.setBackgroundColor).toHaveBeenLastCalledWith('#FFFFFFFF')
  })

  it('survives a subframe load that re-enters the loading state', async () => {
    const h = makeHarness()
    h.factory.executeJavaScriptInIsolatedWorld.mockResolvedValue('rgb(255, 255, 255)')
    await openOne(h)
    h.factory.emit('did-stop-loading')
    await flush()

    // `did-start-loading` is frame-tree scoped, so a lazily-loaded <iframe>
    // fires it again long after the page is up. Pairing it with the
    // main-frame-only `did-finish-load` would strand the page on chrome.
    h.factory.emit('did-start-loading')
    await flush()

    expect(h.setBackgroundColor).toHaveBeenLastCalledWith('#FFFFFFFF')
  })

  it('is not routed through the rate-limited post-load pipeline', async () => {
    const h = makeHarness({ now: () => 0 })
    h.factory.executeJavaScriptInIsolatedWorld.mockResolvedValue('rgb(255, 255, 255)')
    await openOne(h)

    // Three terminations inside one rate-limit window. The pipeline collapses
    // these to a single trailing run; the backdrop must not share that budget,
    // because a dropped transition leaves the page unreadable.
    h.factory.emit('did-stop-loading')
    h.factory.emit('did-stop-loading')
    h.factory.emit('did-stop-loading')
    await flush()

    expect(h.setBackgroundColor).toHaveBeenLastCalledWith('#FFFFFFFF')
  })

  it('returns to chrome when the render process is gone', async () => {
    const h = makeHarness()
    h.factory.executeJavaScriptInIsolatedWorld.mockResolvedValue('rgb(255, 255, 255)')
    await openOne(h)
    h.factory.emit('did-stop-loading')
    await flush()

    // Nothing is painting any more, and the DOM shows its own failure banner —
    // a white rectangle would sit on top of it.
    h.factory.emit('render-process-gone', {}, { reason: 'oom' })
    await flush()

    // The MOVE is the assertion. "Ends on chrome" alone passes against code
    // that only ever painted chrome in the first place.
    const painted = h.setBackgroundColor.mock.calls.map(([argb]) => argb)
    expect(painted).toEqual(['#FF161312', '#FFFFFFFF', '#FF161312'])
  })

  it('refuses a colour it cannot parse rather than passing it through', async () => {
    const h = makeHarness()
    // The value is computed from an UNTRUSTED page and is interpolated into a
    // colour on both sides of the IPC boundary.
    h.factory.executeJavaScriptInIsolatedWorld.mockResolvedValue('rgb(1,2,3); background: url(x)')
    await openOne(h)

    h.factory.emit('did-stop-loading')
    await flush()

    expect(h.setBackgroundColor).toHaveBeenLastCalledWith('#FFFFFFFF')
  })

  it('tells the renderer the same value it paints, every time', async () => {
    const h = makeHarness()
    h.factory.executeJavaScriptInIsolatedWorld.mockResolvedValue('rgb(255, 255, 255)')
    await openOne(h)
    h.factory.emit('did-stop-loading')
    await flush()

    // The invariant replacing "both are brand black": the DOM placeholder and
    // the native view always carry the SAME colour, so no seam can show a band
    // of the wrong one.
    const painted = h.setBackgroundColor.mock.calls.map(([argb]) => `#${argb.slice(3)}`)
    const reported = h.backdropChanged.mock.calls.map(([, css]) => css.toUpperCase())
    expect(reported).toEqual(painted)
  })
})

describe('PreviewViewService — bounds clamp + zoom', () => {
  it('multiplies CSS px by the zoom factor before setBounds on open', async () => {
    const h = makeHarness({ zoom: 2 })
    await h.service.open(REQUEST_A, h.window)
    expect(h.view.setBounds).toHaveBeenCalledWith({ x: 20, y: 40, width: 200, height: 100 })
  })

  it('drops a stale seq and a collapsed rect', async () => {
    const h = makeHarness()
    await h.service.open(REQUEST_A, h.window)
    ;(h.view.setBounds as ReturnType<typeof vi.fn>).mockClear()

    h.service.setBounds('panel-A', { x: 0, y: 0, width: 200, height: 100 }, 5)
    expect(h.view.setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 200, height: 100 })
    ;(h.view.setBounds as ReturnType<typeof vi.fn>).mockClear()

    // seq <= last applied ⇒ dropped.
    h.service.setBounds('panel-A', { x: 1, y: 1, width: 50, height: 50 }, 5)
    expect(h.view.setBounds).not.toHaveBeenCalled()

    // A collapsed rect ⇒ dropped even with a fresh seq.
    h.service.setBounds('panel-A', { x: 1, y: 1, width: 0, height: 50 }, 6)
    expect(h.view.setBounds).not.toHaveBeenCalled()
  })
})

describe('PreviewViewService — reload rate limiting', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('runs one pipeline immediately and coalesces the rest into one trailing run', async () => {
    const h = makeHarness({ now: () => 0 })
    await h.service.open(REQUEST_A, h.window)
    h.readEntryHtml.mockClear()

    // Three rapid did-finish-loads inside the rate-limit window.
    h.factory.emit('did-finish-load')
    h.factory.emit('did-finish-load')
    h.factory.emit('did-finish-load')

    // Leading run fired synchronously; the other two were dropped/coalesced.
    expect(h.readEntryHtml).toHaveBeenCalledTimes(1)

    // The single trailing run fires at the end of the interval.
    await vi.advanceTimersByTimeAsync(PREVIEW.RELOAD_MIN_INTERVAL_MS)
    expect(h.readEntryHtml).toHaveBeenCalledTimes(2)
  })
})

describe('PreviewViewService — bounded destroy', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('forces destroy() after CLOSE_TIMEOUT_MS when close() hangs', async () => {
    const h = makeHarness()
    await h.service.open(REQUEST_A, h.window)

    const closed = h.service.close('panel-A')
    await vi.advanceTimersByTimeAsync(PREVIEW.CLOSE_TIMEOUT_MS)
    await closed

    expect(h.factory.close).toHaveBeenCalledTimes(1)
    expect(h.factory.destroy).toHaveBeenCalledTimes(1)
  })
})

describe('PreviewViewService — applyApprovedHosts', () => {
  it('rebuilds the CSP, purges, clears failures and reloads ignoring cache', async () => {
    const h = makeHarness()
    await h.service.open(REQUEST_A, h.window)
    const log = h.failureLog()

    await h.service.applyApprovedHosts('panel-A', ['cdn.example.com'])

    expect(h.rebuildCsp).toHaveBeenCalledWith(h.token, ['cdn.example.com'])
    expect(h.purge).toHaveBeenCalledWith(h.session.session)
    expect(log.clear).toHaveBeenCalledTimes(1)
    expect(h.factory.reloadIgnoringCache).toHaveBeenCalledTimes(1)
  })

  it('is a no-op for a non-holding panel', async () => {
    const h = makeHarness()
    await h.service.open(REQUEST_A, h.window)
    await h.service.applyApprovedHosts('other', ['cdn.example.com'])
    expect(h.rebuildCsp).not.toHaveBeenCalled()
  })
})

describe('PreviewViewService — destroyAll', () => {
  it('destroys the live view, revokes the token and purges, freeing the slot', async () => {
    const h = makeHarness()
    await h.service.open(REQUEST_A, h.window)

    await h.service.destroyAll('globally-disabled')

    expect(h.factory.destroy).toHaveBeenCalledTimes(1)
    expect(h.revoke).toHaveBeenCalledWith(h.token)
    expect(h.purge).toHaveBeenCalledWith(h.session.session)

    // The slot is free: a different panel now opens rather than being refused.
    const result = await h.service.open({ ...REQUEST_A, panelId: 'panel-B' }, h.window)
    expect(result).toEqual({ ok: true })
  })
})

describe('PreviewViewService — four lifecycle events', () => {
  it('render-process-gone ⇒ failed + render-crash badge carrying the reason', async () => {
    const h = makeHarness()
    await h.service.open(REQUEST_A, h.window)
    const log = h.failureLog()
    h.loadStateChanged.mockClear()

    // Electron delivers (event, details); details.reason distinguishes the crash.
    h.factory.emit('render-process-gone', {}, { reason: 'oom' })

    expect(h.loadStateChanged).toHaveBeenCalledWith('panel-A', 'failed', 0)
    const last = log.records.at(-1)
    expect(last?.type).toBe('render-crash')
    expect(last?.resourceUrlOrHost).toBe('oom')
  })

  it('unresponsive ⇒ failed', async () => {
    const h = makeHarness()
    await h.service.open(REQUEST_A, h.window)
    h.loadStateChanged.mockClear()

    h.factory.emit('unresponsive')

    expect(h.loadStateChanged).toHaveBeenCalledWith('panel-A', 'failed', 0)
  })

  it('entry-file unlink ⇒ failed + missing-local-file "file deleted" badge', async () => {
    const h = makeHarness()
    await h.service.open(REQUEST_A, h.window)
    const log = h.failureLog()
    h.loadStateChanged.mockClear()

    h.entryHandlers().onUnlink()

    expect(h.loadStateChanged).toHaveBeenCalledWith('panel-A', 'failed', 0)
    const last = log.records.at(-1)
    expect(last?.type).toBe('missing-local-file')
    expect(last?.reasonCode).toBe(ErrorCode.PREVIEW_LOCAL_FILE_MISSING)
    expect(last?.resourceUrlOrHost).toBe('page.html')
  })

  it('entry-file rename is treated as a delete (unlink handler fires)', async () => {
    const h = makeHarness()
    await h.service.open(REQUEST_A, h.window)
    h.loadStateChanged.mockClear()

    // chokidar fires `unlink` on the old path for a rename-away.
    h.entryHandlers().onUnlink()

    expect(h.loadStateChanged).toHaveBeenCalledWith('panel-A', 'failed', 0)
  })

  it('entry-file change routes through the reload policy, not an immediate reload', async () => {
    const h = makeHarness()
    await h.service.open(REQUEST_A, h.window)
    h.factory.reload.mockClear()

    h.entryHandlers().onChange()

    // Coalesced through the reload policy (so an entry+CSS burst is one reload),
    // not a synchronous wc.reload().
    expect(h.reloadRecord).toHaveBeenCalledWith('/proj/page.html')
    expect(h.factory.reload).not.toHaveBeenCalled()
  })
})

describe('PreviewViewService — post-load pipeline', () => {
  it('feeds extracted links to the watch coordinator and emits ready', async () => {
    const h = makeHarness({ now: () => 0 })
    h.readEntryHtml.mockResolvedValue(
      '<html><head><link rel="stylesheet" href="style.css"></head></html>'
    )
    await h.service.open(REQUEST_A, h.window)
    h.loadStateChanged.mockClear()

    h.factory.emit('did-finish-load')
    await vi.waitFor(() => expect(h.setWatchSet).toHaveBeenCalled())

    // The relative link resolved against the entry-file directory. Built with
    // the same `resolve(dirname(entry), href)` the view uses rather than a POSIX
    // literal: on win32 `resolve` anchors a rooted POSIX fixture to the current
    // drive, so the produced path is `C:\proj\style.css`.
    expect(h.setWatchSet).toHaveBeenCalledWith([
      resolve(dirname(REQUEST_A.filePath), 'style.css')
    ])
    expect(h.loadStateChanged).toHaveBeenCalledWith('panel-A', 'ready', 0)
  })
})

// =============================================================================
// Teardown races (sd-074b §4.1)
//
// Both defects predate multi-view: with one live view they leak a single
// session; keyed by panel they would leak one per tab and permanently wedge the
// panel id. Fixed on the single-view code first so the fix is reviewable on its
// own, before the registry refactor lands on top.
// =============================================================================

/** A promise plus its resolver, for interleaving an await deliberately. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('PreviewViewService — teardown races', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('abandons an open whose panel was closed while the session was building', async () => {
    const h = makeHarness()
    const gate = deferred<PreviewSession>()
    h.sessionCreate.mockImplementationOnce(() => gate.promise)

    const opening = h.service.open(REQUEST_A, h.window)
    // The renderer unmounts the panel — and therefore sends `close` — while the
    // session is still being built. `this.live` is null in this window, which is
    // exactly what used to make the close a no-op.
    const closing = h.service.close('panel-A')
    gate.resolve(h.session)

    const result = await opening
    await closing

    expect(result.ok).toBe(false)
    // No view was ever installed for the dead panel...
    expect(h.addChildView).not.toHaveBeenCalled()
    // ...and the session that was already built got discarded, not leaked.
    expect(h.revoke).toHaveBeenCalledWith(h.token)
  })

  it('tears the view down when the panel is closed while the entry page loads', async () => {
    const h = makeHarness()
    const gate = deferred<void>()
    h.factory.loadURL.mockImplementationOnce(() => gate.promise)

    const opening = h.service.open(REQUEST_A, h.window)
    await Promise.resolve()
    const closing = h.service.close('panel-A')
    gate.resolve()

    const result = await opening
    await vi.advanceTimersByTimeAsync(PREVIEW.CLOSE_TIMEOUT_MS)
    await closing

    expect(result.ok).toBe(false)
    expect(h.factory.destroy).toHaveBeenCalled()
  })

  it('destroys the webContents and revokes the token even when a teardown step throws', async () => {
    const h = makeHarness()
    ;(
      h.deps.createEntryWatcher as unknown as ReturnType<
        typeof vi.fn<(filePath: string, handlers: EntryHandlers) => PreviewFileWatcherHandle>
      >
    ).mockImplementation(() => ({
      close: vi.fn<() => Promise<void>>(() => Promise.reject(new Error('watcher close failed')))
    }))

    await h.service.open(REQUEST_A, h.window)

    const closing = h.service.close('panel-A')
    await vi.advanceTimersByTimeAsync(PREVIEW.CLOSE_TIMEOUT_MS)

    await expect(closing).resolves.toBeUndefined()
    expect(h.revoke).toHaveBeenCalledWith(h.token)
    expect(h.factory.destroy).toHaveBeenCalled()
  })

  it('leaves the panel re-openable after a teardown step threw', async () => {
    const h = makeHarness()
    ;(
      h.deps.createEntryWatcher as unknown as ReturnType<
        typeof vi.fn<(filePath: string, handlers: EntryHandlers) => PreviewFileWatcherHandle>
      >
    ).mockImplementationOnce(() => ({
      close: vi.fn<() => Promise<void>>(() => Promise.reject(new Error('watcher close failed')))
    }))

    await h.service.open(REQUEST_A, h.window)
    const closing = h.service.close('panel-A')
    await vi.advanceTimersByTimeAsync(PREVIEW.CLOSE_TIMEOUT_MS)
    await closing

    // The slot must be free: a wedged entry would refuse or re-await the dead
    // teardown forever.
    const reopened = await h.service.open(REQUEST_A, h.window)
    expect(reopened).toEqual({ ok: true })
  })
})

// =============================================================================
// Multiple live views, sleep-when-idle, and project-scoped shared state
// (sd-074b §4.2–4.5)
// =============================================================================

describe('PreviewViewService — live-view budget', () => {
  /** Open `count` panels named panel-1..panel-N in order. */
  async function openPanels(h: Harness, count: number): Promise<void> {
    for (let i = 1; i <= count; i += 1) {
      await h.service.open({ ...REQUEST_A, panelId: `panel-${i}` }, h.window)
    }
  }

  /**
   * The still-frame capture is real I/O and can reject. By that point the entry
   * is already out of the registry, so a throw that skipped the teardown would
   * leave a live renderer with no owner — unreachable by `close()`, and with the
   * renderer never told it was suspended, so its resume effect never fires and
   * the tab is permanently dead (lens review F8).
   */
  it('still tears the view down when the still-frame capture rejects', async () => {
    const h = makeHarness()
    const capture = h.deps.stillFrameCache.captureIfStale as unknown as ReturnType<typeof vi.fn>
    capture.mockRejectedValue(new Error('capture failed'))

    await openPanels(h, PREVIEW.MAX_LIVE_VIEWS + 1)

    // The eviction still destroyed the view and told the renderer about it.
    expect(h.factory.destroy).toHaveBeenCalled()
    const suspended = h.loadStateChanged.mock.calls
      .filter(([, state]) => state === 'suspended')
      .map(([panelId]) => panelId)
    expect(suspended).toEqual(['panel-1'])
  })

  it('keeps up to MAX_LIVE_VIEWS running without suspending anything', async () => {
    const h = makeHarness()
    await openPanels(h, PREVIEW.MAX_LIVE_VIEWS)

    expect(h.sessionCreate).toHaveBeenCalledTimes(PREVIEW.MAX_LIVE_VIEWS)
    expect(
      h.loadStateChanged.mock.calls.filter(([, state]) => state === 'suspended')
    ).toHaveLength(0)
  })

  it('suspends the least recently active preview when the budget is exceeded', async () => {
    const h = makeHarness()
    await openPanels(h, PREVIEW.MAX_LIVE_VIEWS + 1)

    const suspended = h.loadStateChanged.mock.calls
      .filter(([, state]) => state === 'suspended')
      .map(([panelId]) => panelId)

    // panel-1 was opened first and never touched since, so it is the candidate.
    expect(suspended).toEqual(['panel-1'])
  })

  it('never suspends the panel that was just opened', async () => {
    const h = makeHarness()
    await openPanels(h, PREVIEW.MAX_LIVE_VIEWS + 2)

    const suspended = h.loadStateChanged.mock.calls
      .filter(([, state]) => state === 'suspended')
      .map(([panelId]) => panelId)

    expect(suspended).not.toContain(`panel-${PREVIEW.MAX_LIVE_VIEWS + 2}`)
  })

  it('treats becoming visible as activation, so an active tab is not evicted', async () => {
    const h = makeHarness()
    await openPanels(h, PREVIEW.MAX_LIVE_VIEWS)
    // The user switches back to the oldest tab before opening one more.
    await h.service.setVisibility('panel-1', true, 'active-tab')
    await h.service.open({ ...REQUEST_A, panelId: 'panel-new' }, h.window)

    const suspended = h.loadStateChanged.mock.calls
      .filter(([, state]) => state === 'suspended')
      .map(([panelId]) => panelId)

    expect(suspended).toEqual(['panel-2'])
    expect(suspended).not.toContain('panel-1')
  })

  it('a suspended panel can be re-opened as a fresh live view', async () => {
    const h = makeHarness()
    await openPanels(h, PREVIEW.MAX_LIVE_VIEWS + 1)
    const createsBefore = h.sessionCreate.mock.calls.length

    const reopened = await h.service.open({ ...REQUEST_A, panelId: 'panel-1' }, h.window)

    expect(reopened).toEqual({ ok: true })
    expect(h.sessionCreate.mock.calls.length).toBe(createsBefore + 1)
  })
})

describe('PreviewViewService — project-scoped shared state', () => {
  it('applies an approved host to EVERY live view of the project', async () => {
    const h = makeHarness()
    await h.service.open(REQUEST_A, h.window)
    await h.service.open({ ...REQUEST_A, panelId: 'panel-B' }, h.window)

    await h.service.applyApprovedHosts('panel-A', ['cdn.example.com'])

    // One rebuild per live view, not just the approving panel: the request
    // filter reads the shared host set live, so a single rebuild would leave the
    // other view's CSP forbidding a host its network filter already allows.
    expect(h.rebuildCsp).toHaveBeenCalledTimes(2)
  })

  it('is a no-op for a panel with no live view', async () => {
    const h = makeHarness()
    await h.service.open(REQUEST_A, h.window)

    await h.service.applyApprovedHosts('panel-unknown', ['cdn.example.com'])

    expect(h.rebuildCsp).not.toHaveBeenCalled()
  })

  it('releases the toast budget only when the project loses its LAST view', async () => {
    const h = makeHarness()
    const clear = h.deps.hostBlockNotifier.clear as unknown as ReturnType<
      typeof vi.fn<(projectPath?: string) => void>
    >
    await h.service.open(REQUEST_A, h.window)
    await h.service.open({ ...REQUEST_A, panelId: 'panel-B' }, h.window)

    await h.service.close('panel-A')
    expect(clear).not.toHaveBeenCalled()

    await h.service.close('panel-B')
    expect(clear).toHaveBeenCalledWith('/proj')
  })

  it('destroyAll tears down every live view', async () => {
    const h = makeHarness()
    await h.service.open(REQUEST_A, h.window)
    await h.service.open({ ...REQUEST_A, panelId: 'panel-B' }, h.window)

    await h.service.destroyAll('global-off')

    // The harness hands every open the SAME fake session, so `destroy` cannot
    // count views — the second call sees `isDestroyed()` already true. Token
    // revocation runs per view regardless, so that is what proves both went.
    expect(h.revoke).toHaveBeenCalledTimes(2)
    // The slots are free again.
    expect(await h.service.open(REQUEST_A, h.window)).toEqual({ ok: true })
  })
})

describe('PreviewViewService — bounds confirmation', () => {
  /** A harness with panel A already open, ready to be pushed new bounds. */
  async function openPanel(): Promise<ReturnType<typeof makeHarness>> {
    const h = makeHarness()
    await h.service.open(REQUEST_A, h.window)
    return h
  }

  /**
   * Push with `ack` and assert it DID confirm.
   *
   * Every "says nothing" case below needs one of these. "Not called" is also the
   * state of a build where the confirmation does not exist at all, so a lone
   * negative assertion passes against unfeatured code and proves nothing — this
   * branch has produced that shape of vacuous test repeatedly. The control makes
   * the silence mean "deliberately withheld" rather than "never implemented".
   */
  async function expectConfirms(
    h: Awaited<ReturnType<typeof openPanel>>,
    seq: number
  ): Promise<void> {
    h.service.setBounds('panel-A', { x: 0, y: 0, width: 200, height: 100 }, seq, true)
    await Promise.resolve()
    await Promise.resolve()
    expect(h.boundsApplied).toHaveBeenCalledWith('panel-A', seq)
  }

  // A confirmation exists so a caller can reveal Erfana's own chrome and know
  // the untrusted page has actually moved off it. Until then the page is still
  // painting there, and a native view takes input over its rect whatever the
  // DOM says — so a control rendered early can be both spoofed and clicked
  // through.
  //
  // Which means SILENCE has to be safe, and every path that drops a push must
  // stay silent. These cases are mostly about that.

  it('confirms only after the page reports a repaint', async () => {
    const h = await openPanel()
    h.boundsApplied.mockClear()

    // The isolated-world call is what asks the page. Hold it pending, and no
    // confirmation may go out: `view.setBounds` having returned is exactly the
    // thing that is NOT sufficient.
    let release: (value: unknown) => void = () => {}
    h.factory.executeJavaScriptInIsolatedWorld.mockImplementationOnce(
      () => new Promise((resolve) => { release = resolve })
    )

    h.service.setBounds('panel-A', { x: 0, y: 0, width: 200, height: 100 }, 9, true)
    expect(h.view.setBounds).toHaveBeenCalled()
    expect(h.boundsApplied).not.toHaveBeenCalled()

    release(420)
    await Promise.resolve()
    await Promise.resolve()
    expect(h.boundsApplied).toHaveBeenCalledWith('panel-A', 9)
  })

  it('asks the page in an isolated world, so it cannot answer on Erfana\'s behalf', async () => {
    const h = await openPanel()
    h.factory.executeJavaScriptInIsolatedWorld.mockClear()

    h.service.setBounds('panel-A', { x: 0, y: 0, width: 200, height: 100 }, 10, true)

    const [worldId, scripts] = h.factory.executeJavaScriptInIsolatedWorld.mock.calls[0]
    expect(worldId).toBeGreaterThan(0)
    // Two frames, not one: the first may already have been scheduled before the
    // resize reached the page.
    const code = (scripts as { code: string }[])[0].code
    expect(code.match(/requestAnimationFrame/g)?.length).toBe(2)
  })

  it('says nothing for an ordinary push that did not ask', async () => {
    const h = await openPanel()
    h.boundsApplied.mockClear()
    h.factory.executeJavaScriptInIsolatedWorld.mockClear()

    h.service.setBounds('panel-A', { x: 0, y: 0, width: 200, height: 100 }, 11)
    await Promise.resolve()

    expect(h.view.setBounds).toHaveBeenCalled()
    expect(h.factory.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled()
    expect(h.boundsApplied).not.toHaveBeenCalled()

    // Control: the very next push, asking, does confirm.
    await expectConfirms(h, 12)
  })

  it('says nothing when the push was DROPPED as stale', async () => {
    const h = await openPanel()
    h.service.setBounds('panel-A', { x: 0, y: 0, width: 200, height: 100 }, 20)
    h.boundsApplied.mockClear()
    h.factory.executeJavaScriptInIsolatedWorld.mockClear()

    // Lower seq: dropped. Confirming it would tell the renderer the view is
    // somewhere it is not.
    h.service.setBounds('panel-A', { x: 0, y: 0, width: 200, height: 100 }, 19, true)
    await Promise.resolve()

    expect(h.boundsApplied).not.toHaveBeenCalled()

    // Control: a FRESH seq on the same view confirms, so the silence above is
    // about staleness and not about a missing feature.
    await expectConfirms(h, 21)
  })

  it('says nothing when the page fails to answer', async () => {
    const h = await openPanel()
    h.boundsApplied.mockClear()
    h.factory.executeJavaScriptInIsolatedWorld.mockRejectedValueOnce(new Error('gone'))

    h.service.setBounds('panel-A', { x: 0, y: 0, width: 200, height: 100 }, 12, true)
    await Promise.resolve()
    await Promise.resolve()

    expect(h.boundsApplied).not.toHaveBeenCalled()

    // Control: the rejection was one-shot, and the next push confirms.
    await expectConfirms(h, 13)
  })

  it('lets the newest push own the confirmation', async () => {
    // A resize mid-flight means the earlier answer describes a geometry that is
    // already gone.
    const h = await openPanel()
    h.boundsApplied.mockClear()

    let release: (value: unknown) => void = () => {}
    h.factory.executeJavaScriptInIsolatedWorld.mockImplementationOnce(
      () => new Promise((resolve) => { release = resolve })
    )
    h.service.setBounds('panel-A', { x: 0, y: 0, width: 200, height: 100 }, 30, true)
    h.service.setBounds('panel-A', { x: 0, y: 0, width: 300, height: 100 }, 31)

    release(420)
    await Promise.resolve()
    await Promise.resolve()

    expect(h.boundsApplied).not.toHaveBeenCalledWith('panel-A', 30)

    // Control: seq 32 confirms as itself, so the withheld 30 is about being
    // overtaken rather than about nothing ever confirming.
    await expectConfirms(h, 32)
  })
})

describe('PreviewViewService — every blocked host reaches the renderer', () => {
  /** The `onBlocked` sink the session factory was handed for panel A. */
  async function blockedSink(h: ReturnType<typeof makeHarness>): Promise<
    (kind: string, host: string, url: string, approvable: boolean, resourceKind?: string) => void
  > {
    await h.service.open(REQUEST_A, h.window)
    const context = h.sessionCreate.mock.calls[0][0] as {
      onBlocked: (
        kind: string,
        host: string,
        url: string,
        approvable: boolean,
        resourceKind?: string
      ) => void
    }
    return context.onBlocked
  }

  it('reports a host even when the toast budget is spent', async () => {
    // THE DEFECT. `hostBlocked` used to be emitted only when the notifier
    // allowed a toast, so the 3-toast budget silently gated the DATA: past the
    // third host the renderer was never told a host had been blocked at all. It
    // could not list it, and the reader had no way to approve it — observed as a
    // page with four hosts where the fourth image stayed broken with no prompt
    // and no route to one.
    const h = makeHarness()
    const onBlocked = await blockedSink(h)
    ;(h.deps.hostBlockNotifier.shouldNotify as ReturnType<typeof vi.fn>).mockReturnValue(false)
    h.hostBlocked.mockClear()

    onBlocked('blocked-host', 'fourth.example.com', 'https://fourth.example.com/a.png', true, 'image')

    expect(h.hostBlocked).toHaveBeenCalledTimes(1)
    const [panelId, host, approvable, kinds, notify] = h.hostBlocked.mock.calls[0]
    expect(panelId).toBe('panel-A')
    expect(host).toBe('fourth.example.com')
    expect(approvable).toBe(true)
    expect(kinds).toEqual(['image'])
    // The budget verdict survives as a HINT the renderer may act on, rather
    // than as a gate that decides whether the fact exists.
    expect(notify).toBe(false)
  })

  it('passes the budget verdict through when a toast IS allowed', async () => {
    const h = makeHarness()
    const onBlocked = await blockedSink(h)
    h.hostBlocked.mockClear()

    onBlocked('blocked-host', 'first.example.com', 'https://first.example.com/a.js', true, 'script')

    expect(h.hostBlocked.mock.calls[0][4]).toBe(true)
  })

  it('accumulates the kinds one host is refused for', async () => {
    // A host serving both a stylesheet and a script must not keep reading
    // "style". A reader who consented to a stylesheet and got script execution
    // was misinformed by the surface built to inform them.
    const h = makeHarness()
    const onBlocked = await blockedSink(h)
    h.hostBlocked.mockClear()

    onBlocked('blocked-host', 'cdn.example.com', 'https://cdn.example.com/a.css', true, 'style')
    onBlocked('blocked-host', 'cdn.example.com', 'https://cdn.example.com/a.js', true, 'script')

    expect(h.hostBlocked.mock.calls[0][3]).toEqual(['style'])
    expect(h.hostBlocked.mock.calls[1][3]).toEqual(['script', 'style'])
  })

  it('still records a non-approvable host, and still refuses to offer it', async () => {
    const h = makeHarness()
    const onBlocked = await blockedSink(h)
    h.hostBlocked.mockClear()

    onBlocked('blocked-host', 'localhost', 'http://localhost:9000/x', false, 'connect')

    const [, host, approvable] = h.hostBlocked.mock.calls[0]
    expect(host).toBe('localhost')
    expect(approvable).toBe(false)
  })
})

describe('PreviewViewService — a CSP refusal survives an approval', () => {
  /**
   * Refuse one subresource, the way the previewed page's preload reports it.
   *
   * Goes through the real `wc.ipc` channel rather than the bridge's API, so
   * these cases cover the WIRING — preload channel → main-frame gate → bridge →
   * `onBlockedHost` → `hostBlocked` — and not just the bridge in isolation.
   */
  function refuse(
    h: ReturnType<typeof makeHarness>,
    url: string,
    effectiveDirective = 'img-src'
  ): void {
    h.factory.emitIpc(PREVIEW_PAGE_CSP_VIOLATION_CHANNEL, { blockedURI: url, effectiveDirective })
  }

  /** The hosts `hostBlocked` was called with, in order. */
  function reportedHosts(h: ReturnType<typeof makeHarness>): string[] {
    return h.hostBlocked.mock.calls.map((call) => call[1] as string)
  }

  it('reports a host the CSP refused, and reports it once', async () => {
    // The positive control for every case below: without this, "nothing was
    // reported" would be indistinguishable from "the channel was never wired".
    const h = makeHarness()
    await h.service.open(REQUEST_A, h.window)

    refuse(h, 'https://fonts.gstatic.com/f.woff2', 'font-src')
    refuse(h, 'https://fonts.gstatic.com/g.woff2', 'font-src')

    expect(reportedHosts(h)).toEqual(['fonts.gstatic.com'])
  })

  it('re-reports the hosts still blocked after a different host is approved', async () => {
    // THE DEFECT. `applyApprovedHosts` clears the failure log and reloads the
    // SAME WebContents, but the CSP bridge's per-host dedupe map lived for the
    // whole life of the view. So the reload refused B and C again, the bridge
    // swallowed both as already-seen, and the log they would have been listed in
    // had just been emptied. Approving one host made every other blocked host
    // vanish from the badge AND become unapprovable — recoverable only by
    // closing and reopening the panel.
    //
    // The network filter cannot compensate: the whole premise of the CSP bridge
    // is that a refusal in the renderer never reaches `onBeforeRequest`.
    const h = makeHarness()
    await h.service.open(REQUEST_A, h.window)

    refuse(h, 'https://a.example.com/1.png')
    refuse(h, 'https://b.example.com/2.png')
    refuse(h, 'https://c.example.com/3.png')
    expect(reportedHosts(h)).toEqual(['a.example.com', 'b.example.com', 'c.example.com'])

    h.hostBlocked.mockClear()
    await h.service.applyApprovedHosts('panel-A', ['a.example.com'])

    // The reload replays the page, so the CSP refuses B and C all over again.
    refuse(h, 'https://b.example.com/2.png')
    refuse(h, 'https://c.example.com/3.png')

    expect(reportedHosts(h)).toEqual(['b.example.com', 'c.example.com'])
  })

  it('still de-duplicates within one page load', async () => {
    // The reset must be tied to the approval, not applied on every violation:
    // twenty violations for one font host are still one row.
    const h = makeHarness()
    await h.service.open(REQUEST_A, h.window)
    h.hostBlocked.mockClear()

    for (let i = 0; i < 20; i += 1) {
      refuse(h, `https://cdn.example.com/img-${i}.png`)
    }

    expect(reportedHosts(h)).toEqual(['cdn.example.com'])
  })
})
