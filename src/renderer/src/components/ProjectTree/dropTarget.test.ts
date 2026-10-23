// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import type { FileNode } from '../../../../preload/index'
import { getBasename } from '../../utils/fileUtils'
import { buildVisibleRows } from './visibleRows'
import { resolveInternalDropFolder, isSameFolderMove } from './dropTarget'

const file = (path: string): FileNode => ({ name: getBasename(path), path, type: 'file', extension: '.md' })
const dir = (path: string, children: FileNode[]): FileNode => ({ name: getBasename(path), path, type: 'directory', children })

// /p: docs/{a.md, b.md}, lib/{c.md}, top.md – everything expanded
const root = dir('/p', [dir('/p/docs', [file('/p/docs/a.md'), file('/p/docs/b.md')]), dir('/p/lib', [file('/p/lib/c.md')]), file('/p/top.md')])
const { rows, indexByPath } = buildVisibleRows(root, new Set(['/p', '/p/docs', '/p/lib']))
const drop = (active: string | null, over: string | null) => resolveInternalDropFolder(rows, indexByPath, active, over)

describe('resolveInternalDropFolder', () => {
  it('lands in a hovered folder', () => {
    expect(drop('/p/docs/a.md', '/p/lib')).toBe('/p/lib')
  })

  it('lands in the folder of a hovered file', () => {
    expect(drop('/p/docs/a.md', '/p/lib/c.md')).toBe('/p/lib')
    expect(drop('/p/docs/a.md', '/p/top.md')).toBe('/p')
  })

  it('does not tint the dragged item\'s own folder when a sibling is hovered', () => {
    expect(drop('/p/docs/a.md', '/p/docs/b.md')).toBeNull()
    expect(drop('/p/docs/a.md', '/p/docs')).toBeNull()
  })

  it('gives no feedback over the dragged item itself, or with nothing dragged', () => {
    expect(drop('/p/docs/a.md', '/p/docs/a.md')).toBeNull()
    expect(drop(null, '/p/lib')).toBeNull()
    expect(drop('/p/docs/a.md', null)).toBeNull()
    expect(drop('/p/docs/a.md', '/p/unknown')).toBeNull()
  })

  it('lets a folder be dropped into a sibling folder', () => {
    expect(drop('/p/docs', '/p/lib/c.md')).toBe('/p/lib')
  })
})

describe('isSameFolderMove', () => {
  it('is true for the item\'s current folder, either separator', () => {
    expect(isSameFolderMove('/p/docs/a.md', '/p/docs')).toBe(true)
    expect(isSameFolderMove('/p/docs/a.md', '/p/docs/')).toBe(true)
    expect(isSameFolderMove('/p/docs/a.md', '/p/lib')).toBe(false)
  })
})
