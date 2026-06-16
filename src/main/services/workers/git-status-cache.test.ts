// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Regression tests for the persistent-cache bug fix in git-status.worker.ts
 *
 * BUG: The worker had a module-level `statusCache = new Map()` that accumulated
 * V8 heap objects across isomorphic-git polling cycles, eventually causing a
 * V8 thread-safety assertion crash after ~42 minutes.
 *
 * FIX: `git.statusMatrix()` now receives a fresh `cache: {}` on every call.
 *
 * These tests verify:
 * 1. statusMatrix is always called with a plain object `{}`, never with a
 *    persistent reference that could accumulate state.
 * 2. Each invocation of executeIsomorphicGit is independent – no shared cache
 *    object is reused between calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'path'
import os from 'os'

// Platform-safe test project paths (Windows PATH_TRAVERSAL validator rejects
// hardcoded Unix paths like '/test/project'). See #157 for the same pattern
// applied across ~20 main-process test files.
const TEST_PROJECT = path.join(os.tmpdir(), 'erfana-test', 'project')
const TEST_PROJECT_ALPHA = path.join(os.tmpdir(), 'erfana-test', 'project-alpha')
const TEST_PROJECT_BETA = path.join(os.tmpdir(), 'erfana-test', 'project-beta')
const TEST_MY_REPO = path.join(os.tmpdir(), 'erfana-test', 'my', 'repo')
const TEST_REPO = path.join(os.tmpdir(), 'erfana-test', 'repo')
const TEST_NO_GIT_HERE = path.join(os.tmpdir(), 'erfana-test', 'no-git-here')
const TEST_POLL_PROJECT = path.join(os.tmpdir(), 'erfana-test', 'poll-project')

// ---------------------------------------------------------------------------
// Mock setup – vi.mock is hoisted, so all top-level variables used inside
// factories must be initialised with vi.hoisted() first.
// ---------------------------------------------------------------------------

const { mockParentPort, mockStatusMatrix, mockCurrentBranch, mockStat } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EventEmitter } = require('events') as typeof import('events')

  class FakePort extends EventEmitter {
    postMessage = vi.fn()
  }

  return {
    mockParentPort: new FakePort() as InstanceType<typeof FakePort> & { postMessage: ReturnType<typeof vi.fn> },
    mockStatusMatrix: vi.fn(),
    mockCurrentBranch: vi.fn(),
    mockStat: vi.fn(),
  }
})

vi.mock('worker_threads', () => ({
  parentPort: mockParentPort,
}))

vi.mock('isomorphic-git', () => ({
  statusMatrix: mockStatusMatrix,
  currentBranch: mockCurrentBranch,
  resolveRef: vi.fn(),
}))

vi.mock('fs/promises', () => ({
  stat: mockStat,
  // access is used by resolveGitPath – reject for all allowlisted git paths
  // so the native-git strategy falls back to isomorphic-git in relevant tests.
  access: vi.fn().mockRejectedValue(new Error('ENOENT')),
}))

// Import the worker AFTER all mocks are in place.
// This causes the module-level parentPort.on('message', …) to register.
import './git-status.worker'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sendToWorker(msg: object): void {
  mockParentPort.emit('message', msg)
}

/** Settle all pending microtasks (let the worker's async handlers complete). */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function makeMatrix(): Array<[string, number, number, number]> {
  return [
    ['src/modified.ts', 1, 2, 1],
    ['src/new.ts',      0, 2, 0],
  ]
}

function mockGitDirExists(): void {
  mockStat.mockResolvedValue({ isDirectory: () => true, isFile: () => false })
}

function mockGitDirMissing(): void {
  mockStat.mockRejectedValue(new Error('ENOENT: no such file or directory'))
}

// ---------------------------------------------------------------------------

describe('git-status.worker – cache regression', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCurrentBranch.mockResolvedValue('main')
    mockStatusMatrix.mockResolvedValue(makeMatrix())
    mockGitDirExists()
  })

  // -------------------------------------------------------------------------
  describe('fresh cache object per statusMatrix call', () => {
    it('calls git.statusMatrix with a plain object for cache (not a Map or shared ref)', async () => {
      sendToWorker({ type: 'execute', id: 1, projectPath: TEST_PROJECT, strategy: 'isomorphic-git' })
      await flushMicrotasks()

      expect(mockStatusMatrix).toHaveBeenCalledOnce()
      const callArgs = mockStatusMatrix.mock.calls[0][0]
      expect(callArgs).toHaveProperty('cache')
      expect(callArgs.cache).toBeInstanceOf(Object)
      expect(callArgs.cache).not.toBeInstanceOf(Map)
    })

    it('uses a distinct cache object for each consecutive statusMatrix call', async () => {
      sendToWorker({ type: 'execute', id: 1, projectPath: TEST_PROJECT, strategy: 'isomorphic-git' })
      await flushMicrotasks()

      sendToWorker({ type: 'execute', id: 2, projectPath: TEST_PROJECT, strategy: 'isomorphic-git' })
      await flushMicrotasks()

      expect(mockStatusMatrix).toHaveBeenCalledTimes(2)
      const cache1 = mockStatusMatrix.mock.calls[0][0].cache
      const cache2 = mockStatusMatrix.mock.calls[1][0].cache

      // If a persistent cache were reused, this reference check would fail.
      expect(cache1).not.toBe(cache2)
    })

    it('uses a distinct cache object for calls with different project paths', async () => {
      sendToWorker({ type: 'execute', id: 1, projectPath: TEST_PROJECT_ALPHA, strategy: 'isomorphic-git' })
      await flushMicrotasks()

      sendToWorker({ type: 'execute', id: 2, projectPath: TEST_PROJECT_BETA, strategy: 'isomorphic-git' })
      await flushMicrotasks()

      const cache1 = mockStatusMatrix.mock.calls[0][0].cache
      const cache2 = mockStatusMatrix.mock.calls[1][0].cache
      expect(cache1).not.toBe(cache2)
    })

    it('passes the project dir alongside the fresh cache', async () => {
      sendToWorker({ type: 'execute', id: 1, projectPath: TEST_MY_REPO, strategy: 'isomorphic-git' })
      await flushMicrotasks()

      const callArgs = mockStatusMatrix.mock.calls[0][0]
      expect(callArgs).toMatchObject({
        dir: TEST_MY_REPO,
        cache: {},
      })
    })
  })

  // -------------------------------------------------------------------------
  describe('execute results posted back correctly', () => {
    it('posts a result message for a valid isomorphic-git execution', async () => {
      sendToWorker({ type: 'execute', id: 42, projectPath: TEST_REPO, strategy: 'isomorphic-git' })
      await flushMicrotasks()

      expect(mockParentPort.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'result', id: 42 })
      )
    })

    it('posts an error message for a relative (invalid) project path', async () => {
      sendToWorker({ type: 'execute', id: 7, projectPath: 'relative/path', strategy: 'isomorphic-git' })
      await flushMicrotasks()

      expect(mockParentPort.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', id: 7, error: 'Invalid project path' })
      )
      expect(mockStatusMatrix).not.toHaveBeenCalled()
    })

    it('posts an error for a path that normalizes to a different string', async () => {
      // '/a/../b' normalizes to '/b', failing the strict equality check.
      sendToWorker({ type: 'execute', id: 8, projectPath: '/a/../b', strategy: 'isomorphic-git' })
      await flushMicrotasks()

      expect(mockParentPort.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', id: 8, error: 'Invalid project path' })
      )
    })

    it('posts isGitRepo: false when .git directory does not exist', async () => {
      mockGitDirMissing()
      sendToWorker({ type: 'execute', id: 3, projectPath: TEST_NO_GIT_HERE, strategy: 'isomorphic-git' })
      await flushMicrotasks()

      const resultCall = mockParentPort.postMessage.mock.calls.find(
        (c: unknown[]) => (c[0] as { type: string; id: number }).type === 'result' && (c[0] as { type: string; id: number }).id === 3
      )
      expect(resultCall).toBeDefined()
      expect((resultCall![0] as { data: { isGitRepo: boolean } }).data.isGitRepo).toBe(false)
      expect(mockStatusMatrix).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  describe('statusMatrix call count tracks polling cycles (no heap growth)', () => {
    /**
     * The original crash: each polling cycle added entries to a persistent Map.
     * After N cycles the Map contained N * (isomorphic-git internal heap) bytes.
     *
     * With the fix, each call creates a fresh `{}` and the GC can reclaim the
     * previous one. These tests verify exactly one statusMatrix call per execute().
     */

    it('calls statusMatrix exactly once per execute() invocation', async () => {
      sendToWorker({ type: 'execute', id: 1, projectPath: TEST_POLL_PROJECT, strategy: 'isomorphic-git' })
      await flushMicrotasks()

      expect(mockStatusMatrix).toHaveBeenCalledTimes(1)
    })

    it('calls statusMatrix N times for N consecutive execute() invocations', async () => {
      const N = 10
      for (let i = 1; i <= N; i++) {
        sendToWorker({ type: 'execute', id: i, projectPath: TEST_POLL_PROJECT, strategy: 'isomorphic-git' })
        await flushMicrotasks()
      }

      expect(mockStatusMatrix).toHaveBeenCalledTimes(N)
    })

    it('every cache argument across N calls is a distinct plain-object reference', async () => {
      const N = 5
      for (let i = 1; i <= N; i++) {
        sendToWorker({ type: 'execute', id: i, projectPath: TEST_POLL_PROJECT, strategy: 'isomorphic-git' })
        await flushMicrotasks()
      }

      expect(mockStatusMatrix).toHaveBeenCalledTimes(N)
      const caches = mockStatusMatrix.mock.calls.map((c: unknown[]) => (c[0] as { cache: object }).cache)
      const unique = new Set(caches)
      expect(unique.size).toBe(N)
    })
  })
})
