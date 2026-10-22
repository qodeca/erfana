// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import type { FileNode, LazyKind } from '../../../../shared/ipc/file-schema'
import { getBasename } from '../../utils/fileUtils'
import { filterMarkdownTree, isMarkdownFileName } from './markdownFilter'

const file = (path: string): FileNode => ({ name: getBasename(path), path, type: 'file' })
const dir = (path: string, children: FileNode[] = [], lazy?: LazyKind): FileNode => ({
  name: getBasename(path),
  path,
  type: 'directory',
  children,
  ...(lazy ? { lazy } : {})
})
const names = (nodes: FileNode[]): string[] =>
  nodes.flatMap((n) => [n.name, ...(n.children ? names(n.children).map((c) => `${n.name}/${c}`) : [])])

describe('filterMarkdownTree', () => {
  it('keeps Markdown files and the folders leading to one', () => {
    const tree = [
      dir('/p/docs', [file('/p/docs/a.MD'), file('/p/docs/b.txt')]),
      dir('/p/src', [file('/p/src/x.ts')]),
      file('/p/r.markdown')
    ]
    expect(names(filterMarkdownTree(tree, new Map()))).toEqual(['docs', 'docs/a.MD', 'r.markdown'])
  })

  it('hides a never-read ignored folder and keeps a never-read capped one (review item 4)', () => {
    const tree = [dir('/p/dist', [], 'ignored'), dir('/p/big', [], 'capped')]
    expect(names(filterMarkdownTree(tree, new Map()))).toEqual(['big'])
  })

  it('judges a read lazy folder by what it held: no Markdown and no unread sub-folder drops it', () => {
    const loaded = new Map([['/p/big', {}]])
    const noMarkdown = dir('/p/big', [file('/p/big/x.txt'), dir('/p/big/dist', [], 'ignored')], 'capped')
    expect(filterMarkdownTree([noMarkdown], loaded)).toEqual([])
    const unreadBelow = dir('/p/big', [dir('/p/big/more', [], 'capped')], 'capped')
    expect(names(filterMarkdownTree([unreadBelow], loaded))).toEqual(['big', 'big/more'])
    const withMarkdown = dir('/p/big', [file('/p/big/a.md')], 'capped')
    expect(names(filterMarkdownTree([withMarkdown], loaded))).toEqual(['big', 'big/a.md'])
  })

  it('names Markdown by extension, any case', () => {
    expect(isMarkdownFileName('A.Md')).toBe(true)
    expect(isMarkdownFileName('notes.markdown')).toBe(true)
    expect(isMarkdownFileName('md')).toBe(false)
  })
})
