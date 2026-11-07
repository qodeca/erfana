// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ExecLike } from '../claudeStatus/process/exec'
import {
  parseWin32Processes,
  ProcessSnapshot,
  ProcessSnapshotUnavailable,
  PS_QUERY,
  resolvePowershell,
  sharedProcessSnapshot
} from './processSnapshot'

const ROWS = JSON.stringify([
  { ProcessId: 2000, ParentProcessId: 1, Name: 'pwsh.exe', CommandLine: 'pwsh', StartMs: 10 },
  { ProcessId: 4321, ParentProcessId: 2000, Name: 'claude.exe', CommandLine: 'claude', StartMs: null }
])

/** An exec that never spawns: counts calls and answers from `answer`. */
function fakeExec(answer: () => Promise<string> = async () => ROWS): { exec: ExecLike; calls: Array<{ file: string; args: string[]; cwd?: string }> } {
  const calls: Array<{ file: string; args: string[]; cwd?: string }> = []
  const exec: ExecLike = async (file, args, opts) => {
    calls.push({ file, args, cwd: opts.cwd })
    return { stdout: await answer() }
  }
  return { exec, calls }
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: Error): void } {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('ProcessSnapshot', () => {
  let savedSystemRoot: string | undefined
  let savedWindir: string | undefined

  beforeEach(() => {
    savedSystemRoot = process.env.SystemRoot
    savedWindir = process.env.windir
    process.env.SystemRoot = 'C:\\Windows'
  })

  afterEach(() => {
    if (savedSystemRoot === undefined) delete process.env.SystemRoot
    else process.env.SystemRoot = savedSystemRoot
    if (savedWindir === undefined) delete process.env.windir
    else process.env.windir = savedWindir
  })

  it('runs the static query through System32 PowerShell, pinned to its folder, and parses the rows', async () => {
    const { exec, calls } = fakeExec()
    const snapshot = new ProcessSnapshot(exec, () => 1000)
    const reading = await snapshot.read(10_000)
    expect(reading.takenAtMs).toBe(1000)
    expect(reading.rows.map((r) => r.pid)).toEqual([2000, 4321])
    expect(calls).toEqual([
      {
        file: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        args: ['-NoProfile', '-NonInteractive', '-Command', PS_QUERY],
        cwd: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0'
      }
    ])
  })

  it('reuses a snapshot younger than the limit and queries again at the limit (strictly below)', async () => {
    let now = 1000
    const { exec, calls } = fakeExec()
    const snapshot = new ProcessSnapshot(exec, () => now)
    await snapshot.read(10_000)
    now = 1000 + 9_999
    expect(snapshot.latest(10_000)?.takenAtMs).toBe(1000)
    await snapshot.read(10_000)
    expect(calls).toHaveLength(1)
    now = 1000 + 10_000
    expect(snapshot.latest(10_000)).toBeNull()
    await snapshot.read(10_000)
    expect(calls).toHaveLength(2)
  })

  it('always queries for a limit of 0, even on a still clock', async () => {
    const { exec, calls } = fakeExec()
    const snapshot = new ProcessSnapshot(exec, () => 1000)
    await snapshot.read(0)
    await snapshot.read(0)
    expect(calls).toHaveLength(2)
  })

  it('has no snapshot before the first query and never starts one from latest()', () => {
    const { exec, calls } = fakeExec()
    expect(new ProcessSnapshot(exec).latest(10_000)).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('keeps one query in flight: concurrent readers share it, whatever age they accept', async () => {
    const gate = deferred<string>()
    const { exec, calls } = fakeExec(() => gate.promise)
    const snapshot = new ProcessSnapshot(exec, () => 1000)
    const a = snapshot.read(0)
    const b = snapshot.read(10_000)
    gate.resolve(ROWS)
    expect(await a).toBe(await b)
    expect(calls).toHaveLength(1)
  })

  it('does not keep a failed query: the next read retries', async () => {
    let fail = true
    const { exec, calls } = fakeExec(async () => {
      if (fail) throw new Error('powershell timeout')
      return ROWS
    })
    const snapshot = new ProcessSnapshot(exec, () => 1000)
    await expect(snapshot.read(10_000)).rejects.toThrow('powershell timeout')
    expect(snapshot.latest(10_000)).toBeNull()
    fail = false
    await expect(snapshot.read(10_000)).resolves.toMatchObject({ takenAtMs: 1000 })
    expect(calls).toHaveLength(2)
  })

  it('rejects with ProcessSnapshotUnavailable, without spawning, when %SystemRoot% and %windir% are unset', async () => {
    delete process.env.SystemRoot
    delete process.env.windir
    const { exec, calls } = fakeExec()
    await expect(new ProcessSnapshot(exec).read(10_000)).rejects.toBeInstanceOf(ProcessSnapshotUnavailable)
    expect(calls).toHaveLength(0)
  })

  it('resolves PowerShell off %windir% when %SystemRoot% is unset', () => {
    delete process.env.SystemRoot
    process.env.windir = 'D:\\Win'
    expect(resolvePowershell()).toBe('D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
  })

  it('shares one snapshot across the process', () => {
    expect(sharedProcessSnapshot()).toBe(sharedProcessSnapshot())
  })
})

describe('parseWin32Processes', () => {
  it('drops empty and malformed input', () => {
    expect(parseWin32Processes('  ')).toEqual([])
    expect(parseWin32Processes('{ not json')).toEqual([])
  })

  it('reads a bare object as one row and skips rows without integer pids or that are not objects', () => {
    expect(parseWin32Processes(JSON.stringify({ ProcessId: 1, ParentProcessId: 0, Name: 'a.exe', CommandLine: null }))).toEqual([
      { pid: 1, ppid: 0, name: 'a.exe', commandLine: '' }
    ])
    expect(parseWin32Processes(JSON.stringify([null, 3, { ProcessId: 'x', ParentProcessId: 1 }, { ProcessId: 2, ParentProcessId: 1 }]))).toEqual([
      { pid: 2, ppid: 1, name: '', commandLine: '' }
    ])
  })

  it('keeps a numeric start time and drops null, negative and non-numeric ones', () => {
    const rows = parseWin32Processes(
      JSON.stringify([
        { ProcessId: 1, ParentProcessId: 0, StartMs: 5 },
        { ProcessId: 2, ParentProcessId: 0, StartMs: null },
        { ProcessId: 3, ParentProcessId: 0, StartMs: -1 },
        { ProcessId: 4, ParentProcessId: 0, StartMs: '/Date(5)/' }
      ])
    )
    expect(rows.map((r) => r.startMs)).toEqual([5, undefined, undefined, undefined])
  })
})
