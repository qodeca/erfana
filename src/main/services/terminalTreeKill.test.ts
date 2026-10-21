// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'events'
import { join } from 'path'

vi.mock('./LoggingService', () => ({
  logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }
}))

import { TREE_KILL_TIMEOUT_MS, killProcessTree, taskkillPath } from './terminalTreeKill'

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

  it('taskkillPath is under SystemRoot\\System32 and falls back to windir', () => {
    expect(taskkillPath({ SystemRoot: 'SR' })).toBe(join('SR', 'System32', 'taskkill.exe'))
    expect(taskkillPath({ windir: 'WD' })).toBe(join('WD', 'System32', 'taskkill.exe'))
  })

  it('starts a hidden, detached tree kill for the pid and does not wait for it', () => {
    const child = fakeChild()
    const spawnFn = vi.fn(() => child)
    expect(killProcessTree(4321, spawnFn as never)).toBe(true)
    expect(spawnFn).toHaveBeenCalledTimes(1)
    const [file, args, options] = spawnFn.mock.calls[0] as unknown as [string, string[], Record<string, unknown>]
    expect(file).toBe(taskkillPath())
    expect(args).toEqual(['/PID', '4321', '/T', '/F'])
    expect(options).toMatchObject({ windowsHide: true, detached: true, stdio: 'ignore' })
    expect(child.unref).toHaveBeenCalled()
  })

  it.each([undefined, 0, -5, 1.5, Number.NaN])('refuses pid %s', (pid) => {
    const spawnFn = vi.fn()
    expect(killProcessTree(pid as number | undefined, spawnFn as never)).toBe(false)
    expect(spawnFn).not.toHaveBeenCalled()
  })

  it('stops a tree kill that has not finished after the timeout', () => {
    const child = fakeChild()
    killProcessTree(10, vi.fn(() => child) as never)
    vi.advanceTimersByTime(TREE_KILL_TIMEOUT_MS - 1)
    expect(child.kill).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(child.kill).toHaveBeenCalledTimes(1)
  })

  it('leaves the timeout alone once taskkill has exited', () => {
    const child = fakeChild()
    killProcessTree(10, vi.fn(() => child) as never)
    child.emit('exit', 0)
    vi.advanceTimersByTime(TREE_KILL_TIMEOUT_MS * 2)
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('never throws when taskkill cannot be started', () => {
    const throwing = vi.fn(() => {
      throw new Error('ENOENT')
    })
    expect(killProcessTree(10, throwing as never)).toBe(false)

    const child = fakeChild()
    expect(killProcessTree(10, vi.fn(() => child) as never)).toBe(true)
    expect(() => child.emit('error', new Error('spawn failed'))).not.toThrow()
  })
})
