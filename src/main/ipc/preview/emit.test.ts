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
import type {
  PreviewFailureInput,
  PreviewPageChange,
  PreviewStillFrame
} from '../../../shared/ipc/preview-types'
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

const FRAME: PreviewStillFrame = {
  dataUrl: 'data:image/png;base64,AAAA',
  width: 4,
  height: 4,
  capturedAt: 1
}

/** A move to b.html with Back to a.html (issue #124). */
const PAGE_CHANGE: PreviewPageChange = {
  filePath: '/proj/b.html',
  anchor: null,
  sameDocument: false,
  canGoBack: true,
  canGoForward: false,
  backTarget: { filePath: '/proj/a.html', anchor: null },
  forwardTarget: null,
  generation: 1,
  failed: false
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

  it('sends a resize hold on its own channel, every transition, never coalesced', () => {
    const target = makeTarget(false)
    const emit = createPreviewEmitters({ resolveTargets: () => [target] })

    emit.resizeHold('panel-1', true)
    emit.resizeHold('panel-1', false)

    expect(target.send.mock.calls).toEqual([
      [PreviewEvents.RESIZE_HOLD, { panelId: 'panel-1', held: true }],
      [PreviewEvents.RESIZE_HOLD, { panelId: 'panel-1', held: false }]
    ])
  })

  it('sends a page change, not coalesced, from the gated entry (issue #124)', () => {
    const target = makeTarget(false)
    const emit = createPreviewEmitters({ resolveTargets: () => [target] })

    emit.pageChanged('panel-1', PAGE_CHANGE)
    emit.pageChanged('panel-1', { ...PAGE_CHANGE, anchor: 'pricing', sameDocument: true })

    expect(target.send.mock.calls).toEqual([
      [PreviewEvents.PAGE_CHANGED, { panelId: 'panel-1', ...PAGE_CHANGE }],
      [
        PreviewEvents.PAGE_CHANGED,
        { panelId: 'panel-1', ...PAGE_CHANGE, anchor: 'pricing', sameDocument: true }
      ]
    ])
  })

  it('drops a page change whose anchor is past the contract and logs it', () => {
    const target = makeTarget(false)
    const emit = createPreviewEmitters({ resolveTargets: () => [target] })

    emit.pageChanged('panel-1', { ...PAGE_CHANGE, anchor: 'x'.repeat(1025) })

    expect(target.send).not.toHaveBeenCalled()
    expect(mockLoggerWarn).toHaveBeenCalledTimes(1)
  })

  it('carries a link disposition, and leaves it out when there is none (issue #124)', () => {
    const target = makeTarget(false)
    const emit = createPreviewEmitters({ resolveTargets: () => [target] })

    emit.openFileRequested('panel-1', '/proj/b.html', 'top', undefined, 'by-mode')
    emit.openFileRequested('panel-1', '/proj/c.html', null)

    expect(target.send.mock.calls).toEqual([
      [
        PreviewEvents.OPEN_FILE_REQUESTED,
        {
          sourcePanelId: 'panel-1',
          filePath: '/proj/b.html',
          anchor: 'top',
          disposition: 'by-mode'
        }
      ],
      [
        PreviewEvents.OPEN_FILE_REQUESTED,
        { sourcePanelId: 'panel-1', filePath: '/proj/c.html', anchor: null }
      ]
    ])
  })

  it('re-validates a resize hold and drops a malformed one (empty panelId)', () => {
    const target = makeTarget(false)
    const emit = createPreviewEmitters({ resolveTargets: () => [target] })

    emit.resizeHold('', true)

    expect(target.send).not.toHaveBeenCalled()
    expect(mockLoggerWarn).toHaveBeenCalledTimes(1)
  })

  it('sends a still frame with its CSS size and stale flag when it has them (issue #124)', () => {
    const target = makeTarget(false)
    const emit = createPreviewEmitters({ resolveTargets: () => [target] })

    emit.stillFrameChanged('panel-1', {
      ...FRAME,
      cssWidth: 640.5,
      cssHeight: 480,
      stale: true
    })

    expect(target.send).toHaveBeenCalledWith(PreviewEvents.STILL_FRAME_CHANGED, {
      panelId: 'panel-1',
      ...FRAME,
      cssWidth: 640.5,
      cssHeight: 480,
      stale: true
    })
  })

  it('omits a missing CSS size and a false stale flag, so an older frame is the payload it always was', () => {
    const target = makeTarget(false)
    const emit = createPreviewEmitters({ resolveTargets: () => [target] })

    emit.stillFrameChanged('panel-1', { ...FRAME, stale: false })

    const [channel, payload] = target.send.mock.calls[0]
    expect(channel).toBe(PreviewEvents.STILL_FRAME_CHANGED)
    expect(Object.keys(payload as object).sort()).toEqual([
      'capturedAt',
      'dataUrl',
      'height',
      'panelId',
      'width'
    ])
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
