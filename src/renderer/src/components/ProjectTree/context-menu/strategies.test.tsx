// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for Context Menu Strategies
 *
 * Tests the Strategy pattern implementation for node type-specific menu generation.
 * Tests both DirectoryContextMenuStrategy and FileContextMenuStrategy.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DirectoryContextMenuStrategy, FileContextMenuStrategy } from './strategies'
import { createMockMenuContext, createMockFileNode } from '../__test__/testUtils'
import type { MenuContext, FileNodeDirectory, FileNodeFile } from './types'

describe('Context Menu Strategies', () => {
  let ctx: MenuContext

  beforeEach(() => {
    ctx = createMockMenuContext()
  })

  describe('DirectoryContextMenuStrategy', () => {
    let strategy: DirectoryContextMenuStrategy

    beforeEach(() => {
      strategy = new DirectoryContextMenuStrategy()
    })

    it('should support directory nodes', () => {
      const node = createMockFileNode('folder', 'directory')

      expect(strategy.supports(node as FileNodeDirectory)).toBe(true)
    })

    it('should not support file nodes', () => {
      const node = createMockFileNode('test.md', 'file')

      expect(strategy.supports(node as FileNodeFile)).toBe(false)
    })

    it('should build menu with all operations', () => {
      const node = createMockFileNode('folder', 'directory')
      vi.mocked(ctx.clipboard.hasClipboard).mockReturnValue(true)

      const items = strategy.build(node as FileNodeDirectory, ctx)

      // Should have: Cut, Copy, Paste, Sep, NewFile, NewFolder, Rename, Sep, Delete
      expect(items.length).toBeGreaterThanOrEqual(9)
      expect(items[0].label).toBe('Cut')
      expect(items[1].label).toBe('Copy')
      expect(items[2].label).toBe('Paste')
    })

    it('should include paste when clipboard has items', () => {
      const node = createMockFileNode('folder', 'directory')
      vi.mocked(ctx.clipboard.hasClipboard).mockReturnValue(true)

      const items = strategy.build(node as FileNodeDirectory, ctx)

      const pasteItem = items.find((item) => item.label === 'Paste')
      expect(pasteItem).toBeDefined()
    })

    it('should exclude paste when clipboard is empty', () => {
      const node = createMockFileNode('folder', 'directory')
      vi.mocked(ctx.clipboard.hasClipboard).mockReturnValue(false)

      const items = strategy.build(node as FileNodeDirectory, ctx)

      const pasteItem = items.find((item) => item.label === 'Paste')
      expect(pasteItem).toBeUndefined()
    })

    it('should include separators between groups', () => {
      const node = createMockFileNode('folder', 'directory')
      vi.mocked(ctx.clipboard.hasClipboard).mockReturnValue(true)

      const items = strategy.build(node as FileNodeDirectory, ctx)

      const separators = items.filter((item) => item.separator === true)
      expect(separators.length).toBeGreaterThanOrEqual(2)
    })

    it('should include create operations', () => {
      const node = createMockFileNode('folder', 'directory')

      const items = strategy.build(node as FileNodeDirectory, ctx)

      expect(items.some((item) => item.label === 'New File')).toBe(true)
      expect(items.some((item) => item.label === 'New Folder')).toBe(true)
      expect(items.some((item) => item.label === 'Rename')).toBe(true)
      expect(items.some((item) => item.label === 'Delete')).toBe(true)
    })

    it('should pass context to all commands', () => {
      const node = createMockFileNode('folder', 'directory')

      const items = strategy.build(node as FileNodeDirectory, ctx)

      // All items should have execute functions
      items.forEach((item) => {
        if (!item.separator) {
          expect(typeof item.execute).toBe('function')
        }
      })
    })

    it('should end with a Reveal item below Delete', () => {
      const node = createMockFileNode('folder', 'directory')

      const items = strategy.build(node as FileNodeDirectory, ctx)
      const visible = items.filter((item) => !item.separator)

      expect(visible.at(-1)?.label).toMatch(/^Reveal in /)
      expect(visible.findIndex((item) => /^Reveal in /.test(item.label))).toBeGreaterThan(
        visible.findIndex((item) => item.label === 'Delete')
      )
    })
  })

  describe('FileContextMenuStrategy', () => {
    let strategy: FileContextMenuStrategy

    beforeEach(() => {
      strategy = new FileContextMenuStrategy()
    })

    it('should support file nodes', () => {
      const node = createMockFileNode('test.md', 'file')

      expect(strategy.supports(node as FileNodeFile)).toBe(true)
    })

    it('should not support directory nodes', () => {
      const node = createMockFileNode('folder', 'directory')

      expect(strategy.supports(node as FileNodeDirectory)).toBe(false)
    })

    it('should build menu with basic operations', () => {
      const node = createMockFileNode('test.md', 'file')

      const items = strategy.build(node as FileNodeFile, ctx)

      // Should have: Cut, Copy, Sep, Rename, Sep, Delete
      expect(items.length).toBeGreaterThanOrEqual(6)
      expect(items[0].label).toBe('Cut')
      expect(items[1].label).toBe('Copy')
    })

    it('should not include paste', () => {
      const node = createMockFileNode('test.md', 'file')
      vi.mocked(ctx.clipboard.hasClipboard).mockReturnValue(true)

      const items = strategy.build(node as FileNodeFile, ctx)

      const pasteItem = items.find((item) => item.label === 'Paste')
      expect(pasteItem).toBeUndefined()
    })

    it('should not include new file/folder', () => {
      const node = createMockFileNode('test.md', 'file')

      const items = strategy.build(node as FileNodeFile, ctx)

      expect(items.some((item) => item.label === 'New File')).toBe(false)
      expect(items.some((item) => item.label === 'New Folder')).toBe(false)
    })

    it('should include separators between groups', () => {
      const node = createMockFileNode('test.md', 'file')

      const items = strategy.build(node as FileNodeFile, ctx)

      const separators = items.filter((item) => item.separator === true)
      expect(separators.length).toBeGreaterThanOrEqual(2)
    })

    it('should include rename and delete', () => {
      const node = createMockFileNode('test.md', 'file')

      const items = strategy.build(node as FileNodeFile, ctx)

      expect(items.some((item) => item.label === 'Rename')).toBe(true)
      expect(items.some((item) => item.label === 'Delete')).toBe(true)
    })

    it('should end with a Reveal item below Delete', () => {
      const node = createMockFileNode('test.md', 'file')

      const items = strategy.build(node as FileNodeFile, ctx)
      const visible = items.filter((item) => !item.separator)

      expect(visible.at(-1)?.label).toMatch(/^Reveal in /)
      expect(visible.findIndex((item) => /^Reveal in /.test(item.label))).toBeGreaterThan(
        visible.findIndex((item) => item.label === 'Delete')
      )
    })

    it('offers "Open as source" first for an .html node', () => {
      const node = createMockFileNode('page.html', 'file')

      const items = strategy.build(node as FileNodeFile, ctx)
      const visible = items.filter((item) => !item.separator)

      expect(visible[0].label).toBe('Open as source')
    })

    it('offers "Open as source" for an .htm node', () => {
      const node = createMockFileNode('index.htm', 'file')

      const items = strategy.build(node as FileNodeFile, ctx)

      expect(items.some((item) => item.label === 'Open as source')).toBe(true)
    })

    it('does not offer "Open as source" for a non-HTML node', () => {
      const node = createMockFileNode('test.md', 'file')

      const items = strategy.build(node as FileNodeFile, ctx)

      expect(items.some((item) => item.label === 'Open as source')).toBe(false)
    })

    it('omits "Open as source" when openAsSource is not wired', () => {
      const node = createMockFileNode('page.html', 'file')
      const ctxWithoutOpen = createMockMenuContext({ openAsSource: undefined })

      const items = strategy.build(node as FileNodeFile, ctxWithoutOpen)

      expect(items.some((item) => item.label === 'Open as source')).toBe(false)
    })

    it('routes "Open as source" through the injected callback with the node path', () => {
      const node = createMockFileNode('page.html', 'file', '/proj/page.html')

      const items = strategy.build(node as FileNodeFile, ctx)
      items.find((item) => item.label === 'Open as source')?.execute()

      expect(ctx.openAsSource).toHaveBeenCalledWith('/proj/page.html')
    })
  })
})

describe('FileContextMenuStrategy – Open in default browser (#124)', () => {
  const strategy = new FileContextMenuStrategy()
  const withBrowser = (overrides?: Partial<MenuContext>): MenuContext =>
    createMockMenuContext({ openInBrowser: vi.fn(), ...overrides })
  const has = (items: { label: string }[]): boolean =>
    items.some((item) => item.label === 'Open in default browser')

  it('offers it second, after "Open as source", then closes the group with a separator', () => {
    const node = createMockFileNode('page.html', 'file')

    const items = strategy.build(node as FileNodeFile, withBrowser())
    const visible = items.filter((item) => !item.separator)

    expect(visible[0].label).toBe('Open as source')
    expect(visible[1].label).toBe('Open in default browser')
    expect(items[2].separator).toBe(true)
    expect(items[3].label).toBe('Cut')
  })

  it('offers it for an .HTM node in any letter case', () => {
    const node = createMockFileNode('INDEX.HTM', 'file')

    expect(has(strategy.build(node as FileNodeFile, withBrowser()))).toBe(true)
  })

  it('does not offer it for a .md node', () => {
    const node = createMockFileNode('notes.md', 'file')

    expect(has(strategy.build(node as FileNodeFile, withBrowser()))).toBe(false)
  })

  it('does not offer it for a folder, even one named like a page', () => {
    const node = createMockFileNode('site.html', 'directory')
    const ctx = withBrowser()

    expect(strategy.supports(node as FileNodeDirectory)).toBe(false)
    expect(has(new DirectoryContextMenuStrategy().build(node as FileNodeDirectory, ctx))).toBe(false)
  })

  it('omits it when openInBrowser is not wired', () => {
    const node = createMockFileNode('page.html', 'file')

    expect(has(strategy.build(node as FileNodeFile, createMockMenuContext()))).toBe(false)
  })

  it('keeps its own gate: alone in the group when "Open as source" is not wired', () => {
    const node = createMockFileNode('page.html', 'file')

    const items = strategy.build(node as FileNodeFile, withBrowser({ openAsSource: undefined }))

    expect(items[0].label).toBe('Open in default browser')
    expect(items[1].separator).toBe(true)
    expect(items[2].label).toBe('Cut')
  })

  it('adds no stray separator when neither open item is wired', () => {
    const node = createMockFileNode('page.html', 'file')

    const items = strategy.build(node as FileNodeFile, createMockMenuContext({ openAsSource: undefined }))

    expect(items[0].label).toBe('Cut')
  })

  it('routes through the injected action with the node path', () => {
    const node = createMockFileNode('page.html', 'file', '/proj/site/page.html')
    const ctx = withBrowser()

    strategy
      .build(node as FileNodeFile, ctx)
      .find((item) => item.label === 'Open in default browser')
      ?.execute()

    expect(ctx.openInBrowser).toHaveBeenCalledWith('/proj/site/page.html')
  })
})
