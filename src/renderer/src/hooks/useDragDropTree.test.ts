// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import {
  flattenTree,
  buildTree,
  getProjection,
  isDescendant,
  canMoveItem,
  useDragDropTree,
  type FlattenedNode,
  type NodeIndex
} from './useDragDropTree'
import type { FileNode } from '../../../preload/index'
import { logger } from '../utils/logger'

/**
 * Structural invariants every `flattenTree` result must satisfy, checked in a
 * single O(n) pass so they can be asserted over a 200k-node result without
 * building a second copy of the tree.
 *
 * Assumes a ROOT-LEVEL flatten (`parentId: null`, `depth: 0`), which is what
 * every caller of this helper produces; a subtree flatten started at an
 * explicit parent would trip the depth and contiguity checks by construction.
 *
 * Returns the violations found (capped, so a broken implementation produces a
 * readable failure rather than 200 000 lines of diff).
 */
function collectFlattenInvariantViolations(
  flattened: FlattenedNode[],
  maxReported = 5
): string[] {
  const violations: string[] = []
  const emittedDepthByPath = new Map<string, number>()
  // Keyed by parentId directly – `null` is a valid Map key, so no sentinel
  // string can collide with a real path.
  const nextIndexByParent = new Map<string | null, number>()
  // Ancestor chain of the node emitted last, outermost first. In a pre-order
  // DFS this is exactly the set of directories the current node sits inside.
  const ancestors: FlattenedNode[] = []

  for (let i = 0; i < flattened.length; i++) {
    const node = flattened[i]

    // CONTIGUITY: a subtree is emitted as one unbroken run, so after popping
    // every entry too shallow-or-equal to enclose this node, whatever remains
    // on top MUST be its parent (or nothing, at root level).
    //
    // This is the check the other three cannot make. They are all local -
    // "parent seen earlier", "depth = parent depth + 1", "sibling index runs
    // 0..n-1 per parent" – and a breadth-first emission satisfies every one of
    // them while interleaving subtrees. Only comparing against the maintained
    // ancestor stack notices that the node's parent is not the block we are
    // currently inside. See "flatten invariant guard" below, which feeds this
    // helper a hand-built BFS ordering and pins that it rejects it.
    while (ancestors.length > 0 && ancestors[ancestors.length - 1].depth >= node.depth) {
      ancestors.pop()
    }
    const enclosingParentId = ancestors.length > 0 ? ancestors[ancestors.length - 1].path : null
    if (node.parentId !== enclosingParentId) {
      violations.push(
        `#${i} ${node.path}: parent "${node.parentId}", but the enclosing subtree is "${enclosingParentId}"`
      )
    }
    ancestors.push(node)

    // Pre-order: a parent is always emitted before any of its descendants.
    if (node.parentId !== null && !emittedDepthByPath.has(node.parentId)) {
      violations.push(`#${i} ${node.path}: parent "${node.parentId}" was not emitted first`)
    }

    // depth === number of ancestors
    const expectedDepth =
      node.parentId === null ? 0 : (emittedDepthByPath.get(node.parentId) ?? NaN) + 1
    if (node.depth !== expectedDepth) {
      violations.push(`#${i} ${node.path}: depth ${node.depth}, expected ${expectedDepth}`)
    }

    // Sibling index restarts at 0 for every parent and runs forward 0..n-1.
    const expectedIndex = nextIndexByParent.get(node.parentId) ?? 0
    if (node.index !== expectedIndex) {
      violations.push(`#${i} ${node.path}: index ${node.index}, expected ${expectedIndex}`)
    }
    nextIndexByParent.set(node.parentId, expectedIndex + 1)

    // offset === the node's own position in the flattened array, which is what
    // lets `getProjection` start its positional walk from an index lookup.
    if (node.offset !== i) {
      violations.push(`#${i} ${node.path}: offset ${node.offset}, expected ${i}`)
    }

    emittedDepthByPath.set(node.path, node.depth)

    if (violations.length >= maxReported) break
  }

  return violations
}

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
        index: 0,
        offset: 0
      })
      expect(flattened[1]).toMatchObject({
        name: 'folder1',
        path: '/project/folder1',
        parentId: null,
        depth: 0,
        index: 1,
        offset: 1
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
        index: 0,
        offset: 0
      })

      // Child file
      expect(flattened[1]).toMatchObject({
        name: 'file1.md',
        parentId: '/project/folder1',
        depth: 1,
        index: 0,
        offset: 1
      })

      // Nested folder
      expect(flattened[2]).toMatchObject({
        name: 'folder2',
        parentId: '/project/folder1',
        depth: 1,
        index: 1,
        offset: 2
      })

      // Deeply nested file
      expect(flattened[3]).toMatchObject({
        name: 'file2.md',
        parentId: '/project/folder1/folder2',
        depth: 2,
        index: 0,
        offset: 3
      })
    })

    it('should handle a directory with children: undefined', () => {
      const tree: FileNode[] = [
        { name: 'empty-dir', path: '/project/empty-dir', type: 'directory' }
      ]

      const flattened = flattenTree(tree)

      expect(flattened).toHaveLength(1)
      expect(flattened[0]).toMatchObject({ parentId: null, depth: 0, index: 0, offset: 0 })
    })

    it('should handle a directory with children: []', () => {
      const tree: FileNode[] = [
        { name: 'empty-dir', path: '/project/empty-dir', type: 'directory', children: [] },
        { name: 'after.md', path: '/project/after.md', type: 'file', extension: '.md' }
      ]

      const flattened = flattenTree(tree)

      expect(flattened).toHaveLength(2)
      expect(flattened[1]).toMatchObject({
        name: 'after.md',
        parentId: null,
        depth: 0,
        index: 1,
        offset: 1
      })
    })

    it('should return an empty array for an empty node list', () => {
      expect(flattenTree([])).toEqual([])
    })

    it('should honour explicit parentId / depth arguments', () => {
      const tree: FileNode[] = [
        { name: 'child.md', path: '/project/folder/child.md', type: 'file', extension: '.md' }
      ]

      expect(flattenTree(tree, '/project/folder', 1)[0]).toMatchObject({
        parentId: '/project/folder',
        depth: 1,
        index: 0,
        // `offset` is a position in the OUTPUT array, so a subtree flatten
        // still starts at 0 – it is not an absolute position in the tree.
        offset: 0
      })
    })

    it('should produce the exact expected array for a mixed tree (parity lock)', () => {
      const tree: FileNode[] = [
        { name: 'a.md', path: '/p/a.md', type: 'file', extension: '.md' },
        {
          name: 'dir',
          path: '/p/dir',
          type: 'directory',
          children: [
            { name: 'b.md', path: '/p/dir/b.md', type: 'file', extension: '.md' },
            { name: 'nested', path: '/p/dir/nested', type: 'directory', children: [
              { name: 'c.txt', path: '/p/dir/nested/c.txt', type: 'file', extension: '.txt' }
            ] }
          ]
        },
        { name: 'z.md', path: '/p/z.md', type: 'file', extension: '.md' }
      ]

      // Full deep-equal, not a spot check: pre-order, forward sibling order,
      // per-parent index reset, per-level depth and the flat-array `offset` are
      // all pinned at once.
      expect(flattenTree(tree)).toEqual([
        {
          name: 'a.md',
          path: '/p/a.md',
          type: 'file',
          extension: '.md',
          parentId: null,
          depth: 0,
          index: 0,
          offset: 0
        },
        {
          name: 'dir',
          path: '/p/dir',
          type: 'directory',
          children: tree[1].children,
          parentId: null,
          depth: 0,
          index: 1,
          offset: 1
        },
        {
          name: 'b.md',
          path: '/p/dir/b.md',
          type: 'file',
          extension: '.md',
          parentId: '/p/dir',
          depth: 1,
          index: 0,
          offset: 2
        },
        {
          name: 'nested',
          path: '/p/dir/nested',
          type: 'directory',
          children: tree[1].children![1].children,
          parentId: '/p/dir',
          depth: 1,
          index: 1,
          offset: 3
        },
        {
          name: 'c.txt',
          path: '/p/dir/nested/c.txt',
          type: 'file',
          extension: '.txt',
          parentId: '/p/dir/nested',
          depth: 2,
          index: 0,
          offset: 4
        },
        {
          name: 'z.md',
          path: '/p/z.md',
          type: 'file',
          extension: '.md',
          parentId: null,
          depth: 0,
          index: 2,
          offset: 5
        }
      ])

      expect(collectFlattenInvariantViolations(flattenTree(tree))).toEqual([])
    })
  })

  /**
   * Self-test for `collectFlattenInvariantViolations`.
   *
   * The scale tests lean on that helper instead of deep-equality (a 200k-node
   * expected array is not something a human reads), so the helper itself has to
   * be shown to reject a wrong-but-plausible ordering. Breadth-first is the
   * realistic accident: a rewrite that drains a QUEUE instead of a STACK still
   * emits every parent before its children with correct depth and per-parent
   * sibling indices, and would sail through the local checks – while breaking
   * `getProjection`, whose shallower-parent walk assumes the rows above the
   * hovered one are its enclosing subtree.
   */
  describe('flatten invariant guard', () => {
    /** dirA/{x.md}, dirB/{y.md} – two sibling subtrees, so BFS interleaves them */
    const tree: FileNode[] = [
      {
        name: 'dirA',
        path: '/p/dirA',
        type: 'directory',
        children: [{ name: 'x.md', path: '/p/dirA/x.md', type: 'file', extension: '.md' }]
      },
      {
        name: 'dirB',
        path: '/p/dirB',
        type: 'directory',
        children: [{ name: 'y.md', path: '/p/dirB/y.md', type: 'file', extension: '.md' }]
      }
    ]

    /**
     * Same nodes, breadth-first. Derived from the real output by a STABLE sort
     * on depth (so sibling order within each level is preserved) with `offset`
     * renumbered to the new positions – i.e. every per-node field stays
     * self-consistent and only the ORDER is wrong.
     */
    const breadthFirst = (): FlattenedNode[] =>
      [...flattenTree(tree)]
        .sort((a, b) => a.depth - b.depth)
        .map((node, position) => ({ ...node, offset: position }))

    it('accepts the depth-first output', () => {
      expect(collectFlattenInvariantViolations(flattenTree(tree))).toEqual([])
    })

    it('rejects a breadth-first ordering of the same nodes', () => {
      const reordered = breadthFirst()

      // Sanity: it really is the interleaved ordering, not the DFS one.
      expect(reordered.map(node => node.path)).toEqual([
        '/p/dirA',
        '/p/dirB',
        '/p/dirA/x.md',
        '/p/dirB/y.md'
      ])

      const violations = collectFlattenInvariantViolations(reordered)

      expect(violations.length).toBeGreaterThan(0)
      // Every violation comes from the contiguity check: the parent-first,
      // depth and sibling-index invariants all still hold under BFS, which is
      // exactly why the ancestor stack had to be added.
      expect(violations.every(v => v.includes('enclosing subtree'))).toBe(true)
      expect(violations[0]).toContain('/p/dirA/x.md')
    })
  })

  describe('flattenTree at scale (issue #60)', () => {
    const WIDE_CHILD_COUNT = 200_000
    const DIR_PATH = '/project/huge'

    /**
     * Reproduction of the reported crash.
     *
     * Pre-fix the flattener recursed and merged subtrees with
     * `flattened.push(...flattenTree(children, ...))`. Spread-into-push is
     * `Function.prototype.apply`, whose argument count is bounded by the engine
     * stack, so the FIRST directory whose flattened subtree exceeded that bound
     * threw. Observed on this fixture before the rewrite:
     *
     *   RangeError: Maximum call stack size exceeded
     *     at flattenTree (src/renderer/src/hooks/useDragDropTree.ts:45)
     *
     *   Reproduced 2026-08-11 on node v22.23.1 (Electron 39 bundles v22.22.1)
     *   by running this fixture through the pre-fix implementation; the test
     *   itself runs under vitest 3.2.6, default pool, jsdom environment.
     *
     * The trigger is subtree WIDTH, not nesting depth, which is why the fixture
     * is one directory holding 200 000 children rather than a flat root array
     * (a flat root array executes zero spreads and reproduces nothing).
     */
    it('should flatten one directory holding 200k children without throwing', () => {
      const children: FileNode[] = []
      for (let i = 0; i < WIDE_CHILD_COUNT; i++) {
        children.push({
          name: `file-${i}.md`,
          path: `${DIR_PATH}/file-${i}.md`,
          type: 'file',
          extension: '.md'
        })
      }
      const dir: FileNode = { name: 'huge', path: DIR_PATH, type: 'directory', children }

      let flattened: FlattenedNode[] = []
      expect(() => {
        flattened = flattenTree([dir])
      }).not.toThrow()

      expect(flattened).toHaveLength(WIDE_CHILD_COUNT + 1)

      // Shape locks – the directory is emitted first, its children follow.
      expect(flattened[0].type).toBe('directory')
      expect(flattened[0].path).toBe(DIR_PATH)
      expect(flattened[1].parentId).toBe(DIR_PATH)
      expect(flattened[1].depth).toBe(1)
      expect(flattened[1].index).toBe(0)
      expect(flattened[1].offset).toBe(1)
      expect(flattened[WIDE_CHILD_COUNT].index).toBe(WIDE_CHILD_COUNT - 1)
      expect(flattened[WIDE_CHILD_COUNT].offset).toBe(WIDE_CHILD_COUNT)

      // O(n) invariant scan over the whole result instead of spot checks.
      expect(collectFlattenInvariantViolations(flattened)).toEqual([])
    }, 60_000)

    /**
     * Depth guard – NOT a second reproduction of issue #60.
     *
     * The original failure was an argument-count limit (subtree width); neither
     * the pre-fix nor the post-fix implementation was depth-limited at the
     * scales a real project reaches. This test exists to pin that the rewrite
     * did not trade a width limit for a DEPTH limit: the explicit stack keeps
     * traversal state in a heap-allocated array, so nesting no longer consumes
     * call frames. A 20 000-level chain would be comfortably fatal to a
     * recursive implementation on a default V8 stack.
     */
    it('should flatten a ~20 000-level deep chain without throwing', () => {
      const DEPTH = 20_000

      // Flat, non-hierarchical path strings keep fixture memory linear -
      // concatenating 20 000 nested segments would be quadratic.
      let node: FileNode = {
        name: `level-${DEPTH - 1}`,
        path: `/deep/level-${DEPTH - 1}`,
        type: 'directory',
        children: []
      }
      for (let level = DEPTH - 2; level >= 0; level--) {
        node = {
          name: `level-${level}`,
          path: `/deep/level-${level}`,
          type: 'directory',
          children: [node]
        }
      }

      let flattened: FlattenedNode[] = []
      expect(() => {
        flattened = flattenTree([node])
      }).not.toThrow()

      expect(flattened).toHaveLength(DEPTH)
      expect(flattened[DEPTH - 1].depth).toBe(DEPTH - 1)
      expect(flattened[DEPTH - 1].offset).toBe(DEPTH - 1)
      expect(flattened[DEPTH - 1].parentId).toBe(`/deep/level-${DEPTH - 2}`)
      expect(collectFlattenInvariantViolations(flattened)).toEqual([])
    }, 60_000)
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
          offset: 0,
          children: []
        },
        {
          name: 'file1.md',
          path: '/project/folder1/file1.md',
          type: 'file',
          extension: '.md',
          parentId: '/project/folder1',
          depth: 1,
          index: 0,
          offset: 1
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
          offset: 0,
          children: []
        },
        {
          name: 'child1',
          path: '/root/child1',
          type: 'directory',
          parentId: '/root',
          depth: 1,
          index: 0,
          offset: 1,
          children: []
        },
        {
          name: 'grandchild.md',
          path: '/root/child1/grandchild.md',
          type: 'file',
          extension: '.md',
          parentId: '/root/child1',
          depth: 2,
          index: 0,
          offset: 2
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
        index: 0,
        offset: 0
      },
      {
        name: 'folder1',
        path: '/project/folder1',
        type: 'directory',
        parentId: null,
        depth: 0,
        index: 1,
        offset: 1,
        children: []
      },
      {
        name: 'child.md',
        path: '/project/folder1/child.md',
        type: 'file',
        extension: '.md',
        parentId: '/project/folder1',
        depth: 1,
        index: 0,
        offset: 2
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

  describe('getProjection with the optional node index', () => {
    const items = (): FlattenedNode[] =>
      flattenTree([
        { name: 'root.md', path: '/project/root.md', type: 'file', extension: '.md' },
        {
          name: 'folder1',
          path: '/project/folder1',
          type: 'directory',
          children: [
            { name: 'child.md', path: '/project/folder1/child.md', type: 'file', extension: '.md' }
          ]
        }
      ])

    const indexOf = (flattened: FlattenedNode[]): NodeIndex =>
      new Map(flattened.map(item => [item.path, item]))

    it('should produce the same projection with and without the index', () => {
      const flattened = items()

      const withoutIndex = getProjection(flattened, '/project/root.md', '/project/folder1', 16)
      const withIndex = getProjection(
        flattened,
        '/project/root.md',
        '/project/folder1',
        16,
        16,
        indexOf(flattened)
      )

      expect(withIndex).toEqual(withoutIndex)
      expect(withIndex).toMatchObject({ depth: 1, parentId: '/project/folder1' })
    })

    it('should resolve ids through the index when one is supplied', () => {
      const flattened = items()
      // Index deliberately missing the active id while the array still has it:
      // a null result proves the lookup went through the index, not the scan.
      const partialIndex = indexOf(flattened.filter(item => item.path !== '/project/root.md'))

      expect(getProjection(flattened, '/project/root.md', '/project/folder1', 16, 16, partialIndex))
        .toBeNull()
    })

    it('should clamp to the root level when the projected depth reaches 0', () => {
      const flattened = items()

      const projection = getProjection(
        flattened,
        '/project/root.md',
        '/project/folder1/child.md',
        -16,
        16,
        indexOf(flattened)
      )

      expect(projection).toMatchObject({ depth: 0, parentId: null })
    })

    /**
     * The shallower branch needs a hovered row at depth >= 2, so that dragging
     * one level left lands ABOVE the hovered node's own depth without clamping
     * to root.
     */
    const deepItems = (): FlattenedNode[] =>
      flattenTree([
        {
          name: 'dir',
          path: '/p/dir',
          type: 'directory',
          children: [
            {
              name: 'nested',
              path: '/p/dir/nested',
              type: 'directory',
              children: [
                { name: 'c.txt', path: '/p/dir/nested/c.txt', type: 'file', extension: '.txt' }
              ]
            }
          ]
        },
        { name: 'z.md', path: '/p/z.md', type: 'file', extension: '.md' }
      ])

    it('should resolve the same shallower parent with and without the index', () => {
      const flattened = deepItems()

      // Hovering the depth-2 file and dragging one level left projects depth 1,
      // whose parent is found by walking backwards to the nearest depth-0
      // directory – the positional branch.
      const withoutIndex = getProjection(flattened, '/p/z.md', '/p/dir/nested/c.txt', -16)
      const withIndex = getProjection(
        flattened,
        '/p/z.md',
        '/p/dir/nested/c.txt',
        -16,
        16,
        indexOf(flattened)
      )

      expect(withIndex).toEqual(withoutIndex)
      expect(withIndex).toMatchObject({ depth: 1, parentId: '/p/dir' })
    })

    it('should start the shallower walk from the indexed offset, not a scan', () => {
      const flattened = deepItems()
      const findIndexSpy = vi.spyOn(flattened, 'findIndex')

      try {
        const projection = getProjection(
          flattened,
          '/p/z.md',
          '/p/dir/nested/c.txt',
          -16,
          16,
          indexOf(flattened)
        )

        // Same answer as the scan, but `offset` supplied the starting row.
        expect(projection).toMatchObject({ depth: 1, parentId: '/p/dir' })
        expect(findIndexSpy).not.toHaveBeenCalled()
      } finally {
        findIndexSpy.mockRestore()
      }
    })

    it('should still scan positionally when no index is supplied', () => {
      const flattened = deepItems()
      const findIndexSpy = vi.spyOn(flattened, 'findIndex')

      try {
        expect(getProjection(flattened, '/p/z.md', '/p/dir/nested/c.txt', -16))
          .toMatchObject({ depth: 1, parentId: '/p/dir' })
        expect(findIndexSpy).toHaveBeenCalledWith(expect.any(Function))
      } finally {
        findIndexSpy.mockRestore()
      }
    })
  })

  describe('useDragDropTree node index', () => {
    beforeEach(() => {
      // The hook logs flatten timing through the renderer logger, which posts
      // to the main process over the preload bridge.
      ;(window as any).api = { logging: { log: vi.fn() } }
    })

    afterEach(() => {
      // Delete rather than set to `undefined`: a leaked bridge stub would make
      // a later test that asserts "no bridge" pass against this one's leftovers.
      delete (window as any).api
    })

    const tree: FileNode[] = [
      { name: 'a.md', path: '/p/a.md', type: 'file', extension: '.md' },
      {
        name: 'dir',
        path: '/p/dir',
        type: 'directory',
        children: [{ name: 'b.md', path: '/p/dir/b.md', type: 'file', extension: '.md' }]
      }
    ]

    it('should build the array and the index in a single pass', () => {
      const { result } = renderHook(() => useDragDropTree(tree, '/p'))

      expect(result.current.flattenedItems).toHaveLength(3)
      // Asserted through `findNode` because the Map is not part of the hook's
      // public surface. Same object IDENTITIES – the lookup resolves the very
      // nodes in the array, so the index is not a second traversal or a copy.
      for (const item of result.current.flattenedItems) {
        expect(result.current.findNode(item.path)).toBe(item)
      }
    })

    it('should keep the first occurrence when paths are duplicated', () => {
      const duplicated: FileNode[] = [
        { name: 'first', path: '/p/dup', type: 'directory', children: [] },
        { name: 'second', path: '/p/dup', type: 'file', extension: '.md' }
      ]

      const { result } = renderHook(() => useDragDropTree(duplicated, '/p'))

      expect(result.current.flattenedItems).toHaveLength(2)
      // `Array.find` semantics: the first node wins, and it is that exact node.
      expect(result.current.findNode('/p/dup')).toBe(result.current.flattenedItems[0])
      expect(result.current.findNode('/p/dup')?.name).toBe('first')
    })

    it('should resolve drag ids through the index, never by scanning the array', () => {
      // Both paths return the same node, so the only observable difference is
      // WHICH lookup ran: without an index `getProjection` falls back to
      // `flattenedItems.find(…)`. Spying on the memoised array instance the
      // hook actually passes is what separates them.
      const { result } = renderHook(() => useDragDropTree(tree, '/p'))
      const findSpy = vi.spyOn(result.current.flattenedItems, 'find')

      try {
        const projection = result.current.getProjection('/p/a.md', '/p/dir', 16)

        expect(projection).toMatchObject({ depth: 1, parentId: '/p/dir' })
        expect(findSpy).not.toHaveBeenCalled()
      } finally {
        findSpy.mockRestore()
      }
    })

    it('should return undefined for an unknown path', () => {
      const { result } = renderHook(() => useDragDropTree(tree, '/p'))

      expect(result.current.findNode('/p/missing.md')).toBeUndefined()
      expect(result.current.findNodeWithRoot('/p/missing.md', null)).toBeUndefined()
    })

    it('should resolve nested nodes by path', () => {
      const { result } = renderHook(() => useDragDropTree(tree, '/p'))

      expect(result.current.findNode('/p/dir/b.md')).toMatchObject({
        name: 'b.md',
        parentId: '/p/dir',
        depth: 1,
        index: 0
      })
    })

    it('should keep the synthetic root out of findNode but resolvable via findNodeWithRoot', () => {
      const rootNode: FileNode = {
        name: 'p',
        path: '/p',
        type: 'directory',
        children: tree
      }

      const { result } = renderHook(() => useDragDropTree(tree, '/p'))

      expect(result.current.findNode('/p')).toBeUndefined()
      expect(result.current.findNodeWithRoot('/p', rootNode)).toMatchObject({
        path: '/p',
        type: 'directory',
        parentId: null,
        depth: 0,
        index: 0,
        // The synthetic root has no slot in `flattenedItems`; -1 keeps
        // positional consumers on the "not found" path.
        offset: -1
      })
    })

    it('should check the synthetic root before the index', () => {
      // A base-tree entry shadowing the root path must lose: root wins.
      const shadowed: FileNode[] = [
        { name: 'shadow', path: '/p', type: 'file', extension: '.md' }
      ]
      const rootNode: FileNode = { name: 'p', path: '/p', type: 'directory', children: shadowed }

      const { result } = renderHook(() => useDragDropTree(shadowed, '/p'))

      expect(result.current.findNodeWithRoot('/p', rootNode)).toMatchObject({
        name: 'p',
        type: 'directory'
      })
    })

    it('should rebuild the index when files change', () => {
      const { result, rerender } = renderHook(
        ({ files }: { files: FileNode[] }) => useDragDropTree(files, '/p'),
        { initialProps: { files: tree } }
      )

      expect(result.current.findNode('/p/a.md')).toBeDefined()

      const nextTree: FileNode[] = [
        { name: 'c.md', path: '/p/c.md', type: 'file', extension: '.md' },
        tree[1]
      ]
      rerender({ files: nextTree })

      expect(result.current.findNode('/p/a.md')).toBeUndefined()
      expect(result.current.findNode('/p/c.md')).toBeDefined()
      expect(result.current.findNode('/p/dir/b.md')).toBeDefined()
    })
  })

  describe('flatten timing instrumentation', () => {
    const tree: FileNode[] = [
      { name: 'a.md', path: '/p/a.md', type: 'file', extension: '.md' }
    ]

    /** Make every `performance.now()` pair `stepMs` apart */
    function stubClock(stepMs: number) {
      let clock = 0
      vi.spyOn(performance, 'now').mockImplementation(() => {
        const value = clock
        clock += stepMs
        return value
      })
    }

    beforeEach(() => {
      ;(window as any).api = { logging: { log: vi.fn() } }
    })

    afterEach(() => {
      vi.restoreAllMocks()
      delete (window as any).api
    })

    it('reports slow flattens at info level with the documented payload', () => {
      stubClock(120)
      const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {})

      renderHook(() => useDragDropTree(tree, '/p'))

      expect(infoSpy).toHaveBeenCalledWith('[ProjectTree] flatten completed', {
        nodeCount: 1,
        durationMs: 120
      })
    })

    it('reports fast flattens at debug level instead', () => {
      stubClock(0)
      const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {})
      const debugSpy = vi.spyOn(logger, 'debug').mockImplementation(() => {})

      renderHook(() => useDragDropTree(tree, '/p'))

      expect(debugSpy).toHaveBeenCalledWith('[ProjectTree] flatten completed', {
        nodeCount: 1,
        durationMs: 0
      })
      expect(infoSpy).not.toHaveBeenCalledWith(
        '[ProjectTree] flatten completed',
        expect.anything()
      )
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
