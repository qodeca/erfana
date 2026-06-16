// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import {
  flattenTree,
  buildTree,
  getProjection,
  isDescendant,
  canMoveItem,
  type FlattenedNode
} from './useDragDropTree'
import type { FileNode } from '../../../preload/index'

describe('useDragDropTree', () => {
  describe('flattenTree', () => {
    it('should flatten a simple tree structure', () => {
      const tree: FileNode[] = [
        { name: 'file1.md', path: '/project/file1.md', type: 'file', extension: '.md' },
        { name: 'folder1', path: '/project/folder1', type: 'directory', children: [] }
      ]

      const flattened = flattenTree(tree)

      expect(flattened).toHaveLength(2)
      expect(flattened[0]).toMatchObject({
        name: 'file1.md',
        path: '/project/file1.md',
        parentId: null,
        depth: 0,
        index: 0
      })
      expect(flattened[1]).toMatchObject({
        name: 'folder1',
        path: '/project/folder1',
        parentId: null,
        depth: 0,
        index: 1
      })
    })

    it('should preserve hierarchy metadata with nested children', () => {
      const tree: FileNode[] = [
        {
          name: 'folder1',
          path: '/project/folder1',
          type: 'directory',
          children: [
            { name: 'file1.md', path: '/project/folder1/file1.md', type: 'file', extension: '.md' },
            {
              name: 'folder2',
              path: '/project/folder1/folder2',
              type: 'directory',
              children: [
                { name: 'file2.md', path: '/project/folder1/folder2/file2.md', type: 'file', extension: '.md' }
              ]
            }
          ]
        }
      ]

      const flattened = flattenTree(tree)

      expect(flattened).toHaveLength(4)

      // Root folder
      expect(flattened[0]).toMatchObject({
        name: 'folder1',
        parentId: null,
        depth: 0,
        index: 0
      })

      // Child file
      expect(flattened[1]).toMatchObject({
        name: 'file1.md',
        parentId: '/project/folder1',
        depth: 1,
        index: 0
      })

      // Nested folder
      expect(flattened[2]).toMatchObject({
        name: 'folder2',
        parentId: '/project/folder1',
        depth: 1,
        index: 1
      })

      // Deeply nested file
      expect(flattened[3]).toMatchObject({
        name: 'file2.md',
        parentId: '/project/folder1/folder2',
        depth: 2,
        index: 0
      })
    })
  })

  describe('buildTree', () => {
    it('should reconstruct tree from flattened nodes', () => {
      const flattened: FlattenedNode[] = [
        {
          name: 'folder1',
          path: '/project/folder1',
          type: 'directory',
          parentId: null,
          depth: 0,
          index: 0,
          children: []
        },
        {
          name: 'file1.md',
          path: '/project/folder1/file1.md',
          type: 'file',
          extension: '.md',
          parentId: '/project/folder1',
          depth: 1,
          index: 0
        }
      ]

      const tree = buildTree(flattened)

      expect(tree).toHaveLength(1)
      expect(tree[0].name).toBe('folder1')
      expect(tree[0].children).toHaveLength(1)
      expect(tree[0].children![0].name).toBe('file1.md')
    })

    it('should handle complex nested structures', () => {
      const flattened: FlattenedNode[] = [
        {
          name: 'root',
          path: '/root',
          type: 'directory',
          parentId: null,
          depth: 0,
          index: 0,
          children: []
        },
        {
          name: 'child1',
          path: '/root/child1',
          type: 'directory',
          parentId: '/root',
          depth: 1,
          index: 0,
          children: []
        },
        {
          name: 'grandchild.md',
          path: '/root/child1/grandchild.md',
          type: 'file',
          extension: '.md',
          parentId: '/root/child1',
          depth: 2,
          index: 0
        }
      ]

      const tree = buildTree(flattened)

      expect(tree).toHaveLength(1)
      expect(tree[0].name).toBe('root')
      expect(tree[0].children).toHaveLength(1)
      expect(tree[0].children![0].name).toBe('child1')
      expect(tree[0].children![0].children).toHaveLength(1)
      expect(tree[0].children![0].children![0].name).toBe('grandchild.md')
    })
  })

  describe('isDescendant', () => {
    it('should return true when path is a descendant', () => {
      const ancestor = '/project/folder1'
      const descendant = '/project/folder1/subfolder/file.md'

      expect(isDescendant(descendant, ancestor)).toBe(true)
    })

    it('should return false when path is not a descendant', () => {
      const path1 = '/project/folder1'
      const path2 = '/project/folder2'

      expect(isDescendant(path2, path1)).toBe(false)
    })

    it('should return false when paths are identical', () => {
      const path = '/project/folder1'

      expect(isDescendant(path, path)).toBe(false)
    })

    it('should handle paths without trailing slashes', () => {
      const ancestor = '/project/folder1'
      const descendant = '/project/folder1/file.md'

      expect(isDescendant(descendant, ancestor)).toBe(true)
    })

    it('should not match partial folder names', () => {
      const ancestor = '/project/fold'
      const notDescendant = '/project/folder1/file.md'

      expect(isDescendant(notDescendant, ancestor)).toBe(false)
    })

    it('should detect descendants in Windows backslash paths', () => {
      const ancestor = 'C:\\project\\folder1'
      const descendant = 'C:\\project\\folder1\\subfolder\\file.md'

      expect(isDescendant(descendant, ancestor)).toBe(true)
    })
  })

  describe('getProjection', () => {
    const createFlattenedItems = (): FlattenedNode[] => [
      {
        name: 'root.md',
        path: '/project/root.md',
        type: 'file',
        extension: '.md',
        parentId: null,
        depth: 0,
        index: 0
      },
      {
        name: 'folder1',
        path: '/project/folder1',
        type: 'directory',
        parentId: null,
        depth: 0,
        index: 1,
        children: []
      },
      {
        name: 'child.md',
        path: '/project/folder1/child.md',
        type: 'file',
        extension: '.md',
        parentId: '/project/folder1',
        depth: 1,
        index: 0
      }
    ]

    it('should calculate correct depth for root level drop', () => {
      const items = createFlattenedItems()

      const projection = getProjection(
        items,
        '/project/folder1/child.md', // activeId
        '/project/root.md',          // overId
        0                             // offsetLeft (no horizontal drag)
      )

      expect(projection).not.toBeNull()
      expect(projection!.depth).toBe(0)
      expect(projection!.parentId).toBeNull()
    })

    it('should calculate deeper nesting with horizontal drag', () => {
      const items = createFlattenedItems()

      const projection = getProjection(
        items,
        '/project/root.md',         // activeId
        '/project/folder1',         // overId
        16                          // offsetLeft (one level deeper)
      )

      expect(projection).not.toBeNull()
      expect(projection!.depth).toBe(1)
      expect(projection!.parentId).toBe('/project/folder1')
    })

    it('should handle negative offset (moving shallower)', () => {
      const items = createFlattenedItems()

      const projection = getProjection(
        items,
        '/project/folder1/child.md', // activeId
        '/project/folder1',          // overId
        -16                          // offsetLeft (one level shallower)
      )

      expect(projection).not.toBeNull()
      // Should clamp to minimum depth 0
      expect(projection!.depth).toBeGreaterThanOrEqual(0)
    })

    it('should return null when activeId not found', () => {
      const items = createFlattenedItems()

      const projection = getProjection(
        items,
        '/nonexistent',
        '/project/root.md',
        0
      )

      expect(projection).toBeNull()
    })

    it('should return null when overId not found', () => {
      const items = createFlattenedItems()

      const projection = getProjection(
        items,
        '/project/root.md',
        '/nonexistent',
        0
      )

      expect(projection).toBeNull()
    })

    it('should not allow drop into files (only directories)', () => {
      const items = createFlattenedItems()

      const projection = getProjection(
        items,
        '/project/folder1',
        '/project/root.md', // hovering over file
        16                  // trying to go deeper
      )

      expect(projection).not.toBeNull()
      // Should not make file a parent, should use parent's level
      expect(projection!.parentId).not.toBe('/project/root.md')
    })
  })

  describe('canMoveItem', () => {
    it('should allow valid moves', () => {
      const result = canMoveItem(
        '/project/file.md',
        { depth: 1, parentId: '/project/folder', overId: '/project/folder' },
        '/project'
      )

      expect(result.valid).toBe(true)
      expect(result.reason).toBeUndefined()
    })

    it('should prevent moving item onto itself', () => {
      const result = canMoveItem(
        '/project/file.md',
        { depth: 0, parentId: null, overId: '/project/file.md' },
        '/project'
      )

      expect(result.valid).toBe(false)
      expect(result.reason).toBe('Cannot move item onto itself')
    })

    it('should prevent moving project root', () => {
      const result = canMoveItem(
        '/project',
        { depth: 1, parentId: '/other', overId: '/other' },
        '/project'
      )

      expect(result.valid).toBe(false)
      expect(result.reason).toBe('Cannot move project root')
    })

    it('should prevent circular moves (folder into its own subfolder)', () => {
      const result = canMoveItem(
        '/project/parent',
        { depth: 2, parentId: '/project/parent/child', overId: '/project/parent/child' },
        '/project'
      )

      expect(result.valid).toBe(false)
      expect(result.reason).toBe('Cannot move folder into its own subfolder')
    })

    it('should allow moving to sibling folder', () => {
      const result = canMoveItem(
        '/project/folder1/file.md',
        { depth: 1, parentId: '/project/folder2', overId: '/project/folder2' },
        '/project'
      )

      expect(result.valid).toBe(true)
    })
  })
})
