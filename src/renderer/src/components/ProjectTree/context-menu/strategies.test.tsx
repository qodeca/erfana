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
  })
})
