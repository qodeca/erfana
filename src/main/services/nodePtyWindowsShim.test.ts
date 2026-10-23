// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

const logger = vi.hoisted(() => ({
  trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn()
}))
vi.mock('./LoggingService', () => ({ logger }))

import {
  installExitTimeRecorder,
  installNoForkConsoleList,
  nativeExitAtMs,
  readNodePtyVersion,
  releaseConoutWorker,
  resetShimWarningForTests
} from './nodePtyWindowsShim'
import { Worker } from 'worker_threads'

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

describe('installExitTimeRecorder (#305)', () => {
  it('notes when the native exit fires, still calls the original, and wraps only once', () => {
    const original = vi.fn()
    class WindowsPtyAgent {
      _$onProcessExit(code: number): void {
        original(code)
      }
    }
    const load = () => ({ WindowsPtyAgent })
    expect(installExitTimeRecorder(load)).toBe(true)
    const wrapped = WindowsPtyAgent.prototype._$onProcessExit
    expect(installExitTimeRecorder(load)).toBe(true)
    expect(WindowsPtyAgent.prototype._$onProcessExit).toBe(wrapped)

    const agent = new WindowsPtyAgent()
    const terminal = { _agent: agent }
    expect(nativeExitAtMs(terminal)).toBeUndefined()
    const before = Date.now()
    agent._$onProcessExit(3)
    expect(original).toHaveBeenCalledWith(3)
    expect(nativeExitAtMs(terminal)).toBeGreaterThanOrEqual(before)
  })

  it('does nothing when node-pty has no such method, and reads nothing from a non-Windows pty', () => {
    expect(installExitTimeRecorder(() => ({ WindowsPtyAgent: class {} }))).toBe(false)
    expect(installExitTimeRecorder(() => {
      throw new Error('missing')
    })).toBe(false)
    expect(nativeExitAtMs({})).toBeUndefined()
    expect(nativeExitAtMs(undefined)).toBeUndefined()
  })
})

describe('releaseConoutWorker (#305 quit hang)', () => {
  const ptyLib = join(process.cwd(), 'node_modules', 'node-pty', 'lib')

  it('relies on what node-pty 1.1.0 has: one conout Worker per agent, ended only by kill()', () => {
    const agent = readFileSync(join(ptyLib, 'windowsPtyAgent.js'), 'utf8')
    const connection = readFileSync(join(ptyLib, 'windowsConoutConnection.js'), 'utf8')
    expect(agent).toContain('this._conoutSocketWorker = new windowsConoutConnection_1.ConoutConnection(')
    expect(connection).toContain('this._worker = new worker_threads_1.Worker(')
    expect(connection).toContain('this._isDisposed')
    expect(connection).toContain('this._drainTimeout')
    // the only dispose() calls are in kill(); the exit path never ends the worker
    const onExit = agent.slice(agent.indexOf('prototype._$onProcessExit'), agent.indexOf('prototype._flushDataAndCleanUp'))
    expect(onExit).not.toContain('dispose')
    const kill = agent.slice(agent.indexOf('prototype.kill'), agent.indexOf('prototype._getConsoleProcessList'))
    expect(kill).toContain('this._conoutSocketWorker.dispose()')
  })

  it('stops a running worker thread at once and marks the connection disposed', async () => {
    // a worker that never ends by itself, like the conout relay whose server keeps listening
    const worker = new Worker('setInterval(() => {}, 1000)', { eval: true })
    await new Promise<void>((resolve) => worker.once('online', () => resolve()))
    const exited = new Promise<number>((resolve) => worker.once('exit', resolve))
    const drain = setTimeout(() => {}, 60_000)
    const connection: Record<string, unknown> = { _worker: worker, _isDisposed: false, _drainTimeout: drain }
    expect(releaseConoutWorker({ _agent: { _conoutSocketWorker: connection } })).toBe(true)
    expect(connection._isDisposed).toBe(true)
    await expect(exited).resolves.toBe(1)
  })

  it('does nothing for shapes that are not node-pty 1.1.0', () => {
    expect(releaseConoutWorker(undefined)).toBe(false)
    expect(releaseConoutWorker({})).toBe(false)
    expect(releaseConoutWorker({ _agent: {} })).toBe(false)
    expect(releaseConoutWorker({ _agent: { _conoutSocketWorker: { _worker: {} } } })).toBe(false)
    const throwing = { _agent: { _conoutSocketWorker: { _worker: { terminate: () => { throw new Error('gone') } } } } }
    expect(releaseConoutWorker(throwing)).toBe(false)
  })
})
