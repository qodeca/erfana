// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for Context Menu Factory
 *
 * Tests the Factory pattern implementation for strategy selection and menu building.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { ContextMenuFactory } from './factory'
import { createMockMenuContext, createMockFileNode } from '../__test__/testUtils'
import type { MenuContext, FileNodeDirectory, FileNodeFile } from './types'

describe('ContextMenuFactory', () => {
  let factory: ContextMenuFactory
  let ctx: MenuContext

  beforeEach(() => {
    factory = new ContextMenuFactory()
    ctx = createMockMenuContext()
  })

  describe('Strategy selection', () => {
    it('should select DirectoryStrategy for directory nodes', () => {
      const node = createMockFileNode('folder', 'directory')

      const items = factory.build(node as FileNodeDirectory, ctx)

      // DirectoryStrategy includes "New File" which FileStrategy doesn't
      expect(items.some((item) => item.label === 'New File')).toBe(true)
    })

    it('should select FileStrategy for file nodes', () => {
      const node = createMockFileNode('test.md', 'file')

      const items = factory.build(node as FileNodeFile, ctx)

      // FileStrategy doesn't include "New File"
      expect(items.some((item) => item.label === 'New File')).toBe(false)
      // But it does include basic operations
      expect(items.some((item) => item.label === 'Cut')).toBe(true)
      expect(items.some((item) => item.label === 'Rename')).toBe(true)
    })

    it('should throw error for unsupported node types', () => {
      const invalidNode = { ...createMockFileNode('test', 'file'), type: 'invalid' as 'file' }

      expect(() => factory.build(invalidNode, ctx)).toThrow('No context menu strategy found for node type: invalid')
    })
  })

  describe('Menu building', () => {
    it('should delegate menu building to selected strategy', () => {
      const fileNode = createMockFileNode('test.md', 'file')
      const dirNode = createMockFileNode('folder', 'directory')

      const fileItems = factory.build(fileNode as FileNodeFile, ctx)
      const dirItems = factory.build(dirNode as FileNodeDirectory, ctx)

      // Different strategies produce different menus
      expect(fileItems.length).toBeGreaterThan(0)
      expect(dirItems.length).toBeGreaterThan(0)
      expect(dirItems.length).toBeGreaterThan(fileItems.length)
    })

    it('should pass node and context to strategy', () => {
      const node = createMockFileNode('test.md', 'file')

      const items = factory.build(node as FileNodeFile, ctx)

      // All items should have execute functions (from strategy)
      items.forEach((item) => {
        if (!item.separator) {
          expect(typeof item.execute).toBe('function')
        }
      })
    })

    it('should return menu items from strategy', () => {
      const node = createMockFileNode('test.md', 'file')

      const items = factory.build(node as FileNodeFile, ctx)

      // Should return valid menu items
      expect(Array.isArray(items)).toBe(true)
      expect(items.length).toBeGreaterThan(0)
      expect(items.every((item) => 'label' in item && 'execute' in item)).toBe(true)
    })

    it('should preserve menu item order from strategy', () => {
      const node = createMockFileNode('test.md', 'file')

      const items = factory.build(node as FileNodeFile, ctx)

      // FileStrategy order: Cut, Copy, Sep, Rename, Sep, Delete
      expect(items[0].label).toBe('Cut')
      expect(items[1].label).toBe('Copy')
    })
  })
})
