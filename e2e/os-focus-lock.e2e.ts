// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The OS-focus lock the fixtures hold around every app launch
 * (e2e/fixtures/osFocusLock.ts): shared leases run together, an exclusive one
 * runs alone and is not starved, and a dead holder cannot deadlock the run.
 *
 * Launches no app and uses a private lock directory per test, so it neither
 * needs nor takes the suite's real lock – hence the plain Playwright `test`.
 */
import { test, expect } from '@playwright/test'
import { spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { acquireOsFocusLock, isProcessAlive, OS_FOCUS_LOCK_POLL_MS } from './fixtures/osFocusLock'
import { E2E_TEMP_DIR, removeDirWithRetry } from './fixtures/isolation'

/** A PID that belonged to a process which has exited. */
async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
  const pid = child.pid
  if (pid === undefined) throw new Error('could not start a child process')
  await new Promise<void>((resolve) => child.once('exit', () => resolve()))
  await expect.poll(() => isProcessAlive(pid)).toBe(false)
  return pid
}

/**
 * Wait until `pending` has stayed unsettled across three of the lock's polls,
 * so a waiter that should still be blocked has looked at the lock again – an
 * expectation read straight after a release would pass whatever the lock did.
 */
async function expectStillPending(pending: { settled: () => boolean }, what: string): Promise<void> {
  let unsettledReads = 0
  await expect
    .poll(() => (pending.settled() ? -1 : ++unsettledReads), {
      message: `${what} stays pending`,
      intervals: [OS_FOCUS_LOCK_POLL_MS],
      timeout: 20 * OS_FOCUS_LOCK_POLL_MS
    })
    .toBeGreaterThanOrEqual(3)
}

/** Resolves when `p` settles; `settled()` says whether it has. */
function track<T>(p: Promise<T>): { promise: Promise<T>; settled: () => boolean } {
  let done = false
  const promise = p.finally(() => {
    done = true
  })
  return { promise, settled: () => done }
}

test.describe('OS-focus lock', () => {
  let dir: string

  test.beforeEach(async () => {
    await fs.promises.mkdir(E2E_TEMP_DIR, { recursive: true })
    dir = await fs.promises.mkdtemp(path.join(E2E_TEMP_DIR, 'focus-lock-'))
  })

  test.afterEach(async () => {
    await removeDirWithRetry(dir)
  })

  test('should grant shared leases together and hold an exclusive one until they are released', async () => {
    const a = await acquireOsFocusLock('shared', { dir })
    const b = await acquireOsFocusLock('shared', { dir })
    const exclusive = track(acquireOsFocusLock('exclusive', { dir }))

    // The exclusive request has queued (its waiting entry is on disk) but is not granted.
    await expect.poll(() => fs.readdirSync(dir).some((n) => n.startsWith('waiting.'))).toBe(true)
    expect(exclusive.settled()).toBe(false)

    a.release()
    await expectStillPending(exclusive, 'the exclusive request while one shared lease is still held')
    b.release()
    const lease = await exclusive.promise
    expect(lease.mode).toBe('exclusive')
    expect(fs.readdirSync(dir).filter((n) => !n.startsWith('mutex'))).toEqual([
      expect.stringMatching(/^exclusive\./)
    ])
    lease.release()
    expect(fs.readdirSync(dir).filter((n) => !n.startsWith('mutex'))).toEqual([])
  })

  test('should keep a new shared request out while an exclusive one waits', async () => {
    const running = await acquireOsFocusLock('shared', { dir })
    const exclusive = track(acquireOsFocusLock('exclusive', { dir }))
    await expect.poll(() => fs.readdirSync(dir).some((n) => n.startsWith('waiting.'))).toBe(true)

    const lateShared = track(acquireOsFocusLock('shared', { dir }))
    running.release()
    const lease = await exclusive.promise
    expect(lateShared.settled()).toBe(false)

    lease.release()
    ;(await lateShared.promise).release()
  })

  test('should clear a lease left by a process that has exited', async () => {
    const pid = await deadPid()
    fs.writeFileSync(path.join(dir, `exclusive.${Date.now()}.${pid}.00000000-0000-4000-8000-000000000000`), '')

    const lease = await acquireOsFocusLock('exclusive', { dir, waitMs: 5_000 })
    expect(fs.readdirSync(dir).some((n) => n.includes(`.${pid}.`))).toBe(false)
    lease.release()
  })

  test('should clear a waiting entry left by a process that has exited, so shared leases are not blocked', async () => {
    const pid = await deadPid()
    fs.writeFileSync(path.join(dir, `waiting.${Date.now()}.${pid}.00000000-0000-4000-8000-000000000000`), '')

    const lease = await acquireOsFocusLock('shared', { dir, waitMs: 5_000 })
    expect(fs.readdirSync(dir).some((n) => n.includes(`.${pid}.`))).toBe(false)
    lease.release()
  })

  test('should clear a mutex left by a process that has exited', async () => {
    const pid = await deadPid()
    fs.mkdirSync(path.join(dir, 'mutex'))
    fs.writeFileSync(path.join(dir, 'mutex', 'owner'), String(pid))

    const lease = await acquireOsFocusLock('shared', { dir, waitMs: 5_000 })
    lease.release()
    expect(fs.existsSync(path.join(dir, 'mutex'))).toBe(false)
  })

  test('should fail naming the holder, and leave no waiting entry, when the lease does not come in time', async () => {
    const holder = await acquireOsFocusLock('shared', { dir })

    await expect(acquireOsFocusLock('exclusive', { dir, waitMs: 300 })).rejects.toThrow(
      new RegExp(`no exclusive lease within 300 ms \\(holders: shared pid ${process.pid};`)
    )
    expect(fs.readdirSync(dir).some((n) => n.startsWith('waiting.'))).toBe(false)
    holder.release()
  })
})
