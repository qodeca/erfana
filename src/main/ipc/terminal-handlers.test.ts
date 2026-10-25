// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { EventEmitter } from 'events'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type {
  ProjectSession,
  ProjectSessionSnapshot
} from '../services/session/ProjectSession'

type Listener = (event: unknown, ...args: unknown[]) => unknown

const handlers = new Map<string, Listener>()
const onListeners = new Map<string, Listener>()

// The sender gate is the registry's job and has its own tests; here the
// handlers are called directly with a fake sender.
vi.mock('./registry', () => ({
  registerHandle: (channel: string, listener: Listener) => {
    handlers.set(channel, listener)
  },
  registerOn: (channel: string, listener: Listener) => {
    onListeners.set(channel, listener)
  }
}))

const windowsById = new Map<number, { isDestroyed: () => boolean; send: Mock }>()
vi.mock('electron', () => ({
  webContents: { fromId: (id: number) => windowsById.get(id) ?? null }
}))

class MockTerminalService extends EventEmitter {
  /** terminalId -> owning webContents id */
  owners = new Map<string, number>()

  isAvailable = vi.fn(() => ({ available: true, initialized: true }))
  createTerminal = vi.fn(async (_config?: unknown, _webContentsId?: number): Promise<unknown> => ({
    terminalId: 'terminal-1',
    shellKind: 'posix' as const
  }))
  write = vi.fn(() => true)
  resize = vi.fn(() => true)
  killTerminal = vi.fn(() => true)
  getTerminalInfo = vi.fn(() => ({ id: 'terminal-1', cwd: 'x', title: 'Terminal 1' }))
  getActivity = vi.fn((): { busy: boolean; known: boolean } | null => ({ busy: true, known: true }))
  listTerminals = vi.fn((): Array<{ id: string; title: string }> => [])
  markInitializationComplete = vi.fn()
  ackOutput = vi.fn()
  getOwner = vi.fn((id: string) => this.owners.get(id))
}

const mockTerminalService = new MockTerminalService()
vi.mock('../services/TerminalService', () => ({ terminalService: mockTerminalService }))

const mockLogger = { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }
vi.mock('../services/LoggingService', () => ({ logger: mockLogger }))

// Imported after the mocks above exist (the factories read them lazily)
let registerTerminalHandlers: typeof import('./terminal-handlers').registerTerminalHandlers
let getConfinedChannels: typeof import('./confinement/registerConfinedHandle').getConfinedChannels

const OWNER = 11
const OTHER = 22
const event = (id: number = OWNER): unknown => ({ sender: { id } })
const invoke = (channel: string, id: number, ...args: unknown[]) =>
  handlers.get(channel)!(event(id), ...args)

describe('terminal-handlers', () => {
  let base: string
  let root: string
  let outside: string
  let snapshot: ProjectSessionSnapshot | null
  let session: ProjectSession

  beforeAll(async () => {
    ;({ registerTerminalHandlers } = await import('./terminal-handlers'))
    ;({ getConfinedChannels } = await import('./confinement/registerConfinedHandle'))
    base = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'erfana-terminal-')))
    root = path.join(base, 'proj')
    outside = path.join(base, 'outside')
    mkdirSync(path.join(root, 'sub'), { recursive: true })
    mkdirSync(outside)
    writeFileSync(path.join(root, 'file.md'), 'a')
  })

  afterAll(() => {
    rmSync(base, { recursive: true, force: true })
  })

  beforeEach(() => {
    vi.clearAllMocks()
    handlers.clear()
    onListeners.clear()
    windowsById.clear()
    mockTerminalService.removeAllListeners()
    mockTerminalService.owners = new Map([['terminal-1', OWNER]])
    mockTerminalService.listTerminals.mockReturnValue([])
    mockTerminalService.createTerminal.mockResolvedValue({ terminalId: 'terminal-1', shellKind: 'posix' })
    snapshot = {
      generation: 1,
      root,
      realRoot: root,
      caseSensitive: process.platform === 'linux',
      ownerWebContentsId: null
    }
    session = { current: () => snapshot, require: () => snapshot!, onChange: () => () => undefined }
    registerTerminalHandlers(session)
  })

  describe('registration and listener cleanup (issue #59)', () => {
    it('registers every channel', () => {
      for (const channel of [
        'terminal:isAvailable',
        'terminal:create',
        'terminal:write',
        'terminal:kill',
        'terminal:getInfo',
        'terminal:getActivity',
        'terminal:list'
      ]) {
        expect(handlers.has(channel), channel).toBe(true)
      }
      expect(onListeners.has('terminal:resize')).toBe(true)
      expect(onListeners.has('terminal:clearComplete')).toBe(true)
      expect(onListeners.has('terminal:ackOutput')).toBe(true)
    })

    it('lists terminal:create among the channels that check a path', () => {
      expect(getConfinedChannels().get('terminal:create')).toEqual(['cwd'])
    })

    it('keeps one listener per event across repeated registration', () => {
      for (let i = 0; i < 5; i++) registerTerminalHandlers(session)
      for (const name of ['data', 'exit', 'error', 'clearTerminal']) {
        expect(mockTerminalService.listenerCount(name), name).toBe(1)
      }
    })

    it('preserves listeners while terminals are active', () => {
      mockTerminalService.listTerminals.mockReturnValue([{ id: 'terminal-1', title: 'T' }])
      registerTerminalHandlers(session)
      expect(mockTerminalService.listenerCount('data')).toBe(2)
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Terminals still active during handler registration')
      )
    })
  })

  describe('bad ids', () => {
    const BAD_IDS: unknown[] = ['', 'terminal-', 'terminal-abc', 'terminal-1234567890', '../x', 'terminal-1\n', 7, null, {}]

    it.each(BAD_IDS)('write refuses %j', async (terminalId) => {
      const result = await invoke('terminal:write', OWNER, { terminalId, data: 'x' })
      expect(result).toMatchObject({ success: false })
      expect(mockTerminalService.write).not.toHaveBeenCalled()
    })

    it.each(BAD_IDS)('kill refuses %j', async (terminalId) => {
      expect(await invoke('terminal:kill', OWNER, terminalId)).toMatchObject({ success: false })
      expect(mockTerminalService.killTerminal).not.toHaveBeenCalled()
    })

    it.each(BAD_IDS)('getInfo, getActivity refuse %j', async (terminalId) => {
      expect(await invoke('terminal:getInfo', OWNER, terminalId)).toMatchObject({ success: false })
      expect(await invoke('terminal:getActivity', OWNER, terminalId)).toMatchObject({ success: false })
    })

    it.each(BAD_IDS.filter((id) => id !== undefined))('resize drops %j', (terminalId) => {
      onListeners.get('terminal:resize')!(event(), { terminalId, cols: 80, rows: 24 })
      expect(mockTerminalService.resize).not.toHaveBeenCalled()
    })

    it('isAvailable refuses a malformed id and accepts none', async () => {
      expect(await invoke('terminal:isAvailable', OWNER, 'nope')).toMatchObject({ success: false })
      expect(await invoke('terminal:isAvailable', OWNER)).toMatchObject({ success: true, available: true })
    })

    it('clearComplete ignores a malformed id', () => {
      onListeners.get('terminal:clearComplete')!(event(), { terminalId: 'nope' })
      expect(mockTerminalService.markInitializationComplete).not.toHaveBeenCalled()
    })
  })

  describe('owner checks', () => {
    it('lets the owner write, resize, read info, read activity and kill', async () => {
      expect(await invoke('terminal:write', OWNER, { terminalId: 'terminal-1', data: 'ls' })).toEqual({ success: true })
      onListeners.get('terminal:resize')!(event(), { terminalId: 'terminal-1', cols: 100, rows: 30 })
      expect(mockTerminalService.resize).toHaveBeenCalledWith('terminal-1', 100, 30)
      expect(await invoke('terminal:getInfo', OWNER, 'terminal-1')).toMatchObject({ success: true })
      expect(await invoke('terminal:getActivity', OWNER, 'terminal-1')).toEqual({ success: true, busy: true, known: true })
      onListeners.get('terminal:clearComplete')!(event(), { terminalId: 'terminal-1' })
      expect(mockTerminalService.markInitializationComplete).toHaveBeenCalledWith('terminal-1')
      expect(await invoke('terminal:kill', OWNER, 'terminal-1')).toEqual({ success: true })
    })

    it('answers isAvailable for a foreign id like an unknown id', async () => {
      mockTerminalService.isAvailable.mockImplementation(((id?: string) =>
        id ? { available: true, initialized: mockTerminalService.owners.has(id) } : { available: true }) as never)
      const unknown = await invoke('terminal:isAvailable', OTHER, 'terminal-9')
      const foreign = await invoke('terminal:isAvailable', OTHER, 'terminal-1')
      expect(foreign).toEqual(unknown)
      expect(foreign).toMatchObject({ success: true, initialized: false })
      expect(await invoke('terminal:isAvailable', OWNER, 'terminal-1')).toMatchObject({ initialized: true })
    })

    it('answers a foreign window like an unknown id', async () => {
      const unknown = await invoke('terminal:getInfo', OTHER, 'terminal-9')
      const foreign = await invoke('terminal:getInfo', OTHER, 'terminal-1')
      expect(foreign).toEqual(unknown)
      expect(foreign).toMatchObject({ success: false })

      expect(await invoke('terminal:write', OTHER, { terminalId: 'terminal-1', data: 'x' })).toMatchObject({ success: false })
      expect(await invoke('terminal:kill', OTHER, 'terminal-1')).toMatchObject({ success: false })
      expect(await invoke('terminal:getActivity', OTHER, 'terminal-1')).toMatchObject({ success: false })
      onListeners.get('terminal:resize')!(event(OTHER), { terminalId: 'terminal-1', cols: 80, rows: 24 })
      onListeners.get('terminal:clearComplete')!(event(OTHER), { terminalId: 'terminal-1' })

      expect(mockTerminalService.write).not.toHaveBeenCalled()
      expect(mockTerminalService.killTerminal).not.toHaveBeenCalled()
      expect(mockTerminalService.resize).not.toHaveBeenCalled()
      expect(mockTerminalService.markInitializationComplete).not.toHaveBeenCalled()
    })

    it('treats an unowned terminal as nobody\'s', async () => {
      mockTerminalService.owners.set('terminal-1', -1)
      expect(await invoke('terminal:write', -1, { terminalId: 'terminal-1', data: 'x' })).toMatchObject({ success: true })
      expect(await handlers.get('terminal:write')!({}, { terminalId: 'terminal-2', data: 'x' })).toMatchObject({ success: false })
    })

    it('lists only the calling window\'s terminals', async () => {
      mockTerminalService.owners = new Map([['terminal-1', OWNER], ['terminal-2', OTHER]])
      mockTerminalService.listTerminals.mockReturnValue([
        { id: 'terminal-1', title: 'One' },
        { id: 'terminal-2', title: 'Two' }
      ])
      expect(await invoke('terminal:list', OWNER)).toEqual({ success: true, terminals: [{ id: 'terminal-1', title: 'One' }] })
      expect(await invoke('terminal:list', OTHER)).toEqual({ success: true, terminals: [{ id: 'terminal-2', title: 'Two' }] })
    })

    it('reports a terminal that is gone from the service', async () => {
      mockTerminalService.getActivity.mockReturnValueOnce(null)
      expect(await invoke('terminal:getActivity', OWNER, 'terminal-1')).toMatchObject({ success: false })
    })
  })

  describe('payload limits', () => {
    it('refuses a write over the limit and accepts one at it', async () => {
      const over = 'a'.repeat(1_048_577)
      expect(await invoke('terminal:write', OWNER, { terminalId: 'terminal-1', data: over })).toMatchObject({ success: false })
      expect(mockTerminalService.write).not.toHaveBeenCalled()
      const at = 'a'.repeat(1_048_576)
      expect(await invoke('terminal:write', OWNER, { terminalId: 'terminal-1', data: at })).toEqual({ success: true })
    })

    it('refuses a write whose data is not a string', async () => {
      expect(await invoke('terminal:write', OWNER, { terminalId: 'terminal-1', data: 5 })).toMatchObject({ success: false })
    })

    it.each([
      [0, 24],
      [80, 0],
      [2001, 24],
      [80, 2001],
      [-1, 24],
      [80.5, 24],
      [Number.NaN, 24]
    ])('drops a resize of %s x %s', (cols, rows) => {
      onListeners.get('terminal:resize')!(event(), { terminalId: 'terminal-1', cols, rows })
      expect(mockTerminalService.resize).not.toHaveBeenCalled()
    })

    it('accepts the largest resize', () => {
      onListeners.get('terminal:resize')!(event(), { terminalId: 'terminal-1', cols: 2000, rows: 2000 })
      expect(mockTerminalService.resize).toHaveBeenCalledWith('terminal-1', 2000, 2000)
    })

    it.each([
      [0, 24],
      [2001, 24],
      [80, 2001],
      [80.5, 24]
    ])('refuses to create a %s x %s terminal', async (cols, rows) => {
      const result = await invoke('terminal:create', OWNER, { cols, rows })
      expect(result).toMatchObject({ success: false })
      expect(mockTerminalService.createTerminal).not.toHaveBeenCalled()
    })
  })

  describe('terminal:create', () => {
    it('answers { success, terminalId, shellKind } and passes the owner to the service', async () => {
      const result = await invoke('terminal:create', OWNER, { cols: 80, rows: 24 })
      expect(result).toEqual({ success: true, terminalId: 'terminal-1', shellKind: 'posix' })
      expect(mockTerminalService.createTerminal).toHaveBeenCalledWith(
        { cwd: root, cols: 80, rows: 24 },
        OWNER
      )
    })

    it('refuses past 32 terminals in one window and still serves another window', async () => {
      const many = Array.from({ length: 32 }, (_, i) => ({ id: `terminal-${i + 1}`, title: 'T' }))
      mockTerminalService.owners = new Map(many.map((t) => [t.id, OWNER]))
      mockTerminalService.listTerminals.mockReturnValue(many)

      const refused = await invoke('terminal:create', OWNER, { cols: 80, rows: 24 })
      expect(refused).toMatchObject({ success: false })
      expect((refused as { error: string }).error).toMatch(/limit is 32/)
      expect(mockTerminalService.createTerminal).not.toHaveBeenCalled()

      expect(await invoke('terminal:create', OTHER, { cols: 80, rows: 24 })).toMatchObject({ success: true })
    })

    it('allows the 32nd terminal', async () => {
      const many = Array.from({ length: 31 }, (_, i) => ({ id: `terminal-${i + 1}`, title: 'T' }))
      mockTerminalService.owners = new Map(many.map((t) => [t.id, OWNER]))
      mockTerminalService.listTerminals.mockReturnValue(many)
      expect(await invoke('terminal:create', OWNER, { cols: 80, rows: 24 })).toMatchObject({ success: true })
    })

    it('answers { success: false, error } and passes the service reason through', async () => {
      mockTerminalService.createTerminal.mockResolvedValueOnce({ error: 'cwd too long' })
      expect(await invoke('terminal:create', OWNER, { cols: 80, rows: 24 })).toEqual({
        success: false,
        error: 'cwd too long'
      })
    })

    it('answers { success: false, error } when the service throws', async () => {
      mockTerminalService.createTerminal.mockRejectedValueOnce(new Error('spawn failed'))
      expect(await invoke('terminal:create', OWNER, { cols: 80, rows: 24 })).toEqual({
        success: false,
        error: 'spawn failed'
      })
    })

    it.each([
      ['shell', { shell: '/bin/sh' }],
      ['env', { env: { A: 'b' } }],
      ['an unknown key', { extra: 1 }]
    ])('refuses a request that carries %s', async (_name, extra) => {
      const result = await invoke('terminal:create', OWNER, { cols: 80, rows: 24, ...extra })
      expect(result).toMatchObject({ success: false })
      expect((result as { error: string }).error).toEqual(expect.any(String))
      expect(mockTerminalService.createTerminal).not.toHaveBeenCalled()
    })

    it.each([[undefined], [null], ['x'], [[]]])('refuses the config %j', async (config) => {
      expect(await invoke('terminal:create', OWNER, config)).toMatchObject({ success: false })
      expect(mockTerminalService.createTerminal).not.toHaveBeenCalled()
    })

    it('opens in the project folder when no cwd is sent', async () => {
      await invoke('terminal:create', OWNER, { cols: 80, rows: 24 })
      expect(mockTerminalService.createTerminal.mock.calls[0]).toEqual([{ cwd: root, cols: 80, rows: 24 }, OWNER])
    })

    it('leaves the choice to the service (home folder) when no project is open', async () => {
      snapshot = null
      await invoke('terminal:create', OWNER, { cols: 80, rows: 24 })
      expect(mockTerminalService.createTerminal.mock.calls[0]).toEqual([
        { cwd: undefined, cols: 80, rows: 24 },
        OWNER
      ])
    })

    it('accepts a folder inside the project', async () => {
      const cwd = path.join(root, 'sub')
      const result = await invoke('terminal:create', OWNER, { cwd, cols: 80, rows: 24 })
      expect(result).toMatchObject({ success: true })
      expect(mockTerminalService.createTerminal.mock.calls[0][0]).toMatchObject({ cwd })
    })

    it('accepts the project folder itself', async () => {
      const result = await invoke('terminal:create', OWNER, { cwd: root, cols: 80, rows: 24 })
      expect(result).toMatchObject({ success: true })
    })

    it('refuses a folder outside the project', async () => {
      const result = await invoke('terminal:create', OWNER, { cwd: outside, cols: 80, rows: 24 })
      expect(result).toMatchObject({ success: false })
      expect(mockTerminalService.createTerminal).not.toHaveBeenCalled()
    })

    it('refuses a path that climbs out of the project', async () => {
      const cwd = path.join(root, 'sub', '..', '..', 'outside')
      expect(await invoke('terminal:create', OWNER, { cwd, cols: 80, rows: 24 })).toMatchObject({ success: false })
      expect(mockTerminalService.createTerminal).not.toHaveBeenCalled()
    })

    it('refuses a missing folder and a file', async () => {
      for (const cwd of [path.join(root, 'missing'), path.join(root, 'file.md')]) {
        expect(await invoke('terminal:create', OWNER, { cwd, cols: 80, rows: 24 })).toMatchObject({ success: false })
      }
      expect(mockTerminalService.createTerminal).not.toHaveBeenCalled()
    })

    it('refuses a relative path', async () => {
      expect(await invoke('terminal:create', OWNER, { cwd: 'sub', cols: 80, rows: 24 })).toMatchObject({ success: false })
    })

    it('refuses a cwd when no project is open', async () => {
      snapshot = null
      const cwd = path.join(root, 'sub')
      expect(await invoke('terminal:create', OWNER, { cwd, cols: 80, rows: 24 })).toMatchObject({ success: false })
      expect(mockTerminalService.createTerminal).not.toHaveBeenCalled()
    })

    it('refuses a link inside the project that leads out of it', async (ctx) => {
      const link = path.join(root, 'link')
      try {
        symlinkSync(outside, link, 'junction')
      } catch {
        ctx.skip()
        return
      }
      expect(await invoke('terminal:create', OWNER, { cwd: link, cols: 80, rows: 24 })).toMatchObject({ success: false })
      expect(mockTerminalService.createTerminal).not.toHaveBeenCalled()
    })

    it('uses the home-folder fallback for a window that does not own the project', async () => {
      snapshot = { ...snapshot!, ownerWebContentsId: OTHER }
      await invoke('terminal:create', OWNER, { cols: 80, rows: 24 })
      expect(mockTerminalService.createTerminal.mock.calls[0][0]).toMatchObject({ cwd: undefined })
    })

    it('keeps the folder name out of the log', async () => {
      await invoke('terminal:create', OWNER, { cwd: path.join(root, 'sub'), cols: 80, rows: 24 })
      const logged = JSON.stringify(mockLogger.info.mock.calls)
      expect(logged).not.toContain(base)
    })
  })

  describe('events go to the owning window only', () => {
    const makeWindow = (id: number) => {
      const win = { isDestroyed: () => false, send: vi.fn() }
      windowsById.set(id, win)
      return win
    }

    it('sends data, exit, error and clear to the owner and to nobody else', () => {
      const owner = makeWindow(OWNER)
      const other = makeWindow(OTHER)

      mockTerminalService.emit('data', { terminalId: 'terminal-1', data: 'out', webContentsId: OWNER })
      mockTerminalService.emit('exit', { terminalId: 'terminal-1', exitCode: 0, signal: undefined, webContentsId: OWNER })
      mockTerminalService.emit('error', { terminalId: 'terminal-1', error: 'boom', webContentsId: OWNER })
      mockTerminalService.emit('clearTerminal', { terminalId: 'terminal-1', webContentsId: OWNER })

      expect(owner.send.mock.calls).toEqual([
        ['terminal:data', { terminalId: 'terminal-1', data: 'out' }],
        ['terminal:exit', { terminalId: 'terminal-1', exitCode: 0, signal: undefined }],
        ['terminal:error', { terminalId: 'terminal-1', error: 'boom' }],
        ['terminal:clear', { terminalId: 'terminal-1' }]
      ])
      expect(other.send).not.toHaveBeenCalled()
    })

    it('still reaches the owner after the terminal left the service (exit after kill)', () => {
      const owner = makeWindow(OWNER)
      mockTerminalService.owners.clear()
      mockTerminalService.emit('exit', { terminalId: 'terminal-1', exitCode: 1, webContentsId: OWNER })
      expect(owner.send).toHaveBeenCalledWith('terminal:exit', {
        terminalId: 'terminal-1',
        exitCode: 1,
        signal: undefined
      })
    })

    it('drops an event with no owner, a destroyed owner or an owner that is gone', () => {
      const destroyed = { isDestroyed: () => true, send: vi.fn() }
      windowsById.set(OTHER, destroyed)
      expect(() => {
        mockTerminalService.emit('data', { terminalId: 'terminal-1', data: 'x', webContentsId: -1 })
        mockTerminalService.emit('data', { terminalId: 'terminal-1', data: 'x' })
        mockTerminalService.emit('data', { terminalId: 'terminal-1', data: 'x', webContentsId: OTHER })
        mockTerminalService.emit('data', { terminalId: 'terminal-1', data: 'x', webContentsId: 999 })
      }).not.toThrow()
      expect(destroyed.send).not.toHaveBeenCalled()
    })
  })

  describe('terminal:ackOutput (flow control)', () => {
    const ack = (id: number, payload: unknown) => onListeners.get('terminal:ackOutput')!(event(id), payload)

    it('passes an ack from the owner to the service', () => {
      ack(OWNER, { terminalId: 'terminal-1', chars: 32_768 })
      expect(mockTerminalService.ackOutput).toHaveBeenCalledWith('terminal-1', 32_768)
    })

    it('ignores an ack from a window that does not own the terminal, and for an unknown id', () => {
      ack(OTHER, { terminalId: 'terminal-1', chars: 32_768 })
      ack(OWNER, { terminalId: 'terminal-2', chars: 32_768 })
      expect(mockTerminalService.ackOutput).not.toHaveBeenCalled()
    })

    it('refuses a malformed ack', () => {
      for (const payload of [
        undefined,
        null,
        'terminal-1',
        { terminalId: 'terminal-1' },
        { terminalId: 'terminal-1', chars: 0 },
        { terminalId: 'terminal-1', chars: -5 },
        { terminalId: 'terminal-1', chars: 1.5 },
        { terminalId: 'terminal-1', chars: Number.NaN },
        { terminalId: 'terminal-1', chars: Number.POSITIVE_INFINITY },
        { terminalId: 'terminal-1', chars: '100' },
        { terminalId: 'terminal-1', chars: 16 * 1024 * 1024 + 1 },
        { terminalId: 'bogus', chars: 10 },
        // Strict: an extra field is refused rather than ignored
        { terminalId: 'terminal-1', chars: 10, webContentsId: OWNER }
      ]) {
        ack(OWNER, payload)
      }
      expect(mockTerminalService.ackOutput).not.toHaveBeenCalled()
    })

    it('accepts the largest ack', () => {
      ack(OWNER, { terminalId: 'terminal-1', chars: 16 * 1024 * 1024 })
      expect(mockTerminalService.ackOutput).toHaveBeenCalledWith('terminal-1', 16 * 1024 * 1024)
    })
  })
})
