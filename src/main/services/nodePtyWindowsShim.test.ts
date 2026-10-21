// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const logger = vi.hoisted(() => ({
  trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn()
}))
vi.mock('./LoggingService', () => ({ logger }))

import { installNoForkConsoleList, resetShimWarningForTests } from './nodePtyWindowsShim'

/** Shaped like node-pty 1.1.0: the original builds its list by forking, which throws when the fuse is off */
function fakeModule() {
  const fork = vi.fn(() => {
    throw new Error('child_process.fork() is not supported when the runAsNode fuse is disabled')
  })
  class WindowsPtyAgent {
    _innerPid = 4242
    _getConsoleProcessList(): Promise<number[]> {
      return new Promise((resolve) => {
        fork()
        resolve([])
      })
    }
  }
  return { module: { WindowsPtyAgent }, fork }
}

describe('nodePtyWindowsShim', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetShimWarningForTests()
  })

  it('the original fails when forking is impossible, the replacement resolves to the shell pid', async () => {
    const { module, fork } = fakeModule()
    const before = new module.WindowsPtyAgent()
    await expect(before._getConsoleProcessList()).rejects.toThrow(/runAsNode/)

    fork.mockClear()
    await expect(installNoForkConsoleList(async () => module)).resolves.toBe(true)
    const agent = new module.WindowsPtyAgent()
    await expect(agent._getConsoleProcessList()).resolves.toEqual([4242])
    expect(fork).not.toHaveBeenCalled()
  })

  it('is applied to agents created before the install, and twice is the same as once', async () => {
    const { module } = fakeModule()
    const early = new module.WindowsPtyAgent()
    await installNoForkConsoleList(async () => module)
    const installed = module.WindowsPtyAgent.prototype._getConsoleProcessList
    await expect(installNoForkConsoleList(async () => module)).resolves.toBe(true)
    expect(module.WindowsPtyAgent.prototype._getConsoleProcessList).toBe(installed)
    await expect(early._getConsoleProcessList()).resolves.toEqual([4242])
  })

  it('resolves to an empty list when the agent has no pid yet', async () => {
    const { module } = fakeModule()
    await installNoForkConsoleList(async () => module)
    const agent = new module.WindowsPtyAgent()
    agent._innerPid = 0
    await expect(agent._getConsoleProcessList()).resolves.toEqual([])
  })

  it.each([
    ['no module', undefined],
    ['no WindowsPtyAgent', {}],
    ['no prototype method', { WindowsPtyAgent: class {} }]
  ])('does nothing and does not crash with %s, and logs once', async (_name, module) => {
    await expect(installNoForkConsoleList(async () => module)).resolves.toBe(false)
    await expect(installNoForkConsoleList(async () => module)).resolves.toBe(false)
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  it('does not crash when the module cannot be loaded', async () => {
    await expect(
      installNoForkConsoleList(async () => {
        throw new Error('Cannot find module')
      })
    ).resolves.toBe(false)
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  it('matches the real node-pty 1.1.0 shape (export and field name)', async () => {
    const real = await import('node-pty/lib/windowsPtyAgent')
    const proto = (real as unknown as { WindowsPtyAgent: { prototype: Record<string, unknown> } }).WindowsPtyAgent.prototype
    expect(typeof proto._getConsoleProcessList).toBe('function')
    const original = proto._getConsoleProcessList
    try {
      await installNoForkConsoleList(async () => real)
      const result = await (proto._getConsoleProcessList as (this: unknown) => Promise<number[]>).call({ _innerPid: 77 })
      expect(result).toEqual([77])
    } finally {
      proto._getConsoleProcessList = original
    }
  })
})
