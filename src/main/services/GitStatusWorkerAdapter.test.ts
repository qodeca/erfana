// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for GitStatusWorkerAdapter
 * ==================================
 * These tests cover the adapter's message-passing contract with the worker thread
 * and focus on regression scenarios related to the persistent-cache bug fix:
 *
 * BUG FIXED: git-status.worker.ts had a module-level `statusCache` Map that
 * accumulated V8 heap objects across polling cycles, causing a V8 thread-safety
 * assertion crash after ~42 minutes. The fix passes `cache: {}` per call.
 *
 * Key regressions guarded here:
 * - The adapter does not accumulate per-project state between calls
 * - Worker lifecycle (lazy creation, reuse, teardown) is correct
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GIT_STATUS } from '../../shared/constants'

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------
// vi.mock is hoisted before imports. The `instances` array must live outside
// the factory so tests can access the workers created during each test.
// We use vi.hoisted() to initialise the array before the hoisted mock factory runs.

const instances = vi.hoisted(() => {
   
  const arr: any[] = []
  return arr
})

vi.mock('worker_threads', async () => {
  const { EventEmitter } = await import('events')

  class MockWorker extends EventEmitter {
    postMessage = vi.fn()
    terminate = vi.fn().mockResolvedValue(0)

    constructor(_path: string) {
      super()
      instances.push(this)
    }
  }

  return { Worker: MockWorker }
})

// Mock LoggingService to suppress noise in test output.
vi.mock('./LoggingService', () => ({
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { GitStatusWorkerAdapter } from './GitStatusWorkerAdapter'
import type { GitStatusResponse } from '../../shared/ipc/git-schema'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockWorkerInstance = {
  postMessage: ReturnType<typeof vi.fn>
  terminate: ReturnType<typeof vi.fn>
  emit: (event: string, ...args: unknown[]) => boolean
}

function makeResponse(overrides?: Partial<GitStatusResponse>): GitStatusResponse {
  return {
    isGitRepo: true,
    branch: 'main',
    isDetached: false,
    files: [],
    counts: { modified: 0, untracked: 0, deleted: 0, staged: 0, conflicted: 0 },
    truncated: false,
    ...overrides,
  }
}

function replyWithResult(worker: MockWorkerInstance, id: number, data: GitStatusResponse): void {
  worker.emit('message', { type: 'result', id, data })
}

function replyWithError(worker: MockWorkerInstance, id: number, error: string): void {
  worker.emit('message', { type: 'error', id, error })
}


function currentWorker(): MockWorkerInstance {
  return instances[instances.length - 1] as MockWorkerInstance
}

// ---------------------------------------------------------------------------

describe('GitStatusWorkerAdapter', () => {
  let adapter: GitStatusWorkerAdapter

  beforeEach(() => {
    vi.clearAllMocks()
    instances.length = 0
    adapter = new GitStatusWorkerAdapter()
  })

  afterEach(async () => {
    // Clean up any hanging adapter state – ignore errors from already-disposed adapters.
    await adapter.dispose().catch(() => undefined)
  })

  // -------------------------------------------------------------------------
  describe('worker lifecycle', () => {
    it('creates no worker thread before the first execute() call', () => {
      expect(instances).toHaveLength(0)
    })

    it('creates a worker thread lazily on first execute()', async () => {
      const p = adapter.execute({ projectPath: '/project', strategy: 'isomorphic-git' })
      expect(instances).toHaveLength(1)
      replyWithResult(currentWorker(), 1, makeResponse())
      await p
    })

    it('reuses the same worker thread across multiple execute() calls', async () => {
      const p1 = adapter.execute({ projectPath: '/project', strategy: 'isomorphic-git' })
      replyWithResult(currentWorker(), 1, makeResponse())
      await p1

      const p2 = adapter.execute({ projectPath: '/project', strategy: 'isomorphic-git' })
      replyWithResult(currentWorker(), 2, makeResponse())
      await p2

      expect(instances).toHaveLength(1)
    })

    it('isAlive() returns false before any execute() call', () => {
      expect(adapter.isAlive()).toBe(false)
    })

    it('isAlive() returns true after worker is created', async () => {
      const p = adapter.execute({ projectPath: '/project', strategy: 'isomorphic-git' })
      replyWithResult(currentWorker(), 1, makeResponse())
      await p
      expect(adapter.isAlive()).toBe(true)
    })

    it('isAlive() returns false after dispose()', async () => {
      const p = adapter.execute({ projectPath: '/project', strategy: 'isomorphic-git' })
      replyWithResult(currentWorker(), 1, makeResponse())
      await p

      await adapter.dispose()

      expect(adapter.isAlive()).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  describe('execute() message routing', () => {
    it('posts a message with type "execute" and the correct projectPath', async () => {
      const p = adapter.execute({ projectPath: '/my/project', strategy: 'isomorphic-git' })
      replyWithResult(currentWorker(), 1, makeResponse())
      await p

      expect(currentWorker().postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'execute',
          projectPath: '/my/project',
          strategy: 'isomorphic-git',
        })
      )
    })

    it('uses incrementing request IDs so concurrent requests get distinct IDs', () => {
      adapter.execute({ projectPath: '/a', strategy: 'isomorphic-git' })
      adapter.execute({ projectPath: '/b', strategy: 'native-git' })

      const calls = currentWorker().postMessage.mock.calls
      const id1 = calls[0][0].id as number
      const id2 = calls[1][0].id as number

      expect(id2).toBe(id1 + 1)
    })

    it('resolves with the data from the worker result message', async () => {
      const expected = makeResponse({ branch: 'feature/test' })
      const p = adapter.execute({ projectPath: '/project', strategy: 'isomorphic-git' })
      replyWithResult(currentWorker(), 1, expected)
      const result = await p
      expect(result).toBe(expected)
    })

    it('rejects when the worker posts an error message', async () => {
      const p = adapter.execute({ projectPath: '/project', strategy: 'isomorphic-git' })
      replyWithError(currentWorker(), 1, 'Invalid project path')
      await expect(p).rejects.toThrow('Invalid project path')
    })

    it('routes concurrent requests to the correct pending entry by ID', async () => {
      const response1 = makeResponse({ branch: 'one' })
      const response2 = makeResponse({ branch: 'two' })

      const p1 = adapter.execute({ projectPath: '/a', strategy: 'isomorphic-git' })
      const p2 = adapter.execute({ projectPath: '/b', strategy: 'isomorphic-git' })

      // Reply out of order – id=2 first, then id=1
      replyWithResult(currentWorker(), 2, response2)
      replyWithResult(currentWorker(), 1, response1)

      const [r1, r2] = await Promise.all([p1, p2])
      expect(r1).toBe(response1)
      expect(r2).toBe(response2)
    })
  })

  // -------------------------------------------------------------------------
  describe('stateless execution – regression against persistent cache', () => {
    /**
     * The original bug: a module-level `statusCache` Map accumulated heap
     * objects per project across every poll cycle, eventually crashing V8.
     *
     * The fix: `git.statusMatrix` now receives a fresh `cache: {}` each call.
     * These tests verify the adapter does NOT pass any per-project caching data
     * in its postMessage calls, so no state can accumulate at the adapter level.
     */

    it('does not include any "cache" field in execute messages sent to the worker', async () => {
      const p = adapter.execute({ projectPath: '/project', strategy: 'isomorphic-git' })
      replyWithResult(currentWorker(), 1, makeResponse())
      await p

      const sentMessage = currentWorker().postMessage.mock.calls[0][0]
      expect(sentMessage).not.toHaveProperty('cache')
    })

    it('sends structurally identical messages for the same path on consecutive calls', async () => {
      const p1 = adapter.execute({ projectPath: '/shared', strategy: 'isomorphic-git' })
      replyWithResult(currentWorker(), 1, makeResponse({ branch: 'first' }))
      await p1

      const p2 = adapter.execute({ projectPath: '/shared', strategy: 'isomorphic-git' })
      replyWithResult(currentWorker(), 2, makeResponse({ branch: 'second' }))
      await p2

      const call1 = currentWorker().postMessage.mock.calls[0][0]
      const call2 = currentWorker().postMessage.mock.calls[1][0]

      // Strategy and path must be identical; only the request id changes.
      expect(call1.strategy).toBe(call2.strategy)
      expect(call1.projectPath).toBe(call2.projectPath)
      expect(call1.id).not.toBe(call2.id)
      // No extra fields should appear between calls.
      expect(Object.keys(call2).sort()).toEqual(['id', 'projectPath', 'strategy', 'type'])
    })

    it('does not accumulate entries in the internal pending Map after requests complete', async () => {
      const p1 = adapter.execute({ projectPath: '/a', strategy: 'isomorphic-git' })
      const p2 = adapter.execute({ projectPath: '/b', strategy: 'isomorphic-git' })

      replyWithResult(currentWorker(), 1, makeResponse())
      replyWithResult(currentWorker(), 2, makeResponse())
      await Promise.all([p1, p2])

      const adapterInternal = adapter as unknown as { pending: Map<number, unknown> }
      expect(adapterInternal.pending.size).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  describe('error and crash recovery', () => {
    it('rejects all pending requests when the worker emits an error event', async () => {
      const p1 = adapter.execute({ projectPath: '/a', strategy: 'isomorphic-git' })
      const p2 = adapter.execute({ projectPath: '/b', strategy: 'isomorphic-git' })

      currentWorker().emit('error', new Error('Worker crashed'))

      await expect(p1).rejects.toThrow('Worker crashed')
      await expect(p2).rejects.toThrow('Worker crashed')
    })

    it('rejects all pending requests when the worker exits with a non-zero code', async () => {
      const p1 = adapter.execute({ projectPath: '/a', strategy: 'isomorphic-git' })
      const p2 = adapter.execute({ projectPath: '/b', strategy: 'isomorphic-git' })

      currentWorker().emit('exit', 1)

      await expect(p1).rejects.toThrow('Worker exited with code 1')
      await expect(p2).rejects.toThrow('Worker exited with code 1')
    })

    it('sets isAlive() to false after a non-zero exit code', async () => {
      const p = adapter.execute({ projectPath: '/project', strategy: 'isomorphic-git' })
      currentWorker().emit('exit', 1)
      await expect(p).rejects.toThrow()
      expect(adapter.isAlive()).toBe(false)
    })

    it('creates a new worker on the next execute() after a crash', async () => {
      // First execute: worker created, then crashes.
      const p1 = adapter.execute({ projectPath: '/project', strategy: 'isomorphic-git' })
      // Grab id of the first request before crash clears state.
      const firstId = (currentWorker().postMessage.mock.calls[0][0] as { id: number }).id
      currentWorker().emit('exit', 1)
      await expect(p1).rejects.toThrow()

      // Second execute: adapter must create a brand-new worker.
      const p2 = adapter.execute({ projectPath: '/project', strategy: 'isomorphic-git' })
      // The second worker is instances[1]; the request id increments from firstId.
      const secondId = (instances[1].postMessage.mock.calls[0][0] as { id: number }).id
      expect(secondId).toBe(firstId + 1)
      replyWithResult(instances[1] as MockWorkerInstance, secondId, makeResponse())
      const result = await p2

      expect(instances).toHaveLength(2)
      expect(result.branch).toBe('main')
    })

    it('times out and rejects when the worker never responds', async () => {
      vi.useFakeTimers()

      const p = adapter.execute({ projectPath: '/project', strategy: 'isomorphic-git' })

      vi.advanceTimersByTime(GIT_STATUS.WORKER_REQUEST_TIMEOUT + 100)

      await expect(p).rejects.toThrow(/timed out/)

      vi.useRealTimers()
    })
  })

  // -------------------------------------------------------------------------
  describe('dispose()', () => {
    it('terminates the worker thread', async () => {
      const execP = adapter.execute({ projectPath: '/project', strategy: 'isomorphic-git' })
      replyWithResult(currentWorker(), 1, makeResponse())
      await execP

      const w = currentWorker()
      await adapter.dispose()

      expect(w.terminate).toHaveBeenCalledOnce()
    })

    it('is safe to call multiple times without throwing', async () => {
      const execP = adapter.execute({ projectPath: '/project', strategy: 'isomorphic-git' })
      replyWithResult(currentWorker(), 1, makeResponse())
      await execP

      await adapter.dispose()

      // Second dispose: worker is already null, should be a no-op.
      await expect(adapter.dispose()).resolves.toBeUndefined()
    })

    it('is safe to call when no worker was ever created', async () => {
      await expect(adapter.dispose()).resolves.toBeUndefined()
      expect(instances).toHaveLength(0)
    })
  })
})
