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
  destroy: ReturnType<typeof vi.fn<() => void>>
  close: ReturnType<typeof vi.fn<() => void>>
  executeJavaScriptInIsolatedWorld: ReturnType<
    typeof vi.fn<(worldId: number, scripts: { code: string }[]) => Promise<unknown>>
  >
  setDestroyed(value: boolean): void
}

function makeFakeWc(): FakeWc {
  const listeners = new Map<string, Listener[]>()
  let destroyed = false

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

  const wc = {
    loadURL,
    reload,
    reloadIgnoringCache,
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
    on: on as unknown as PreviewWebContentsHandle['on'],
    once: once as unknown as PreviewWebContentsHandle['once'],
    removeListener: removeListener as unknown as PreviewWebContentsHandle['removeListener']
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
    destroy,
    close,
    executeJavaScriptInIsolatedWorld,
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
  hostBlocked: ReturnType<typeof vi.fn<(panelId: string, host: string, approvable: boolean) => void>>
  reloadRecord: ReturnType<typeof vi.fn<(path: string) => void>>
  readEntryHtml: ReturnType<typeof vi.fn<(path: string) => Promise<string>>>
  entryHandlers(): EntryHandlers
  failureLog(): ReturnType<typeof makeFailureLog>
  token: string
}

function makeHarness(
  options: { zoom?: number; now?: () => number; windowId?: number } = {}
): Harness {
  const factory = makeFakeWc()
  const view = {
    webContents: factory.wc,
    setBounds: vi.fn<(bounds: { x: number; y: number; width: number; height: number }) => void>(),
    setBackgroundColor: vi.fn<(color: string) => void>(),
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
  const window = {
    id: options.windowId ?? 1,
    contentView: { addChildView, removeChildView },
    getContentBounds: () => ({ x: 0, y: 0, width: 1000, height: 800 })
  } as unknown as PreviewWindowLike
  /** A second window for the cross-window panel-id collision case. */
  const otherWindow = {
    id: (options.windowId ?? 1) + 1,
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
  const hostBlocked = vi.fn<(panelId: string, host: string, approvable: boolean) => void>()

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
      loadStateChanged
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
    hostBlocked,
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

    expect(result).toEqual({ ok: false, errorCode: ErrorCode.PROJECT_NOT_FOUND })
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
