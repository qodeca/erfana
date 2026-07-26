// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Fail-closed unit tests for the REAL {@link runSqliteWorker} (SD-019 #19, FIX 3).
 *
 * These exercise the actual production worker-spawn function — not an injected
 * `runWorker` collaborator — by handing it an injectable Worker factory that
 * returns a fake, crashing worker. This covers the paths the orchestrator's
 * fail-closed exit-code contract depends on but that the collaborator-injected
 * orchestrator tests cannot reach: timeout, worker `error`, non-zero `exit`, and
 * a clean `exit` (code 0) that posted no result (FIX 6).
 *
 * Mirrors the EventEmitter-backed mock-worker pattern in
 * `GitStatusWorkerAdapter.test.ts` (~:275-333).
 *
 * @see specs/designs/sd-019-native-dep-spike.md §5
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import type { Worker } from 'worker_threads'
import { runSqliteWorker, WORKER_TIMEOUT_MS, type SqliteWorkerFactory } from './nativeDepsSmoke'

/** Minimal Worker stand-in: an EventEmitter with the two methods runSqliteWorker calls. */
class FakeWorker extends EventEmitter {
  postMessage = vi.fn()
  terminate = vi.fn().mockResolvedValue(0)
}

/** Build a factory that captures the FakeWorker it hands to runSqliteWorker. */
function fakeWorkerFactory(): { factory: SqliteWorkerFactory; get: () => FakeWorker } {
  let created: FakeWorker | undefined
  const factory: SqliteWorkerFactory = () => {
    created = new FakeWorker()
    return created as unknown as Worker
  }
  return { factory, get: () => created as FakeWorker }
}

describe('runSqliteWorker (real fail-closed spawn path)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('rejects when the worker emits an error event', async () => {
    const { factory, get } = fakeWorkerFactory()
    const p = runSqliteWorker(factory)
    get().emit('error', new Error('worker blew up'))

    await expect(p).rejects.toThrow('worker blew up')
    expect(get().terminate).toHaveBeenCalledOnce()
  })

  it('rejects when the worker exits with a non-zero code', async () => {
    const { factory, get } = fakeWorkerFactory()
    const p = runSqliteWorker(factory)
    get().emit('exit', 7)

    await expect(p).rejects.toThrow('sqlite smoke worker exited with code 7')
    expect(get().terminate).toHaveBeenCalledOnce()
  })

  it('rejects when the worker exits cleanly (code 0) without posting a result (FIX 6)', async () => {
    const { factory, get } = fakeWorkerFactory()
    const p = runSqliteWorker(factory)
    get().emit('exit', 0)

    await expect(p).rejects.toThrow('sqlite smoke worker exited before posting a result')
  })

  it('rejects when the worker never responds within the timeout', async () => {
    vi.useFakeTimers()
    const { factory, get } = fakeWorkerFactory()
    const p = runSqliteWorker(factory)
    // Nothing is emitted — advance past the hard ceiling to trip the timer.
    vi.advanceTimersByTime(WORKER_TIMEOUT_MS + 100)

    await expect(p).rejects.toThrow(/timed out/)
    expect(get().terminate).toHaveBeenCalledOnce()
  })

  it('resolves with the worker result and ignores the subsequent terminate-driven exit', async () => {
    const { factory, get } = fakeWorkerFactory()
    const p = runSqliteWorker(factory)
    get().emit('message', {
      type: 'result',
      ok: true,
      token: 'ERFANA_SQLITE_SMOKE_OK',
      checks: [{ name: 'sqlite:load', passed: true }],
      loadedBinaryPath: '/fake/prebuilds/darwin-arm64.node',
    })
    // A real Worker fires `exit` after we terminate() — it must be a no-op here.
    get().emit('exit', 0)

    const result = await p
    expect(result.ok).toBe(true)
    expect(result.token).toBe('ERFANA_SQLITE_SMOKE_OK')
  })
})
