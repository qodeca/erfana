// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'events'
import type { spawn } from 'child_process'

vi.mock('./LoggingService', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import {
  buildReapScript,
  MAX_SWEEPS,
  powershellEnv,
  powershellPath,
  QUIT_GRACE_SEC,
  QUIT_TRACE_ENV,
  SHELL_SPAWN_TOLERANCE_MS,
  startConptyHostReaper
} from './conptyHostReaper'

function fakeChild(): EventEmitter & { kill: ReturnType<typeof vi.fn>; unref: ReturnType<typeof vi.fn> } {
  return Object.assign(new EventEmitter(), { kill: vi.fn(), unref: vi.fn() })
}

describe('buildReapScript', () => {
  it('matches hosts and the passed shells that are our children, inside the creation window', () => {
    const script = buildReapScript(4242, 1_000, 2_000, [
      { pid: 9001, spawnedAtMs: 1_500 },
      { pid: 9002, spawnedAtMs: 1_600 },
      { pid: 9001, spawnedAtMs: 1_500 }
    ])
    expect(script).toContain('$app = 4242')
    expect(script).toContain("$hosts = @('conhost.exe', 'OpenConsole.exe')")
    // duplicates dropped; spawn times as .NET ticks (ms * 10000 + the Unix epoch)
    expect(script).toContain('$shells = @{ 9001 = 621355968015000000; 9002 = 621355968016000000 }')
    expect(script).toContain('FromUnixTimeMilliseconds(1000)')
    expect(script).toContain('FromUnixTimeMilliseconds(2000)')
    // the end of the creation window is the quit moment + 250 ms, nothing more
    expect(script).toContain('FromUnixTimeMilliseconds(2250)')
    expect(script).toContain('if ($pp -eq $app -and $c -le $e.Ticks) {')
    expect(script).toContain('.UtcDateTime')
    expect(script).not.toContain('LocalDateTime')
    expect(script).toContain('-OperationTimeoutSec 5')
    // a shell counts only near its spawn time
    expect(SHELL_SPAWN_TOLERANCE_MS).toBe(5_000)
    expect(script).toContain('$mine = $d -le 50000000 -and $d -ge -50000000')
    // a descendant must be no older than the member it hangs below
    expect(script).toContain('$known[$pp].T -le $c')
    // ended only through a handle opened at kill time, after its start time matched
    expect(script).toContain('$h | Stop-Process -Force')
    expect(script).not.toContain('Stop-Process -Id')
    // a process without a handle is not pinned and never ended
    expect(script).toContain('if ($null -ne $h.Handle) {')
    expect(script.indexOf('if ($null -ne $h.Handle) {')).toBeLessThan(script.indexOf('$st = $h.StartTime'))
  })

  it('has no double quotes or backslashes, so the command line needs no escaping', () => {
    const script = buildReapScript(4242, 1_000, 2_000, [{ pid: 9001, spawnedAtMs: 1_500 }])
    expect(script).not.toMatch(/["\\]/)
  })

  it('stops before listing or ending anything when a date could not be built (Constrained Language Mode)', () => {
    const script = buildReapScript(4242, 1_000, 2_000)
    const guard = script.indexOf("if (-not $s -or -not $q -or -not $e) { Trace 'helper stopped: dates unavailable'; exit }")
    expect(guard).toBeGreaterThan(script.indexOf('$e ='))
    expect(guard).toBeLessThan(script.indexOf('Get-Process'))
    expect(guard).toBeLessThan(script.indexOf('$null = Tree @(Snap)'))
    expect(guard).toBeLessThan(script.indexOf('Stop-Process'))
  })

  it('waits for our process, and ends it only when still alive and started before the quit moment', () => {
    const script = buildReapScript(4242, 1_000, 2_000)
    expect(QUIT_GRACE_SEC).toBe(15)
    expect(script).toContain(`$until = (Get-Date).AddSeconds(${QUIT_GRACE_SEC})`)
    expect(buildReapScript(4242, 1_000, 2_000, [], 3)).toContain('$until = (Get-Date).AddSeconds(3)')
    expect(script).toContain('$p | Wait-Process -Timeout 1')
    // the force-end uses the checked process object (no pid re-lookup), guarded by the
    // start-time check, and runs before the sweeps
    const stop = script.indexOf('$p | Stop-Process -Force')
    expect(stop).toBeGreaterThan(-1)
    expect(script).toContain('if ($p.HasExited)')
    // the handle is held before the start time is read, so both refer to this process
    expect(script).toContain('if ($null -ne $p.Handle) { $st = $p.StartTime }')
    // a listing error during the wait does not end the wait
    expect(script).toContain('try { $null = Tree @(Snap) } catch { }')
    // the "seen alive" time is taken before the query
    expect(script.indexOf('$script:snapAt =')).toBeLessThan(script.indexOf('Get-CimInstance'))
    expect(script.indexOf('$st.ToUniversalTime() -gt $q')).toBeLessThan(stop)
    expect(stop).toBeLessThan(script.indexOf(`for ($i = 1; $i -le ${MAX_SWEEPS}; $i++)`))
  })

  it('writes its trace only through the path in the environment', () => {
    const script = buildReapScript(4242, 1_000, 2_000)
    expect(script).toContain(`$tr = $env:${QUIT_TRACE_ENV}`)
    expect(script).toContain('Add-Content -LiteralPath $tr')
    // error ids only, never messages
    expect(script).toContain('FullyQualifiedErrorId')
    expect(script).not.toContain('Exception.Message')
  })

  it('refuses values that are not positive integers', () => {
    expect(() => buildReapScript(NaN, 1, 2)).toThrow()
    expect(() => buildReapScript(1.5, 1, 2)).toThrow()
    expect(() => buildReapScript(0, 1, 2)).toThrow()
    expect(() => buildReapScript(1, 1, 2, [{ pid: 0, spawnedAtMs: 1 }])).toThrow()
    expect(() => buildReapScript(1, 1, 2, [{ pid: 1, spawnedAtMs: 1.5 }])).toThrow()
    expect(() => buildReapScript(1, 1, 2, [], 0)).toThrow()
    // @ts-expect-error a string must never reach the script
    expect(() => buildReapScript("1' ; calc ; '", 1, 2)).toThrow()
    // @ts-expect-error nor as a shell pid
    expect(() => buildReapScript(1, 1, 2, [{ pid: "1' ; calc ; '", spawnedAtMs: 1 }])).toThrow()
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

  it('adds the trace path only when it is absolute', () => {
    expect(powershellEnv({}, 'C:\\Users\\a\\.erfana\\logs\\quit-cleanup.log')[QUIT_TRACE_ENV]).toBe(
      'C:\\Users\\a\\.erfana\\logs\\quit-cleanup.log'
    )
    expect(powershellEnv({}, 'logs\\quit-cleanup.log')).not.toHaveProperty(QUIT_TRACE_ENV)
    expect(powershellEnv({})).not.toHaveProperty(QUIT_TRACE_ENV)
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
    expect(script).toContain('$app = 777')
    // start = now - uptime (no margin before our start); end = now + 250 ms rounding only
    expect(script).toContain('FromUnixTimeMilliseconds(99940000)')
    expect(script).toContain('FromUnixTimeMilliseconds(100000000)')
    expect(script).toContain('FromUnixTimeMilliseconds(100000250)')
    expect(opts).toMatchObject({ windowsHide: true, detached: true, stdio: 'ignore' })
    expect(Object.keys(opts.env as object).sort()).toEqual(['PSModulePath', 'SystemRoot', 'windir'])
    expect(child.unref).toHaveBeenCalled()
  })

  it('passes the live shells and the trace path, and starts the trace before the helper', () => {
    const child = fakeChild()
    const order: string[] = []
    const spawnFn = vi.fn(() => {
      order.push('spawn')
      return child
    })
    const writeFileFn = vi.fn(() => order.push('write'))
    const appendFileFn = vi.fn()
    const tracePath = 'C:\\Users\\a\\.erfana\\logs\\quit-cleanup.log'
    startConptyHostReaper({
      platform: 'win32',
      pid: 777,
      now: () => 100_000_000,
      uptimeSeconds: () => 60,
      shells: [
        { pid: 9001, spawnedAtMs: 99_000_000 },
        { pid: -1, spawnedAtMs: 99_000_000 },
        { pid: 9003, spawnedAtMs: 1.5 },
        { pid: 9002, spawnedAtMs: 99_000_000 }
      ],
      tracePath,
      spawnFn: spawnFn as unknown as typeof spawn,
      writeFileFn: writeFileFn as never,
      appendFileFn: appendFileFn as never
    })
    expect(order).toEqual(['write', 'spawn'])
    const [file, text] = writeFileFn.mock.calls[0] as unknown as [string, string]
    expect(file).toBe(tracePath)
    // pids and counts only
    expect(text).toMatch(/^\S+ app starting quit helper app-pid=777 shells=2\n$/)
    const [, args, opts] = spawnFn.mock.calls[0] as unknown as [string, string[], { env: Record<string, string> }]
    expect(args[args.length - 1]).toMatch(/\$shells = @\{ 9001 = \d+; 9002 = \d+ \}/)
    expect(opts.env[QUIT_TRACE_ENV]).toBe(tracePath)
  })

  it('records a helper that exits while the app is still running (it should wait for the app)', async () => {
    const { logger } = await import('./LoggingService')
    const child = fakeChild()
    const appendFileFn = vi.fn()
    startConptyHostReaper({
      platform: 'win32',
      tracePath: 'C:\\logs\\quit-cleanup.log',
      spawnFn: vi.fn(() => child) as unknown as typeof spawn,
      writeFileFn: vi.fn() as never,
      appendFileFn: appendFileFn as never
    })
    child.emit('exit', 1)
    expect(logger.warn).toHaveBeenCalledWith('Quit cleanup helper exited before the app', { code: 1 })
    expect(appendFileFn.mock.calls[0][1]).toMatch(/app: quit helper exited before the app code=1\n$/)
  })

  it('writes no trace for a relative path, and a failing trace write does not stop the helper', () => {
    const writeFileFn = vi.fn()
    startConptyHostReaper({
      platform: 'win32',
      tracePath: 'logs\\quit-cleanup.log',
      spawnFn: vi.fn(() => fakeChild()) as unknown as typeof spawn,
      writeFileFn: writeFileFn as never
    })
    expect(writeFileFn).not.toHaveBeenCalled()

    const spawnFn = vi.fn(() => fakeChild())
    const started = startConptyHostReaper({
      platform: 'win32',
      tracePath: 'C:\\logs\\quit-cleanup.log',
      spawnFn: spawnFn as unknown as typeof spawn,
      writeFileFn: vi.fn(() => {
        throw new Error('EACCES')
      }) as never
    })
    expect(started).toBe(true)
    expect(spawnFn).toHaveBeenCalledTimes(1)
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
