// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'events'
import type { spawn } from 'child_process'

vi.mock('./LoggingService', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import {
  buildReapScript,
  powershellEnv,
  powershellPath,
  QUIT_GRACE_SEC,
  startConptyHostReaper
} from './conptyHostReaper'

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
    // the end of the creation window is the quit moment + 250 ms, nothing more
    expect(script).toContain('FromUnixTimeMilliseconds(2250)')
    expect(script).toContain('$_.CreationDate.ToUniversalTime() -ge $s')
    expect(script).toContain('$_.CreationDate.ToUniversalTime() -le $e')
    expect(script).toContain('.UtcDateTime')
    expect(script).not.toContain('LocalDateTime')
    expect(script).toContain('-OperationTimeoutSec 5')
    expect(script).toContain('Stop-Process -Id $_.ProcessId -Force')
  })

  it('stops before querying when a date could not be built (Constrained Language Mode)', () => {
    const script = buildReapScript(4242, 1_000, 2_000)
    const guard = script.indexOf('if (-not $s -or -not $q -or -not $e) { exit }')
    expect(guard).toBeGreaterThan(script.indexOf('$e ='))
    expect(guard).toBeLessThan(script.indexOf('Get-Process'))
    expect(guard).toBeLessThan(script.indexOf('Get-CimInstance'))
  })

  it('waits for our process, and ends it only when still alive and started before the quit moment', () => {
    const script = buildReapScript(4242, 1_000, 2_000)
    expect(QUIT_GRACE_SEC).toBe(15)
    expect(script).toContain(`$p | Wait-Process -Timeout ${QUIT_GRACE_SEC}`)
    // the force-end uses the checked process object (no pid re-lookup), guarded by the
    // start-time check, and runs before the host query
    const stop = script.indexOf('$p | Stop-Process -Force')
    expect(stop).toBeGreaterThan(-1)
    expect(script).not.toContain('Stop-Process -Id 4242')
    expect(script).toContain('if (-not $p.HasExited)')
    expect(script.indexOf('$p.StartTime.ToUniversalTime() -le $q')).toBeLessThan(stop)
    expect(stop).toBeLessThan(script.indexOf('Get-CimInstance'))
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

describe('powershellEnv', () => {
  it('carries only SystemRoot, windir and a PSModulePath under the validated root', () => {
    expect(powershellEnv({ SystemRoot: 'D:\\Win', PATH: 'x', PSModulePath: 'C:\\evil' })).toEqual({
      SystemRoot: 'D:\\Win',
      windir: 'D:\\Win',
      PSModulePath: 'D:\\Win\\System32\\WindowsPowerShell\\v1.0\\Modules'
    })
  })

  it('falls back to C:\\Windows when SystemRoot is relative', () => {
    expect(powershellEnv({ SystemRoot: 'relative' }).SystemRoot).toBe('C:\\Windows')
  })
})

describe('startConptyHostReaper', () => {
  it('does nothing off Windows', () => {
    const spawnFn = vi.fn()
    expect(startConptyHostReaper({ platform: 'darwin', spawnFn: spawnFn as unknown as typeof spawn })).toBe(false)
    expect(spawnFn).not.toHaveBeenCalled()
  })

  it('starts one hidden detached PowerShell for our pid and returns at once', () => {
    const child = fakeChild()
    const spawnFn = vi.fn(() => child)
    const started = startConptyHostReaper({
      platform: 'win32',
      pid: 777,
      now: () => 100_000_000,
      uptimeSeconds: () => 60,
      spawnFn: spawnFn as unknown as typeof spawn
    })
    expect(started).toBe(true)
    expect(spawnFn).toHaveBeenCalledTimes(1)
    const [file, args, opts] = spawnFn.mock.calls[0] as unknown as [string, string[], Record<string, unknown>]
    expect(file).toMatch(/powershell\.exe$/i)
    expect(args.slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-NoLogo'])
    expect(args).not.toContain('-ExecutionPolicy')
    expect(args).toContain('-Command')
    const script = args[args.length - 1]
    expect(script).toContain('ParentProcessId=777')
    // start = now - uptime (no margin before our start); end = now + 250 ms rounding only
    expect(script).toContain('FromUnixTimeMilliseconds(99940000)')
    expect(script).toContain('FromUnixTimeMilliseconds(100000000)')
    expect(script).toContain('FromUnixTimeMilliseconds(100000250)')
    expect(opts).toMatchObject({ windowsHide: true, detached: true, stdio: 'ignore' })
    expect(Object.keys(opts.env as object).sort()).toEqual(['PSModulePath', 'SystemRoot', 'windir'])
    expect(child.unref).toHaveBeenCalled()
  })

  it('does not throw when PowerShell cannot be started', () => {
    const child = fakeChild()
    expect(
      startConptyHostReaper({ platform: 'win32', spawnFn: vi.fn(() => child) as unknown as typeof spawn })
    ).toBe(true)
    expect(() => child.emit('error', new Error('ENOENT'))).not.toThrow()

    const throwing = vi.fn(() => {
      throw new Error('boom')
    })
    expect(startConptyHostReaper({ platform: 'win32', spawnFn: throwing as unknown as typeof spawn })).toBe(false)
  })
})
