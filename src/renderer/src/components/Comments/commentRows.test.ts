// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { damaged, fileView, message, thread } from '../Panels/HtmlPreviewPanel/comments/__test-helpers__/commentTestKit'
import { COPY, DRAWER_COPY } from './commentCopy'
import { COMMENT_LIST_COPY } from './commentCopyWords'
import { drawerRows, listCounts, sortRows } from './commentRows'

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
    // Still Show in preview: the element exists, it is just not drawn.
    expect(rows.open[0].main).toBe('reveal')
  })

  // Changed expectation under OD-04 (was "R-020 tags Element not found, Damaged and Newer format separately",
  // all three in Needs attention with the warning look).
  it('OD-04 regroups the states: Not found is Open with a neutral tag, Damaged and Newer format are Can\'t edit', () => {
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
    expect(rows.open.map(tagsOf)).toEqual([[DRAWER_COPY.notFound]])
    expect(rows.open[0].tags[0].attention).toBe(false)
    expect(rows.cantEdit.map(tagsOf)).toEqual([[DRAWER_COPY.damaged], [COPY.newerTag]])
    // Only a damaged comment carries the ▲ attention counter; a newer format is neutral.
    expect(rows.cantEdit.map(r => r.tags[0].attention)).toEqual([true, false])
  })

  // Changed expectation under OD-04 (was "R-020 offers Show on page … Open in source otherwise" over Needs attention).
  it('OD-04 offers Show in preview for an attached thread and Open in source otherwise', () => {
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
    expect(rows.open.map(r => r.main)).toEqual(['reveal', 'source'])
    expect(rows.cantEdit.map(r => r.main)).toEqual(['source', 'source'])
    expect(rows.cantEdit[0]).toMatchObject({ blockKey: 'b1', label: 'index.html, line 41', filter: 'cantEdit' })
  })

  it('a not-found thread is never also tagged Not visible', () => {
    const rows = drawerRows(
      [fileView({ threads: [thread(1, { attached: false, notVisible: true })] })],
      new Set(['t1'])
    )
    expect(tagsOf(rows.open[0])).toEqual([DRAWER_COPY.notFound])
  })

  it('OD-04 a resolved thread whose target is gone stays Resolved and also says Not found (S-06)', () => {
    const rows = drawerRows(
      [fileView({ threads: [thread(1, { status: 'resolved', attached: false, resolved: { by: { name: 'Bo' }, at: '2026-10-20' } })] })],
      new Set()
    )
    expect(rows.resolved.map(tagsOf)).toEqual([[DRAWER_COPY.resolved, DRAWER_COPY.notFound]])
  })

  it('C-15 one state tag per thread by precedence: Words changed over Changed over Not visible now', () => {
    const rows = drawerRows(
      [
        fileView({
          threads: [
            thread(1, { notVisible: true, change: { state: 'changed', was: 'Old text' } }),
            thread(2, { change: { state: 'words', was: 'ship by Friday', now: 'ship by Thursday' } }),
            thread(3, { attached: false, change: { state: 'changed', was: 'x' } })
          ]
        })
      ],
      new Set()
    )
    expect(rows.open.map(tagsOf)).toEqual([
      [COMMENT_LIST_COPY.changedTag],
      [COMMENT_LIST_COPY.wordsChangedTag],
      [DRAWER_COPY.notFound]
    ])
    expect(rows.open.map(r => r.changed)).toEqual([true, true, false])
    expect(rows.open[1].words).toBe('“ship by Friday” → “ship by Thursday”')
  })

  it('C-15 sorts a filter by file order, changed first, or latest activity – ties keep file order', () => {
    const files = [
      fileView({
        threads: [
          thread(1, { messages: [message(1, { at: '2026-10-01T10:00:00Z' })] }),
          thread(2, { messages: [message(2, { at: '2026-10-03T10:00:00Z' })], change: { state: 'changed', was: 'x' } }),
          thread(3, { messages: [message(3, { at: '2026-10-01T10:00:00Z' }), message(4, { at: '2026-10-05T10:00:00Z' })] })
        ]
      })
    ]
    const { open } = drawerRows(files, new Set())
    expect(sortRows(open, 'file')).toBe(open)
    expect(sortRows(open, 'changed').map(r => r.threadKey)).toEqual(['t2', 't1', 't3'])
    expect(sortRows(open, 'latest').map(r => r.threadKey)).toEqual(['t3', 't2', 't1'])
    expect(sortRows([], 'latest')).toEqual([])
  })

  it('OD-04 counts for the toolbar: open found or not, ▲ damaged only, newer in neither', () => {
    const files = [
      fileView({
        threads: [
          thread(1),
          thread(2, { attached: false }),
          thread(3, { status: 'resolved' }),
          thread(4, { change: { state: 'words', was: 'a' } })
        ],
        damaged: [damaged(1), damaged(2)],
        newer: [{ blockKey: 'n1', version: 2, line: 70 }]
      })
    ]
    expect(listCounts(files)).toEqual({ open: 3, resolved: 1, changed: 1, damaged: 2 })
    expect(listCounts([])).toEqual({ open: 0, resolved: 0, changed: 0, damaged: 0 })
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
