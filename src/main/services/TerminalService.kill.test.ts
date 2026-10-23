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

const shim = vi.hoisted(() => ({
  installNoForkConsoleList: vi.fn(() => true),
  installExitTimeRecorder: vi.fn(() => true),
  nativeExitAtMs: vi.fn((_pty: unknown): number | undefined => undefined)
}))
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
    shim.installExitTimeRecorder.mockClear()
    shim.nativeExitAtMs.mockReset()
    shim.nativeExitAtMs.mockImplementation(() => undefined)
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

    it('skips the tree kill for the diagnostics switch only when diagnostics are allowed (dev builds)', async () => {
      const { terminalService, SKIP_TREE_KILL_ENV } = await load('win32')
      terminalService.allowDiagnostics(true)
      await create(terminalService, 'win32')
      spawned[0].kill.mockImplementation(() => spawned[0].emit('exit', { exitCode: 0 }))
      process.env[SKIP_TREE_KILL_ENV] = '1'
      try {
        await terminalService.dispose()
      } finally {
        delete process.env[SKIP_TREE_KILL_ENV]
      }
      expect(treeKill.killProcessTrees).not.toHaveBeenCalled()
      // the pty itself is still ended
      expect(spawned[0].kill).toHaveBeenCalledTimes(1)
    })

    it('tells whether the tree kill is skipped, so the quit helper can say a quit is unverified', async () => {
      const { terminalService, SKIP_TREE_KILL_ENV } = await load('win32')
      process.env[SKIP_TREE_KILL_ENV] = '1'
      try {
        expect(terminalService.treeKillSkipped()).toBe(false)
        terminalService.allowDiagnostics(true)
        expect(terminalService.treeKillSkipped()).toBe(true)
        process.env[SKIP_TREE_KILL_ENV] = '0'
        expect(terminalService.treeKillSkipped()).toBe(false)
      } finally {
        delete process.env[SKIP_TREE_KILL_ENV]
      }
    })

    it('ignores the diagnostics switch silently by default (packaged builds)', async () => {
      const { terminalService, SKIP_TREE_KILL_ENV } = await load('win32')
      const { logger } = await import('./LoggingService')
      vi.mocked(logger.warn).mockClear()
      await create(terminalService, 'win32')
      spawned[0].kill.mockImplementation(() => spawned[0].emit('exit', { exitCode: 0 }))
      process.env[SKIP_TREE_KILL_ENV] = '1'
      try {
        await terminalService.dispose()
      } finally {
        delete process.env[SKIP_TREE_KILL_ENV]
      }
      expect(treeKill.killProcessTrees).toHaveBeenCalledTimes(1)
      expect(vi.mocked(logger.warn).mock.calls.some(([m]) => String(m).includes('Tree kill skipped'))).toBe(false)
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

  describe('quit helper inputs (#305)', () => {
    it('lists the shells still running with their spawn time, including ones a window close is ending', async () => {
      const { terminalService } = await load('win32')
      const before = Date.now()
      await create(terminalService, 'win32', 7)
      await create(terminalService, 'win32')
      await create(terminalService, 'win32')
      const pids = () => terminalService.getLiveShells().map((s) => s.pid)
      expect(pids()).toEqual([9000, 9001, 9002])
      for (const shell of terminalService.getLiveShells()) {
        expect(shell.spawnedAtMs).toBeGreaterThanOrEqual(before)
        expect(shell.spawnedAtMs).toBeLessThanOrEqual(Date.now())
      }

      spawned[1].emit('exit', { exitCode: 0 })
      // detached from the map, but its shell has not reported an exit yet
      terminalService.cleanupForWebContentsId(7)
      expect(pids()).toEqual([9000, 9002])
      spawned[0].emit('exit', { exitCode: 0 })
      expect(pids()).toEqual([9002])
    })

    it('an old exit does not drop a newer shell that got the same pid', async () => {
      const { terminalService } = await load('win32')
      await create(terminalService, 'win32')
      const first = spawned[0]
      // the mock numbers pids by count, so the next shell gets the same pid (9000)
      spawned.length = 0
      await create(terminalService, 'win32')
      expect(spawned[0].pid).toBe(first.pid)
      first.emit('exit', { exitCode: 0 })
      expect(terminalService.getLiveShells().map((s) => s.pid)).toEqual([9000])
    })

    it('takes the spawn time before node-pty spawns the shell', async () => {
      const { terminalService } = await load('win32')
      let spawnCalledAt = 0
      mockNodePty.spawn.mockImplementationOnce((...args: unknown[]) => {
        spawnCalledAt = Date.now()
        return (mockNodePty.spawn.getMockImplementation() as (...a: unknown[]) => MockPTY)(...args)
      })
      await create(terminalService, 'win32')
      const [live] = terminalService.getLiveShells()
      expect(live.spawnedAtMs).toBeLessThanOrEqual(spawnCalledAt)
      expect(shim.installExitTimeRecorder).toHaveBeenCalled()
    })

    it('reports the earliest end: the kill request or the native exit, whichever came first', async () => {
      vi.useFakeTimers({ now: 1_000_000 })
      const { terminalService } = await load('win32')
      await create(terminalService, 'win32', 7)
      await create(terminalService, 'win32')
      expect(terminalService.getLiveShells().every((s) => s.endBeforeMs === undefined)).toBe(true)

      // the second shell's native exit fired at 1,000,500 (onExit not yet delivered)
      shim.nativeExitAtMs.mockImplementation((pty: unknown) => (pty === spawned[1] ? 1_000_500 : undefined))
      vi.setSystemTime(1_002_000)
      // the window closes: the first shell is asked to end now
      terminalService.cleanupForWebContentsId(7)
      const ends = terminalService.getLiveShells().map((s) => [s.pid, s.endBeforeMs])
      expect(ends).toEqual([
        [9000, 1_002_000],
        [9001, 1_000_500]
      ])
    })

    it('creates no terminal once the shutdown has begun', async () => {
      const { terminalService, TERMINAL_SHUTTING_DOWN_MESSAGE } = await load('win32')
      terminalService.beginShutdown()
      const result = await terminalService.createTerminal({ shell: 'C:\\Windows\\System32\\cmd.exe', cwd: 'C:\\Projects\\test' })
      expect(result).toEqual({ error: TERMINAL_SHUTTING_DOWN_MESSAGE })
      expect(mockNodePty.spawn).not.toHaveBeenCalled()
      expect(terminalService.getLiveShells()).toEqual([])
    })

    it('refuses a terminal requested while dispose runs', async () => {
      const { terminalService, TERMINAL_SHUTTING_DOWN_MESSAGE } = await load('darwin')
      const disposed = terminalService.dispose()
      const result = await terminalService.createTerminal({ cwd: tmpdir() })
      await disposed
      expect(result).toEqual({ error: TERMINAL_SHUTTING_DOWN_MESSAGE })
      expect(mockNodePty.spawn).not.toHaveBeenCalled()
    })
  })
})
