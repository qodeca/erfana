// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Prompt Execution Observability
 *
 * Provides optional execution tracing for debugging and monitoring prompt execution.
 * Tracks execution timing, success/failure rates, and provides debugging logs.
 *
 * Usage:
 *   // Enable tracing
 *   setTracingEnabled(true)
 *
 *   // Execute with tracing
 *   const trace = startTrace('my-prompt')
 *   try {
 *     await executePrompt(...)
 *     trace.success()
 *   } catch (error) {
 *     trace.failure(error)
 *   }
 *
 *   // Get metrics
 *   const metrics = getExecutionMetrics()
 */

import { ErrorCode } from '../../../shared/errors'
import { logger } from '../utils/logger'

/**
 * Execution trace data
 */
export interface ExecutionTrace {
  /** Unique trace ID */
  id: string
  /** Prompt template ID */
  promptId: string
  /** Start timestamp */
  startTime: number
  /** End timestamp (set on completion) */
  endTime?: number
  /** Duration in milliseconds */
  duration?: number
  /** Whether execution succeeded */
  success?: boolean
  /** Error code if failed */
  errorCode?: ErrorCode
  /** Error message if failed */
  errorMessage?: string
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Execution metrics summary
 */
export interface ExecutionMetrics {
  /** Total number of executions */
  totalExecutions: number
  /** Number of successful executions */
  successfulExecutions: number
  /** Number of failed executions */
  failedExecutions: number
  /** Success rate (0-1) */
  successRate: number
  /** Average execution time in ms */
  averageExecutionTime: number
  /** Min execution time in ms */
  minExecutionTime: number
  /** Max execution time in ms */
  maxExecutionTime: number
  /** Executions by prompt ID */
  byPromptId: Record<string, {
    total: number
    successful: number
    failed: number
    averageTime: number
  }>
  /** Failures by error code */
  failuresByErrorCode: Record<string, number>
}

/** Configuration */
let tracingEnabled = false
let maxTraceHistory = 100
/** Maximum age of traces to keep (in milliseconds, default 1 hour) */
let maxTraceAgeMs = 60 * 60 * 1000

/** Trace storage */
const traceHistory: ExecutionTrace[] = []

/** Generate unique trace ID */
function generateTraceId(): string {
  return `trace-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

/**
 * Enable or disable tracing
 * @param enabled - Whether tracing should be enabled
 */
export function setTracingEnabled(enabled: boolean): void {
  tracingEnabled = enabled
  if (enabled) {
    logger.info('Prompt execution tracing enabled')
  }
}

/**
 * Check if tracing is enabled
 */
export function isTracingEnabled(): boolean {
  return tracingEnabled
}

/**
 * Set maximum trace history size
 * @param max - Maximum number of traces to keep
 */
export function setMaxTraceHistory(max: number): void {
  maxTraceHistory = max
  // Trim history if needed
  while (traceHistory.length > maxTraceHistory) {
    traceHistory.shift()
  }
}

/**
 * Set maximum trace age
 * @param maxAgeMs - Maximum age in milliseconds (default 1 hour)
 */
export function setMaxTraceAge(maxAgeMs: number): void {
  maxTraceAgeMs = maxAgeMs
}

/**
 * Get current max trace age setting
 */
export function getMaxTraceAge(): number {
  return maxTraceAgeMs
}

/**
 * Cleanup old traces based on age
 * Removes traces older than maxTraceAgeMs.
 * Call periodically or before getExecutionMetrics() for accurate data.
 * @returns Number of traces removed
 */
export function cleanupOldTraces(): number {
  const cutoffTime = Date.now() - maxTraceAgeMs
  const originalLength = traceHistory.length

  // Remove traces older than cutoff (traces are in chronological order)
  let removeCount = 0
  while (traceHistory.length > 0 && traceHistory[0].startTime < cutoffTime) {
    traceHistory.shift()
    removeCount++
  }

  if (tracingEnabled && removeCount > 0) {
    logger.info(`Cleaned up ${removeCount} old traces`)
  }

  return originalLength - traceHistory.length
}

/**
 * Start a new execution trace
 * @param promptId - The prompt template ID being executed
 * @param metadata - Optional additional metadata
 * @returns Trace controller with success/failure methods
 */
export function startTrace(
  promptId: string,
  metadata?: Record<string, unknown>
): {
  id: string
  success: (metadata?: Record<string, unknown>) => void
  failure: (error: Error | { code?: ErrorCode; message?: string }, metadata?: Record<string, unknown>) => void
} {
  const trace: ExecutionTrace = {
    id: generateTraceId(),
    promptId,
    startTime: Date.now(),
    metadata
  }

  if (tracingEnabled) {
    logger.info(`[${trace.id}] Starting execution: ${promptId}`)
  }

  return {
    id: trace.id,
    success: (additionalMetadata?: Record<string, unknown>) => {
      trace.endTime = Date.now()
      trace.duration = trace.endTime - trace.startTime
      trace.success = true
      if (additionalMetadata) {
        trace.metadata = { ...trace.metadata, ...additionalMetadata }
      }

      if (tracingEnabled) {
        logger.info(`[${trace.id}] Execution succeeded: ${promptId} (${trace.duration}ms)`)
      }

      // Add to history
      traceHistory.push(trace)
      while (traceHistory.length > maxTraceHistory) {
        traceHistory.shift()
      }
    },
    failure: (error: Error | { code?: ErrorCode; message?: string }, additionalMetadata?: Record<string, unknown>) => {
      trace.endTime = Date.now()
      trace.duration = trace.endTime - trace.startTime
      trace.success = false
      trace.errorCode = 'code' in error ? error.code : undefined
      trace.errorMessage = error.message || 'Unknown error'
      if (additionalMetadata) {
        trace.metadata = { ...trace.metadata, ...additionalMetadata }
      }

      if (tracingEnabled) {
        logger.info(`[${trace.id}] Execution failed: ${promptId} (${trace.duration}ms) - ${trace.errorMessage}`)
      }

      // Add to history
      traceHistory.push(trace)
      while (traceHistory.length > maxTraceHistory) {
        traceHistory.shift()
      }
    }
  }
}

/**
 * Get all execution traces
 * @returns Array of execution traces (most recent last)
 */
export function getTraceHistory(): ExecutionTrace[] {
  return [...traceHistory]
}

/**
 * Get traces for a specific prompt ID
 * @param promptId - The prompt template ID
 * @returns Array of traces for that prompt
 */
export function getTracesForPrompt(promptId: string): ExecutionTrace[] {
  return traceHistory.filter(t => t.promptId === promptId)
}

/**
 * Get execution metrics summary
 * @returns Aggregated metrics across all traces
 */
export function getExecutionMetrics(): ExecutionMetrics {
  const completedTraces = traceHistory.filter(t => t.success !== undefined)

  if (completedTraces.length === 0) {
    return {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      successRate: 0,
      averageExecutionTime: 0,
      minExecutionTime: 0,
      maxExecutionTime: 0,
      byPromptId: {},
      failuresByErrorCode: {}
    }
  }

  const successful = completedTraces.filter(t => t.success)
  const failed = completedTraces.filter(t => !t.success)
  const times = completedTraces.filter(t => t.duration !== undefined).map(t => t.duration!)

  // Aggregate by prompt ID
  const byPromptId: Record<string, { total: number; successful: number; failed: number; averageTime: number }> = {}
  for (const trace of completedTraces) {
    if (!byPromptId[trace.promptId]) {
      byPromptId[trace.promptId] = { total: 0, successful: 0, failed: 0, averageTime: 0 }
    }
    byPromptId[trace.promptId].total++
    if (trace.success) {
      byPromptId[trace.promptId].successful++
    } else {
      byPromptId[trace.promptId].failed++
    }
  }

  // Calculate average times per prompt
  for (const promptId of Object.keys(byPromptId)) {
    const promptTraces = completedTraces.filter(t => t.promptId === promptId && t.duration !== undefined)
    const totalTime = promptTraces.reduce((sum, t) => sum + (t.duration || 0), 0)
    byPromptId[promptId].averageTime = promptTraces.length > 0 ? totalTime / promptTraces.length : 0
  }

  // Aggregate failures by error code
  const failuresByErrorCode: Record<string, number> = {}
  for (const trace of failed) {
    const code = trace.errorCode || 'UNKNOWN'
    failuresByErrorCode[code] = (failuresByErrorCode[code] || 0) + 1
  }

  return {
    totalExecutions: completedTraces.length,
    successfulExecutions: successful.length,
    failedExecutions: failed.length,
    successRate: successful.length / completedTraces.length,
    averageExecutionTime: times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0,
    minExecutionTime: times.length > 0 ? Math.min(...times) : 0,
    maxExecutionTime: times.length > 0 ? Math.max(...times) : 0,
    byPromptId,
    failuresByErrorCode
  }
}

/**
 * Clear all trace history
 */
export function clearTraceHistory(): void {
  traceHistory.length = 0
  if (tracingEnabled) {
    logger.info('Trace history cleared')
  }
}

/**
 * Get recent failures for debugging
 * @param limit - Maximum number of failures to return (default 10)
 * @returns Array of recent failed traces
 */
export function getRecentFailures(limit = 10): ExecutionTrace[] {
  return traceHistory
    .filter(t => t.success === false)
    .slice(-limit)
}
