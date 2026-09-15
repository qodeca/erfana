// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Same-tab moves, history steps and resume, main side (issue #124, WI-17b;
 * design part 3 §3.4, §3.5 – acceptance P3-AC2), on a real temporary project
 * opened THROUGH A SYMLINKED FOLDER, as a user who keeps projects behind a
 * link would open it (and as every macOS temp path is: `/var` → `/private/var`).
 *
 * Real: the `preview:navigate` handler with its schema checks, the navigation
 * gate with `confinePath` on the real disk, the panel's history, the registry,
 * the page navigator over the live page, the URL builder, and the protocol
 * handler that serves the bytes. Faked: Electron's IPC (the global mock's
 * `ipcMain`), the view's `webContents` events and the eligibility check.
 *
 * It also covers a view's FIRST load in such a project (at the end of this
 * file), which once built its URL from the link's own path and got a 404.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../shared/errors'
import { PreviewChannels } from '../../../shared/ipc/preview-channels'
import type { PreviewNavigateResult, PreviewPageChange } from '../../../shared/ipc/preview-types'
import { registerPreviewNavigationHandlers } from '../../ipc/preview/navigation-handlers'
import type { PreviewEligibilityVerdict } from './PreviewEligibilityService'
import { attach as attachHandler } from './PreviewProtocolHandler'
import { createPreviewRequestKindLedger } from './PreviewRequestKindLedger'
import { PreviewRootRegistry } from './PreviewRootRegistry'
import { createPreviewLivePage, type PreviewLivePageDeps } from './previewLivePage'
import {
  createPreviewPageNavigator,
  type PreviewLiveNavigationParams,
  type PreviewNavigationMove
} from './previewPageNavigator'
import { createPreviewPanelState } from './previewPanelState'
import { createTabHistory, pushEntry } from './previewTabHistory'
import { buildPreviewUrl, samePreviewDocument } from './previewUrl'
import {
  createPreviewViewNavigation,
  type PreviewNavigableView,
  type PreviewStartingPage,
  type PreviewStartingPageResult
} from './previewViewNavigation'

type Listener = (...args: unknown[]) => void
type ProtocolListener = (request: GlobalRequest) => Promise<GlobalResponse>

const PANEL = 'preview-panel-1'
const WINDOW_ID = 1
const TRUSTED = { sender: { id: 7 } } as unknown as IpcMainInvokeEvent
const at = (filePath: string, anchor: string | null = null) => ({ filePath, anchor })

/** The page a start opened on; a refusal (QG-7 item 11) fails the test here. */
function opened(started: PreviewStartingPageResult): PreviewStartingPage {
  if (!started.ok) {
    throw new Error(`the gate refused the opening page: ${started.errorCode}`)
  }
  return started
}

let base: string
let site: string
/** The project as the user opened it: through the link, never resolved (ProjectService). */
let project: string
let realRoot: string
let token: string
let registry: PreviewRootRegistry
let cleanups: Array<() => void>

/** The protocol handler for this registry, as `protocol.handle` would call it. */
function serve(url: string): Promise<GlobalResponse> {
  const captured: { handler?: ProtocolListener } = {}
  const session = {
    protocol: {
      handle: (_scheme: string, listener: ProtocolListener) => {
        captured.handler = listener
      },
      unhandle: () => {}
    }
  } as unknown as Parameters<typeof attachHandler>[0]
  attachHandler(session, {
    resolve: (host) => registry.resolve(host) ?? null,
    recordFailure: vi.fn(),
    recordDocumentFailure: vi.fn(),
    recordFrameRefusal: vi.fn(),
    ledger: createPreviewRequestKindLedger()
  })
  // Chromium never sends the fragment to the handler.
  const bare = new URL(url)
  bare.hash = ''
  const request = { url: bare.href, method: 'GET', headers: new Headers(), destination: '' }
  return captured.handler!(request as unknown as GlobalRequest)
}

/** The service's navigation half behind the real `preview:navigate` handler. */
function makeService(options: { eligibility?: 'yes' | 'no' | 'none' } = {}) {
  const panelState = createPreviewPanelState()
  const checkEligibility = vi.fn(
    async (): Promise<PreviewEligibilityVerdict> =>
      options.eligibility === 'no' ? { eligible: false, reason: 'globally-disabled' } : { eligible: true }
  )
  const view = {
    projectPath: project,
    realRoot,
    navigate: vi.fn<(move: PreviewNavigationMove) => boolean>(() => true),
    isNavigationPending: vi.fn(() => false)
  }
  const navigation = createPreviewViewNavigation({
    registry: {
      entry: (id: string) =>
        id === PANEL ? { view: view as unknown as PreviewNavigableView, windowId: WINDOW_ID } : null
    },
    panelState,
    checkEligibility: () => (options.eligibility === 'none' ? undefined : checkEligibility)
  })
  cleanups.push(
    registerPreviewNavigationHandlers({
      service: navigation,
      isTrustedSender: (event) => event === TRUSTED,
      resolveWindow: () => ({ id: WINDOW_ID })
    })
  )
  const listener = vi
    .mocked(ipcMain.handle)
    .mock.calls.filter(([channel]) => channel === PreviewChannels.NAVIGATE)
    .at(-1)![1]
  const invoke = (payload: unknown, event = TRUSTED): Promise<PreviewNavigateResult> =>
    listener(event, payload) as Promise<PreviewNavigateResult>
  const open = (filePath: string, phase: 'check' | 'commit' = 'check', anchor: string | null = null) =>
    invoke({ panelId: PANEL, phase, action: 'open', filePath, anchor })
  const step = (action: 'back' | 'forward', phase: 'check' | 'commit' = 'check') =>
    invoke({ panelId: PANEL, phase, action, generation: panelState.history(PANEL)!.generation })
  return { panelState, checkEligibility, view, navigation, invoke, open, step }
}

/** A live view's page and navigator, over faked `webContents` events. */
function mountPage(
  start: { readonly filePath: string; readonly navigation: PreviewLiveNavigationParams },
  root: { readonly projectPath: string; readonly token: string; readonly realRoot: string }
) {
  const listeners = new Map<string, Set<Listener>>()
  const contents = {
    on: (event: string, listener: Listener) => {
      listeners.set(event, (listeners.get(event) ?? new Set<Listener>()).add(listener))
    },
    removeListener: (event: string, listener: Listener) => listeners.get(event)?.delete(listener)
  }
  const urlFor = (absPath: string): string => buildPreviewUrl(root.token, root.realRoot, absPath)
  // Like `loadURL` before the commit: neither resolves nor rejects.
  const loadUrl = vi.fn<(url: string) => Promise<unknown>>(() => new Promise<unknown>(() => {}))
  const emitPageChanged = vi.fn<(change: PreviewPageChange) => void>()
  const page = createPreviewLivePage({
    panelId: PANEL,
    contents: contents as unknown as PreviewLivePageDeps['contents'],
    pageScopes: { beginPending: vi.fn(), commit: vi.fn(), dropPending: vi.fn() },
    initialPage: start.filePath,
    urlFor,
    onOutcome: (end) => navigator.loadEnded(end),
    onInPageStep: (url) => navigator.inPageStep(url)
  })
  const navigator = createPreviewPageNavigator({
    panelId: PANEL,
    page,
    navigation: start.navigation,
    urlFor,
    loadUrl,
    nativeHistory: () => null,
    emitPageChanged,
    onMoveStarted: vi.fn(),
    // No real input reaches this fake page (QG-7 S1).
    takeRecentGesture: () => false,
    isDefunct: () => false
  })
  /** Chromium's main-frame commit, with the URL as Chromium reports it (parsed). */
  const didNavigate = (url: string, status = 200): void => {
    for (const listener of listeners.get('did-navigate') ?? []) listener({}, new URL(url).href, status, 'OK')
  }
  return { navigator, urlFor, loadUrl, emitPageChanged, didNavigate }
}

function write(rel: string, content: string): void {
  writeFileSync(join(site, rel), content)
}

describe.skipIf(process.platform === 'win32')('same-tab navigation in a project behind a symlinked folder', () => {
  beforeEach(async () => {
    // Deliberately NOT realpath'd: on macOS the temp folder is itself behind `/var`.
    base = mkdtempSync(join(tmpdir(), 'erfana-nav-'))
    site = join(base, 'site')
    const outside = join(base, 'outside')
    for (const dir of ['sub', 'node_modules', '.hidden']) mkdirSync(join(site, dir), { recursive: true })
    mkdirSync(outside)
    write('index.html', '<!doctype html><title>-INDEX-</title>')
    write('about.html', '<!doctype html><title>-ABOUT-</title><h2 id="team">Team</h2>')
    write('sub/contact.html', '<title>-CONTACT-</title>')
    write('notes.md', '# Notes')
    write('run.sh', '#!/bin/sh\necho hi\n')
    write('node_modules/x.html', '<title>-EXCLUDED-</title>')
    write('.hidden/x.html', '<title>-HIDDEN-</title>')
    writeFileSync(join(outside, 'page.html'), '<title>-OUTSIDE-</title>')
    symlinkSync(join(outside, 'page.html'), join(site, 'escape.html'))
    symlinkSync(outside, join(site, 'outdir'), 'dir')
    symlinkSync(join(site, 'run.sh'), join(site, 'script.html'))
    symlinkSync(site, join(base, 'site-link'), 'dir')
    project = join(base, 'site-link')
    registry = new PreviewRootRegistry()
    token = await registry.issue(project, [])
    realRoot = registry.resolve(token)!.realRoot
    cleanups = []
  })

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup()
    registry.clear()
    rmSync(base, { recursive: true, force: true })
  })

  it('resolves the root through the link, so the real root and the project path differ', () => {
    expect(realRoot).toBe(realpathSync.native(site))
    expect(realRoot).not.toBe(project)
  })

  describe('a move, through preview:navigate', () => {
    it('check names the target in project space and starts nothing; commit loads it at its real path', async () => {
      const svc = makeService()
      svc.panelState.setHistory(PANEL, createTabHistory(at(join(project, 'index.html'))))

      expect(await svc.open(join(project, 'about.html'))).toEqual({
        ok: true,
        target: at(join(project, 'about.html')),
        generation: 0
      })
      expect(svc.view.navigate).not.toHaveBeenCalled()

      expect(await svc.open(join(project, 'about.html'), 'commit', 'team')).toMatchObject({ ok: true })
      expect(svc.view.navigate).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'open',
          target: at(join(project, 'about.html'), 'team'),
          realPath: join(realRoot, 'about.html')
        })
      )
    })

    it('gives a target named through the real folder the same project-space name, and asks eligibility in project space', async () => {
      const svc = makeService()
      svc.panelState.setHistory(PANEL, createTabHistory(at(join(project, 'index.html'))))

      expect(await svc.open(join(realRoot, 'sub', 'contact.html'))).toMatchObject({
        ok: true,
        target: at(join(project, 'sub', 'contact.html'))
      })
      expect(svc.checkEligibility).toHaveBeenCalledWith(join(project, 'sub', 'contact.html'), project)
    })

    it.each([
      ['a page that does not exist', 'missing.html', ErrorCode.PREVIEW_NAV_TARGET_MISSING],
      ['a link to a page outside the project', 'escape.html', ErrorCode.PREVIEW_NAV_TARGET_REFUSED],
      ['a page behind a linked folder that leaves it', 'outdir/page.html', ErrorCode.PREVIEW_NAV_TARGET_REFUSED],
      ['a climb out of the project', '../outside/page.html', ErrorCode.PREVIEW_NAV_TARGET_REFUSED],
      ['a page in node_modules', 'node_modules/x.html', ErrorCode.PREVIEW_NAV_TARGET_REFUSED],
      ['a page in a dot-folder', '.hidden/x.html', ErrorCode.PREVIEW_NAV_TARGET_REFUSED],
      ['a Markdown file', 'notes.md', ErrorCode.PREVIEW_NAV_TARGET_REFUSED],
      ['a link named .html to a script', 'script.html', ErrorCode.PREVIEW_NAV_TARGET_REFUSED]
    ])('refuses %s (%s)', async (_label, rel, errorCode) => {
      const svc = makeService()
      svc.panelState.setHistory(PANEL, createTabHistory(at(join(project, 'index.html'))))

      expect(await svc.open(join(project, rel), 'commit')).toEqual({ ok: false, errorCode })
      expect(svc.view.navigate).not.toHaveBeenCalled()
    })

    it('refuses an ineligible page, and every page when there is no eligibility check (fails closed)', async () => {
      for (const eligibility of ['no', 'none'] as const) {
        const svc = makeService({ eligibility })
        svc.panelState.setHistory(PANEL, createTabHistory(at(join(project, 'index.html'))))
        expect(await svc.open(join(project, 'about.html'), 'commit')).toEqual({
          ok: false,
          errorCode: ErrorCode.PREVIEW_NAV_TARGET_REFUSED
        })
      }
    })

    it('reads an untrusted sender, or a payload past the contract, as unavailable, before the gate runs', async () => {
      const svc = makeService()
      svc.panelState.setHistory(PANEL, createTabHistory(at(join(project, 'index.html'))))
      const payload = { panelId: PANEL, phase: 'check', action: 'open', filePath: join(project, 'about.html'), anchor: null }
      const unavailable = { ok: false, errorCode: ErrorCode.PREVIEW_NAV_UNAVAILABLE }

      expect(await svc.invoke(payload, { sender: { id: 8 } } as unknown as IpcMainInvokeEvent)).toEqual(unavailable)
      expect(await svc.invoke({ ...payload, filePath: 'x'.repeat(5000) })).toEqual(unavailable)
      expect(svc.checkEligibility).not.toHaveBeenCalled()
    })
  })

  describe('Back and Forward', () => {
    it('drops a Back entry whose page was deleted, and the next Back goes one entry further (RU2-3)', async () => {
      const svc = makeService()
      const x = join(project, 'index.html')
      const gone = join(project, 'gone.html')
      const a = join(project, 'about.html')
      svc.panelState.setHistory(PANEL, pushEntry(pushEntry(createTabHistory(at(x)), at(gone)), at(a)))

      expect(await svc.step('back')).toEqual({
        ok: false,
        errorCode: ErrorCode.PREVIEW_NAV_TARGET_MISSING,
        history: expect.objectContaining({ canGoBack: true, backTarget: at(x) })
      })
      expect(await svc.step('back')).toMatchObject({ ok: true, target: at(x) })
    })

    it("refuses a script's pushState entry that leads out of the project, at the same gate (RX8)", async () => {
      const svc = makeService()
      const pushed = join(project, 'outdir', 'page.html')
      svc.panelState.setHistory(PANEL, pushEntry(createTabHistory(at(pushed)), at(join(project, 'index.html'))))

      expect(await svc.step('back')).toEqual({ ok: false, errorCode: ErrorCode.PREVIEW_NAV_TARGET_REFUSED })
    })
  })

  describe('resume (main is authoritative)', () => {
    it("reopens on main's page, loaded at its real path and named in project space", async () => {
      const svc = makeService()
      svc.panelState.setHistory(PANEL, pushEntry(createTabHistory(at(join(project, 'index.html'))), at(join(project, 'about.html'))))

      const start = opened(await svc.navigation.startingPage({ panelId: PANEL, filePath: join(project, 'index.html') }, realRoot, project))

      expect(start.filePath).toBe(join(realRoot, 'about.html'))
      const { entries, index } = start.navigation.initialHistory
      expect(entries[index]).toEqual(at(join(project, 'about.html')))
      expect(start.navigation.initialSameDocument).toBe(false)
    })

    it("falls back to the tab's own page, one generation on, when main's page is gone: served from its real path, named in project space", async () => {
      const svc = makeService()
      const prior = pushEntry(createTabHistory(at(join(project, 'index.html'))), at(join(project, 'gone.html')))
      svc.panelState.setHistory(PANEL, prior)

      const start = opened(await svc.navigation.startingPage({ panelId: PANEL, filePath: join(project, 'index.html') }, realRoot, project))

      expect(start.filePath).toBe(join(realRoot, 'index.html'))
      expect(start.navigation.initialHistory).toEqual(createTabHistory(at(join(project, 'index.html')), prior.generation + 1))
      const live = mountPage(start, { projectPath: project, token, realRoot })
      void live.navigator.loadFirst(start.filePath)
      expect((await serve(live.loadUrl.mock.calls[0][0])).status).toBe(200)
    })
  })

  describe('the page a move lands on', () => {
    async function mountResumed() {
      const svc = makeService()
      svc.panelState.setHistory(PANEL, createTabHistory(at(join(project, 'index.html'))))
      const start = opened(await svc.navigation.startingPage({ panelId: PANEL, filePath: join(project, 'index.html') }, realRoot, project))
      const live = mountPage(start, { projectPath: project, token, realRoot })
      svc.view.navigate.mockImplementation((move) => {
        void live.navigator.move(move)
        return true
      })
      svc.view.isNavigationPending.mockImplementation(() => live.navigator.isNavigationPending())
      return { svc, live }
    }

    it('is served from the real root, and its commit is announced in project space with its anchor', async () => {
      const { svc, live } = await mountResumed()

      expect(await svc.open(join(project, 'about.html'), 'commit', 'team')).toMatchObject({ ok: true })
      const url = live.loadUrl.mock.calls[0][0]
      expect(url.endsWith('#team')).toBe(true)
      const response = await serve(url)
      expect(response.status).toBe(200)
      expect(await response.text()).toContain('-ABOUT-')

      live.didNavigate(url)
      expect(live.emitPageChanged).toHaveBeenCalledWith(
        expect.objectContaining({ ...at(join(project, 'about.html'), 'team'), sameDocument: false, failed: false, canGoBack: true })
      )
    })

    it('commits as failed when the page was deleted between the check and the load (404)', async () => {
      const { svc, live } = await mountResumed()

      expect(await svc.open(join(project, 'about.html'), 'commit')).toMatchObject({ ok: true })
      rmSync(join(site, 'about.html'))
      const url = live.loadUrl.mock.calls[0][0]
      expect((await serve(url)).status).toBe(404)

      live.didNavigate(url, 404)
      expect(live.emitPageChanged).toHaveBeenCalledWith(
        expect.objectContaining({ filePath: join(project, 'about.html'), failed: true })
      )
    })
  })

  describe('the first open of a project reached through a symlinked folder', () => {
    /** The first open, as `PreviewViewService.open` runs it, for a panel main has no history for. */
    async function firstOpen(projectPath: string) {
      const openToken = await registry.issue(projectPath, [])
      const openRoot = registry.resolve(openToken)!.realRoot
      const svc = makeService()
      // The path the renderer sends: a tree path, joined under the project path
      // as opened (`FileService.readDirectory`), and main keeps that path
      // unresolved (`ProjectService.switchProject` → `updateServices`).
      const rendererPath = join(projectPath, 'index.html')
      const start = opened(await svc.navigation.startingPage({ panelId: 'fresh-panel', filePath: rendererPath }, openRoot, projectPath))
      // Loaded at its real path, named in project space – as a move is.
      expect(start.filePath).toBe(join(openRoot, 'index.html'))
      expect(start.navigation.initialHistory).toEqual(createTabHistory(at(rendererPath)))
      const live = mountPage(start, { projectPath, token: openToken, realRoot: openRoot })
      void live.navigator.loadFirst(start.filePath)
      expect(live.loadUrl).toHaveBeenCalledTimes(1)
      return { live, start, openRoot, url: live.loadUrl.mock.calls[0][0] }
    }

    it('serves the first page when the project is opened at its real path', async () => {
      const { url } = await firstOpen(realpathSync.native(site))
      const response = await serve(url)
      expect(response.status).toBe(200)
      expect(await response.text()).toContain('-INDEX-')
    })

    // The renderer names the page under the link. Built from that path against
    // the REAL root, the URL would ask for `<realRoot>/<path of the link>/…`: 404.
    it('serves the first page the renderer asks for', async () => {
      const { url } = await firstOpen(project)
      const response = await serve(url)
      expect(response.status).toBe(200)
    })

    // The link bridge's `currentUrl` and in-page matching compare against this URL.
    it('gives the first page the URL a move back onto it would use', async () => {
      const { live, start, openRoot } = await firstOpen(project)
      expect(samePreviewDocument(live.urlFor(start.filePath), live.urlFor(join(openRoot, 'index.html')))).toBe(true)
    })
  })
})
