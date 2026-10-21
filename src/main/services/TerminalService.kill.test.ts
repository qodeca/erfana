// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Terminal kill paths on quit and window close (#296): the Windows process-tree
 * kill, one kill per pty, and a bounded batch of node-pty kills.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
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

const treeKill = vi.hoisted(() => ({ killProcessTree: vi.fn(() => true) }))
vi.mock('./terminalTreeKill', () => treeKill)

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

describe('TerminalService kill paths (#296)', () => {
  afterAll(() => {
    delete (globalThis as Record<string, unknown>)[PTY_GLOBAL]
  })

  beforeEach(() => {
    spawned.length = 0
    mockNodePty.spawn.mockClear()
    treeKill.killProcessTree.mockClear()
    process.env.SHELL = '/bin/zsh'
    delete process.env.ERFANA_E2E_FAST_SHELL
  })

  it('kills the whole process tree before the pty on Windows', async () => {
    const { terminalService } = await load('win32')
    const id = await create(terminalService, 'win32')
    const order: string[] = []
    treeKill.killProcessTree.mockImplementationOnce(() => {
      order.push('tree')
      return true
    })
    spawned[0].kill.mockImplementationOnce(() => order.push('pty'))

    expect(terminalService.killTerminal(id)).toBe(true)
    expect(order).toEqual(['tree', 'pty'])
    expect(treeKill.killProcessTree).toHaveBeenCalledWith(spawned[0].pid)
  })

  it('does not start a tree kill off Windows', async () => {
    const { terminalService } = await load('darwin')
    const id = await create(terminalService, 'darwin')
    terminalService.killTerminal(id)
    expect(treeKill.killProcessTree).not.toHaveBeenCalled()
    expect(spawned[0].kill).toHaveBeenCalledTimes(1)
  })

  it('kills a pty once even when it is killed again', async () => {
    const { terminalService } = await load('win32')
    const id = await create(terminalService, 'win32')
    expect(terminalService.killTerminal(id)).toBe(true)
    // gone from the map, so a late second kill (restart then window close) is refused
    expect(terminalService.killTerminal(id)).toBe(false)
    terminalService.cleanupForWebContentsId(-1)
    expect(spawned[0].kill).toHaveBeenCalledTimes(1)
    expect(treeKill.killProcessTree).toHaveBeenCalledTimes(1)
  })

  it('cleanup for a closed window ends every owned terminal and no others', async () => {
    const { terminalService } = await load('win32')
    await create(terminalService, 'win32', 7)
    await create(terminalService, 'win32', 7)
    await create(terminalService, 'win32', 8)
    terminalService.cleanupForWebContentsId(7)
    expect(treeKill.killProcessTree).toHaveBeenCalledTimes(2)
    expect(spawned[0].kill).toHaveBeenCalledTimes(1)
    expect(spawned[1].kill).toHaveBeenCalledTimes(1)
    expect(spawned[2].kill).not.toHaveBeenCalled()
  })

  it('a throwing pty kill does not stop the rest of a window cleanup', async () => {
    const { terminalService } = await load('win32')
    await create(terminalService, 'win32', 7)
    await create(terminalService, 'win32', 7)
    terminalService.on('error', () => {})
    spawned[0].kill.mockImplementation(() => {
      throw new Error('AttachConsole failed')
    })
    expect(() => terminalService.cleanupForWebContentsId(7)).not.toThrow()
    expect(spawned[1].kill).toHaveBeenCalledTimes(1)
    expect(treeKill.killProcessTree).toHaveBeenCalledTimes(2)
  })

  it('stops calling node-pty kill once the budget is spent, but still tree-kills every shell', async () => {
    const { terminalService, TERMINAL_KILL_BUDGET_MS } = await load('win32')
    for (let i = 0; i < 5; i++) await create(terminalService, 'win32', 7)
    let now = 1_000_000
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    // each pty kill "takes" 400 ms, so the budget runs out after three of them
    for (const pty of spawned) pty.kill.mockImplementation(() => void (now += 400))

    terminalService.cleanupForWebContentsId(7)
    clock.mockRestore()

    expect(treeKill.killProcessTree).toHaveBeenCalledTimes(5)
    const ptyKills = spawned.filter((p) => p.kill.mock.calls.length > 0).length
    expect(ptyKills).toBe(Math.ceil(TERMINAL_KILL_BUDGET_MS / 400))
    expect(ptyKills).toBeLessThan(5)
  })

  it('dispose is bounded and tree-kills every shell even when exits never arrive', async () => {
    vi.useFakeTimers()
    try {
      const { terminalService, TERMINAL_EXIT_WAIT_MS } = await load('win32')
      for (let i = 0; i < 4; i++) await create(terminalService, 'win32')
      const disposed = terminalService.dispose()
      await vi.advanceTimersByTimeAsync(TERMINAL_EXIT_WAIT_MS)
      await disposed
      expect(treeKill.killProcessTree).toHaveBeenCalledTimes(4)
      expect(spawned.every((p) => p.kill.mock.calls.length === 1)).toBe(true)
    } finally {
      vi.useRealTimers()
    }
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
