// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments' five request channels (docs/designs/
 * html-preview-comments.md §8; SEC-07, SEC-20): the sender gate before the
 * payload, the strict schema, the sender's own window, the re-validated
 * answer, and never a throw. `electron`'s `ipcMain` is mocked to capture the
 * registered handlers, as in `focus-handlers.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../shared/errors'
import { PreviewCommentChannels } from '../../../shared/ipc/preview-comment-channels'
import type { CommentServiceApi } from '../../services/preview/comments/commentServiceTypes'
import { logger } from '../../services/LoggingService'
import { registerPreviewCommentHandlers, type CommentHostWindow } from './comment-handlers'

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
  BrowserWindow: { fromWebContents: vi.fn(() => null) }
}))

vi.mock('../../services/LoggingService', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

const PANEL = 'html-preview-/p/index.html'
const KEY_INVALID = { ok: false, code: ErrorCode.COMMENT_KEY_INVALID }
const DRAFT = 'a'.repeat(32)
const SECRET_TEXT = 'Secret review text from Ada'

function service(overrides: Partial<CommentServiceApi> = {}): CommentServiceApi {
  return {
    panelId: PANEL,
    windowId: 1,
    setMode: vi.fn(async (on: boolean, showIcons: boolean) => ({ ok: true as const, on, showIcons })),
    list: vi.fn(async () => ({ ok: true as const, files: [] })),
    reveal: vi.fn(() => ({ ok: true as const })),
    keepDraft: vi.fn(() => ({ ok: true as const })),
    save: vi.fn(async () => ({ ok: true as const, threadKey: 't1' })),
    e2eState: vi.fn(),
    ...overrides
  } as CommentServiceApi
}

let dispose: (() => void) | null = null
let closed: Array<() => void> = []

function register(options: { svc?: CommentServiceApi; trusted?: boolean; window?: CommentHostWindow | null } = {}) {
  const svc = options.svc ?? service()
  const unsaved = { set: vi.fn(async () => {}), has: vi.fn(async () => false), forget: vi.fn() }
  const get = vi.fn((panelId: string, windowId: number) => (panelId === svc.panelId && windowId === svc.windowId ? svc : undefined))
  const window: CommentHostWindow = { id: 1, once: (_event, listener) => closed.push(listener) }
  dispose = registerPreviewCommentHandlers({
    registry: { get },
    unsaved,
    isTrustedSender: () => options.trusted !== false,
    resolveWindow: () => (options.window === undefined ? window : options.window)
  })
  return { svc, unsaved, get }
}

const invoke = (channel: string, arg: unknown): Promise<unknown> => handlers[channel]({ sender: {} }, arg)

beforeEach(() => {
  vi.clearAllMocks()
  closed = []
})

afterEach(() => {
  dispose?.()
  dispose = null
})

describe('preview comment handlers', () => {
  it('serve each channel for the panel in the sender\'s own window', async () => {
    const { svc, unsaved } = register()
    expect(await invoke(PreviewCommentChannels.SET_MODE, { panelId: PANEL, on: true, showIcons: false })).toEqual({ ok: true, on: true, showIcons: false })
    expect(svc.setMode).toHaveBeenCalledWith(true, false)
    expect(await invoke(PreviewCommentChannels.LIST, { panelId: PANEL })).toEqual({ ok: true, files: [] })
    expect(await invoke(PreviewCommentChannels.COMMAND, { panelId: PANEL, command: 'reveal', threadKey: 't1' })).toEqual({ ok: true })
    expect(svc.reveal).toHaveBeenCalledWith('t1')
    const save = { panelId: PANEL, op: 'add', draftToken: DRAFT, text: SECRET_TEXT }
    expect(await invoke(PreviewCommentChannels.SAVE, save)).toEqual({ ok: true, threadKey: 't1' })
    expect(svc.save).toHaveBeenCalledWith(save)
    expect(await invoke(PreviewCommentChannels.SET_UNSAVED_SOURCES, { paths: ['/p/index.html'] })).toEqual({ ok: true })
    expect(unsaved.set).toHaveBeenCalledWith(1, ['/p/index.html'])
  })

  it('SEC-07 an untrusted sender is refused before the payload is read', async () => {
    const { svc, get } = register({ trusted: false })
    const poisoned = new Proxy({}, { get: () => { throw new Error('payload was read') } })
    for (const channel of Object.values(PreviewCommentChannels)) {
      const answer = (await invoke(channel, poisoned)) as { ok: boolean }
      expect(answer.ok, channel).toBe(false)
    }
    expect(get).not.toHaveBeenCalled()
    expect(svc.save).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('untrusted sender'), { channel: PreviewCommentChannels.SAVE })
  })

  it('SEC-07 a payload that fails its strict schema is refused, and logs issue codes only (SEC-20)', async () => {
    const { svc } = register()
    const answer = await invoke(PreviewCommentChannels.SAVE, { panelId: PANEL, op: 'add', draftToken: DRAFT, text: SECRET_TEXT, author: { name: 'Mallory' } })
    expect(answer).toEqual({ ok: false, code: ErrorCode.COMMENT_WRITE_FAILED })
    expect(svc.save).not.toHaveBeenCalled()
    const logged = JSON.stringify(vi.mocked(logger.warn).mock.calls)
    expect(logged).toContain('unrecognized_keys')
    expect(logged).not.toContain(SECRET_TEXT)
    expect(logged).not.toContain('Mallory')
  })

  it('SEC-07 another window\'s panel, or no window, is not found', async () => {
    const svc = service({ windowId: 2 })
    register({ svc })
    expect(await invoke(PreviewCommentChannels.SET_MODE, { panelId: PANEL, on: true, showIcons: true })).toEqual({ ok: true, on: false, showIcons: true })
    expect(await invoke(PreviewCommentChannels.LIST, { panelId: PANEL })).toEqual({ ok: true, files: [], unavailable: 'disabled' })
    expect(await invoke(PreviewCommentChannels.COMMAND, { panelId: PANEL, command: 'reveal', threadKey: 't1' })).toEqual(KEY_INVALID)
    expect(await invoke(PreviewCommentChannels.SAVE, { panelId: PANEL, op: 'add', draftToken: DRAFT, text: 'x' })).toEqual(KEY_INVALID)
    expect(svc.save).not.toHaveBeenCalled()

    dispose?.()
    register({ window: null })
    expect(await invoke(PreviewCommentChannels.LIST, { panelId: PANEL })).toEqual(KEY_INVALID)
  })

  it('a service that throws, or answers off-schema, reads as a refusal – never a throw', async () => {
    register({
      svc: service({
        save: vi.fn(async () => {
          throw new Error(`EACCES: open '/home/ada/secret.html'`)
        }),
        list: vi.fn(async () => ({ ok: true, files: [{ realPath: '/p/x' }] }) as never)
      })
    })
    expect(await invoke(PreviewCommentChannels.SAVE, { panelId: PANEL, op: 'add', draftToken: DRAFT, text: 'x' })).toEqual({
      ok: false,
      code: ErrorCode.COMMENT_WRITE_FAILED
    })
    expect(await invoke(PreviewCommentChannels.LIST, { panelId: PANEL })).toEqual(KEY_INVALID)
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain('secret.html')
  })

  it('C-14 (HTML) keep-draft renews a draft of the sender\'s own panel only, and the strict schema refuses anything else', async () => {
    const { svc } = register()
    expect(await invoke(PreviewCommentChannels.COMMAND, { panelId: PANEL, command: 'keep-draft', draftToken: DRAFT })).toEqual({ ok: true })
    expect(svc.keepDraft).toHaveBeenCalledExactlyOnceWith(DRAFT)
    for (const bad of [
      { panelId: PANEL, command: 'keep-draft', draftToken: 'not-a-token' },
      { panelId: PANEL, command: 'keep-draft', draftToken: DRAFT, threadKey: 't1' },
      { panelId: PANEL, command: 'keep-draft' },
      { panelId: PANEL, command: 'reveal', draftToken: DRAFT }
    ]) {
      expect(await invoke(PreviewCommentChannels.COMMAND, bad), JSON.stringify(bad)).toEqual(KEY_INVALID)
    }
    expect(svc.keepDraft).toHaveBeenCalledTimes(1)
    expect(svc.reveal).not.toHaveBeenCalled()
    dispose?.()
    const foreign = service({ windowId: 2 })
    register({ svc: foreign })
    expect(await invoke(PreviewCommentChannels.COMMAND, { panelId: PANEL, command: 'keep-draft', draftToken: DRAFT })).toEqual(KEY_INVALID)
    expect(foreign.keepDraft).not.toHaveBeenCalled()
  })

  it('a window\'s unsaved files are forgotten when it closes, and watched once', async () => {
    const { unsaved } = register()
    await invoke(PreviewCommentChannels.SET_UNSAVED_SOURCES, { paths: [] })
    await invoke(PreviewCommentChannels.SET_UNSAVED_SOURCES, { paths: [] })
    expect(closed).toHaveLength(1)
    closed[0]()
    expect(unsaved.forget).toHaveBeenCalledWith(1)
    await invoke(PreviewCommentChannels.SET_UNSAVED_SOURCES, { paths: [] })
    expect(closed).toHaveLength(2)
  })

  it('SEC-07 by default the window is the sender\'s own: no window behind the sender, no answer', async () => {
    const { BrowserWindow } = await import('electron')
    const svc = service()
    dispose = registerPreviewCommentHandlers({
      registry: { get: vi.fn(() => svc) },
      unsaved: { set: vi.fn(async () => {}), has: vi.fn(async () => false), forget: vi.fn() },
      isTrustedSender: () => true
    })
    const sender = { id: 9 }
    expect(await handlers[PreviewCommentChannels.LIST]({ sender }, { panelId: PANEL })).toEqual(KEY_INVALID)
    expect(BrowserWindow.fromWebContents).toHaveBeenCalledWith(sender)
    expect(svc.list).not.toHaveBeenCalled()
  })

  it('dispose removes every channel', () => {
    register()
    dispose?.()
    dispose = null
    for (const channel of Object.values(PreviewCommentChannels)) expect(handlers[channel]).toBeUndefined()
  })
})
