// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

const logger = vi.hoisted(() => ({
  trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn()
}))
vi.mock('./LoggingService', () => ({ logger }))

import { installNoForkConsoleList, readNodePtyVersion, resetShimWarningForTests } from './nodePtyWindowsShim'

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
    expect(installNoForkConsoleList(() => module)).toBe(true)
    const agent = new module.WindowsPtyAgent()
    await expect(agent._getConsoleProcessList()).resolves.toEqual([4242])
    expect(fork).not.toHaveBeenCalled()
  })

  it('is applied to agents created before the install, and twice is the same as once', async () => {
    const { module } = fakeModule()
    const early = new module.WindowsPtyAgent()
    installNoForkConsoleList(() => module)
    const installed = module.WindowsPtyAgent.prototype._getConsoleProcessList
    expect(installNoForkConsoleList(() => module)).toBe(true)
    expect(module.WindowsPtyAgent.prototype._getConsoleProcessList).toBe(installed)
    await expect(early._getConsoleProcessList()).resolves.toEqual([4242])
  })

  it('resolves to an empty list when the agent has no pid yet', async () => {
    const { module } = fakeModule()
    installNoForkConsoleList(() => module)
    const agent = new module.WindowsPtyAgent()
    agent._innerPid = 0
    await expect(agent._getConsoleProcessList()).resolves.toEqual([])
  })

  it.each([
    ['no module', undefined],
    ['no WindowsPtyAgent', {}],
    ['no prototype method', { WindowsPtyAgent: class {} }]
  ])('does nothing and does not crash with %s, and logs once', async (_name, module) => {
    expect(installNoForkConsoleList(() => module)).toBe(false)
    expect(installNoForkConsoleList(() => module)).toBe(false)
    expect(logger.error).toHaveBeenCalledTimes(1)
  })

  it('does not crash when the module cannot be loaded', async () => {
    expect(
      installNoForkConsoleList(() => {
        throw new Error('Cannot find module')
      })
    ).toBe(false)
    expect(logger.error).toHaveBeenCalledTimes(1)
  })

  describe('node-pty version', () => {
    it('reads the installed version, and the lockfile one is the checked 1.1 series', () => {
      expect(readNodePtyVersion()).toMatch(/^1\.1\./)
    })

    it.each(['1.1.0', '1.1.7'])('says nothing for %s', (version) => {
      const { module } = fakeModule()
      expect(installNoForkConsoleList(() => module, () => version)).toBe(true)
      expect(logger.warn).not.toHaveBeenCalled()
    })

    it.each(['1.2.0', '2.0.0', undefined])('installs anyway and warns once, naming the version (%s)', (version) => {
      const first = fakeModule().module
      expect(installNoForkConsoleList(() => first, () => version)).toBe(true)
      const second = fakeModule().module
      expect(installNoForkConsoleList(() => second, () => version)).toBe(true)
      expect(logger.warn).toHaveBeenCalledTimes(1)
      expect(String(logger.warn.mock.calls[0][0])).toContain(version ?? 'unknown')
      expect(logger.error).not.toHaveBeenCalled()
    })
  })

  it('the real loader finds node-pty and replaces the method on the prototype in use', async () => {
    const { createRequire } = await import('module')
    // the same module object node-pty's own code gets from require
    const viaRequire = createRequire(import.meta.url)('node-pty/lib/windowsPtyAgent') as {
      WindowsPtyAgent: { prototype: Record<string, unknown> }
    }
    const proto = viaRequire.WindowsPtyAgent.prototype
    const original = proto._getConsoleProcessList
    expect(typeof original).toBe('function')
    try {
      // no injected loader: this is the production path
      expect(installNoForkConsoleList()).toBe(true)
      expect(logger.error).not.toHaveBeenCalled()
      expect(proto._getConsoleProcessList).not.toBe(original)
      const result = await (proto._getConsoleProcessList as (this: unknown) => Promise<number[]>).call({
        _innerPid: 77
      })
      expect(result).toEqual([77])
    } finally {
      proto._getConsoleProcessList = original
    }
  })

  it('never imports node-pty internals with a bare dynamic import (fails under ESM without an extension)', () => {
    const source = readFileSync(join(__dirname, 'nodePtyWindowsShim.ts'), 'utf8')
    expect(source).not.toMatch(/import\(\s*['"`]node-pty\//)
  })

  const builtBundle = join(process.cwd(), 'out', 'main', 'index.js')
  // A stale bundle (built before the shim source last changed) says nothing about the
  // current code: skip until `npx electron-vite build` has been run again.
  const bundleIsFresh =
    existsSync(builtBundle) &&
    statSync(builtBundle).mtimeMs >= statSync(join(__dirname, 'nodePtyWindowsShim.ts')).mtimeMs
  it.skipIf(!bundleIsFresh)(
    'the built main bundle loads the agent with createRequire, not a bare dynamic import (skipped when out/main is missing or older than nodePtyWindowsShim.ts: run npx electron-vite build)',
    () => {
      const bundle = readFileSync(builtBundle, 'utf8')
      expect(bundle).toContain('node-pty/lib/windowsPtyAgent')
      expect(bundle).not.toMatch(/import\(\s*["'`]node-pty\/lib\/windowsPtyAgent["'`]\s*\)/)
      expect(bundle).toMatch(/createRequire\([^)]*\)\(\s*["'`]node-pty\/lib\/windowsPtyAgent["'`]\s*\)/)
    }
  )
})
