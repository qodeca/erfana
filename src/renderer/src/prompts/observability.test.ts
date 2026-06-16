// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for prompt execution observability
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  setTracingEnabled,
  isTracingEnabled,
  setMaxTraceHistory,
  setMaxTraceAge,
  getMaxTraceAge,
  cleanupOldTraces,
  startTrace,
  getTraceHistory,
  getTracesForPrompt,
  getExecutionMetrics,
  clearTraceHistory,
  getRecentFailures
} from './observability'
import { ErrorCode } from '../../../shared/errors'

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn()
  }
}))

vi.mock('../utils/logger', () => ({ logger: mockLogger }))

describe('observability', () => {
  beforeEach(() => {
    clearTraceHistory()
    setTracingEnabled(false)
    setMaxTraceHistory(100) // Reset to default
    setMaxTraceAge(60 * 60 * 1000) // Reset to default (1 hour)
  })

  afterEach(() => {
    clearTraceHistory()
    setTracingEnabled(false)
    setMaxTraceHistory(100) // Reset to default
    setMaxTraceAge(60 * 60 * 1000) // Reset to default (1 hour)
  })

  describe('setTracingEnabled() / isTracingEnabled()', () => {
    it('should be disabled by default', () => {
      expect(isTracingEnabled()).toBe(false)
    })

    it('should enable tracing', () => {
      setTracingEnabled(true)
      expect(isTracingEnabled()).toBe(true)
    })

    it('should disable tracing', () => {
      setTracingEnabled(true)
      setTracingEnabled(false)
      expect(isTracingEnabled()).toBe(false)
    })

    it('should log when enabling tracing', () => {
      mockLogger.info.mockClear()
      setTracingEnabled(true)
      expect(mockLogger.info).toHaveBeenCalledWith('Prompt execution tracing enabled')
    })
  })

  describe('startTrace()', () => {
    it('should create a trace with unique ID', () => {
      const trace1 = startTrace('test-prompt')
      const trace2 = startTrace('test-prompt')

      expect(trace1.id).toBeDefined()
      expect(trace2.id).toBeDefined()
      expect(trace1.id).not.toBe(trace2.id)
    })

    it('should record successful execution', () => {
      const trace = startTrace('explain')
      trace.success()

      const history = getTraceHistory()
      expect(history).toHaveLength(1)
      expect(history[0].promptId).toBe('explain')
      expect(history[0].success).toBe(true)
      expect(history[0].duration).toBeDefined()
      expect(history[0].duration).toBeGreaterThanOrEqual(0)
    })

    it('should record failed execution', () => {
      const trace = startTrace('modify')
      trace.failure({ message: 'Something went wrong' })

      const history = getTraceHistory()
      expect(history).toHaveLength(1)
      expect(history[0].promptId).toBe('modify')
      expect(history[0].success).toBe(false)
      expect(history[0].errorMessage).toBe('Something went wrong')
    })

    it('should record error code on failure', () => {
      const trace = startTrace('ask')
      trace.failure({ code: ErrorCode.PROMPT_TERMINAL_TIMEOUT, message: 'Timeout' })

      const history = getTraceHistory()
      expect(history[0].errorCode).toBe(ErrorCode.PROMPT_TERMINAL_TIMEOUT)
    })

    it('should include metadata', () => {
      const trace = startTrace('explain', { userId: '123' })
      trace.success({ resultSize: 500 })

      const history = getTraceHistory()
      expect(history[0].metadata).toEqual({ userId: '123', resultSize: 500 })
    })

    it('should log when tracing is enabled', () => {
      setTracingEnabled(true)
      mockLogger.info.mockClear()

      const trace = startTrace('explain')
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Starting execution: explain'))

      trace.success()
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Execution succeeded: explain'))
    })

    it('should log failures when tracing is enabled', () => {
      setTracingEnabled(true)
      mockLogger.info.mockClear()

      const trace = startTrace('modify')
      trace.failure({ message: 'Failed!' })

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Execution failed: modify'))
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Failed!'))
    })

    it('should not log when tracing is disabled', () => {
      setTracingEnabled(false)
      mockLogger.info.mockClear()

      const trace = startTrace('explain')
      trace.success()

      expect(mockLogger.info).not.toHaveBeenCalled()
    })
  })

  describe('setMaxTraceHistory()', () => {
    it('should limit trace history', () => {
      setMaxTraceHistory(3)

      for (let i = 0; i < 5; i++) {
        const trace = startTrace(`prompt-${i}`)
        trace.success()
      }

      const history = getTraceHistory()
      expect(history).toHaveLength(3)
      // Should keep the most recent
      expect(history[0].promptId).toBe('prompt-2')
      expect(history[2].promptId).toBe('prompt-4')
    })

    it('should trim existing history when limit is reduced', () => {
      for (let i = 0; i < 10; i++) {
        const trace = startTrace(`prompt-${i}`)
        trace.success()
      }

      expect(getTraceHistory()).toHaveLength(10)

      setMaxTraceHistory(5)
      expect(getTraceHistory()).toHaveLength(5)
    })
  })

  describe('getTraceHistory()', () => {
    it('should return empty array when no traces', () => {
      expect(getTraceHistory()).toEqual([])
    })

    it('should return all traces', () => {
      startTrace('prompt-1').success()
      startTrace('prompt-2').failure({ message: 'Error' })
      startTrace('prompt-3').success()

      expect(getTraceHistory()).toHaveLength(3)
    })

    it('should return a copy (not reference)', () => {
      startTrace('test').success()
      const history = getTraceHistory()
      history.push({} as never)

      expect(getTraceHistory()).toHaveLength(1)
    })
  })

  describe('getTracesForPrompt()', () => {
    it('should filter traces by prompt ID', () => {
      startTrace('explain').success()
      startTrace('modify').success()
      startTrace('explain').failure({ message: 'Error' })
      startTrace('ask').success()

      const explainTraces = getTracesForPrompt('explain')
      expect(explainTraces).toHaveLength(2)
      expect(explainTraces.every(t => t.promptId === 'explain')).toBe(true)
    })

    it('should return empty array for unknown prompt', () => {
      startTrace('explain').success()

      expect(getTracesForPrompt('unknown')).toEqual([])
    })
  })

  describe('getExecutionMetrics()', () => {
    it('should return zero metrics when no traces', () => {
      const metrics = getExecutionMetrics()

      expect(metrics.totalExecutions).toBe(0)
      expect(metrics.successfulExecutions).toBe(0)
      expect(metrics.failedExecutions).toBe(0)
      expect(metrics.successRate).toBe(0)
      expect(metrics.averageExecutionTime).toBe(0)
    })

    it('should calculate total executions', () => {
      startTrace('a').success()
      startTrace('b').success()
      startTrace('c').failure({ message: 'Error' })

      const metrics = getExecutionMetrics()
      expect(metrics.totalExecutions).toBe(3)
    })

    it('should calculate success/failure counts', () => {
      startTrace('a').success()
      startTrace('b').success()
      startTrace('c').failure({ message: 'Error' })

      const metrics = getExecutionMetrics()
      expect(metrics.successfulExecutions).toBe(2)
      expect(metrics.failedExecutions).toBe(1)
    })

    it('should calculate success rate', () => {
      startTrace('a').success()
      startTrace('b').success()
      startTrace('c').success()
      startTrace('d').failure({ message: 'Error' })

      const metrics = getExecutionMetrics()
      expect(metrics.successRate).toBe(0.75)
    })

    it('should calculate execution times', async () => {
      const trace1 = startTrace('a')
      await new Promise(r => setTimeout(r, 10))
      trace1.success()

      const trace2 = startTrace('b')
      await new Promise(r => setTimeout(r, 20))
      trace2.success()

      const metrics = getExecutionMetrics()
      expect(metrics.averageExecutionTime).toBeGreaterThan(0)
      expect(metrics.minExecutionTime).toBeGreaterThan(0)
      expect(metrics.maxExecutionTime).toBeGreaterThan(0)
      expect(metrics.maxExecutionTime).toBeGreaterThanOrEqual(metrics.minExecutionTime)
    })

    it('should aggregate by prompt ID', () => {
      startTrace('explain').success()
      startTrace('explain').success()
      startTrace('modify').failure({ message: 'Error' })

      const metrics = getExecutionMetrics()

      expect(metrics.byPromptId['explain']).toEqual({
        total: 2,
        successful: 2,
        failed: 0,
        averageTime: expect.any(Number)
      })

      expect(metrics.byPromptId['modify']).toEqual({
        total: 1,
        successful: 0,
        failed: 1,
        averageTime: expect.any(Number)
      })
    })

    it('should aggregate failures by error code', () => {
      startTrace('a').failure({ code: ErrorCode.PROMPT_TERMINAL_TIMEOUT, message: 'Timeout' })
      startTrace('b').failure({ code: ErrorCode.PROMPT_TERMINAL_TIMEOUT, message: 'Timeout' })
      startTrace('c').failure({ code: ErrorCode.PROMPT_SEND_FAILED, message: 'Failed' })
      startTrace('d').failure({ message: 'Unknown' })

      const metrics = getExecutionMetrics()

      expect(metrics.failuresByErrorCode[ErrorCode.PROMPT_TERMINAL_TIMEOUT]).toBe(2)
      expect(metrics.failuresByErrorCode[ErrorCode.PROMPT_SEND_FAILED]).toBe(1)
      expect(metrics.failuresByErrorCode['UNKNOWN']).toBe(1)
    })
  })

  describe('clearTraceHistory()', () => {
    it('should clear all traces', () => {
      startTrace('a').success()
      startTrace('b').success()

      expect(getTraceHistory()).toHaveLength(2)

      clearTraceHistory()

      expect(getTraceHistory()).toHaveLength(0)
    })

    it('should log when tracing is enabled', () => {
      setTracingEnabled(true)
      mockLogger.info.mockClear()

      clearTraceHistory()

      expect(mockLogger.info).toHaveBeenCalledWith('Trace history cleared')
    })
  })

  describe('getRecentFailures()', () => {
    it('should return recent failures', () => {
      startTrace('a').success()
      startTrace('b').failure({ message: 'Error 1' })
      startTrace('c').success()
      startTrace('d').failure({ message: 'Error 2' })

      const failures = getRecentFailures()

      expect(failures).toHaveLength(2)
      expect(failures[0].errorMessage).toBe('Error 1')
      expect(failures[1].errorMessage).toBe('Error 2')
    })

    it('should limit results', () => {
      for (let i = 0; i < 20; i++) {
        startTrace(`prompt-${i}`).failure({ message: `Error ${i}` })
      }

      const failures = getRecentFailures(5)
      expect(failures).toHaveLength(5)
      // Should be the most recent
      expect(failures[0].errorMessage).toBe('Error 15')
    })

    it('should return empty array when no failures', () => {
      startTrace('a').success()
      startTrace('b').success()

      expect(getRecentFailures()).toEqual([])
    })
  })

  describe('setMaxTraceAge() / getMaxTraceAge()', () => {
    it('should have default of 1 hour', () => {
      expect(getMaxTraceAge()).toBe(60 * 60 * 1000)
    })

    it('should set max trace age', () => {
      setMaxTraceAge(30 * 60 * 1000) // 30 minutes
      expect(getMaxTraceAge()).toBe(30 * 60 * 1000)
    })
  })

  describe('cleanupOldTraces()', () => {
    it('should remove traces older than max age', () => {
      // Create a trace with an old startTime by manipulating Date.now
      const originalNow = Date.now
      let mockTime = 1000000

      // Override Date.now for startTrace
      Date.now = () => mockTime

      // Create old trace
      startTrace('old-prompt').success()

      // Move time forward by 2 hours
      mockTime += 2 * 60 * 60 * 1000

      // Create new trace
      startTrace('new-prompt').success()

      // Restore Date.now
      Date.now = originalNow

      expect(getTraceHistory()).toHaveLength(2)

      // Cleanup with 1 hour max age (default)
      // Need to set time mock for cleanup too
      Date.now = () => mockTime
      const removed = cleanupOldTraces()
      Date.now = originalNow

      expect(removed).toBe(1)
      expect(getTraceHistory()).toHaveLength(1)
      expect(getTraceHistory()[0].promptId).toBe('new-prompt')
    })

    it('should return 0 when no old traces', () => {
      startTrace('prompt-1').success()
      startTrace('prompt-2').success()

      const removed = cleanupOldTraces()
      expect(removed).toBe(0)
      expect(getTraceHistory()).toHaveLength(2)
    })

    it('should handle empty history', () => {
      const removed = cleanupOldTraces()
      expect(removed).toBe(0)
    })

    it('should log when tracing is enabled', () => {
      // Create old trace
      const originalNow = Date.now
      let mockTime = 1000000
      Date.now = () => mockTime

      startTrace('old').success()
      mockTime += 2 * 60 * 60 * 1000

      setTracingEnabled(true)
      mockLogger.info.mockClear()

      Date.now = () => mockTime
      cleanupOldTraces()
      Date.now = originalNow

      expect(mockLogger.info).toHaveBeenCalledWith('Cleaned up 1 old traces')
    })

    it('should respect custom max age setting', () => {
      const originalNow = Date.now
      let mockTime = 1000000
      Date.now = () => mockTime

      // Create trace
      startTrace('prompt').success()

      // Move time forward by 10 minutes
      mockTime += 10 * 60 * 1000

      // Set max age to 5 minutes
      setMaxTraceAge(5 * 60 * 1000)

      // Cleanup should remove the trace
      Date.now = () => mockTime
      const removed = cleanupOldTraces()
      Date.now = originalNow

      expect(removed).toBe(1)
      expect(getTraceHistory()).toHaveLength(0)
    })
  })
})
