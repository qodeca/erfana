// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * SEC-07 at the composition root (docs/designs/comments/html-preview-comments.md §8,
 * §12.3): the comment channels `registerPreviewHandlers` registers are gated
 * by the REAL preview sender predicate (`isTrustedPreviewSender`), not only by
 * the process-wide gate of `registry.ts`.
 *
 * Its own file because its module mocks differ from `preview-handlers.test.ts`
 * (`docs/windows/contributing.md` "Test-file split policy"): here the comment
 * handlers and the sender predicate are real, and `electron`'s `ipcMain` is
 * mocked to capture the registered handlers. The process-wide gate is passed
 * through for the first group, so only the preview predicate decides, and is
 * the real one for the last test.
 */
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../shared/errors'
import { FileCommentChannels } from '../../shared/ipc/file-comment-channels'
import { PreviewCommentChannels } from '../../shared/ipc/preview-comment-channels'
import type { GlobalSettings } from '../../shared/ipc/global-settings-schema'
import type { PreviewCommentRegistry } from '../services/preview/comments/commentServiceTypes'
import type { ProjectSessionSnapshot } from '../services/session/ProjectSession'
import { registerPreviewHandlers, type PreviewHandlerBundle } from './preview-handlers'
import type { PreviewGraph } from './preview/buildPreviewGraph'

type Handler = (event: unknown, arg: unknown) => Promise<unknown>
const handlers: Record<string, Handler> = {}
const appGate = vi.hoisted(() => ({ passThrough: true }))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Handler) => {
      handlers[channel] = handler
    }),
    removeHandler: vi.fn((channel: string) => {
      delete handlers[channel]
    })
  },
  BrowserWindow: { fromWebContents: vi.fn(() => ({ id: 1, once: vi.fn() })) }
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('./senderValidation', async importOriginal => {
  const real = await importOriginal<typeof import('./senderValidation')>()
  return { ...real, isTrustedAppSender: (event: Parameters<typeof real.isTrustedAppSender>[0]) => appGate.passThrough || real.isTrustedAppSender(event) }
})
vi.mock('./preview/buildPreviewGraph', () => ({ buildPreviewGraph: vi.fn() }))
vi.mock('./preview/lifecycle-handlers', () => ({ registerPreviewLifecycleHandlers: vi.fn(() => () => {}) }))
vi.mock('./preview/navigation-handlers', () => ({ registerPreviewNavigationHandlers: vi.fn(() => () => {}) }))
vi.mock('./preview/focus-handlers', () => ({ registerPreviewFocusHandlers: vi.fn(() => () => {}) }))
vi.mock('./preview/find-handlers', () => ({ registerPreviewFindHandlers: vi.fn(() => () => {}) }))
vi.mock('./preview/allowlist-handlers', () => ({ registerPreviewAllowlistHandlers: vi.fn(() => () => {}) }))
vi.mock('../services/LoggingService', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

/** The bundled renderer entry, as `isTrustedPreviewSender` pins it (relative to its own folder). */
const RENDERER_URL = pathToFileURL(join(__dirname, 'preview', '../renderer/index.html')).href
const PANEL = 'html-preview-/p/index.html'
const KEY_INVALID = { ok: false, code: ErrorCode.COMMENT_KEY_INVALID }

let bundle: PreviewHandlerBundle | undefined

function setup(session?: Parameters<typeof registerPreviewHandlers>[0]['session']) {
  const list = vi.fn(async () => ({ ok: true as const, files: [] }))
  const registry: PreviewCommentRegistry = {
    get: vi.fn(() => ({ panelId: PANEL, windowId: 1, list }) as never),
    add: vi.fn(() => () => {}),
    all: vi.fn(() => [])
  }
  const unsaved = { set: vi.fn(async () => {}), has: vi.fn(async () => false), forget: vi.fn() }
  const graph = {
    service: { destroyAll: vi.fn(), onProjectChanged: vi.fn(), dispose: vi.fn(async () => {}), setResizeHold: vi.fn() },
    eligibility: {},
    allowlistStore: {},
    disposeEmitters: vi.fn(),
    comments: { registry, unsaved }
  } as unknown as PreviewGraph
  bundle = registerPreviewHandlers({
    getProjectPath: () => '/p',
    globalSettings: { getSettings: () => ({ htmlPreview: { enabled: true } }) as GlobalSettings, onSettingsChanged: () => () => {} },
    graph,
    session
  })
  return { registry, unsaved, list, graph }
}

/** An invoke from a frame at `url`; `child` makes it a sub-frame. */
function from(url: string, child = false) {
  return { sender: {}, senderFrame: { url, parent: child ? { url: RENDERER_URL } : null } }
}

beforeEach(() => {
  vi.clearAllMocks()
  appGate.passThrough = true
})

afterEach(async () => {
  await bundle?.dispose()
  bundle = undefined
})

describe('SEC-07 the comment channels of registerPreviewHandlers', () => {
  it('answer the app\'s own top-level renderer frame', async () => {
    const s = setup()
    expect(await handlers[PreviewCommentChannels.LIST](from(RENDERER_URL), { panelId: PANEL })).toEqual({ ok: true, files: [] })
    expect(s.list).toHaveBeenCalledTimes(1)
  })

  it('refuse a previewed page and a sub-frame before the payload is read, and reach no service', async () => {
    const s = setup()
    const senders = [
      from('erfana-preview://tok123/index.html'),
      from('erfana-preview://tok123/frame.html', true),
      from(RENDERER_URL, true),
      { sender: {}, senderFrame: null }
    ]
    for (const sender of senders) {
      expect(await handlers[PreviewCommentChannels.LIST](sender, { panelId: PANEL })).toEqual(KEY_INVALID)
      expect(await handlers[PreviewCommentChannels.SET_UNSAVED_SOURCES](sender, { paths: ['/p/index.html'] })).toEqual(KEY_INVALID)
      expect(await handlers[PreviewCommentChannels.SAVE](sender, { panelId: PANEL, op: 'add', draftToken: 'a'.repeat(32), text: 'x' })).toEqual({
        ok: false,
        code: ErrorCode.COMMENT_WRITE_FAILED
      })
    }
    expect(s.registry.get).not.toHaveBeenCalled()
    expect(s.unsaved.set).not.toHaveBeenCalled()
  })

  it('behind the process-wide gate too: a previewed page is rejected before either check reads it', async () => {
    appGate.passThrough = false
    const s = setup()
    // Electron turns the gate's throw into the renderer's rejected invoke.
    expect(() => handlers[PreviewCommentChannels.LIST](from('erfana-preview://tok123/index.html'), { panelId: PANEL })).toThrow(/Untrusted sender/)
    expect(s.registry.get).not.toHaveBeenCalled()
  })
})

describe('the file-comment family at the composition root (spec 024)', () => {
  /** A session whose project changes are driven by the test. */
  function fakeSession() {
    const listeners: Array<(prev: ProjectSessionSnapshot | null, next: ProjectSessionSnapshot | null) => void> = []
    const snapshot = (root: string): ProjectSessionSnapshot => ({ generation: 1, root, realRoot: root, caseSensitive: true, ownerWebContentsId: null })
    return {
      session: {
        current: () => null,
        onChange: vi.fn((listener: (typeof listeners)[number]) => {
          listeners.push(listener)
          return () => void listeners.splice(listeners.indexOf(listener), 1)
        })
      },
      change: (from: string, to: string) => listeners.forEach(listener => listener(snapshot(from), snapshot(to))),
      listening: () => listeners.length
    }
  }

  it('registers the file-comment channels only when a session is given, and removes them on dispose', async () => {
    setup()
    expect(handlers[FileCommentChannels.LIST]).toBeUndefined()
    await bundle?.dispose()
    const fake = fakeSession()
    setup(fake.session)
    for (const channel of Object.values(FileCommentChannels)) expect(handlers[channel], channel).toBeDefined()
    await bundle?.dispose()
    bundle = undefined
    for (const channel of Object.values(FileCommentChannels)) expect(handlers[channel], channel).toBeUndefined()
    expect(fake.listening()).toBe(0)
  })

  it('a previewed page is refused on the file-comment channels before the payload is read', async () => {
    setup(fakeSession().session)
    const answer = await handlers[FileCommentChannels.LIST](from('erfana-preview://tok123/index.html'), { panelId: 'p', filePath: '/p/a.md' })
    expect(answer).toEqual({ ok: false, code: ErrorCode.COMMENT_WRITE_FAILED, reason: 'untrusted-sender' })
  })

  it('the session also feeds the main-side preview teardown on a project switch', () => {
    const fake = fakeSession()
    const { graph } = setup(fake.session)
    fake.change('/old', '/new')
    expect(graph.service.onProjectChanged).toHaveBeenCalledWith('/old', '/new')
  })
})
