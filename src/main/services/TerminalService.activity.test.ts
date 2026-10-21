// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Terminal owner and foreground-process lookups (`getOwner`, `getActivity`),
 * and the owner id carried by every event.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'events'
import { tmpdir } from 'node:os'

interface MockPTY extends EventEmitter {
  pid: number
  /** What node-pty reports as the foreground process */
  process: string | undefined
  write: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
  onData: (cb: (d: string) => void) => void
  onExit: (cb: (event: { exitCode: number; signal?: number }) => void) => void
}

const spawned: MockPTY[] = []

const mockNodePty = {
  spawn: vi.fn((..._args: unknown[]) => {
    const pty = new EventEmitter() as MockPTY
    pty.pid = 5000 + spawned.length
    pty.process = 'zsh'
    pty.write = vi.fn()
    pty.resize = vi.fn()
    pty.kill = vi.fn()
    pty.onData = (cb) => pty.on('data', cb)
    pty.onExit = (cb) => pty.on('exit', cb)
    spawned.push(pty)
    return pty
  })
}

// TerminalService reads its pty from this global when it is set (the seam
// TerminalService.test.ts uses too); set per load so a sibling file cannot win.
const PTY_GLOBAL = '__ERFANA_TEST_PTY__'

vi.mock('./LoggingService', () => ({
  logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }
}))

async function loadService(platform: 'darwin' | 'win32' = 'darwin') {
  vi.resetModules()
  ;(globalThis as Record<string, unknown>)[PTY_GLOBAL] = mockNodePty
  vi.doMock('os', async () => ({ ...(await vi.importActual<object>('os')), platform: () => platform }))
  const { terminalService } = await import('./TerminalService')
  return terminalService
}

async function createTerminal(
  service: Awaited<ReturnType<typeof loadService>>,
  owner?: number
): Promise<string> {
  const result = await service.createTerminal({ cwd: tmpdir() }, owner)
  if ('error' in result) throw new Error(result.error)
  return result.terminalId
}

describe('TerminalService owner and activity', () => {
  afterAll(() => {
    delete (globalThis as Record<string, unknown>)[PTY_GLOBAL]
  })

  beforeEach(() => {
    spawned.length = 0
    mockNodePty.spawn.mockClear()
    process.env.SHELL = '/bin/zsh'
    delete process.env.ERFANA_E2E_FAST_SHELL
  })

  it('records the window that created a terminal', async () => {
    const service = await loadService()
    const id = await createTerminal(service, 42)
    expect(service.getOwner(id)).toBe(42)
    expect(service.getOwner('terminal-999')).toBeUndefined()
  })

  it('uses -1 for a terminal created without an owner', async () => {
    const service = await loadService()
    expect(service.getOwner(await createTerminal(service))).toBe(-1)
  })

  describe('getActivity', () => {
    it('is not busy while the shell is in the foreground', async () => {
      const service = await loadService()
      const id = await createTerminal(service, 1)
      expect(service.getActivity(id)).toEqual({ busy: false, known: true })
    })

    it('treats a login-shell name (leading dash) as the shell', async () => {
      const service = await loadService()
      const id = await createTerminal(service, 1)
      spawned[0].process = '-zsh'
      expect(service.getActivity(id)).toEqual({ busy: false, known: true })
    })

    it('is busy while another program is in the foreground', async () => {
      const service = await loadService()
      const id = await createTerminal(service, 1)
      spawned[0].process = 'node'
      expect(service.getActivity(id)).toEqual({ busy: true, known: true })
    })

    it('treats sh as the shell in the fast e2e shell', async () => {
      process.env.ERFANA_E2E_FAST_SHELL = '1'
      const service = await loadService()
      const id = await createTerminal(service, 1)
      spawned[0].process = 'sh'
      expect(service.getActivity(id)).toEqual({ busy: false, known: true })
    })

    it('returns null for an unknown terminal', async () => {
      const service = await loadService()
      expect(service.getActivity('terminal-999')).toBeNull()
    })

    it('says it cannot tell when the pty does not name a process', async () => {
      const service = await loadService()
      const id = await createTerminal(service, 1)
      spawned[0].process = undefined
      expect(service.getActivity(id)).toEqual({ busy: false, known: false })
    })

    it('says it cannot tell on Windows, where node-pty only names the shell', async () => {
      const service = await loadService('win32')
      const id = await createTerminal(service, 1)
      spawned[0].process = 'node'
      expect(service.getActivity(id)).toEqual({ busy: false, known: false })
    })
  })

  describe('events name their owner', () => {
    it('carries the owner on data, exit and clear', async () => {
      const service = await loadService()
      const seen: Array<[string, unknown]> = []
      for (const name of ['data', 'exit', 'clearTerminal']) {
        service.on(name, (payload: unknown) => seen.push([name, payload]))
      }
      const id = await createTerminal(service, 7)

      // The bootstrap marker opens the clear handshake, then output is forwarded
      const calls = mockNodePty.spawn.mock.calls
      const marker = /__ERFANA_PWD_MARKER_\d+__/.exec(String(calls[calls.length - 1][1]))![0]
      spawned[0].emit('data', `${marker}\n`)
      service.markInitializationComplete(id)
      spawned[0].emit('data', 'hello')
      spawned[0].emit('exit', { exitCode: 0 })

      expect(seen).toEqual([
        ['clearTerminal', { terminalId: id, webContentsId: 7 }],
        ['data', { terminalId: id, data: 'hello', webContentsId: 7 }],
        ['exit', { terminalId: id, exitCode: 0, signal: undefined, webContentsId: 7 }]
      ])
    })
  })
})
