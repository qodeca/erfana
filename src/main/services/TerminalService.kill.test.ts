// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Terminal kill paths (#296): process trees die only on quit and window close,
 * after one awaited taskkill; one tab or a restart ends just the shell; a quit
 * stays inside its bound.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'events'
import { tmpdir } from 'node:os'

interface MockPTY extends EventEmitter {
  pid: number
  write: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
  onData: (cb: (d: string) => void) => void
  onExit: (cb: (event: { exitCode: number; signal?: number }) => void) => void
}

const spawned: MockPTY[] = []

const mockNodePty = {
  spawn: vi.fn(() => {
    const pty = new EventEmitter() as MockPTY
    pty.pid = 9000 + spawned.length
    pty.write = vi.fn()
    pty.resize = vi.fn()
    pty.kill = vi.fn()
    pty.onData = (cb) => pty.on('data', cb)
    pty.onExit = (cb) => pty.on('exit', cb)
    spawned.push(pty)
    return pty
  })
}

const treeKill = vi.hoisted(() => ({
  killProcessTrees: vi.fn((_pids: ReadonlyArray<number | undefined>) => Promise.resolve(true))
}))
vi.mock('./terminalTreeKill', () => treeKill)

const shim = vi.hoisted(() => ({ installNoForkConsoleList: vi.fn(() => Promise.resolve(true)) }))
vi.mock('./nodePtyWindowsShim', () => shim)

const PTY_GLOBAL = '__ERFANA_TEST_PTY__'

vi.mock('./LoggingService', () => ({
  logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }
}))

async function load(platform: 'darwin' | 'win32') {
  vi.resetModules()
  ;(globalThis as Record<string, unknown>)[PTY_GLOBAL] = mockNodePty
  vi.doMock('os', async () => ({ ...(await vi.importActual<object>('os')), platform: () => platform }))
  return import('./TerminalService')
}

async function create(
  service: Awaited<ReturnType<typeof load>>['terminalService'],
  platform: 'darwin' | 'win32',
  owner?: number
): Promise<string> {
  // Windows mode validates the cwd string only, so a drive path works on any host
  const config =
    platform === 'win32'
      ? { shell: 'C:\\Windows\\System32\\cmd.exe', cwd: 'C:\\Projects\\test' }
      : { cwd: tmpdir() }
  const result = await service.createTerminal(config, owner)
  if ('error' in result) throw new Error(result.error)
  return result.terminalId
}

/** A tree kill that settles when the test says so */
function deferredTreeKill() {
  let release: () => void = () => {}
  treeKill.killProcessTrees.mockImplementationOnce(
    () =>
      new Promise<boolean>((resolve) => {
        release = () => resolve(true)
      })
  )
  return () => release()
}

describe('TerminalService kill paths (#296)', () => {
  afterAll(() => {
    delete (globalThis as Record<string, unknown>)[PTY_GLOBAL]
  })

  beforeEach(() => {
    spawned.length = 0
    mockNodePty.spawn.mockClear()
    treeKill.killProcessTrees.mockClear()
    shim.installNoForkConsoleList.mockClear()
    treeKill.killProcessTrees.mockImplementation(() => Promise.resolve(true))
    process.env.SHELL = '/bin/zsh'
    delete process.env.ERFANA_E2E_FAST_SHELL
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('node-pty fork shim', () => {
    it('is installed before a terminal is created on Windows', async () => {
      const { terminalService } = await load('win32')
      await create(terminalService, 'win32')
      expect(shim.installNoForkConsoleList).toHaveBeenCalledTimes(1)
    })

    it('is not installed off Windows', async () => {
      const { terminalService } = await load('darwin')
      await create(terminalService, 'darwin')
      expect(shim.installNoForkConsoleList).not.toHaveBeenCalled()
    })

    it('a kill that returns a rejecting promise is contained', async () => {
      const { terminalService } = await load('win32')
      const id = await create(terminalService, 'win32')
      const unhandled = vi.fn()
      process.on('unhandledRejection', unhandled)
      try {
        spawned[0].kill.mockImplementation(() => Promise.reject(new Error('fork is not supported')))
        expect(terminalService.killTerminal(id)).toBe(true)
        await new Promise((resolve) => setImmediate(resolve))
        expect(unhandled).not.toHaveBeenCalled()
      } finally {
        process.off('unhandledRejection', unhandled)
      }
    })
  })

  describe('one terminal (tab close, restart)', () => {
    it('ends only the shell on Windows – no tree kill', async () => {
      const { terminalService } = await load('win32')
      const id = await create(terminalService, 'win32')
      expect(terminalService.killTerminal(id)).toBe(true)
      expect(treeKill.killProcessTrees).not.toHaveBeenCalled()
      expect(spawned[0].kill).toHaveBeenCalledTimes(1)
    })

    it('kills a pty once; a second kill of the id is refused', async () => {
      const { terminalService } = await load('win32')
      const id = await create(terminalService, 'win32')
      expect(terminalService.killTerminal(id)).toBe(true)
      expect(terminalService.killTerminal(id)).toBe(false)
      terminalService.cleanupForWebContentsId(-1)
      expect(spawned[0].kill).toHaveBeenCalledTimes(1)
    })

    it('can try again after a kill that threw', async () => {
      const { terminalService } = await load('darwin')
      terminalService.on('error', () => {})
      const id = await create(terminalService, 'darwin')
      spawned[0].kill.mockImplementationOnce(() => {
        throw new Error('boom')
      })
      expect(terminalService.killTerminal(id)).toBe(false)
      // the terminal is still there and the flag was reset, so the retry reaches the pty
      expect(terminalService.killTerminal(id)).toBe(true)
      expect(spawned[0].kill).toHaveBeenCalledTimes(2)
    })

    it('treats a pty that already reports ESRCH as killed', async () => {
      const { terminalService } = await load('win32')
      const id = await create(terminalService, 'win32')
      spawned[0].kill.mockImplementation(() => {
        throw Object.assign(new Error('gone'), { code: 'ESRCH' })
      })
      expect(terminalService.killTerminal(id)).toBe(true)
      expect(terminalService.listTerminals()).toEqual([])
    })
  })

  describe('window close', () => {
    it('runs one batched tree kill for the owned shells, then the pty kills after it settles', async () => {
      const { terminalService } = await load('win32')
      await create(terminalService, 'win32', 7)
      await create(terminalService, 'win32', 7)
      await create(terminalService, 'win32', 8)
      const release = deferredTreeKill()

      terminalService.cleanupForWebContentsId(7)

      expect(treeKill.killProcessTrees).toHaveBeenCalledTimes(1)
      expect(treeKill.killProcessTrees.mock.calls[0][0]).toEqual([spawned[0].pid, spawned[1].pid])
      // taskkill has not settled yet: the shells must still be alive for its lookup
      await Promise.resolve()
      expect(spawned[0].kill).not.toHaveBeenCalled()
      expect(spawned[1].kill).not.toHaveBeenCalled()

      release()
      await vi.waitFor(() => expect(spawned[1].kill).toHaveBeenCalledTimes(1))
      expect(spawned[0].kill).toHaveBeenCalledTimes(1)
      expect(spawned[2].kill).not.toHaveBeenCalled()
      expect(terminalService.listTerminals()).toHaveLength(1)
    })

    it('leaves out a shell that already exited, and does not kill one that exits during the wait', async () => {
      const { terminalService } = await load('win32')
      await create(terminalService, 'win32', 7)
      await create(terminalService, 'win32', 7)
      await create(terminalService, 'win32', 7)
      spawned[0].emit('exit', { exitCode: 0 })
      const release = deferredTreeKill()

      terminalService.cleanupForWebContentsId(7)
      expect(treeKill.killProcessTrees.mock.calls[0][0]).toEqual([spawned[1].pid, spawned[2].pid])

      spawned[1].emit('exit', { exitCode: 0 })
      release()
      await vi.waitFor(() => expect(spawned[2].kill).toHaveBeenCalledTimes(1))
      expect(spawned[0].kill).not.toHaveBeenCalled()
      expect(spawned[1].kill).not.toHaveBeenCalled()
    })

    it('does no tree kill off Windows and ends the shells at once', async () => {
      const { terminalService } = await load('darwin')
      await create(terminalService, 'darwin', 7)
      await create(terminalService, 'darwin', 7)
      terminalService.cleanupForWebContentsId(7)
      expect(treeKill.killProcessTrees).not.toHaveBeenCalled()
      expect(spawned[0].kill).toHaveBeenCalledTimes(1)
      expect(spawned[1].kill).toHaveBeenCalledTimes(1)
    })

    it('a throwing pty kill does not stop the rest of the batch', async () => {
      const { terminalService } = await load('win32')
      await create(terminalService, 'win32', 7)
      await create(terminalService, 'win32', 7)
      spawned[0].kill.mockImplementation(() => {
        throw new Error('AttachConsole failed')
      })
      terminalService.cleanupForWebContentsId(7)
      await vi.waitFor(() => expect(spawned[1].kill).toHaveBeenCalledTimes(1))
    })

    it('defers, not drops, the pty kills left over once the budget is spent', async () => {
      const { terminalService, TERMINAL_KILL_BUDGET_MS } = await load('win32')
      for (let i = 0; i < 5; i++) await create(terminalService, 'win32', 7)
      let now = 1_000_000
      const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
      // each pty kill "takes" 200 ms
      for (const pty of spawned) pty.kill.mockImplementation(() => void (now += 200))

      terminalService.cleanupForWebContentsId(7)
      // tree kill is awaited first, so everything below happens after one tick
      for (let i = 0; i < 10; i++) await Promise.resolve()
      const sync = spawned.filter((p) => p.kill.mock.calls.length > 0).length
      expect(sync).toBe(Math.ceil(TERMINAL_KILL_BUDGET_MS / 200))
      expect(sync).toBeLessThan(5)

      await vi.waitFor(() => expect(spawned.every((p) => p.kill.mock.calls.length === 1)).toBe(true))
      clock.mockRestore()
    })
  })

  describe('dispose (quit)', () => {
    it('stays inside its bound when taskkill and every exit hang', async () => {
      vi.useFakeTimers()
      const { terminalService, TERMINAL_DISPOSE_BOUND_MS } = await load('win32')
      for (let i = 0; i < 4; i++) await create(terminalService, 'win32')
      treeKill.killProcessTrees.mockImplementation(() => new Promise<boolean>(() => {}))

      const startedAt = Date.now()
      let doneAt = -1
      const disposed = terminalService.dispose().then(() => {
        doneAt = Date.now() - startedAt
      })
      await vi.advanceTimersByTimeAsync(TERMINAL_DISPOSE_BOUND_MS + 1)
      await disposed
      expect(doneAt).toBeLessThanOrEqual(TERMINAL_DISPOSE_BOUND_MS)
      expect(treeKill.killProcessTrees).toHaveBeenCalledTimes(1)
      expect(treeKill.killProcessTrees.mock.calls[0][0]).toHaveLength(4)
    })

    it('the exit wait gets only the time the kills left, never less than the floor', async () => {
      vi.useFakeTimers()
      const { terminalService, TERMINAL_DISPOSE_BOUND_MS, TERMINAL_MIN_EXIT_WAIT_MS } = await load('win32')
      await create(terminalService, 'win32')
      // taskkill takes 1200 ms to settle, so about 600 ms remain for the exit
      treeKill.killProcessTrees.mockImplementation(
        () => new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 1_200))
      )
      const startedAt = Date.now()
      let doneAt = -1
      const disposed = terminalService.dispose().then(() => {
        doneAt = Date.now() - startedAt
      })
      await vi.advanceTimersByTimeAsync(TERMINAL_DISPOSE_BOUND_MS + 1)
      await disposed
      expect(doneAt).toBe(TERMINAL_DISPOSE_BOUND_MS)
      expect(doneAt - 1_200).toBeGreaterThanOrEqual(TERMINAL_MIN_EXIT_WAIT_MS)
    })

    it('returns as soon as the shells have exited', async () => {
      const { terminalService } = await load('win32')
      await create(terminalService, 'win32')
      await create(terminalService, 'win32')
      spawned.forEach((pty) => pty.kill.mockImplementation(() => pty.emit('exit', { exitCode: 0 })))
      await terminalService.dispose()
      expect(spawned.every((p) => p.kill.mock.calls.length === 1)).toBe(true)
    })

    it('does no tree kill off Windows', async () => {
      const { terminalService } = await load('darwin')
      await create(terminalService, 'darwin')
      spawned[0].kill.mockImplementation(() => spawned[0].emit('exit', { exitCode: 0 }))
      await terminalService.dispose()
      expect(treeKill.killProcessTrees).not.toHaveBeenCalled()
      expect(spawned[0].kill).toHaveBeenCalledTimes(1)
    })

    it('also waits for a window-close batch that is still running', async () => {
      const { terminalService } = await load('win32')
      await create(terminalService, 'win32', 7)
      const release = deferredTreeKill()
      terminalService.cleanupForWebContentsId(7)

      let disposed = false
      const done = terminalService.dispose().then(() => {
        disposed = true
      })
      await Promise.resolve()
      expect(disposed).toBe(false)
      spawned[0].kill.mockImplementation(() => spawned[0].emit('exit', { exitCode: 0 }))
      release()
      await done
      expect(spawned[0].kill).toHaveBeenCalledTimes(1)
    })
  })
})
