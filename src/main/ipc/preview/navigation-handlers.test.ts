// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * `preview:navigate` (issue #124, WI-17b; part 3 §3.1, §3.5).
 *
 * The handler's own gates – sender, payload, window, a service that throws, an
 * answer that fails its schema – over a fake service; then every navigation
 * gate through the handler, over the real `createPreviewViewNavigation`, a fake
 * registry and a real project directory, so confinement runs against a real
 * file system. electron's ipcMain is mocked to capture the handler.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { ipcMain } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ErrorCode } from '../../../shared/errors'
import { PreviewChannels } from '../../../shared/ipc/preview-channels'
import type { PreviewNavigateRequest } from '../../../shared/ipc/preview-navigation-schema'
import type { PreviewNavigateResult, PreviewPageTarget } from '../../../shared/ipc/preview-types'
import { logger } from '../../services/LoggingService'
import type { PreviewEligibilityCheck } from '../../services/preview/previewLiveTypes'
import { createPreviewPanelState } from '../../services/preview/previewPanelState'
import {
  createTabHistory,
  pushEntry,
  stepHistory,
  type PreviewTabHistory
} from '../../services/preview/previewTabHistory'
import {
  createPreviewViewNavigation,
  type PreviewNavigableView
} from '../../services/preview/previewViewNavigation'
import {
  registerPreviewNavigationHandlers,
  type PreviewNavigationHandlerDeps
} from './navigation-handlers'

type Handler = (event: unknown, arg: unknown) => Promise<unknown>
const handlers: Record<string, Handler> = {}

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Handler) => {
      handlers[channel] = handler
    }),
    removeHandler: vi.fn((channel: string) => {
      delete handlers[channel]
    })
  },
  BrowserWindow: { fromWebContents: vi.fn(() => ({ id: 1 })) }
}))

vi.mock('../../services/LoggingService', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

const UNAVAILABLE = { ok: false, errorCode: ErrorCode.PREVIEW_NAV_UNAVAILABLE }
const REFUSED = { ok: false, errorCode: ErrorCode.PREVIEW_NAV_TARGET_REFUSED }
const SKIPPED = { ok: false, errorCode: ErrorCode.PREVIEW_NAV_SKIPPED }
const OPEN_CHECK: PreviewNavigateRequest = {
  panelId: 'panel-A',
  phase: 'check',
  action: 'open',
  filePath: '/proj/b.html',
  anchor: null
}

let dispose: (() => void) | null = null
const directories: string[] = []

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  dispose?.()
  dispose = null
  for (const dir of directories.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

/** Register the handler, trusted and in window 1 unless told otherwise; the invoke. */
function register(
  deps: Partial<PreviewNavigationHandlerDeps> & Pick<PreviewNavigationHandlerDeps, 'service'>
): (request: unknown) => Promise<unknown> {
  dispose = registerPreviewNavigationHandlers({
    isTrustedSender: () => true,
    resolveWindow: () => ({ id: 1 }),
    ...deps
  })
  return (request) => handlers[PreviewChannels.NAVIGATE]({ sender: {} }, request)
}

describe('preview:navigate — the handler', () => {
  const ANSWER: PreviewNavigateResult = {
    ok: true,
    target: { filePath: '/proj/b.html', anchor: null },
    generation: 0
  }
  const fakeService = (answer: PreviewNavigateResult = ANSWER) => ({
    navigate: vi.fn(async () => answer)
  })

  it("hands a valid request to the service with the sender's window, and returns its answer", async () => {
    const service = fakeService()
    // No resolver injected: the sender's BrowserWindow (window 1 in the mock).
    const invoke = register({ service, resolveWindow: undefined })

    await expect(invoke(OPEN_CHECK)).resolves.toEqual(ANSWER)
    expect(service.navigate).toHaveBeenCalledWith(OPEN_CHECK, 1)
  })

  it('rejects an untrusted sender before reading the payload', async () => {
    const service = fakeService()
    const invoke = register({ service, isTrustedSender: () => false })

    await expect(invoke(OPEN_CHECK)).resolves.toEqual(UNAVAILABLE)
    expect(service.navigate).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith('Rejected preview:navigate from untrusted sender')
  })

  it.each([
    ['a URL instead of a path', { ...OPEN_CHECK, url: 'erfana-preview://token/b.html' }],
    ['an anchor past 1024 characters', { ...OPEN_CHECK, anchor: 'x'.repeat(1025) }],
    [
      'a negative generation',
      { panelId: 'panel-A', phase: 'commit', action: 'back', generation: -1 }
    ],
    ['no payload', undefined]
  ])('rejects %s', async (_label, request) => {
    const service = fakeService()
    const invoke = register({ service })

    await expect(invoke(request)).resolves.toEqual(UNAVAILABLE)
    expect(service.navigate).not.toHaveBeenCalled()
  })

  it('answers unavailable for a sender with no window', async () => {
    const service = fakeService()
    const invoke = register({ service, resolveWindow: () => null })

    await expect(invoke(OPEN_CHECK)).resolves.toEqual(UNAVAILABLE)
    expect(service.navigate).not.toHaveBeenCalled()
  })

  it('answers unavailable when the service throws, and logs it', async () => {
    const invoke = register({
      service: {
        navigate: vi.fn(async () => {
          throw new Error('boom')
        })
      }
    })

    await expect(invoke(OPEN_CHECK)).resolves.toEqual(UNAVAILABLE)
    expect(logger.error).toHaveBeenCalledWith('preview:navigate failed', expect.any(Error))
  })

  it('drops an answer that fails its schema', async () => {
    const invoke = register({
      service: fakeService({ ok: true, target: { filePath: '', anchor: null }, generation: 0 })
    })

    await expect(invoke(OPEN_CHECK)).resolves.toEqual(UNAVAILABLE)
    expect(logger.warn).toHaveBeenCalledWith(
      'Dropped a preview:navigate answer that failed its schema',
      expect.objectContaining({ error: expect.any(String) })
    )
  })

  it('removes the handler when disposed', () => {
    register({ service: fakeService() })

    dispose?.()
    dispose = null

    expect(ipcMain.removeHandler).toHaveBeenCalledWith(PreviewChannels.NAVIGATE)
  })
})

/** A real project: pages, a note, a dot folder, and a file outside with a symlink to it. */
function makeProject(): string {
  // `.native` is load-bearing: it expands a Windows 8.3 short tmpdir name
  // (`C:\Users\MARCIN~1\...`) so this root matches what the resolver's
  // `fsPromises.realpath` returns. Full explanation in PreviewProtocolHandler.test.ts.
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'erfana-navigate-')))
  directories.push(dir)
  const root = join(dir, 'site')
  for (const rel of ['a.html', 'b.html', 'x.html', 'notes.md', '.private/page.html']) {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), '<p>page</p>')
  }
  writeFileSync(join(dir, 'outside.html'), '<p>page</p>')
  symlinkSync(join(dir, 'outside.html'), join(root, 'escape.html'))
  return root
}

/** The real navigation over one view of panel A in window 1, behind the handler. */
function makeGate(options: { check?: PreviewEligibilityCheck | null } = {}) {
  const root = makeProject()
  const page = (rel: string, anchor: string | null = null): PreviewPageTarget => ({
    filePath: join(root, rel),
    anchor
  })
  const view = {
    projectPath: root,
    realRoot: root,
    navigate: vi.fn<PreviewNavigableView['navigate']>(() => true),
    isNavigationPending: vi.fn(() => false)
  }
  let installed = true
  const panelState = createPreviewPanelState()
  panelState.setHistory('panel-A', createTabHistory(page('a.html')))
  const check =
    options.check === undefined
      ? vi.fn<PreviewEligibilityCheck>(async () => ({ eligible: true }))
      : options.check
  const navigation = createPreviewViewNavigation({
    registry: {
      entry: (panelId) => (panelId === 'panel-A' && installed ? { view, windowId: 1 } : null)
    },
    panelState,
    checkEligibility: () => check ?? undefined
  })
  const invoke = register({ service: navigation })
  return {
    root,
    page,
    view,
    check,
    invoke,
    history: () => panelState.history('panel-A'),
    setHistory: (history: PreviewTabHistory) => panelState.setHistory('panel-A', history),
    uninstall: () => {
      installed = false
    },
    open: (phase: 'check' | 'commit', rel: string, anchor: string | null = null) =>
      invoke({ panelId: 'panel-A', phase, action: 'open', filePath: join(root, rel), anchor }),
    step: (phase: 'check' | 'commit', action: 'back' | 'forward', generation: number) =>
      invoke({ panelId: 'panel-A', phase, action, generation })
  }
}

describe('preview:navigate — the gate (RX8), through the handler', () => {
  it('checks an open without starting it, reading eligibility in project space', async () => {
    const g = makeGate()

    await expect(g.open('check', 'b.html', 'plans')).resolves.toEqual({
      ok: true,
      target: g.page('b.html', 'plans'),
      generation: 0
    })
    expect(g.check).toHaveBeenCalledWith(join(g.root, 'b.html'), g.root)
    expect(g.view.navigate).not.toHaveBeenCalled()
  })

  it('starts a committed open at its real path, against the current list', async () => {
    const g = makeGate()
    const basis = g.history()

    await expect(g.open('commit', 'b.html')).resolves.toEqual({
      ok: true,
      target: g.page('b.html'),
      generation: 0
    })
    expect(g.view.navigate).toHaveBeenCalledWith({
      kind: 'open',
      target: g.page('b.html'),
      realPath: join(g.root, 'b.html'),
      basis
    })
  })

  it.each([
    ['a page that is gone', 'gone.html', ErrorCode.PREVIEW_NAV_TARGET_MISSING],
    ['a path out of the project', '../outside.html', ErrorCode.PREVIEW_NAV_TARGET_REFUSED],
    ['a symlink out of the project', 'escape.html', ErrorCode.PREVIEW_NAV_TARGET_REFUSED],
    ['a page in a dot folder', '.private/page.html', ErrorCode.PREVIEW_NAV_TARGET_REFUSED],
    ['a file that is no page', 'notes.md', ErrorCode.PREVIEW_NAV_TARGET_REFUSED]
  ])('refuses %s', async (_label, rel, errorCode) => {
    const g = makeGate()

    await expect(g.open('commit', rel)).resolves.toEqual({ ok: false, errorCode })
    expect(g.view.navigate).not.toHaveBeenCalled()
  })

  it('refuses a relative path', async () => {
    const g = makeGate()

    await expect(g.invoke({ ...OPEN_CHECK, filePath: 'b.html' })).resolves.toEqual(REFUSED)
  })
})

describe('preview:navigate — eligibility fails closed', () => {
  it('refuses a page the eligibility check turns down', async () => {
    const g = makeGate({ check: async () => ({ eligible: false, reason: 'gitignored' }) })

    await expect(g.open('check', 'b.html')).resolves.toEqual(REFUSED)
  })

  it('refuses when the check throws, and logs only the error name', async () => {
    const g = makeGate({
      check: async () => {
        throw new TypeError('cannot read /private/secret')
      }
    })

    await expect(g.open('check', 'b.html')).resolves.toEqual(REFUSED)
    expect(logger.warn).toHaveBeenCalledWith(
      'Preview navigation: the eligibility check failed; refusing the page',
      { error: 'TypeError' }
    )
  })

  it('refuses every page while no eligibility check is wired', async () => {
    const g = makeGate({ check: null })

    await expect(g.open('check', 'b.html')).resolves.toEqual(REFUSED)
  })
})

describe('preview:navigate — the view, and a move on its way', () => {
  it('answers unavailable for a panel with no view in the window', async () => {
    const g = makeGate()

    await expect(g.invoke({ ...OPEN_CHECK, panelId: 'panel-B' })).resolves.toEqual(UNAVAILABLE)
  })

  it('answers unavailable when the view went away while the gate awaited', async () => {
    let leave = (): void => {}
    const g = makeGate({
      check: async () => {
        leave()
        return { eligible: true }
      }
    })
    leave = g.uninstall

    await expect(g.open('commit', 'b.html')).resolves.toEqual(UNAVAILABLE)
    expect(g.view.navigate).not.toHaveBeenCalled()
  })

  it('refuses a commit while a move is on its way, and still answers a check', async () => {
    const g = makeGate()
    g.view.isNavigationPending.mockReturnValue(true)

    await expect(g.open('commit', 'b.html')).resolves.toEqual(SKIPPED)
    await expect(g.open('check', 'b.html')).resolves.toEqual(expect.objectContaining({ ok: true }))
    expect(g.view.navigate).not.toHaveBeenCalled()
  })

  it('answers unavailable when the view cannot start the move', async () => {
    const g = makeGate()
    g.view.navigate.mockReturnValue(false)

    await expect(g.open('commit', 'b.html')).resolves.toEqual(UNAVAILABLE)
  })
})

describe('preview:navigate — Back and Forward', () => {
  /** On b.html with Back to a.html, at generation 1. */
  function onB(g: ReturnType<typeof makeGate>): PreviewTabHistory {
    const history = pushEntry(createTabHistory(g.page('a.html')), g.page('b.html'))
    g.setHistory(history)
    return history
  }

  it('steps onto the neighbour against the current generation', async () => {
    const g = makeGate()
    const basis = onB(g)

    await expect(g.step('commit', 'back', 1)).resolves.toEqual({
      ok: true,
      target: g.page('a.html'),
      generation: 1
    })
    expect(g.view.navigate).toHaveBeenCalledWith({
      kind: 'back',
      target: g.page('a.html'),
      realPath: join(g.root, 'a.html'),
      basis
    })
  })

  it.each([
    ['a stale generation', 'back', 0],
    ['no entry that way', 'forward', 1]
  ] as const)('skips a step with %s', async (_label, action, generation) => {
    const g = makeGate()
    onB(g)

    await expect(g.step('check', action, generation)).resolves.toEqual(SKIPPED)
  })

  it('skips a step whose list changed while its gate awaited', async () => {
    let change = (): void => {}
    const g = makeGate({
      check: async () => {
        change()
        return { eligible: true }
      }
    })
    const basis = onB(g)
    change = () => g.setHistory(pushEntry(basis, g.page('x.html')))

    await expect(g.step('commit', 'back', 1)).resolves.toEqual(SKIPPED)
    expect(g.view.navigate).not.toHaveBeenCalled()
  })

  it("re-confines a script's pushState entry: one in a dot folder is refused and kept", async () => {
    const g = makeGate()
    const pushed = pushEntry(createTabHistory(g.page('a.html')), g.page('.private/page.html'))
    const history = stepHistory(pushed, 'back')
    g.setHistory(history)

    await expect(g.step('commit', 'forward', history.generation)).resolves.toEqual(REFUSED)
    expect(g.history()).toBe(history)
  })

  it('drops a Back entry whose page is gone, with the new state; the next Back goes one further (RU2-3)', async () => {
    const g = makeGate()
    const history = pushEntry(
      pushEntry(createTabHistory(g.page('x.html')), g.page('gone.html')),
      g.page('a.html')
    )
    g.setHistory(history)
    const next = history.generation + 1

    await expect(g.step('check', 'back', history.generation)).resolves.toEqual({
      ok: false,
      errorCode: ErrorCode.PREVIEW_NAV_TARGET_MISSING,
      history: {
        canGoBack: true,
        canGoForward: false,
        backTarget: g.page('x.html'),
        forwardTarget: null,
        generation: next
      }
    })
    await expect(g.step('commit', 'back', next)).resolves.toEqual({
      ok: true,
      target: g.page('x.html'),
      generation: next
    })
    expect(g.view.navigate).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'back', target: g.page('x.html') })
    )
  })
})
