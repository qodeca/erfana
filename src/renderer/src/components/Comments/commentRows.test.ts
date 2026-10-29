// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { damaged, fileView, message, thread } from '../Panels/HtmlPreviewPanel/comments/__test-helpers__/commentTestKit'
import { COPY, DRAWER_COPY } from './commentCopy'
import { drawerRows } from './commentRows'

const tagsOf = (row: { tags: readonly { text: string }[] }): string[] => row.tags.map(t => t.text)

describe('drawerRows', () => {
  it('reports none for a page with no comments', () => {
    expect(drawerRows([fileView()], new Set()).none).toBe(true)
  })

  it('R-009 keeps file order and sorts threads into open and resolved', () => {
    const rows = drawerRows(
      [
        fileView({
          threads: [
            thread(1),
            thread(2, { status: 'resolved', resolved: { by: { name: 'Bo' }, at: '2026-10-20' } }),
            thread(3, { messages: [message(3), message(4), message(5)] })
          ]
        })
      ],
      new Set()
    )
    expect(rows.open.map(r => r.threadKey)).toEqual(['t1', 't3'])
    expect(rows.resolved.map(r => r.threadKey)).toEqual(['t2'])
    expect(rows.open[1]).toMatchObject({ replies: 2, excerpt: 'Message 3', author: 'Ada Lovelace' })
    expect(tagsOf(rows.resolved[0])).toEqual([DRAWER_COPY.resolved])
    expect(rows.none).toBe(false)
  })

  it('R-009 tags a thread whose element is hidden right now as Not visible', () => {
    const files = [fileView({ threads: [thread(1), thread(2, { notVisible: true })] })]
    const rows = drawerRows(files, new Set(['t1']))
    expect(tagsOf(rows.open[0])).toEqual([DRAWER_COPY.notVisible])
    expect(tagsOf(rows.open[1])).toEqual([DRAWER_COPY.notVisible])
    // Still Show on page: the element exists, it is just not drawn.
    expect(rows.open[0].main).toBe('reveal')
  })

  it('R-020 tags Element not found, Damaged and Newer format separately', () => {
    const rows = drawerRows(
      [
        fileView({
          threads: [thread(1, { attached: false })],
          damaged: [damaged(1)],
          newer: [{ blockKey: 'n1', version: 2, line: 70 }]
        })
      ],
      new Set()
    )
    expect(rows.attention.map(tagsOf)).toEqual([
      [DRAWER_COPY.notFound],
      [DRAWER_COPY.damaged],
      [COPY.newerTag]
    ])
    expect(rows.attention.every(r => r.tags.every(t => t.attention))).toBe(true)
  })

  it('R-020 offers Show on page for an attached thread and Open in source otherwise', () => {
    const rows = drawerRows(
      [
        fileView({
          threads: [thread(1), thread(2, { attached: false })],
          damaged: [damaged(1)],
          newer: [{ blockKey: 'n1', version: 3, line: 70 }]
        })
      ],
      new Set()
    )
    expect(rows.open[0].main).toBe('reveal')
    expect(rows.attention.map(r => r.main)).toEqual(['source', 'source', 'source'])
    expect(rows.attention[1]).toMatchObject({ blockKey: 'b1', label: 'index.html, line 41' })
  })

  it('a not-found thread is never also tagged Not visible', () => {
    const rows = drawerRows(
      [fileView({ threads: [thread(1, { attached: false, notVisible: true })] })],
      new Set(['t1'])
    )
    expect(tagsOf(rows.attention[0])).toEqual([DRAWER_COPY.notFound])
  })

  it('labels a frame file and a script-built element', () => {
    const rows = drawerRows(
      [
        fileView({
          fileKey: 'f2',
          displayPath: 'child.html',
          frame: true,
          threads: [thread(1, { runtime: { tag: 'li', path: '0/1' } })]
        })
      ],
      new Set()
    )
    expect(rows.open[0]).toMatchObject({ label: 'li', id: 'f2/t1' })
    expect(tagsOf(rows.open[0])).toEqual(['In frame: child.html'])
  })

  it('handles 1,000 threads in one pass', () => {
    const threads = Array.from({ length: 1_000 }, (_, i) => thread(i))
    const rows = drawerRows([fileView({ threads })], new Set())
    expect(rows.open).toHaveLength(1_000)
  })
})
