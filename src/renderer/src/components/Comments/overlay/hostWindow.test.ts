// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileCommentOpenDraftResult } from '../../../../../shared/ipc/file-comment-schema'
import { MARKDOWN_WORDS } from '../commentCopyWords'
import { DRAFT_REFRESH_MS, newRequestExtras, useDraftKeepAlive } from './hostWindow'
import type { PreviewCommentAdapter } from './previewAdapter'

const OPENED = 'a'.repeat(32)
const token = (n: number): string => n.toString(16).padStart(32, '0')

describe('C-14 (Markdown) the open window’s draft never silently expires', () => {
  let clock: number
  let minted: number
  let openDraft: ReturnType<typeof vi.fn<() => Promise<FileCommentOpenDraftResult>>>

  beforeEach(() => {
    vi.useFakeTimers()
    clock = 0
    minted = 0
    openDraft = vi.fn(async () => ({ ok: true as const, draftToken: token((minted += 1)) }))
  })
  afterEach(() => vi.useRealTimers())

  function keepAlive(opened: string | null): { result: { current: (t: string) => Promise<string> }; rerender: (o: string | null) => void } {
    const hook = renderHook(({ open }: { open: string | null }) => useDraftKeepAlive(open, openDraft, () => clock), {
      initialProps: { open: opened }
    })
    return { result: hook.result, rerender: open => hook.rerender({ open }) }
  }

  it('C-14 (Markdown) a save right after the window opened uses the draft it opened with', async () => {
    const { result } = keepAlive(OPENED)
    await expect(result.current(OPENED)).resolves.toBe(OPENED)
    expect(openDraft).not.toHaveBeenCalled()
  })

  it('C-14 (Markdown) the draft is renewed while the window stays open, and the save takes the newest', async () => {
    const { result } = keepAlive(OPENED)
    for (let i = 0; i < 3; i += 1) {
      clock += DRAFT_REFRESH_MS
      await act(async () => {
        await vi.advanceTimersByTimeAsync(DRAFT_REFRESH_MS)
      })
    }
    expect(openDraft).toHaveBeenCalledTimes(3)
    await expect(result.current(OPENED)).resolves.toBe(token(3))
  })

  it('C-14 (Markdown) a renewal missed while the machine slept is made up before the save', async () => {
    const { result } = keepAlive(OPENED)
    clock += 30 * 60 * 1000
    await expect(result.current(OPENED)).resolves.toBe(token(1))
    expect(openDraft).toHaveBeenCalledTimes(1)
  })

  it('C-14 (Markdown) a refused renewal keeps the current draft; main then says it expired (C-14.1)', async () => {
    openDraft.mockResolvedValueOnce({ ok: false, code: 'COMMENT_WRITE_FAILED' } as unknown as FileCommentOpenDraftResult)
    const { result } = keepAlive(OPENED)
    clock += DRAFT_REFRESH_MS
    await expect(result.current(OPENED)).resolves.toBe(OPENED)
  })

  it('C-14 (Markdown) nothing is renewed once the window closed, and another token passes through', async () => {
    const { result, rerender } = keepAlive(OPENED)
    rerender(null)
    clock += DRAFT_REFRESH_MS
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DRAFT_REFRESH_MS * 2)
    })
    expect(openDraft).not.toHaveBeenCalled()
    await expect(result.current(OPENED)).resolves.toBe(OPENED)
  })
})

describe('new-comment request extras', () => {
  function adapterWith(parent: HTMLElement | null, patch: Partial<PreviewCommentAdapter> = {}): PreviewCommentAdapter {
    return {
      words: MARKDOWN_WORDS,
      targetAt: () => null,
      targetsInOrder: () => [],
      parentOf: () => parent,
      childOf: () => null,
      tagOf: el => el.tagName.toLowerCase(),
      lineOf: () => 1,
      canComment: () => ({ ok: true }),
      describe: () => null,
      attach: () => null,
      ...patch
    }
  }

  it('C-19 (Markdown) W-07 a target inside a commentable parent names it; none at the top level', () => {
    const li = document.createElement('li')
    expect(newRequestExtras(li, adapterWith(document.createElement('ul')))).toEqual({ parentTag: 'ul' })
    expect(newRequestExtras(li, adapterWith(null))).toEqual({})
    const blocked = adapterWith(document.createElement('ul'), { canComment: () => ({ ok: false, reason: 'no' }) })
    expect(newRequestExtras(li, blocked)).toEqual({})
  })

  it('C-19 (Markdown) W-08 a refusal the adapter already knows travels with the request', () => {
    const p = document.createElement('p')
    expect(newRequestExtras(p, adapterWith(null, { refusalOf: () => 'generated-region' }))).toEqual({ refused: 'generated-region' })
    expect(newRequestExtras(p, adapterWith(null, { refusalOf: () => null }))).toEqual({})
  })
})
