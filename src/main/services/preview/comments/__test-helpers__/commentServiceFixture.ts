// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One live view's comment service over a real temp project, for the
 * `PreviewCommentService` suites: real frame → file confinement, real token
 * tables, the real writer, a fake `webContents` that records listeners and
 * answers the world-996 scripts, and spies for what reaches the renderer.
 * Plain builders; no `vi.mock()` here.
 */
import { vi, type Mock } from 'vitest'
import { PreviewCommentPageChannels } from '../../../../../shared/ipc/preview-comment-channels'
import { createInProcessCommentFileJobs } from '../commentFileJobs'
import type { PreviewCommentServing } from '../commentInstrumentation'
import { READ_SCROLL_SCRIPT } from '../commentScripts'
import { createPreviewCommentRegistry, type PreviewCommentEmitters } from '../commentServiceTypes'
import { createCommentUnsavedSources } from '../commentUnsavedSources'
import { ElementTokenTable } from '../ElementTokenTable'
import { PreviewCommentService, type PreviewCommentServiceDeps } from '../PreviewCommentService'
import { makeProject, type TempProject } from './commentWriterHarness'
import { eventFrom, FakeFrame, flush, serveLoad } from './commentServiceHarness'

export const TOKEN = 'tok123'
export const SCROLL = { x: 0, y: 640, hash: '#pricing' }

type Listener = (...args: unknown[]) => void

/** A `webContents` stand-in: listeners by name, scripted world-996 answers. */
export function fakeContents(top: FakeFrame) {
  const ipc = new Map<string, Listener>()
  const events = new Map<string, Listener>()
  const scripts: string[] = []
  const contents = {
    mainFrame: top,
    ipc: {
      on: (channel: string, listener: Listener) => ipc.set(channel, listener),
      removeListener: (channel: string) => ipc.delete(channel)
    },
    on: (event: string, listener: Listener) => events.set(event, listener),
    removeListener: (event: string) => events.delete(event),
    getZoomLevel: () => 0,
    capturePage: vi.fn(),
    executeJavaScriptInIsolatedWorld: vi.fn(async (_world: number, [script]: { code: string }[]) => {
      scripts.push(script.code)
      if (script.code === READ_SCROLL_SCRIPT) return SCROLL
      if (script.code.includes('requestAnimationFrame(() => requestAnimationFrame')) return { x: 0, y: 0 }
      return true
    })
  }
  return { contents, ipc, events, scripts }
}

/** A comment serving over a real token table. */
export function fakeServing(): PreviewCommentServing & { setCommentMode: Mock; unavailableReason: Mock } {
  return {
    tokens: new ElementTokenTable(),
    bodyFor: vi.fn(),
    setCommentMode: vi.fn(),
    unavailableReason: vi.fn(() => undefined),
    dispose: vi.fn()
  } as unknown as PreviewCommentServing & { setCommentMode: Mock; unavailableReason: Mock }
}

export type CommentServiceFixture = Awaited<ReturnType<typeof commentServiceFixture>>

/** The view: `index.html` (with `pageHtml`) on screen in frame 1, as committed. */
export async function commentServiceFixture(pageHtml: string, overrides: Partial<PreviewCommentServiceDeps> = {}) {
  const project: TempProject = await makeProject()
  const pagePath = await project.write('index.html', pageHtml)
  const top = new FakeFrame(1)
  const framesById = new Map<number, FakeFrame>([[1, top]])
  const view = fakeContents(top)
  const serving = fakeServing()
  const emit: { [K in keyof PreviewCommentEmitters]: Mock } = {
    draftOpened: vi.fn(),
    commentsChanged: vi.fn(),
    anchorStatus: vi.fn(),
    modeChanged: vi.fn(),
    saveSettled: vi.fn()
  }
  let enabled = true
  let now = 1_000
  const registry = createPreviewCommentRegistry()
  const unsaved = createCommentUnsavedSources({ projectRoot: () => project.root })
  const captureFresh = vi.fn(async () => true)
  const reload = vi.fn()
  let page = pagePath
  const service = new PreviewCommentService({
    panelId: 'html-preview-index',
    windowId: 1,
    session: 1,
    contents: view.contents as unknown as PreviewCommentServiceDeps['contents'],
    serving,
    token: TOKEN,
    realRoot: project.root,
    projectPath: project.root,
    shared: {
      registry,
      unsaved,
      emit,
      identity: () => ({ name: 'Ada Lovelace', email: 'ada@example.com' }),
      isEnabled: () => enabled,
      cursor: () => ({ x: 0, y: 0 }),
      jobs: createInProcessCommentFileJobs()
    },
    still: {
      stillFrameCache: { captureFresh },
      lastRect: () => ({ x: 0, y: 40, width: 800, height: 600 }),
      lastCssSize: () => ({ width: 800, height: 600 }),
      isDrawn: () => true
    },
    geometry: { viewRect: () => ({ x: 0, y: 40, width: 800, height: 600 }), contentBounds: () => ({ x: 0, y: 0 }), hostZoom: () => 1 },
    currentPage: () => page,
    reload,
    now: () => now,
    frameFromIds: (_pid, routingId) => framesById.get(routingId),
    ...overrides
  })

  /** A document committed in `frame` at `rel` (`did-frame-navigate`). */
  const navigate = (frame: FakeFrame, rel: string): void => {
    framesById.set(frame.frameTreeNodeId, frame)
    view.events.get('did-frame-navigate')?.({}, `erfana-preview://${TOKEN}/${rel}`, 200, 'OK', frame.parent === null, 7, frame.frameTreeNodeId)
  }
  // The async work of every page signal (the service's `guard`), so `hello` and `pick` wait for
  // exactly that work: a fixed number of turns is too few for its file reads in a loaded full run.
  const signals = new Set<Promise<void>>()
  const guarded = service as unknown as { guard(work: Promise<void>): void }
  const guard = guarded.guard.bind(service)
  guarded.guard = work => {
    signals.add(work)
    void work.finally(() => signals.delete(work)).catch(() => undefined)
    guard(work)
  }
  /** Wait until no page signal's work is left, and the turns after it. */
  const settle = async (): Promise<void> => {
    while (signals.size > 0) {
      await Promise.allSettled([...signals])
      await flush()
    }
  }
  /** `frame` says hello, and its state goes out. */
  const hello = async (frame: FakeFrame): Promise<void> => {
    view.ipc.get(PreviewCommentPageChannels.HELLO)?.(eventFrom(frame), {})
    await flush()
    await flush()
    await settle()
  }
  const pick = async (frame: FakeFrame, payload: unknown): Promise<void> => {
    view.ipc.get(PreviewCommentPageChannels.PICK)?.(eventFrom(frame), payload)
    for (let i = 0; i < 6; i++) await flush()
    await settle()
  }
  const anchors = (frame: FakeFrame, payload: unknown): void => {
    view.ipc.get(PreviewCommentPageChannels.ANCHORS)?.(eventFrom(frame), payload)
  }
  /** Serve, commit and greet the page, the way a load reaches comments. */
  const loadPage = async (html = pageHtml) => {
    const load = serveLoad(serving.tokens, html, pagePath, 'page')
    navigate(top, 'index.html')
    await hello(top)
    return load
  }

  return {
    project,
    pagePath,
    top,
    view,
    serving,
    emit,
    registry,
    unsaved,
    captureFresh,
    reload,
    service,
    navigate,
    hello,
    pick,
    anchors,
    loadPage,
    setEnabled: (on: boolean) => (enabled = on),
    advance: (ms: number) => (now += ms),
    setPage: (path: string) => (page = path),
    dispose: async () => {
      service.dispose()
      await project.dispose()
    }
  }
}
