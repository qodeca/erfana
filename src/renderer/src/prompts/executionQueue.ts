// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Concurrent Execution Queue
 *
 * Manages prompt execution to prevent race conditions when multiple
 * prompts are triggered simultaneously or in quick succession.
 *
 * Features:
 * - Queue-based execution (FIFO)
 * - Configurable concurrency limit
 * - Execution timeout handling
 * - Queue status inspection
 * - Cancel support
 *
 * Usage:
 *   const queue = createExecutionQueue()
 *   const result = await queue.enqueue('my-prompt', async () => {
 *     return await executePrompt(...)
 *   })
 */

import type { PromptResult } from '../utils/panelUtils'
import { AppError, ErrorCode } from '../../../shared/errors'

/**
 * Queued task item
 */
interface QueuedTask {
  /** Unique task ID */
  id: string
  /** Prompt ID being executed */
  promptId: string
  /** The task to execute */
  execute: () => Promise<PromptResult>
  /** Resolve function for the enqueue promise */
  resolve: (result: PromptResult) => void
  /** Reject function for the enqueue promise */
  reject: (error: Error) => void
  /** When the task was enqueued */
  enqueuedAt: number
  /** Task status */
  status: 'pending' | 'running' | 'completed' | 'cancelled'
  /** Timeout timer ID (if timeout configured) */
  timeoutId?: ReturnType<typeof setTimeout>
}

/**
 * Queue configuration
 */
export interface ExecutionQueueConfig {
  /** Maximum concurrent executions (default: 1) */
  maxConcurrent?: number
  /** Execution timeout in ms (default: 30000, 0 = no timeout) */
  executionTimeout?: number
  /** Maximum queue size (default: 100, 0 = unlimited) */
  maxQueueSize?: number
}

/**
 * Queue status info
 */
export interface QueueStatus {
  /** Number of tasks waiting to execute */
  pendingCount: number
  /** Number of currently running tasks */
  runningCount: number
  /** Total tasks processed */
  totalProcessed: number
  /** Total tasks cancelled */
  totalCancelled: number
  /** Whether queue is accepting new tasks */
  isAcceptingTasks: boolean
}

/**
 * Execution queue interface
 */
export interface IExecutionQueue {
  /**
   * Enqueue a task for execution
   * @param promptId - ID of the prompt being executed
   * @param execute - Function that performs the execution
   * @returns Promise resolving to the execution result
   */
  enqueue(promptId: string, execute: () => Promise<PromptResult>): Promise<PromptResult>

  /**
   * Cancel a specific task by ID
   * @param taskId - ID of the task to cancel
   * @returns true if cancelled, false if not found or already completed
   */
  cancel(taskId: string): boolean

  /**
   * Cancel all pending tasks
   * @returns Number of tasks cancelled
   */
  cancelAll(): number

  /**
   * Get current queue status
   */
  getStatus(): QueueStatus

  /**
   * Pause accepting new tasks
   */
  pause(): void

  /**
   * Resume accepting new tasks
   */
  resume(): void

  /**
   * Wait for all current tasks to complete
   */
  drain(): Promise<void>

  /**
   * Reset the queue (clears all tasks and counters)
   */
  reset(): void
}

/**
 * Generate unique task ID
 */
function generateTaskId(): string {
  return `task-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

/**
 * Create an execution queue
 */
export function createExecutionQueue(config: ExecutionQueueConfig = {}): IExecutionQueue {
  const maxConcurrent = config.maxConcurrent ?? 1
  const executionTimeout = config.executionTimeout ?? 30000
  const maxQueueSize = config.maxQueueSize ?? 100

  const pendingQueue: QueuedTask[] = []
  const runningTasks: Map<string, QueuedTask> = new Map()
  let totalProcessed = 0
  let totalCancelled = 0
  let isPaused = false

  /**
   * Process the next task in queue
   */
  function processNext(): void {
    if (isPaused) return
    if (runningTasks.size >= maxConcurrent) return
    if (pendingQueue.length === 0) return

    const task = pendingQueue.shift()!
    task.status = 'running'
    runningTasks.set(task.id, task)

    // Set up timeout if configured
    if (executionTimeout > 0) {
      task.timeoutId = setTimeout(() => {
        if (task.status === 'running') {
          task.status = 'completed'
          runningTasks.delete(task.id)
          totalProcessed++

          const error = new AppError(
            `Execution timed out after ${executionTimeout}ms`,
            ErrorCode.PROMPT_TERMINAL_TIMEOUT
          )
          task.resolve({ success: false, error })

          // Process next
          processNext()
        }
      }, executionTimeout)
    }

    // Execute the task
    task
      .execute()
      .then((result) => {
        if (task.status === 'running') {
          task.status = 'completed'
          if (task.timeoutId) clearTimeout(task.timeoutId)
          runningTasks.delete(task.id)
          totalProcessed++
          task.resolve(result)
        }
      })
      .catch((error) => {
        if (task.status === 'running') {
          task.status = 'completed'
          if (task.timeoutId) clearTimeout(task.timeoutId)
          runningTasks.delete(task.id)
          totalProcessed++
          task.reject(error)
        }
      })
      .finally(() => {
        // Process next task regardless of result
        processNext()
      })

    // Try to process more tasks (if concurrency allows)
    processNext()
  }

  return {
    enqueue(promptId: string, execute: () => Promise<PromptResult>): Promise<PromptResult> {
      return new Promise((resolve, reject) => {
        if (isPaused) {
          reject(new Error('Queue is paused and not accepting new tasks'))
          return
        }

        if (maxQueueSize > 0 && pendingQueue.length >= maxQueueSize) {
          reject(new Error(`Queue is full (max ${maxQueueSize} tasks)`))
          return
        }

        const task: QueuedTask = {
          id: generateTaskId(),
          promptId,
          execute,
          resolve,
          reject,
          enqueuedAt: Date.now(),
          status: 'pending'
        }

        pendingQueue.push(task)
        processNext()
      })
    },

    cancel(taskId: string): boolean {
      // Check pending queue
      const pendingIndex = pendingQueue.findIndex((t) => t.id === taskId)
      if (pendingIndex !== -1) {
        const task = pendingQueue[pendingIndex]
        task.status = 'cancelled'
        pendingQueue.splice(pendingIndex, 1)
        totalCancelled++

        const error = new AppError('Task was cancelled', ErrorCode.PROMPT_SEND_FAILED)
        task.resolve({ success: false, error })
        return true
      }

      // Cannot cancel running tasks (they're already in progress)
      return false
    },

    cancelAll(): number {
      let cancelled = 0
      while (pendingQueue.length > 0) {
        const task = pendingQueue.shift()!
        task.status = 'cancelled'
        totalCancelled++
        cancelled++

        const error = new AppError('Task was cancelled', ErrorCode.PROMPT_SEND_FAILED)
        task.resolve({ success: false, error })
      }
      return cancelled
    },

    getStatus(): QueueStatus {
      return {
        pendingCount: pendingQueue.length,
        runningCount: runningTasks.size,
        totalProcessed,
        totalCancelled,
        isAcceptingTasks: !isPaused
      }
    },

    pause(): void {
      isPaused = true
    },

    resume(): void {
      isPaused = false
      processNext()
    },

    async drain(): Promise<void> {
      // Wait for all running and pending tasks to complete
      while (runningTasks.size > 0 || pendingQueue.length > 0) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    },

    reset(): void {
      // Cancel all pending
      this.cancelAll()

      // Clear running tasks (they'll complete on their own)
      // Just reset counters
      totalProcessed = 0
      totalCancelled = 0
      isPaused = false
    }
  }
}

/** Default queue singleton (lazily initialized) */
let defaultQueue: IExecutionQueue | null = null

/**
 * Get the default execution queue
 */
export function getDefaultExecutionQueue(): IExecutionQueue {
  if (!defaultQueue) {
    defaultQueue = createExecutionQueue()
  }
  return defaultQueue
}

/**
 * Reset the default queue (for testing)
 */
export function resetDefaultExecutionQueue(): void {
  if (defaultQueue) {
    defaultQueue.reset()
  }
  defaultQueue = null
}
