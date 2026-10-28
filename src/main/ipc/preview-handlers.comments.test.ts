// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * SEC-07 at the composition root (docs/designs/html-preview-comments.md §8,
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
import { PreviewCommentChannels } from '../../shared/ipc/preview-comment-channels'
import type { GlobalSettings } from '../../shared/ipc/global-settings-schema'
import type { PreviewCommentRegistry } from '../services/preview/comments/commentServiceTypes'
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

function setup() {
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
    graph
  })
  return { registry, unsaved, list }
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
