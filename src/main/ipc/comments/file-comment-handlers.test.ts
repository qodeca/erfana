// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The `file-comment:*` handlers (spec 024 architecture note 001 § 4, § 8 C17,
 * C18): the sender gate before the payload, the strict capped schema, the
 * confinement check on a named path, the sender's own window, the
 * re-validated answer, never a throw – every refusal a code and a reason.
 * `electron`'s `ipcMain` is mocked to capture the handlers.
 */
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../shared/errors'
import { FileCommentChannels } from '../../../shared/ipc/file-comment-channels'
import { logger } from '../../services/LoggingService'
import type { FileCommentService } from '../../services/comments/FileCommentService'
import type { ProjectSessionSnapshot } from '../../services/session/ProjectSession'
import { registerFileCommentHandlers, type FileCommentHostWindow } from './file-comment-handlers'

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
  BrowserWindow: { fromWebContents: vi.fn(() => null), fromId: vi.fn(() => null) }
}))

vi.mock('../../services/LoggingService', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

const PANEL = 'editor-panel-1'
const SECRET_TEXT = 'Secret review text from the reviewer'
const TOKEN = 'a'.repeat(32)
const HASH = 'b'.repeat(64)
const VIEW = { w: 800, h: 600, dpr: 1, x: 0, y: 0 }

let root: string
let made: string
let dispose: (() => void) | null = null
let closed: Array<() => void> = []

function fakeService(): { [K in 'list' | 'openDraft' | 'save' | 'forgetWindow']: ReturnType<typeof vi.fn> } {
  return {
    list: vi.fn(async () => ({
      ok: true,
      file: { fileKey: 'f1', displayPath: 'notes.txt', filePath: join(root, 'notes.txt'), frame: false, writable: true, threads: [], damaged: [], newer: [] },
      placements: []
    })),
    openDraft: vi.fn(async () => ({ ok: true, draftToken: TOKEN })),
    save: vi.fn(async () => ({ ok: true, threadKey: 't1' })),
    forgetWindow: vi.fn()
  }
}

function register(options: { trusted?: boolean; window?: FileCommentHostWindow | null; snapshot?: ProjectSessionSnapshot | null } = {}) {
  const service = fakeService()
  const window: FileCommentHostWindow = { id: 7, once: (_event, listener) => closed.push(listener) }
  const snapshot: ProjectSessionSnapshot | null =
    options.snapshot === undefined ? { generation: 1, root, realRoot: root, caseSensitive: process.platform === 'linux', ownerWebContentsId: null } : options.snapshot
  dispose = registerFileCommentHandlers({
    service: service as unknown as Pick<FileCommentService, 'list' | 'openDraft' | 'save' | 'forgetWindow'>,
    session: { current: () => snapshot },
    isTrustedSender: () => options.trusted !== false,
    resolveWindow: () => (options.window === undefined ? window : options.window)
  })
  return service
}

const invoke = (channel: string, arg: unknown): Promise<unknown> => handlers[channel]({ sender: { id: 3 } }, arg)
const refused = (code: ErrorCode, reason: string) => ({ ok: false, code, reason })

beforeEach(async () => {
  vi.clearAllMocks()
  closed = []
  made = await mkdtemp(join(tmpdir(), 'erfana-file-comment-ipc-'))
  root = await realpath(made)
  await writeFile(join(root, 'notes.txt'), 'Para.\n')
})

afterEach(async () => {
  dispose?.()
  dispose = null
  await rm(made, { recursive: true, force: true })
})

describe('file-comment handlers', () => {
  it('serve each channel for the sender\'s own window, with the confined path', async () => {
    const service = register()
    const filePath = join(root, 'notes.txt')
    expect(await invoke(FileCommentChannels.LIST, { panelId: PANEL, filePath })).toMatchObject({ ok: true })
    expect(service.list).toHaveBeenCalledWith({ windowId: 7, root, realRoot: root }, { panelId: PANEL, filePath })
    expect(await invoke(FileCommentChannels.OPEN_DRAFT, { panelId: PANEL, filePath })).toEqual({ ok: true, draftToken: TOKEN })
    const add = { panelId: PANEL, filePath, op: 'add', draftToken: TOKEN, target: { lineStart: 1, lineEnd: 1, tag: 'p', ordinal: 0 }, text: SECRET_TEXT, view: VIEW }
    expect(await invoke(FileCommentChannels.SAVE, add)).toEqual({ ok: true, threadKey: 't1' })
    const reply = { panelId: PANEL, op: 'reply', fileKey: 'f1', threadKey: 't1', rawHash: HASH, text: 'x' }
    expect(await invoke(FileCommentChannels.SAVE, reply)).toEqual({ ok: true, threadKey: 't1' })
    expect(service.save).toHaveBeenLastCalledWith({ windowId: 7, root, realRoot: root }, reply)
  })

  it('a closing window forgets its panels', async () => {
    const service = register()
    await invoke(FileCommentChannels.LIST, { panelId: PANEL, filePath: join(root, 'notes.txt') })
    await invoke(FileCommentChannels.LIST, { panelId: 'other', filePath: join(root, 'notes.txt') })
    expect(closed).toHaveLength(1)
    closed[0]()
    expect(service.forgetWindow).toHaveBeenCalledWith(7)
  })

  it('024-AC-038 an untrusted sender is refused before the payload is read', async () => {
    const service = register({ trusted: false })
    const poisoned = new Proxy({}, { get: () => { throw new Error('payload was read') } })
    for (const channel of Object.values(FileCommentChannels)) {
      expect(await invoke(channel, poisoned), channel).toEqual(refused(ErrorCode.COMMENT_WRITE_FAILED, 'untrusted-sender'))
    }
    expect(service.list).not.toHaveBeenCalled()
    expect(service.save).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('untrusted sender'), { channel: FileCommentChannels.SAVE })
  })

  it.each([
    ['an unknown field', { panelId: PANEL, filePath: '/x.txt', extra: 1 }],
    ['an over-long path', { panelId: PANEL, filePath: `/${'a'.repeat(5000)}.txt` }],
    ['a buffer over the file limit', { panelId: PANEL, filePath: '/x.txt', bufferText: 'a'.repeat(25 * 1024 * 1024 + 1) }]
  ])('024-AC-038 a malformed list (%s) is refused; logs carry issue codes only', async (_name, payload) => {
    const service = register()
    expect(await invoke(FileCommentChannels.LIST, payload)).toEqual(refused(ErrorCode.COMMENT_WRITE_FAILED, 'bad-request'))
    expect(service.list).not.toHaveBeenCalled()
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain('aaaa')
  })

  it.each([
    ['a thread op naming a path', { panelId: PANEL, op: 'reply', fileKey: 'f1', threadKey: 't1', rawHash: HASH, text: 'x', filePath: '/x.txt' }],
    ['a thread op naming an author', { panelId: PANEL, op: 'reply', fileKey: 'f1', threadKey: 't1', rawHash: HASH, text: 'x', author: 'Eve' }],
    ['an add without its draft token', { panelId: PANEL, filePath: '/x.txt', op: 'add', target: { lineStart: 1, lineEnd: 1, tag: 'p', ordinal: 0 }, text: 'x', view: VIEW }],
    ['an add whose target ends before it starts', { panelId: PANEL, filePath: '/x.txt', op: 'add', draftToken: TOKEN, target: { lineStart: 4, lineEnd: 2, tag: 'p', ordinal: 0 }, text: 'x', view: VIEW }],
    ['a blank message', { panelId: PANEL, op: 'reply', fileKey: 'f1', threadKey: 't1', rawHash: HASH, text: '   ' }]
  ])('024-AC-038 a malformed save (%s) is refused, the comment text never logged', async (_name, payload) => {
    const service = register()
    expect(await invoke(FileCommentChannels.SAVE, { ...payload })).toEqual(refused(ErrorCode.COMMENT_WRITE_FAILED, 'bad-request'))
    expect(service.save).not.toHaveBeenCalled()
  })

  it('a path outside the project is refused by the confinement check before the service runs', async () => {
    const service = register()
    const outside = join(tmpdir(), 'not-in-project.txt')
    expect(await invoke(FileCommentChannels.LIST, { panelId: PANEL, filePath: outside })).toEqual(
      refused(ErrorCode.COMMENT_PATH_REFUSED, 'outside-project')
    )
    expect(await invoke(FileCommentChannels.LIST, { panelId: PANEL, filePath: join(root, 'missing.txt') })).toEqual(
      refused(ErrorCode.COMMENT_FILE_GONE, 'missing')
    )
    expect(service.list).not.toHaveBeenCalled()
  })

  it('no window or no project: refused, never thrown', async () => {
    register({ window: null })
    expect(await invoke(FileCommentChannels.OPEN_DRAFT, { panelId: PANEL, filePath: join(root, 'notes.txt') })).toEqual(
      refused(ErrorCode.COMMENT_KEY_INVALID, 'not-open')
    )
    dispose?.()
    register({ snapshot: null })
    expect(await invoke(FileCommentChannels.OPEN_DRAFT, { panelId: PANEL, filePath: join(root, 'notes.txt') })).toEqual(
      refused(ErrorCode.COMMENT_PATH_REFUSED, 'outside-project')
    )
  })

  it('an answer that fails its schema, or a throw, is a refusal', async () => {
    const service = register()
    service.openDraft.mockResolvedValueOnce({ ok: true, draftToken: 'not-a-token' })
    expect(await invoke(FileCommentChannels.OPEN_DRAFT, { panelId: PANEL, filePath: join(root, 'notes.txt') })).toEqual(
      refused(ErrorCode.COMMENT_WRITE_FAILED, 'invalid')
    )
    service.list.mockRejectedValueOnce(new Error(`boom ${SECRET_TEXT}`))
    expect(await invoke(FileCommentChannels.LIST, { panelId: PANEL, filePath: join(root, 'notes.txt') })).toEqual(
      refused(ErrorCode.COMMENT_WRITE_FAILED, 'io')
    )
  })
})
