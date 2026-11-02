// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The HTML Preview's draft keep-alive in the renderer (spec 024 C-14.2).
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../../../../shared/errors'
import { DRAFT_REFRESH_MS } from '../../../Comments/overlay/hostWindow'
import { installCommentsBridge } from './__test-helpers__/commentTestKit'
import { usePreviewDraftKeepAlive } from './usePreviewDraftKeepAlive'

const PANEL = 'html-preview-index'
const TOKEN = 'a'.repeat(32)
const add = (draftToken: string) => ({ panelId: PANEL, op: 'add' as const, draftToken, text: 'x' })

let kit: ReturnType<typeof installCommentsBridge>

beforeEach(() => {
  vi.useFakeTimers()
  kit = installCommentsBridge()
})

afterEach(() => {
  kit.uninstall()
  vi.useRealTimers()
})

describe('usePreviewDraftKeepAlive', () => {
  it('C-14 (HTML) renews the open window’s draft on a timer, and stops when the window closes', async () => {
    const hook = renderHook(({ token }: { token: string | null }) => usePreviewDraftKeepAlive(PANEL, token), { initialProps: { token: TOKEN as string | null } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DRAFT_REFRESH_MS)
    })
    expect(kit.bridge.keepDraft).toHaveBeenCalledExactlyOnceWith(PANEL, TOKEN)
    hook.rerender({ token: null })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DRAFT_REFRESH_MS * 3)
    })
    expect(kit.bridge.keepDraft).toHaveBeenCalledTimes(1)
  })

  it('C-14 (HTML) renews a stale draft right before its Save (the machine slept), and leaves a fresh one, another draft and other ops alone', async () => {
    let clock = 0
    const hook = renderHook(() => usePreviewDraftKeepAlive(PANEL, TOKEN, () => clock))
    await hook.result.current(add(TOKEN))
    expect(kit.bridge.keepDraft).not.toHaveBeenCalled()
    // Sleep stops timers but not the clock.
    clock += DRAFT_REFRESH_MS
    await hook.result.current(add('b'.repeat(32)))
    await hook.result.current({ panelId: PANEL, op: 'reply', fileKey: 'f1', threadKey: 't1', rawHash: 'h'.repeat(64), text: 'x' } as never)
    expect(kit.bridge.keepDraft).not.toHaveBeenCalled()
    await hook.result.current(add(TOKEN))
    expect(kit.bridge.keepDraft).toHaveBeenCalledExactlyOnceWith(PANEL, TOKEN)
    // Renewed: the next save goes straight through.
    await hook.result.current(add(TOKEN))
    expect(kit.bridge.keepDraft).toHaveBeenCalledTimes(1)
  })

  it('C-14 (HTML) a refused renewal is not a failure here: the Save goes on and says the draft expired', async () => {
    kit.bridge.keepDraft.mockResolvedValue({ ok: false, code: ErrorCode.COMMENT_DRAFT_EXPIRED } as never)
    let clock = 0
    const hook = renderHook(() => usePreviewDraftKeepAlive(PANEL, TOKEN, () => clock))
    clock += DRAFT_REFRESH_MS
    await expect(hook.result.current(add(TOKEN))).resolves.toBeUndefined()
    // Still stale: the next save asks again.
    await hook.result.current(add(TOKEN))
    expect(kit.bridge.keepDraft).toHaveBeenCalledTimes(2)
  })
})
