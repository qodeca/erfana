// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import type { FileNode } from '../../../../preload/index'
import { getBasename } from '../../utils/fileUtils'
import { buildVisibleRows } from './visibleRows'

const file = (path: string): FileNode => ({ name: getBasename(path), path, type: 'file', extension: '.md' })
const dir = (path: string, children: FileNode[]): FileNode => ({
  name: getBasename(path),
  path,
  type: 'directory',
  children
})

/** /p: a.md, docs/{one.md, deep/{x.md}}, z.md */
const root = dir('/p', [file('/p/a.md'), dir('/p/docs', [file('/p/docs/one.md'), dir('/p/docs/deep', [file('/p/docs/deep/x.md')])]), file('/p/z.md')])

describe('buildVisibleRows', () => {
  it('returns nothing without a project', () => {
    const { rows, indexByPath } = buildVisibleRows(null, new Set())
    expect(rows).toEqual([])
    expect(indexByPath.size).toBe(0)
  })

  it('shows only the root row while the root is collapsed', () => {
    const { rows } = buildVisibleRows(root, new Set())
    expect(rows.map((r) => r.node.path)).toEqual(['/p'])
    expect(rows[0]).toMatchObject({ level: 0, parentPath: null, posInSet: 1, setSize: 1, isExpanded: false })
  })

  it('lists expanded folders in display order and skips collapsed subtrees', () => {
    const { rows } = buildVisibleRows(root, new Set(['/p', '/p/docs']))
    expect(rows.map((r) => r.node.path)).toEqual(['/p', '/p/a.md', '/p/docs', '/p/docs/one.md', '/p/docs/deep', '/p/z.md'])
  })

  it('does not descend a folder whose parent is collapsed, even if it is marked expanded', () => {
    const { rows } = buildVisibleRows(root, new Set(['/p', '/p/docs/deep']))
    expect(rows.map((r) => r.node.path)).not.toContain('/p/docs/deep/x.md')
  })

  it('records level, parent and sibling position for the ARIA attributes', () => {
    const { rows, indexByPath } = buildVisibleRows(root, new Set(['/p', '/p/docs', '/p/docs/deep']))
    const at = (path: string) => rows[indexByPath.get(path)!]

    expect(at('/p/a.md')).toMatchObject({ level: 1, parentPath: '/p', posInSet: 1, setSize: 3 })
    expect(at('/p/docs')).toMatchObject({ level: 1, posInSet: 2, setSize: 3, isExpanded: true })
    expect(at('/p/z.md')).toMatchObject({ level: 1, posInSet: 3, setSize: 3 })
    expect(at('/p/docs/deep/x.md')).toMatchObject({ level: 3, parentPath: '/p/docs/deep', posInSet: 1, setSize: 1 })
  })

  it('indexes every row by path', () => {
    const { rows, indexByPath } = buildVisibleRows(root, new Set(['/p', '/p/docs']))
    rows.forEach((row, i) => expect(indexByPath.get(row.node.path)).toBe(i))
  })

  it('handles a deep chain without recursion', () => {
    let node: FileNode = file('/p/leaf.md')
    const expanded = new Set<string>()
    for (let depth = 20_000; depth > 0; depth--) {
      const path = `/p/${depth}`
      node = dir(path, [node])
      expanded.add(path)
    }
    const deepRoot = dir('/p', [node])
    expanded.add('/p')

    const { rows } = buildVisibleRows(deepRoot, expanded)
    expect(rows).toHaveLength(20_002)
    expect(rows[rows.length - 1].level).toBe(20_001)
  })
})
