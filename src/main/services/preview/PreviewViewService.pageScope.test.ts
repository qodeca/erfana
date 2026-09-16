// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A live view's page scopes, driven through the service (issue #124, WI-29;
 * part 2 §2.3). Each session gets its own fake page, and the failure log is
 * the real one, so a coalesced snapshot that must never be sent would be sent
 * here. Split from `PreviewViewService.test.ts`, which is not grown.
 */
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'

import { PREVIEW } from '../../../shared/constants'
import { ErrorCode } from '../../../shared/errors'
import type { PreviewFailureInput } from '../../../shared/ipc/preview-types'
import { createPreviewFailureLog, type IPreviewFailureLog } from './PreviewFailureLog'
import type {
  PreviewSession,
  PreviewSessionCreateContext,
  PreviewSessionLike,
  PreviewViewHandle,
  PreviewWebContentsHandle
} from './PreviewSessionFactory'
import { PREVIEW_PAGE_CSP_VIOLATION_CHANNEL } from './previewCspViolationBridge'
import {
  PreviewViewService,
  type PreviewViewDeps,
  type PreviewWindowLike
} from './PreviewViewService'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

const TOKEN = 'deadbeefdeadbeefdeadbeefdeadbeef'
const PAGE_URL = `erfana-preview://${TOKEN}/page.html`
const REQUEST = {
  panelId: 'panel-A',
  filePath: '/proj/page.html',
  bounds: { x: 0, y: 0, width: 100, height: 50 }
}
const SCRIPT_ERROR: PreviewFailureInput = {
  type: 'script-error',
  resourceUrlOrHost: 'boom',
  reasonCode: ErrorCode.UNKNOWN_ERROR
}
/** The protocol handler's refusal of the page's main document. */
const REFUSED_PAGE: PreviewFailureInput = {
  type: 'missing-local-file',
  resourceUrlOrHost: '/page.html',
  reasonCode: ErrorCode.PREVIEW_LOCAL_FILE_MISSING
}
/** The allowlist's load-time badge: the view's, not one page's (#115). */
const ALLOWLIST_INVALID: PreviewFailureInput = {
  type: 'allowlist-invalid',
  resourceUrlOrHost: '.erfana/settings.json',
  reasonCode: ErrorCode.PROJECT_SETTINGS_VALIDATION_FAILED
}

type Listener = (...args: unknown[]) => void

/** One preview page: its events, and the page-scoped IPC channel its preload uses. */
function makePage() {
  const listeners = new Map<string, Listener[]>()
  const ipcListeners = new Map<string, Listener[]>()
  const mainFrame = { id: 'main-frame' }
  let destroyed = false
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
    // A bounded teardown waits for `destroyed`; deliver it at once.
    close: vi.fn<() => void>(() => {
      destroyed = true
      emit('destroyed')
    }),
    isDestroyed: () => destroyed,
    setWindowOpenHandler: vi.fn(),
    executeJavaScriptInIsolatedWorld: vi.fn(() => Promise.resolve(true)),
    capturePage: vi.fn(() =>
      Promise.resolve({
        isEmpty: () => true,
        getSize: () => ({ width: 0, height: 0 }),
        resize: () => ({}),
        toDataURL: () => ''
      })
    ),
    isBeingCaptured: vi.fn(() => false),
    printToPDF: vi.fn(() => Promise.resolve(Buffer.from(''))),
    findInPage: vi.fn(() => 1),
    stopFindInPage: vi.fn(),
    setZoomLevel: vi.fn(),
    getZoomLevel: vi.fn(() => 0),
    isFocused: vi.fn(() => false),
    on: (event: string, listener: Listener) => add(listeners, event, listener),
    once: (event: string, listener: Listener) => add(listeners, event, listener),
    removeListener: (event: string, listener: Listener) => remove(listeners, event, listener)
  }
  return {
    contents,
    emit,
    /** A CSP refusal, as the page's preload reports it. */
    refuse(url: string): void {
      for (const listener of ipcListeners.get(PREVIEW_PAGE_CSP_VIOLATION_CHANNEL) ?? []) {
        listener({ senderFrame: mainFrame }, { blockedURI: url, effectiveDirective: 'img-src' })
      }
    },
    /** The main frame commits the preview page. */
    commit(status = 200): void {
      emit('did-navigate', {}, PAGE_URL, status, status === 200 ? 'OK' : 'Not Found')
    }
  }
}

type FakePage = ReturnType<typeof makePage>
type SpiedLog = IPreviewFailureLog & { drop: ReturnType<typeof vi.fn> }

/** `root` is the project's real root and path; `extra` adds deps (issue #124, RS3-3). */
function makeHarness(root = '/proj', extra: Partial<PreviewViewDeps> = {}) {
  const pages: FakePage[] = []
  const contexts: PreviewSessionCreateContext[] = []
  const logs: SpiedLog[] = []
  let windowDestroyed = false
  const addChildView = vi.fn<(view: PreviewViewHandle) => void>()
  const window = {
    id: 1,
    isDestroyed: () => windowDestroyed,
    contentView: { addChildView, removeChildView: vi.fn() },
    getContentBounds: () => ({ x: 0, y: 0, width: 1000, height: 800 })
  } as unknown as PreviewWindowLike

  const sessionCreate = vi.fn(
    async (ctx: PreviewSessionCreateContext): Promise<PreviewSession> => {
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
        realRoot: root,
        partition: 'erfana-preview-test',
        teardown: vi.fn(),
        release: vi.fn(() => Promise.resolve())
      }
    }
  )
  const failuresChanged =
    vi.fn<(panelId: string, failures: readonly PreviewFailureInput[], truncated: boolean) => void>()
  const hostBlocked = vi.fn()
  const pageChanged = vi.fn()

  const deps: PreviewViewDeps = {
    sessionFactory: { create: sessionCreate, forgetRecycled: vi.fn() },
    registry: { rebuildCsp: vi.fn(), revoke: vi.fn() },
    stillFrameCache: {
      captureIfStale: vi.fn(() => Promise.resolve()),
      get: vi.fn(() => undefined),
      invalidate: vi.fn()
    },
    exportController: {
      exportToPdf: vi.fn(() => Promise.resolve({ ok: true as const, path: '/x.pdf' }))
    },
    storageSeal: { purge: vi.fn(() => Promise.resolve()) },
    getAllowedHosts: () => [],
    emit: {
      failuresChanged,
      hostBlocked,
      allowlistChanged: vi.fn(),
      visibilityApplied: vi.fn(),
      openFileRequested: vi.fn(),
      findResult: vi.fn(),
      stillFrameChanged: vi.fn(),
      backdropChanged: vi.fn(),
      loadStateChanged: vi.fn(),
      boundsApplied: vi.fn(),
      pageChanged
    },
    createWatchCoordinator: () => ({
      setWatchSet: vi.fn(() => Promise.resolve({ watched: [], dropped: [] })),
      dispose: vi.fn(() => Promise.resolve())
    }),
    createReloadPolicy: () => ({
      record: vi.fn(),
      flush: vi.fn(),
      cancel: vi.fn(),
      dispose: vi.fn()
    }),
    createFindController: () => ({ find: vi.fn(), clearHighlights: vi.fn(), dispose: vi.fn() }),
    createFailureLog: (onEmit) => {
      const log = createPreviewFailureLog({ onEmit })
      vi.spyOn(log, 'drop')
      logs.push(log as SpiedLog)
      return log
    },
    createEntryWatcher: () => ({ close: vi.fn(() => Promise.resolve()) }),
    getProjectPath: () => root,
    getZoomFactor: () => 1,
    now: () => 0,
    readEntryHtml: vi.fn(() => Promise.resolve('<html></html>')),
    platform: 'darwin'
  }

  return {
    service: new PreviewViewService({ ...deps, ...extra }),
    window,
    pages,
    contexts,
    logs,
    sessionCreate,
    addChildView,
    failuresChanged,
    hostBlocked,
    pageChanged,
    setWindowDestroyed: (value: boolean) => {
      windowDestroyed = value
    },
    /** The failures of the last snapshot sent to the renderer. */
    lastSnapshot: (): readonly PreviewFailureInput[] | undefined =>
      failuresChanged.mock.calls.at(-1)?.[1]
  }
}

/** Open panel A and let its first load commit. */
async function openCommitted(h: ReturnType<typeof makeHarness>): Promise<FakePage> {
  await h.service.open(REQUEST, h.window)
  const [page] = h.pages
  page.commit()
  return page
}

describe('PreviewViewService — page scopes (WI-29)', () => {
  it("gives a view's first load no pending page: its main-document refusal lands on the page on screen", async () => {
    const h = makeHarness()
    await h.service.open(REQUEST, h.window)
    expect(h.logs).toHaveLength(1)

    h.contexts[0].pageScopes().forMainDocument().recordFailure(REFUSED_PAGE)
    await vi.advanceTimersByTimeAsync(PREVIEW.FAILURE_COALESCE_MS)
    expect(h.lastSnapshot()).toEqual([expect.objectContaining(REFUSED_PAGE)])

    // The refused first page commits with its 404 (S15) and keeps its badge.
    h.pages[0].commit(404)
    expect(h.logs).toHaveLength(1)
    expect(h.logs[0].drop).not.toHaveBeenCalled()
  })

  it('approval reloads through startPageLoad: the old log stays until the commit replaces it', async () => {
    const h = makeHarness()
    const page = await openCommitted(h)
    page.emit('render-process-gone', {}, { reason: 'crashed' })
    await vi.advanceTimersByTimeAsync(PREVIEW.FAILURE_COALESCE_MS)
    expect(h.lastSnapshot()).toEqual([expect.objectContaining({ type: 'render-crash' })])

    await h.service.applyApprovedHosts('panel-A', ['https://cdn.example.com'])

    expect(page.contents.reloadIgnoringCache).toHaveBeenCalledTimes(1)
    expect(h.logs).toHaveLength(2)
    expect(h.logs[0].drop).not.toHaveBeenCalled()
    // Until the reload commits, the badge stays as it was.
    const sent = h.failuresChanged.mock.calls.length
    await vi.advanceTimersByTimeAsync(PREVIEW.FAILURE_COALESCE_MS)
    expect(h.failuresChanged).toHaveBeenCalledTimes(sent)

    page.commit()

    expect(h.logs[0].drop).toHaveBeenCalledTimes(1)
    expect(h.lastSnapshot()).toEqual([])
  })

  it('the live reload is a page load too: a pending page, committed on did-navigate', async () => {
    const h = makeHarness()
    const page = await openCommitted(h)

    await h.service.reload('panel-A', { ignoreCache: false })
    expect(page.contents.reload).toHaveBeenCalledTimes(1)
    expect(h.logs).toHaveLength(2)
    page.commit()

    expect(h.logs[0].drop).toHaveBeenCalledTimes(1)
    expect(h.lastSnapshot()).toEqual([])
  })

  it('a main-document refusal lands in the pending page and survives its 404 commit (S15)', async () => {
    const h = makeHarness()
    const page = await openCommitted(h)
    await h.service.reload('panel-A', { ignoreCache: true })
    expect(page.contents.reloadIgnoringCache).toHaveBeenCalledTimes(1)

    h.contexts[0].pageScopes().forMainDocument().recordFailure(REFUSED_PAGE)
    await vi.advanceTimersByTimeAsync(PREVIEW.FAILURE_COALESCE_MS)
    // The old page is still on screen, so the refusal is not in its badge.
    expect(h.failuresChanged).not.toHaveBeenCalled()

    page.commit(404)
    expect(h.lastSnapshot()).toEqual([expect.objectContaining(REFUSED_PAGE)])

    // S16: a stale main-frame -3 naming the old page arrives after the commit,
    // then the stop. Neither changes anything.
    page.emit('did-fail-load', {}, -3, 'ERR_ABORTED', PAGE_URL, true, 1, 1)
    page.emit('did-stop-loading')
    await vi.advanceTimersByTimeAsync(PREVIEW.FAILURE_COALESCE_MS)
    expect(h.logs[1].drop).not.toHaveBeenCalled()
    expect(h.lastSnapshot()).toEqual([expect.objectContaining(REFUSED_PAGE)])
  })

  it("keeps the old page's CSP refusals out of the page loading after it", async () => {
    const h = makeHarness()
    const page = await openCommitted(h)
    await h.service.reload('panel-A')

    page.refuse('https://cdn.example.com/a.png')
    expect(h.hostBlocked).toHaveBeenCalledTimes(1)
    page.commit()
    expect(h.lastSnapshot()).toEqual([])

    // A new page, a new dedupe: the host is news again when it is refused there.
    page.refuse('https://cdn.example.com/a.png')
    expect(h.hostBlocked).toHaveBeenCalledTimes(2)
  })

  it('a reload that stops without a commit leaves the page, its badge and its log as they were', async () => {
    const h = makeHarness()
    const page = await openCommitted(h)
    page.refuse('https://cdn.example.com/a.png')
    await h.service.reload('panel-A')

    page.emit('did-finish-load') // S16: fires for the OLD page while the new one is pending
    page.emit('did-stop-loading') // the page called window.stop(): nothing committed

    expect(h.logs[1].drop).toHaveBeenCalledTimes(1)
    expect(h.logs[0].drop).not.toHaveBeenCalled()
    // The old page is still on screen: its next failure joins its own badge.
    page.emit('unresponsive')
    await vi.advanceTimersByTimeAsync(PREVIEW.FAILURE_COALESCE_MS)
    expect(h.lastSnapshot()?.map((failure) => failure.type)).toEqual(['blocked-host', 'render-crash'])
  })

  it('a reopen inside the coalesce window gets no late snapshot from the torn-down view (RA3-1)', async () => {
    const h = makeHarness()
    await h.service.open(REQUEST, h.window)
    const oldScopes = h.contexts[0].pageScopes
    oldScopes().committed().recordFailure(SCRIPT_ERROR)

    await h.service.open(REQUEST, h.window)
    // A late write from the old session reaches only the old, inert page.
    oldScopes().committed().recordFailure(SCRIPT_ERROR)
    oldScopes().forMainDocument().recordFailure(REFUSED_PAGE)
    await vi.advanceTimersByTimeAsync(PREVIEW.FAILURE_COALESCE_MS * 2)

    expect(h.logs[0].drop).toHaveBeenCalledTimes(1)
    expect(h.failuresChanged).not.toHaveBeenCalled()
  })

  it('closing mid-reload ends both pages and emits nothing', async () => {
    const h = makeHarness()
    await openCommitted(h)
    await h.service.reload('panel-A')
    h.contexts[0].pageScopes().forMainDocument().recordFailure(REFUSED_PAGE)
    h.contexts[0].pageScopes().committed().recordFailure(SCRIPT_ERROR)

    await h.service.close('panel-A')
    await vi.advanceTimersByTimeAsync(PREVIEW.FAILURE_COALESCE_MS * 2)

    expect(h.logs.map((log) => log.drop.mock.calls.length)).toEqual([1, 1])
    expect(h.failuresChanged).not.toHaveBeenCalled()
  })

  it("keeps the view's allowlist badge across a reload and an approval, and drops it with the view (#115)", async () => {
    const h = makeHarness()
    const page = await openCommitted(h)
    // The session factory drains the allowlist's load-time badge onto the view.
    h.contexts[0].pageScopes().recordViewFailure(ALLOWLIST_INVALID)
    await vi.advanceTimersByTimeAsync(PREVIEW.FAILURE_COALESCE_MS)
    expect(h.lastSnapshot()).toEqual([expect.objectContaining(ALLOWLIST_INVALID)])

    // A reload commits a new page, and the badge is on it from the start.
    await h.service.reload('panel-A')
    page.commit()
    expect(h.logs[0].drop).toHaveBeenCalledTimes(1)
    expect(h.lastSnapshot()).toEqual([expect.objectContaining(ALLOWLIST_INVALID)])

    // So is the page an approval reloads.
    await h.service.applyApprovedHosts('panel-A', ['https://cdn.example.com'])
    page.commit()
    expect(h.logs[1].drop).toHaveBeenCalledTimes(1)
    expect(h.lastSnapshot()).toEqual([expect.objectContaining(ALLOWLIST_INVALID)])

    // The view's teardown drops it: nothing more is sent, and a reopen starts clean.
    const sent = h.failuresChanged.mock.calls.length
    await h.service.close('panel-A')
    expect(h.logs[2].drop).toHaveBeenCalledTimes(1)
    await h.service.open(REQUEST, h.window)
    h.pages[1].commit()
    await vi.advanceTimersByTimeAsync(PREVIEW.FAILURE_COALESCE_MS * 2)
    expect(h.failuresChanged).toHaveBeenCalledTimes(sent)
    expect(h.logs[3].list()).toEqual([])
  })

  it('an approval during a same-tab move replaces it: the move ends, history stays, the next move is accepted (RS3-3)', async () => {
    // `.native` is load-bearing: it expands a Windows 8.3 short tmpdir name
    // (`C:\Users\MARCIN~1\...`) so this root matches what the resolver's
    // `fsPromises.realpath` returns. Full explanation in PreviewProtocolHandler.test.ts.
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'erfana-rs3-3-')))
    onTestFinished(() => rmSync(root, { recursive: true, force: true }))
    for (const name of ['page.html', 'b.html']) {
      writeFileSync(join(root, name), '<p>')
    }
    const h = makeHarness(root, { checkEligibility: async () => ({ eligible: true }) })
    await h.service.open({ ...REQUEST, filePath: join(root, 'page.html') }, h.window)
    const page = h.pages[0]
    page.commit()
    const move = { panelId: 'panel-A', phase: 'commit', action: 'open', anchor: null } as const
    const toB = { ...move, filePath: join(root, 'b.html') }

    expect(await h.service.navigate(toB, 1)).toMatchObject({ ok: true })
    await h.service.applyApprovedHosts('panel-A', ['https://cdn.example.com'])
    page.commit() // the approval's reload of the old page, which replaced the move

    expect(h.pageChanged).toHaveBeenCalledTimes(1) // the first page only: no history change
    const back = { panelId: 'panel-A', phase: 'check', action: 'back', generation: 0 } as const
    expect(await h.service.navigate(back, 1)).toMatchObject({
      ok: false,
      errorCode: ErrorCode.PREVIEW_NAV_SKIPPED
    })
    expect(await h.service.navigate(toB, 1)).toMatchObject({ ok: true })
    expect(page.contents.loadURL).toHaveBeenLastCalledWith(`erfana-preview://${TOKEN}/b.html`)
  })

  describe('the three early exits in open() dispose the page scopes', () => {
    it('when the session cannot be built', async () => {
      const h = makeHarness()
      h.sessionCreate.mockImplementationOnce(async () => {
        throw new Error('persistent partition')
      })

      const result = await h.service.open(REQUEST, h.window)

      expect(result).toEqual({ ok: false, errorCode: ErrorCode.PREVIEW_CSP_INVALID })
      expect(h.logs[0].drop).toHaveBeenCalledTimes(1)
    })

    it('when the window closed while the session was building', async () => {
      const h = makeHarness()
      const build = h.sessionCreate.getMockImplementation()!
      h.sessionCreate.mockImplementationOnce(async (ctx) => {
        h.setWindowDestroyed(true)
        return build(ctx)
      })

      const result = await h.service.open(REQUEST, h.window)

      expect(result).toEqual({ ok: false, errorCode: ErrorCode.PREVIEW_OPEN_SUPERSEDED })
      expect(h.logs[0].drop).toHaveBeenCalledTimes(1)
    })

    it('when the live view cannot be built', async () => {
      const h = makeHarness()
      h.addChildView.mockImplementationOnce(() => {
        throw new Error('Object has been destroyed')
      })

      const result = await h.service.open(REQUEST, h.window)

      expect(result).toEqual({ ok: false, errorCode: ErrorCode.PREVIEW_CSP_INVALID })
      expect(h.logs[0].drop).toHaveBeenCalledTimes(1)
    })
  })
})
