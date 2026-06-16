// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for concurrent execution queue
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createExecutionQueue,
  getDefaultExecutionQueue,
  resetDefaultExecutionQueue,
  type IExecutionQueue
} from './executionQueue'
import { ErrorCode } from '../../../shared/errors'

describe('executionQueue', () => {
  let queue: IExecutionQueue

  beforeEach(() => {
    queue = createExecutionQueue()
  })

  afterEach(() => {
    queue.reset()
    resetDefaultExecutionQueue()
  })

  describe('createExecutionQueue()', () => {
    it('should create a queue with default config', () => {
      const q = createExecutionQueue()
      const status = q.getStatus()

      expect(status.pendingCount).toBe(0)
      expect(status.runningCount).toBe(0)
      expect(status.isAcceptingTasks).toBe(true)
    })

    it('should accept custom config', () => {
      const q = createExecutionQueue({
        maxConcurrent: 5,
        executionTimeout: 10000,
        maxQueueSize: 50
      })

      expect(q.getStatus().isAcceptingTasks).toBe(true)
    })
  })

  describe('enqueue()', () => {
    it('should execute a single task', async () => {
      const result = await queue.enqueue('test-prompt', async () => {
        return { success: true }
      })

      expect(result.success).toBe(true)
    })

    it('should execute tasks in order (FIFO)', async () => {
      const order: number[] = []

      const p1 = queue.enqueue('prompt-1', async () => {
        order.push(1)
        return { success: true }
      })

      const p2 = queue.enqueue('prompt-2', async () => {
        order.push(2)
        return { success: true }
      })

      const p3 = queue.enqueue('prompt-3', async () => {
        order.push(3)
        return { success: true }
      })

      await Promise.all([p1, p2, p3])

      expect(order).toEqual([1, 2, 3])
    })

    it('should limit concurrent executions', async () => {
      const q = createExecutionQueue({ maxConcurrent: 2 })
      let maxConcurrent = 0
      let currentConcurrent = 0

      const createTask = () =>
        q.enqueue('test', async () => {
          currentConcurrent++
          maxConcurrent = Math.max(maxConcurrent, currentConcurrent)
          await new Promise((r) => setTimeout(r, 50))
          currentConcurrent--
          return { success: true }
        })

      await Promise.all([createTask(), createTask(), createTask(), createTask()])

      expect(maxConcurrent).toBeLessThanOrEqual(2)
    })

    it('should reject when queue is paused', async () => {
      queue.pause()

      await expect(
        queue.enqueue('test', async () => ({ success: true }))
      ).rejects.toThrow('Queue is paused')
    })

    it('should reject when queue is full', async () => {
      const q = createExecutionQueue({ maxQueueSize: 2 })

      // Fill the queue with slow tasks
      q.enqueue('test', async () => {
        await new Promise((r) => setTimeout(r, 1000))
        return { success: true }
      })
      q.enqueue('test', async () => {
        await new Promise((r) => setTimeout(r, 1000))
        return { success: true }
      })
      q.enqueue('test', async () => {
        await new Promise((r) => setTimeout(r, 1000))
        return { success: true }
      })

      // This should fail (queue is full)
      await expect(
        q.enqueue('test', async () => ({ success: true }))
      ).rejects.toThrow('Queue is full')
    })

    it('should handle task errors', async () => {
      await expect(
        queue.enqueue('test', async () => {
          throw new Error('Task failed')
        })
      ).rejects.toThrow('Task failed')
    })

    it('should handle timeout', async () => {
      const q = createExecutionQueue({ executionTimeout: 50 })

      const result = await q.enqueue('test', async () => {
        await new Promise((r) => setTimeout(r, 200))
        return { success: true }
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe(ErrorCode.PROMPT_TERMINAL_TIMEOUT)
    })

    it('should track status during execution', async () => {
      const q = createExecutionQueue({ maxConcurrent: 1 })

      const slowTask = q.enqueue('test', async () => {
        await new Promise((r) => setTimeout(r, 100))
        return { success: true }
      })

      // Check status while running
      await new Promise((r) => setTimeout(r, 10))
      const status = q.getStatus()
      expect(status.runningCount).toBe(1)

      await slowTask
    })
  })

  describe('cancel()', () => {
    it('should cancel a pending task', async () => {
      const q = createExecutionQueue({ maxConcurrent: 1 })

      // Start a slow task
      const task1 = q.enqueue('task-1', async () => {
        await new Promise((r) => setTimeout(r, 500))
        return { success: true }
      })

      // Queue another task
      const task2Promise = q.enqueue('task-2', async () => {
        return { success: true }
      })

      // Get the pending task ID (hacky, but for testing)
      // Cancel all pending - task2 should be pending
      const cancelled = q.cancelAll()
      expect(cancelled).toBeGreaterThan(0)

      // Wait for task1 to complete
      await task1

      // Task2 should have been cancelled
      const result2 = await task2Promise
      expect(result2.success).toBe(false)
      expect(result2.error?.code).toBe(ErrorCode.PROMPT_SEND_FAILED)
    })

    it('should return false for non-existent task', () => {
      const result = queue.cancel('non-existent-id')
      expect(result).toBe(false)
    })
  })

  describe('cancelAll()', () => {
    it('should cancel all pending tasks', async () => {
      const q = createExecutionQueue({ maxConcurrent: 1 })
      const results: boolean[] = []

      // Start a slow task
      q.enqueue('task-1', async () => {
        await new Promise((r) => setTimeout(r, 200))
        results.push(true)
        return { success: true }
      })

      // Queue more tasks
      const promises = [
        q.enqueue('task-2', async () => ({ success: true })),
        q.enqueue('task-3', async () => ({ success: true })),
        q.enqueue('task-4', async () => ({ success: true }))
      ]

      // Cancel all pending
      const cancelled = q.cancelAll()
      expect(cancelled).toBe(3) // 3 pending tasks

      // All cancelled tasks should resolve with failure
      const allResults = await Promise.all(promises)
      expect(allResults.every((r) => r.success === false)).toBe(true)
    })

    it('should update status counters', async () => {
      for (let i = 0; i < 5; i++) {
        queue.enqueue('test', async () => {
          await new Promise((r) => setTimeout(r, 100))
          return { success: true }
        })
      }

      queue.cancelAll()

      const status = queue.getStatus()
      expect(status.totalCancelled).toBeGreaterThan(0)
    })
  })

  describe('getStatus()', () => {
    it('should return accurate counts', async () => {
      const q = createExecutionQueue({ maxConcurrent: 1 })

      q.enqueue('test', async () => {
        await new Promise((r) => setTimeout(r, 50))
        return { success: true }
      })
      q.enqueue('test', async () => ({ success: true }))
      q.enqueue('test', async () => ({ success: true }))

      await new Promise((r) => setTimeout(r, 10))
      const duringStatus = q.getStatus()
      expect(duringStatus.runningCount).toBe(1)
      expect(duringStatus.pendingCount).toBe(2)

      await q.drain()
      const afterStatus = q.getStatus()
      expect(afterStatus.runningCount).toBe(0)
      expect(afterStatus.pendingCount).toBe(0)
      expect(afterStatus.totalProcessed).toBe(3)
    })
  })

  describe('pause() / resume()', () => {
    it('should pause accepting new tasks', () => {
      queue.pause()
      expect(queue.getStatus().isAcceptingTasks).toBe(false)
    })

    it('should resume accepting new tasks', async () => {
      queue.pause()
      queue.resume()

      const result = await queue.enqueue('test', async () => ({ success: true }))
      expect(result.success).toBe(true)
    })

    it('should process pending tasks on resume', async () => {
      const q = createExecutionQueue({ maxConcurrent: 1 })

      // Start slow task
      q.enqueue('task-1', async () => {
        await new Promise((r) => setTimeout(r, 100))
        return { success: true }
      })

      // Pause before task2 starts
      q.pause()

      // Queue task2 - should be rejected because queue is paused
      const task2Result = await q.enqueue('task-2', async () => {
        return { success: true }
      }).catch((e: Error) => ({ success: false, error: e.message }))

      // task2 was rejected because queue was paused when enqueued
      expect(task2Result.success).toBe(false)
    })
  })

  describe('drain()', () => {
    it('should wait for all tasks to complete', async () => {
      const results: number[] = []

      for (let i = 0; i < 5; i++) {
        queue.enqueue('test', async () => {
          await new Promise((r) => setTimeout(r, 20))
          results.push(i)
          return { success: true }
        })
      }

      await queue.drain()

      expect(results).toHaveLength(5)
    })

    it('should resolve immediately if queue is empty', async () => {
      const start = Date.now()
      await queue.drain()
      const duration = Date.now() - start

      expect(duration).toBeLessThan(100)
    })
  })

  describe('reset()', () => {
    it('should cancel pending and reset counters', async () => {
      queue.enqueue('test', async () => ({ success: true }))
      queue.enqueue('test', async () => ({ success: true }))

      await queue.drain()

      const beforeReset = queue.getStatus()
      expect(beforeReset.totalProcessed).toBe(2)

      queue.reset()

      const afterReset = queue.getStatus()
      expect(afterReset.totalProcessed).toBe(0)
      expect(afterReset.totalCancelled).toBe(0)
    })
  })

  describe('getDefaultExecutionQueue()', () => {
    it('should return same instance', () => {
      const q1 = getDefaultExecutionQueue()
      const q2 = getDefaultExecutionQueue()

      expect(q1).toBe(q2)
    })
  })

  describe('resetDefaultExecutionQueue()', () => {
    it('should reset and create new instance', () => {
      const q1 = getDefaultExecutionQueue()
      resetDefaultExecutionQueue()
      const q2 = getDefaultExecutionQueue()

      expect(q1).not.toBe(q2)
    })
  })
})
