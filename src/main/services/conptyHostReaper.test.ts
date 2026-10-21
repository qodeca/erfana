// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'events'
import type { spawn } from 'child_process'

vi.mock('./LoggingService', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { buildReapScript, powershellPath, reapConptyHosts } from './conptyHostReaper'

function fakeChild(): EventEmitter & { kill: ReturnType<typeof vi.fn>; unref: ReturnType<typeof vi.fn> } {
  return Object.assign(new EventEmitter(), { kill: vi.fn(), unref: vi.fn() })
}

describe('buildReapScript', () => {
  it('matches only direct children of our pid, by image name, inside the creation window', () => {
    const script = buildReapScript(4242, 1_000, 2_000)
    expect(script).toContain("-Filter 'ParentProcessId=4242'")
    expect(script).toContain("$_.Name -ieq 'conhost.exe'")
    expect(script).toContain("$_.Name -ieq 'OpenConsole.exe'")
    expect(script).toContain('FromUnixTimeMilliseconds(1000)')
    expect(script).toContain('FromUnixTimeMilliseconds(2000)')
    expect(script).toContain('$_.CreationDate -ge $s -and $_.CreationDate -le $e')
    expect(script).toContain('Stop-Process -Id $_.ProcessId -Force')
  })

  it('refuses values that are not positive integers', () => {
    expect(() => buildReapScript(NaN, 1, 2)).toThrow()
    expect(() => buildReapScript(1.5, 1, 2)).toThrow()
    expect(() => buildReapScript(0, 1, 2)).toThrow()
    // @ts-expect-error a string must never reach the script
    expect(() => buildReapScript("1' ; calc ; '", 1, 2)).toThrow()
  })
})

describe('powershellPath', () => {
  it('is absolute under System32 and ignores a relative SystemRoot', () => {
    expect(powershellPath({ SystemRoot: 'D:\\Win' })).toBe('D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    expect(powershellPath({ SystemRoot: 'relative' })).toBe(
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
    )
  })
})

describe('reapConptyHosts', () => {
  it('does nothing off Windows', async () => {
    const spawnFn = vi.fn()
    await expect(reapConptyHosts({ platform: 'darwin', spawnFn: spawnFn as unknown as typeof spawn })).resolves.toBe(false)
    expect(spawnFn).not.toHaveBeenCalled()
  })

  it('starts one hidden detached PowerShell for our pid and resolves when it exits', async () => {
    const child = fakeChild()
    const spawnFn = vi.fn(() => child)
    const promise = reapConptyHosts({
      platform: 'win32',
      pid: 777,
      now: () => 100_000_000,
      uptimeSeconds: () => 60,
      spawnFn: spawnFn as unknown as typeof spawn,
      awaitMs: 5_000
    })
    child.emit('exit', 0)
    await expect(promise).resolves.toBe(true)
    expect(spawnFn).toHaveBeenCalledTimes(1)
    const [file, args, opts] = spawnFn.mock.calls[0] as unknown as [string, string[], Record<string, unknown>]
    expect(file).toMatch(/powershell\.exe$/i)
    expect(args.slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-NoLogo'])
    expect(args[args.length - 1]).toContain("ParentProcessId=777")
    expect(opts).toMatchObject({ windowsHide: true, detached: true, stdio: 'ignore' })
    expect(child.unref).toHaveBeenCalled()
    // start = now - uptime - slack; end = now + slack
    expect(args[args.length - 1]).toContain('FromUnixTimeMilliseconds(99935000)')
    expect(args[args.length - 1]).toContain('FromUnixTimeMilliseconds(100005000)')
  })

  it('stops waiting after awaitMs without killing the cleanup', async () => {
    vi.useFakeTimers()
    try {
      const child = fakeChild()
      const promise = reapConptyHosts({
        platform: 'win32',
        spawnFn: vi.fn(() => child) as unknown as typeof spawn,
        awaitMs: 300
      })
      await vi.advanceTimersByTimeAsync(300)
      await expect(promise).resolves.toBe(true)
      expect(child.kill).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('resolves false when PowerShell cannot be started, without throwing', async () => {
    const child = fakeChild()
    const promise = reapConptyHosts({
      platform: 'win32',
      spawnFn: vi.fn(() => child) as unknown as typeof spawn
    })
    child.emit('error', new Error('ENOENT'))
    await expect(promise).resolves.toBe(false)

    const throwing = vi.fn(() => {
      throw new Error('boom')
    })
    await expect(reapConptyHosts({ platform: 'win32', spawnFn: throwing as unknown as typeof spawn })).resolves.toBe(false)
  })
})
