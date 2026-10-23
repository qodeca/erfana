// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import type { FileNode } from '../../../../preload/index'
import { getBasename } from '../../utils/fileUtils'
import { buildVisibleRows } from './visibleRows'
import { resolveTreeKey, findTypeAheadMatch, isTypeAheadKey } from './treeKeyboard'

const file = (path: string): FileNode => ({ name: getBasename(path), path, type: 'file', extension: '.md' })
const dir = (path: string, children: FileNode[]): FileNode => ({
  name: getBasename(path),
  path,
  type: 'directory',
  children
})

// 0 /p, 1 alpha.md, 2 docs (open), 3 docs/beta.md, 4 empty (open, no children), 5 lib (closed), 6 zeta.md
const root = dir('/p', [
  file('/p/alpha.md'),
  dir('/p/docs', [file('/p/docs/beta.md')]),
  dir('/p/empty', []),
  dir('/p/lib', [file('/p/lib/gamma.md')]),
  file('/p/zeta.md')
])
const { rows } = buildVisibleRows(root, new Set(['/p', '/p/docs', '/p/empty']))
const key = (k: string, mods: Record<string, boolean> = {}) => ({ key: k, ...mods })

describe('resolveTreeKey', () => {
  it('moves down and up one row, clamped at the ends', () => {
    expect(resolveTreeKey(rows, 1, key('ArrowDown'))).toEqual({ type: 'focus', index: 2 })
    expect(resolveTreeKey(rows, 6, key('ArrowDown'))).toEqual({ type: 'focus', index: 6 })
    expect(resolveTreeKey(rows, 1, key('ArrowUp'))).toEqual({ type: 'focus', index: 0 })
    expect(resolveTreeKey(rows, 0, key('ArrowUp'))).toEqual({ type: 'focus', index: 0 })
  })

  it('jumps to the first and last row with Home and End', () => {
    expect(resolveTreeKey(rows, 3, key('Home'))).toEqual({ type: 'focus', index: 0 })
    expect(resolveTreeKey(rows, 3, key('End'))).toEqual({ type: 'focus', index: rows.length - 1 })
  })

  it('opens a closed folder with →, and steps into an open one', () => {
    expect(resolveTreeKey(rows, 5, key('ArrowRight'))).toEqual({ type: 'expand', path: '/p/lib' })
    expect(resolveTreeKey(rows, 2, key('ArrowRight'))).toEqual({ type: 'focus', index: 3 })
  })

  it('does nothing with → on a file or on an open folder with no children', () => {
    expect(resolveTreeKey(rows, 1, key('ArrowRight'))).toBeNull()
    expect(resolveTreeKey(rows, 4, key('ArrowRight'))).toBeNull()
  })

  it('closes an open folder with ←, and otherwise moves to the parent', () => {
    expect(resolveTreeKey(rows, 2, key('ArrowLeft'))).toEqual({ type: 'collapse', path: '/p/docs' })
    expect(resolveTreeKey(rows, 3, key('ArrowLeft'))).toEqual({ type: 'focus', index: 2 })
    expect(resolveTreeKey(rows, 5, key('ArrowLeft'))).toEqual({ type: 'focus', index: 0 })
  })

  it('does nothing with ← on the collapsed root', () => {
    const collapsed = buildVisibleRows(root, new Set()).rows
    expect(resolveTreeKey(collapsed, 0, key('ArrowLeft'))).toBeNull()
  })

  it('activates the row with Enter', () => {
    expect(resolveTreeKey(rows, 1, key('Enter'))).toEqual({ type: 'activate', index: 1 })
  })

  it('opens the context menu with Shift+F10 and the Menu key', () => {
    expect(resolveTreeKey(rows, 3, key('F10', { shiftKey: true }))).toEqual({ type: 'menu', index: 3 })
    expect(resolveTreeKey(rows, 3, key('ContextMenu'))).toEqual({ type: 'menu', index: 3 })
    expect(resolveTreeKey(rows, 3, key('F10'))).toBeNull()
  })

  it('leaves app shortcuts alone', () => {
    expect(resolveTreeKey(rows, 1, key('ArrowDown', { metaKey: true }))).toBeNull()
    expect(resolveTreeKey(rows, 1, key('Enter', { ctrlKey: true }))).toBeNull()
    expect(resolveTreeKey(rows, 1, key('Home', { altKey: true }))).toBeNull()
    expect(resolveTreeKey(rows, 1, key('ArrowDown', { shiftKey: true }))).toBeNull()
  })

  it('ignores keys outside the contract and an out-of-range index', () => {
    expect(resolveTreeKey(rows, 1, key('Tab'))).toBeNull()
    expect(resolveTreeKey(rows, 99, key('ArrowDown'))).toBeNull()
  })
})

describe('findTypeAheadMatch', () => {
  it('finds the next row starting with a letter, after the focused one, wrapping', () => {
    expect(findTypeAheadMatch(rows, 0, 'z')).toBe(6)
    expect(findTypeAheadMatch(rows, 6, 'a')).toBe(1)
  })

  it('cycles through matches when the same letter is pressed again', () => {
    const many = buildVisibleRows(dir('/p', [file('/p/b1.md'), file('/p/b2.md')]), new Set(['/p'])).rows
    expect(findTypeAheadMatch(many, 1, 'b')).toBe(2)
    expect(findTypeAheadMatch(many, 2, 'b')).toBe(1)
  })

  it('stays on the focused row while a longer query still matches it', () => {
    expect(findTypeAheadMatch(rows, 2, 'do')).toBe(2)
  })

  it('is case-insensitive and reports a miss', () => {
    expect(findTypeAheadMatch(rows, 0, 'ZE')).toBe(6)
    expect(findTypeAheadMatch(rows, 0, 'q')).toBeNull()
    expect(findTypeAheadMatch(rows, 0, '')).toBeNull()
  })
})

describe('isTypeAheadKey', () => {
  it('accepts a printable character only', () => {
    expect(isTypeAheadKey(key('a'))).toBe(true)
    expect(isTypeAheadKey(key('.'))).toBe(true)
    expect(isTypeAheadKey(key(' '))).toBe(false)
    expect(isTypeAheadKey(key('ArrowDown'))).toBe(false)
    expect(isTypeAheadKey(key('c', { metaKey: true }))).toBe(false)
  })
})

describe('the keyboard and lazy-folder placeholder lines (#320)', () => {
  // 0 /p, 1 big (open, loading), 2 line, 3 zeta.md
  const lazyRoot = dir('/p', [{ ...dir('/p/big', []), lazy: 'capped' as const }, file('/p/zeta.md')])
  const { rows: withLine } = buildVisibleRows(lazyRoot, new Set(['/p', '/p/big']), new Map([['/p/big', 'loading' as const]]))

  it('steps over the line with the arrows and never lands on it with End', () => {
    expect(withLine[2]).toMatchObject({ kind: 'placeholder' })
    expect(resolveTreeKey(withLine, 1, key('ArrowDown'))).toEqual({ type: 'focus', index: 3 })
    expect(resolveTreeKey(withLine, 3, key('ArrowUp'))).toEqual({ type: 'focus', index: 1 })
    expect(resolveTreeKey(withLine, 1, key('End'))).toEqual({ type: 'focus', index: 3 })
  })

  it('does not treat the line as the open folder\'s first child, nor as anyone\'s parent', () => {
    expect(resolveTreeKey(withLine, 1, key('ArrowRight'))).toBeNull()
    expect(resolveTreeKey(withLine, 3, key('ArrowLeft'))).toEqual({ type: 'focus', index: 0 })
    expect(resolveTreeKey(withLine, 2, key('ArrowDown'))).toBeNull()
  })

  it('never matches the line in type-ahead', () => {
    expect(findTypeAheadMatch(withLine, 1, 'l')).toBeNull()
    expect(findTypeAheadMatch(withLine, 1, 'z')).toBe(3)
  })
})
