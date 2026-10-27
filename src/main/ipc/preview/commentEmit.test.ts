// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments' events go only to the window that owns the view, and
 * only after their schema (docs/designs/html-preview-comments.md §8; SEC-07,
 * SEC-20).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../shared/errors'
import { PreviewCommentEvents } from '../../../shared/ipc/preview-comment-channels'
import { logger } from '../../services/LoggingService'
import { createPreviewCommentEmitters, issueCodesOf } from './commentEmit'
import type { PreviewEmitTarget } from './emit'

vi.mock('../../services/LoggingService', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

const PANEL = 'html-preview-/p/index.html'

function target(windowId: number | undefined, destroyed = false) {
  const send = vi.fn()
  const value: PreviewEmitTarget = { isDestroyed: () => destroyed, send, ...(windowId === undefined ? {} : { windowId }) }
  return { value, send }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createPreviewCommentEmitters', () => {
  it('SEC-07 sends each event to the owning window only – never to another, an unknown or a destroyed target', () => {
    const own = target(1)
    const other = target(2)
    const anonymous = target(undefined)
    const gone = target(1, true)
    const emit = createPreviewCommentEmitters({ resolveTargets: () => [own.value, other.value, anonymous.value, gone.value] })

    emit.commentsChanged(1, { panelId: PANEL, counts: { open: 1, resolved: 0, attention: 0 } })
    emit.anchorStatus(1, { panelId: PANEL, notVisible: [] })
    emit.modeChanged(1, { panelId: PANEL, on: true, reason: 'shortcut' })
    emit.saveSettled(1, { panelId: PANEL, op: 'reply', threadKey: 't1', ok: false, code: ErrorCode.COMMENT_BLOCK_CHANGED })
    emit.draftOpened(1, {
      panelId: PANEL,
      kind: 'icon',
      point: { x: 1, y: 2 },
      displayPath: 'index.html',
      filePath: '/p/index.html',
      frame: false,
      fileKey: 'f1',
      threadKeys: ['t1'],
      blockKeys: []
    })

    expect(own.send.mock.calls.map(([channel]) => channel)).toEqual([
      PreviewCommentEvents.COMMENTS_CHANGED,
      PreviewCommentEvents.ANCHOR_STATUS,
      PreviewCommentEvents.MODE_CHANGED,
      PreviewCommentEvents.SAVE_SETTLED,
      PreviewCommentEvents.DRAFT_OPENED
    ])
    for (const silent of [other, anonymous, gone]) expect(silent.send).not.toHaveBeenCalled()
  })

  it('SEC-20 an event that fails its schema is not sent, and the log carries issue codes only', () => {
    const own = target(1)
    const emit = createPreviewCommentEmitters({ resolveTargets: () => [own.value] })
    emit.modeChanged(1, { panelId: PANEL, on: true, reason: 'secret reason text' as never })
    expect(own.send).not.toHaveBeenCalled()
    const logged = JSON.stringify(vi.mocked(logger.warn).mock.calls)
    expect(logged).toContain('invalid_value')
    expect(logged).not.toContain('secret reason text')
  })

  it('H1 a settle that names no key, or a key of another op, or stays pending is not sent', () => {
    const own = target(1)
    const emit = createPreviewCommentEmitters({ resolveTargets: () => [own.value] })
    emit.saveSettled(1, { panelId: PANEL, op: 'reply', ok: true })
    emit.saveSettled(1, { panelId: PANEL, op: 'add', threadKey: 't1', ok: true })
    emit.saveSettled(1, { panelId: PANEL, op: 'reply', threadKey: 't1', ok: false, code: ErrorCode.COMMENT_SAVE_PENDING })
    expect(own.send).not.toHaveBeenCalled()
  })

  it('a target that throws on send does not stop the rest', () => {
    const throwing = target(1)
    throwing.send.mockImplementation(() => {
      throw new Error('Object has been destroyed')
    })
    const second = target(1)
    const emit = createPreviewCommentEmitters({ resolveTargets: () => [throwing.value, second.value] })
    expect(() => emit.anchorStatus(1, { panelId: PANEL, notVisible: [] })).not.toThrow()
    expect(second.send).toHaveBeenCalledTimes(1)
  })

  describe('§19 Rev 4 owner test – the host takes native focus before a draft opens', () => {
    const DRAFT = {
      panelId: PANEL,
      kind: 'open' as const,
      point: { x: 1, y: 2 },
      displayPath: 'index.html',
      filePath: '/p/index.html',
      frame: false,
      fileKey: 'f1'
    }

    function focusable(windowId: number, destroyed = false) {
      const trail: string[] = []
      const focusHost = vi.fn(() => {
        trail.push('focus')
        return true
      })
      const send = vi.fn((channel: string) => {
        trail.push(channel)
      })
      const value: PreviewEmitTarget = { isDestroyed: () => destroyed, send, windowId, focusHost }
      return { value, send, focusHost, trail }
    }

    it('focuses the owning window BEFORE it sends draftOpened – and no other window', () => {
      const own = focusable(1)
      const other = focusable(2)
      const gone = focusable(1, true)
      const emit = createPreviewCommentEmitters({ resolveTargets: () => [own.value, other.value, gone.value] })
      emit.draftOpened(1, DRAFT)
      expect(own.trail).toEqual(['focus', PreviewCommentEvents.DRAFT_OPENED])
      expect(other.focusHost).not.toHaveBeenCalled()
      expect(gone.focusHost).not.toHaveBeenCalled()
    })

    it('focuses for every draft kind – the menu and a pin thread open over the page too', () => {
      const own = focusable(1)
      const emit = createPreviewCommentEmitters({ resolveTargets: () => [own.value] })
      emit.draftOpened(1, { ...DRAFT, kind: 'menu' })
      emit.draftOpened(1, { ...DRAFT, kind: 'icon', threadKeys: ['t1'], blockKeys: [] })
      expect(own.focusHost).toHaveBeenCalledTimes(2)
    })

    it('moves no focus for the other events, nor for a draft that fails its schema', () => {
      const own = focusable(1)
      const emit = createPreviewCommentEmitters({ resolveTargets: () => [own.value] })
      emit.commentsChanged(1, { panelId: PANEL, counts: { open: 1, resolved: 0, attention: 0 } })
      emit.anchorStatus(1, { panelId: PANEL, notVisible: [] })
      emit.modeChanged(1, { panelId: PANEL, on: true, reason: 'shortcut' })
      emit.draftOpened(1, { ...DRAFT, kind: 'bogus' as never })
      expect(own.focusHost).not.toHaveBeenCalled()
    })

    it('a focus that throws still lets the draft through', () => {
      const own = focusable(1)
      own.focusHost.mockImplementation(() => {
        throw new Error('Object has been destroyed')
      })
      const emit = createPreviewCommentEmitters({ resolveTargets: () => [own.value] })
      expect(() => emit.draftOpened(1, DRAFT)).not.toThrow()
      expect(own.send).toHaveBeenCalledWith(PreviewCommentEvents.DRAFT_OPENED, expect.objectContaining({ kind: 'open' }))
    })
  })

  it('issueCodesOf keeps distinct codes, at most eight', () => {
    const issues = Array.from({ length: 20 }, (_, i) => ({ code: `c${i % 10}` }))
    expect(issueCodesOf({ issues })).toEqual(['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'])
  })
})
