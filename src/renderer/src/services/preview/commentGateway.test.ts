// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../../shared/errors'
import { installCommentsBridge } from '../../components/Panels/HtmlPreviewPanel/comments/__test-helpers__/commentTestKit'
import { commentGateway } from './commentGateway'

const REFUSED = { ok: false, code: ErrorCode.UNKNOWN_ERROR }

describe('commentGateway', () => {
  let uninstall: (() => void) | null = null
  afterEach(() => {
    uninstall?.()
    uninstall = null
  })

  it('answers refused and subscribes to nothing without a bridge', async () => {
    expect(commentGateway.available()).toBe(false)
    await expect(commentGateway.list('p')).resolves.toEqual(REFUSED)
    await expect(
      commentGateway.save({ panelId: 'p', op: 'deleteThread' } as never)
    ).resolves.toEqual(REFUSED)
    const off = commentGateway.onDraftOpened(vi.fn())
    expect(() => off()).not.toThrow()
    const offSettled = commentGateway.onSaveSettled(vi.fn())
    expect(() => offSettled()).not.toThrow()
  })

  it('forwards every request and subscription to the bridge', async () => {
    const fake = installCommentsBridge()
    uninstall = fake.uninstall
    expect(commentGateway.available()).toBe(true)
    await commentGateway.setMode({ panelId: 'p', on: true, showIcons: true })
    await commentGateway.list('p')
    await commentGateway.reveal('p', 't1')
    await commentGateway.setUnsavedSources(['/a.html'])
    expect(fake.bridge.setMode).toHaveBeenCalledWith({ panelId: 'p', on: true, showIcons: true })
    expect(fake.bridge.list).toHaveBeenCalledWith('p')
    expect(fake.bridge.reveal).toHaveBeenCalledWith('p', 't1')
    expect(fake.bridge.setUnsavedSources).toHaveBeenCalledWith(['/a.html'])

    const seen = vi.fn()
    const offs = [
      commentGateway.onDraftOpened(seen),
      commentGateway.onCommentsChanged(seen),
      commentGateway.onAnchorStatus(seen),
      commentGateway.onModeChanged(seen),
      commentGateway.onSaveSettled(seen)
    ]
    fake.emitMode({ panelId: 'p', on: true, reason: 'escape' })
    fake.emitAnchors({ panelId: 'p', notVisible: [] })
    fake.emitChanged({ panelId: 'p', counts: { open: 0, resolved: 0, attention: 0 } })
    fake.emitSettled({ panelId: 'p', op: 'reply', threadKey: 't1', ok: false, code: ErrorCode.COMMENT_BLOCK_CHANGED })
    expect(seen).toHaveBeenCalledTimes(4)
    expect(seen).toHaveBeenLastCalledWith({ panelId: 'p', op: 'reply', threadKey: 't1', ok: false, code: ErrorCode.COMMENT_BLOCK_CHANGED })
    offs.forEach(off => off())
    fake.emitMode({ panelId: 'p', on: false, reason: 'escape' })
    fake.emitSettled({ panelId: 'p', op: 'add', draftToken: 'a'.repeat(32), ok: true })
    expect(seen).toHaveBeenCalledTimes(4)
  })

  it('turns a rejected invoke into the generic refusal', async () => {
    const fake = installCommentsBridge()
    uninstall = fake.uninstall
    fake.bridge.save.mockRejectedValueOnce(new Error('No handler registered'))
    await expect(
      commentGateway.save({ panelId: 'p', op: 'add', draftToken: 'a'.repeat(32), text: 'x' })
    ).resolves.toEqual(REFUSED)
  })

  it('turns a throwing subscription into a no-op unsubscribe', () => {
    const fake = installCommentsBridge()
    uninstall = fake.uninstall
    fake.bridge.onModeChanged.mockImplementationOnce(() => {
      throw new Error('gone')
    })
    const off = commentGateway.onModeChanged(vi.fn())
    expect(() => off()).not.toThrow()
  })
})
