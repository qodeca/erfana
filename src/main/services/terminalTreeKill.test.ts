// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'events'
import { win32 } from 'path'

vi.mock('./LoggingService', () => ({
  logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }
}))

import {
  TREE_KILL_AWAIT_MS,
  TREE_KILL_TIMEOUT_MS,
  killProcessTrees,
  taskkillPath
} from './terminalTreeKill'

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & { kill: ReturnType<typeof vi.fn>; unref: ReturnType<typeof vi.fn> }
  child.kill = vi.fn()
  child.unref = vi.fn()
  return child
}

describe('terminalTreeKill', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  describe('taskkillPath', () => {
    const fallback = win32.join('C:\\Windows', 'System32', 'taskkill.exe')

    it('is under an absolute SystemRoot', () => {
      expect(taskkillPath({ SystemRoot: 'D:\\WinNT' })).toBe(win32.join('D:\\WinNT', 'System32', 'taskkill.exe'))
    })

    it('falls back to windir, then to C:\\Windows', () => {
      expect(taskkillPath({ windir: 'E:\\Win' })).toBe(win32.join('E:\\Win', 'System32', 'taskkill.exe'))
      expect(taskkillPath({})).toBe(fallback)
    })

    it.each(['System', '.\\Windows', '..\\Windows', '', '\\Windows'])(
      'ignores a SystemRoot that is not an absolute drive path (%j)',
      (value) => {
        expect(taskkillPath({ SystemRoot: value })).toBe(fallback)
      }
    )
  })

  it('starts one hidden, detached taskkill for the whole batch, without a shell', () => {
    const child = fakeChild()
    const spawnFn = vi.fn(() => child)
    void killProcessTrees([4321, 77, 9], spawnFn as never)
    expect(spawnFn).toHaveBeenCalledTimes(1)
    const [file, args, options] = spawnFn.mock.calls[0] as unknown as [string, string[], Record<string, unknown>]
    expect(file).toBe(taskkillPath())
    expect(args).toEqual(['/T', '/F', '/PID', '4321', '/PID', '77', '/PID', '9'])
    expect(options).toMatchObject({ windowsHide: true, detached: true, stdio: 'ignore' })
    expect(options).not.toHaveProperty('shell')
    expect(child.unref).toHaveBeenCalled()
  })

  it('drops invalid pids and starts nothing when none are left', async () => {
    const spawnFn = vi.fn(() => fakeChild())
    await expect(killProcessTrees([undefined, 0, -5, 1.5, Number.NaN], spawnFn as never)).resolves.toBe(false)
    expect(spawnFn).not.toHaveBeenCalled()

    void killProcessTrees([undefined, 12, 0], spawnFn as never)
    expect((spawnFn.mock.calls[0] as unknown[])[1]).toEqual(['/T', '/F', '/PID', '12'])
  })

  it('resolves when taskkill exits, before the wait is up', async () => {
    const child = fakeChild()
    const done = killProcessTrees([10], vi.fn(() => child) as never)
    child.emit('exit', 0)
    await expect(done).resolves.toBe(true)
  })

  it('stops waiting after the await bound but leaves taskkill running', async () => {
    const child = fakeChild()
    let settled = false
    const done = killProcessTrees([10], vi.fn(() => child) as never).then((v) => {
      settled = true
      return v
    })
    await vi.advanceTimersByTimeAsync(TREE_KILL_AWAIT_MS - 1)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(done).resolves.toBe(true)
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('stops a tree kill that has not finished after the timeout', async () => {
    const child = fakeChild()
    void killProcessTrees([10], vi.fn(() => child) as never)
    await vi.advanceTimersByTimeAsync(TREE_KILL_TIMEOUT_MS - 1)
    expect(child.kill).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(child.kill).toHaveBeenCalledTimes(1)
  })

  it('leaves the timeout alone once taskkill has exited', async () => {
    const child = fakeChild()
    void killProcessTrees([10], vi.fn(() => child) as never)
    child.emit('exit', 0)
    await vi.advanceTimersByTimeAsync(TREE_KILL_TIMEOUT_MS * 2)
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('never throws or rejects when taskkill cannot be started', async () => {
    const throwing = vi.fn(() => {
      throw new Error('ENOENT')
    })
    await expect(killProcessTrees([10], throwing as never)).resolves.toBe(false)

    const child = fakeChild()
    const done = killProcessTrees([10], vi.fn(() => child) as never)
    child.emit('error', new Error('spawn failed'))
    await expect(done).resolves.toBe(false)
  })
})
