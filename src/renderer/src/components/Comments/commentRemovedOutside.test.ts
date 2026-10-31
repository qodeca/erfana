// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comments removed outside Erfana (comments-v2 OD-06): which open threads a
 * new list no longer holds, minus Erfana's own deletes; session only.
 */
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { CommentListState } from '../../stores/usePreviewCommentStore'
import { fileView, thread } from '../Panels/HtmlPreviewPanel/comments/__test-helpers__/commentTestKit'
import { HTML_WORDS } from './commentCopyWords'
import { openThreadsOf, removedOutside, useRemovedOutside } from './commentRemovedOutside'

const listOf = (generation: number, threads = [thread(1), thread(2)], fileKey = 'f1'): CommentListState => ({
  status: 'ready',
  generation,
  files: [fileView({ fileKey, threads })]
})

describe('removedOutside', () => {
  it('OD-06 names the open threads a new list no longer holds, never a resolved or still-listed one, never Erfana\'s own', () => {
    const before = openThreadsOf([fileView({ threads: [thread(1), thread(2), thread(3), thread(4, { status: 'resolved' })] })], HTML_WORDS)
    expect([...before.keys()]).toEqual(['t1', 't2', 't3'])
    expect(before.get('t1')).toEqual({ threadKey: 't1', text: 'Message 1', author: 'Ada Lovelace', label: 'button.cta' })
    // t2 is now resolved – still listed, so not removed; t3 Erfana deleted itself.
    const gone = removedOutside(before, new Set(['t2', 't4']), new Set(['t3']))
    expect(gone.map(r => r.threadKey)).toEqual(['t1'])
    expect(removedOutside(new Map(), new Set(), new Set())).toEqual([])
  })
})

describe('useRemovedOutside', () => {
  it('OD-06 the first list notes nothing; a later list of the same file notes what went, until Dismiss', () => {
    const { result, rerender } = renderHook(({ list }) => useRemovedOutside(list, HTML_WORDS), {
      initialProps: { list: listOf(1) }
    })
    expect(result.current.removed).toEqual([])
    rerender({ list: listOf(2, [thread(2)]) })
    expect(result.current.removed.map(r => r.threadKey)).toEqual(['t1'])
    rerender({ list: listOf(3, []) })
    expect(result.current.removed.map(r => r.threadKey)).toEqual(['t1', 't2'])
    act(() => result.current.dismiss())
    expect(result.current.removed).toEqual([])
  })

  it('OD-06 a thread Erfana deletes itself is never noted', () => {
    const { result, rerender } = renderHook(({ list }) => useRemovedOutside(list, HTML_WORDS), {
      initialProps: { list: listOf(1) }
    })
    act(() => result.current.ownDelete('t1'))
    rerender({ list: listOf(2, [thread(2)]) })
    expect(result.current.removed).toEqual([])
  })

  it('OD-06 another file, a loading or failed list, and the same generation again note nothing', () => {
    const { result, rerender } = renderHook(({ list }) => useRemovedOutside(list, HTML_WORDS), {
      initialProps: { list: listOf(1) }
    })
    rerender({ list: { status: 'loading', files: [], generation: 2 } })
    rerender({ list: { status: 'error', files: [], generation: 3 } })
    expect(result.current.removed).toEqual([])
    rerender({ list: listOf(4, [], 'f2') })
    expect(result.current.removed).toEqual([])
    rerender({ list: listOf(4, [], 'f2') })
    expect(result.current.removed).toEqual([])
  })
})
