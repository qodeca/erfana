// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preview emitter tests (Issue #74, item 43).
 *
 * Covers: a destroyed target receives no send; every payload is re-validated
 * against its schema before send (an invalid one is dropped + logged); and
 * `failuresChanged` is coalesced (rapid calls collapse to one trailing send with
 * the latest snapshot). A fake target and an injected `scheduleFlush` make the
 * coalescing deterministic without fake timers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ErrorCode } from '../../../shared/errors'
import { PreviewEvents } from '../../../shared/ipc/preview-channels'
import type { PreviewFailureInput } from '../../../shared/ipc/preview-types'
import { createPreviewEmitters, type PreviewEmitTarget } from './emit'

const mockLoggerWarn = vi.fn()
vi.mock('../../services/LoggingService', () => ({
  logger: { warn: (...a: unknown[]) => mockLoggerWarn(...a), error: vi.fn(), info: vi.fn() }
}))

interface FakeTarget extends PreviewEmitTarget {
  isDestroyed: () => boolean
  send: ReturnType<typeof vi.fn>
}

function makeTarget(destroyed = false): FakeTarget {
  return { isDestroyed: () => destroyed, send: vi.fn() }
}

const FAILURE: PreviewFailureInput = {
  type: 'blocked-host',
  resourceUrlOrHost: 'cdn.example.com',
  reasonCode: ErrorCode.UNKNOWN_ERROR
}

beforeEach(() => {
  mockLoggerWarn.mockClear()
})

describe('createPreviewEmitters', () => {
  it('does not send to a destroyed target', () => {
    const target = makeTarget(true)
    const emit = createPreviewEmitters({ resolveTargets: () => [target] })

    emit.hostBlocked('panel-1', 'cdn.example.com', true, ['script'], false)

    expect(target.send).not.toHaveBeenCalled()
  })

  it('sends a valid payload to a live target on the right channel', () => {
    const target = makeTarget(false)
    const emit = createPreviewEmitters({ resolveTargets: () => [target] })

    emit.hostBlocked('panel-1', 'cdn.example.com', true, ['script'], false)

    expect(target.send).toHaveBeenCalledTimes(1)
    expect(target.send).toHaveBeenCalledWith(PreviewEvents.HOST_BLOCKED, {
      panelId: 'panel-1',
      host: 'cdn.example.com',
      approvable: true,
      kinds: ['script'],
      truncated: false
    })
  })

  it('re-validates and drops a malformed payload (empty panelId)', () => {
    const target = makeTarget(false)
    const emit = createPreviewEmitters({ resolveTargets: () => [target] })

    emit.hostBlocked('', 'cdn.example.com', true, ['script'], false)

    expect(target.send).not.toHaveBeenCalled()
    expect(mockLoggerWarn).toHaveBeenCalledTimes(1)
  })

  it('re-validates loadStateChanged and drops an out-of-enum state', () => {
    const target = makeTarget(false)
    const emit = createPreviewEmitters({ resolveTargets: () => [target] })

    // Force an invalid state past the type system to exercise the schema tripwire.
    emit.loadStateChanged('panel-1', 'bogus' as 'idle', 0)

    expect(target.send).not.toHaveBeenCalled()
    expect(mockLoggerWarn).toHaveBeenCalledTimes(1)
  })

  it('coalesces failuresChanged: two calls → one trailing send with the latest', () => {
    const target = makeTarget(false)
    let captured: (() => void) | null = null
    const emit = createPreviewEmitters({
      resolveTargets: () => [target],
      scheduleFlush: (flush) => {
        captured = flush
      }
    })

    emit.failuresChanged('panel-1', [FAILURE], false)
    emit.failuresChanged('panel-1', [FAILURE, FAILURE], true)

    // Nothing sent until the scheduled flush runs.
    expect(target.send).not.toHaveBeenCalled()
    expect(captured).not.toBeNull()

    captured!()

    expect(target.send).toHaveBeenCalledTimes(1)
    const [channel, payload] = target.send.mock.calls[0]
    expect(channel).toBe(PreviewEvents.FAILURES_CHANGED)
    expect(payload).toMatchObject({ panelId: 'panel-1', truncated: true })
    expect((payload as { failures: unknown[] }).failures).toHaveLength(2)
  })

  it('schedules exactly one flush across a burst for the same panel', () => {
    const scheduleFlush = vi.fn()
    const emit = createPreviewEmitters({ resolveTargets: () => [makeTarget()], scheduleFlush })

    emit.failuresChanged('panel-1', [FAILURE], false)
    emit.failuresChanged('panel-1', [FAILURE], false)
    emit.failuresChanged('panel-1', [FAILURE], false)

    expect(scheduleFlush).toHaveBeenCalledTimes(1)
  })

  it('dispose() cancels a pending coalesced flush', () => {
    const target = makeTarget(false)
    let captured: (() => void) | null = null
    const emit = createPreviewEmitters({
      resolveTargets: () => [target],
      scheduleFlush: (flush) => {
        captured = flush
      }
    })

    emit.failuresChanged('panel-1', [FAILURE], false)
    emit.dispose()
    captured!()

    expect(target.send).not.toHaveBeenCalled()
  })

  it('adds a schema-valid id + timestamp to each forwarded failure', () => {
    const target = makeTarget(false)
    let captured: (() => void) | null = null
    const emit = createPreviewEmitters({
      resolveTargets: () => [target],
      now: () => 1234,
      scheduleFlush: (flush) => {
        captured = flush
      }
    })

    emit.failuresChanged('panel-1', [FAILURE], false)
    captured!()

    const payload = target.send.mock.calls[0][1] as {
      failures: { id: string; timestamp: number }[]
    }
    expect(payload.failures[0].id).toMatch(/\d+/)
    expect(payload.failures[0].timestamp).toBe(1234)
  })
})
