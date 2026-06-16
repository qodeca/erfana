// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for filenameIndex.ts
 *
 * Tests the filename index used for O(1) filename lookups
 * in smart file path resolution.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createFilenameIndex,
  extractFilename,
  collectFilePaths,
  buildFilenameMap,
  type FilenameIndex
} from './filenameIndex'
import type { FileNode } from '../../../preload/index'

describe('filenameIndex', () => {
  describe('extractFilename', () => {
    it('should extract filename from POSIX path', () => {
      expect(extractFilename('/project/src/Button.tsx')).toBe('Button.tsx')
    })

    it('should extract filename from Windows path', () => {
      expect(extractFilename('C:\\Users\\dev\\Button.tsx')).toBe('Button.tsx')
    })

    it('should extract filename from mixed separators', () => {
      expect(extractFilename('/project\\src/Button.tsx')).toBe('Button.tsx')
    })

    it('should return filename if no path separator', () => {
      expect(extractFilename('Button.tsx')).toBe('Button.tsx')
    })

    it('should handle nested paths', () => {
      expect(extractFilename('/a/b/c/d/e/file.ts')).toBe('file.ts')
    })

    it('should handle root level file', () => {
      expect(extractFilename('/file.md')).toBe('file.md')
    })

    it('should handle dotfiles', () => {
      expect(extractFilename('/project/.gitignore')).toBe('.gitignore')
    })

    it('should handle files with multiple dots', () => {
      expect(extractFilename('/project/file.test.ts')).toBe('file.test.ts')
    })
  })

  describe('collectFilePaths', () => {
    it('should collect paths from flat structure', () => {
      const files: FileNode[] = [
        { name: 'file1.ts', path: '/project/file1.ts', type: 'file' },
        { name: 'file2.ts', path: '/project/file2.ts', type: 'file' }
      ]

      const paths = collectFilePaths(files)
      expect(paths).toEqual(['/project/file1.ts', '/project/file2.ts'])
    })

    it('should collect paths from nested structure', () => {
      const files: FileNode[] = [
        {
          name: 'src',
          path: '/project/src',
          type: 'directory',
          children: [
            { name: 'index.ts', path: '/project/src/index.ts', type: 'file' },
            {
              name: 'components',
              path: '/project/src/components',
              type: 'directory',
              children: [
                { name: 'Button.tsx', path: '/project/src/components/Button.tsx', type: 'file' }
              ]
            }
          ]
        }
      ]

      const paths = collectFilePaths(files)
      expect(paths).toEqual(['/project/src/index.ts', '/project/src/components/Button.tsx'])
    })

    it('should exclude directories', () => {
      const files: FileNode[] = [
        { name: 'file.ts', path: '/project/file.ts', type: 'file' },
        { name: 'folder', path: '/project/folder', type: 'directory', children: [] }
      ]

      const paths = collectFilePaths(files)
      expect(paths).toEqual(['/project/file.ts'])
    })

    it('should handle empty tree', () => {
      expect(collectFilePaths([])).toEqual([])
    })

    it('should handle directory without children property', () => {
      const files: FileNode[] = [{ name: 'folder', path: '/project/folder', type: 'directory' }]

      const paths = collectFilePaths(files)
      expect(paths).toEqual([])
    })

    it('should handle deeply nested structures', () => {
      const files: FileNode[] = [
        {
          name: 'a',
          path: '/a',
          type: 'directory',
          children: [
            {
              name: 'b',
              path: '/a/b',
              type: 'directory',
              children: [
                {
                  name: 'c',
                  path: '/a/b/c',
                  type: 'directory',
                  children: [{ name: 'deep.ts', path: '/a/b/c/deep.ts', type: 'file' }]
                }
              ]
            }
          ]
        }
      ]

      const paths = collectFilePaths(files)
      expect(paths).toEqual(['/a/b/c/deep.ts'])
    })
  })

  describe('buildFilenameMap', () => {
    it('should build map from paths', () => {
      const paths = ['/project/src/Button.tsx', '/project/lib/utils.ts']

      const map = buildFilenameMap(paths)

      expect(map.get('button.tsx')).toEqual(['/project/src/Button.tsx'])
      expect(map.get('utils.ts')).toEqual(['/project/lib/utils.ts'])
    })

    it('should handle duplicate filenames', () => {
      const paths = [
        '/project/src/components/Button.tsx',
        '/project/src/ui/Button.tsx',
        '/project/legacy/Button.tsx'
      ]

      const map = buildFilenameMap(paths)
      const buttons = map.get('button.tsx')

      expect(buttons).toHaveLength(3)
      expect(buttons).toContain('/project/src/components/Button.tsx')
      expect(buttons).toContain('/project/src/ui/Button.tsx')
      expect(buttons).toContain('/project/legacy/Button.tsx')
    })

    it('should be case-insensitive', () => {
      const paths = ['/project/README.md', '/project/docs/readme.md']

      const map = buildFilenameMap(paths)
      const readmes = map.get('readme.md')

      expect(readmes).toHaveLength(2)
    })

    it('should handle empty array', () => {
      const map = buildFilenameMap([])
      expect(map.size).toBe(0)
    })
  })

  describe('createFilenameIndex', () => {
    let index: FilenameIndex

    beforeEach(() => {
      index = createFilenameIndex()
    })

    describe('initial state', () => {
      it('should not be built initially', () => {
        expect(index.isBuilt).toBe(false)
      })

      it('should have zero size initially', () => {
        expect(index.size).toBe(0)
      })

      it('should have zero totalPaths initially', () => {
        expect(index.totalPaths).toBe(0)
      })

      it('should return undefined for any lookup before build', () => {
        expect(index.get('anything.ts')).toBeUndefined()
      })
    })

    describe('rebuild', () => {
      it('should build index from file tree', () => {
        const files: FileNode[] = [
          { name: 'Button.tsx', path: '/project/Button.tsx', type: 'file' }
        ]

        index.rebuild(files)

        expect(index.isBuilt).toBe(true)
        expect(index.get('Button.tsx')).toEqual(['/project/Button.tsx'])
      })

      it('should update size after build', () => {
        const files: FileNode[] = [
          { name: 'a.ts', path: '/a.ts', type: 'file' },
          { name: 'b.ts', path: '/b.ts', type: 'file' }
        ]

        index.rebuild(files)

        expect(index.size).toBe(2)
      })

      it('should update totalPaths after build', () => {
        const files: FileNode[] = [
          {
            name: 'src',
            path: '/src',
            type: 'directory',
            children: [
              { name: 'a.ts', path: '/src/a.ts', type: 'file' },
              { name: 'b.ts', path: '/src/b.ts', type: 'file' },
              { name: 'c.ts', path: '/src/c.ts', type: 'file' }
            ]
          }
        ]

        index.rebuild(files)

        expect(index.totalPaths).toBe(3)
      })

      it('should allow rebuilding multiple times', () => {
        const files1: FileNode[] = [{ name: 'old.ts', path: '/old.ts', type: 'file' }]
        const files2: FileNode[] = [{ name: 'new.ts', path: '/new.ts', type: 'file' }]

        index.rebuild(files1)
        expect(index.get('old.ts')).toBeDefined()

        index.rebuild(files2)
        expect(index.get('old.ts')).toBeUndefined()
        expect(index.get('new.ts')).toEqual(['/new.ts'])
      })
    })

    describe('get', () => {
      beforeEach(() => {
        const files: FileNode[] = [
          { name: 'Button.tsx', path: '/src/Button.tsx', type: 'file' },
          { name: 'Button.tsx', path: '/ui/Button.tsx', type: 'file' },
          { name: 'utils.ts', path: '/src/utils.ts', type: 'file' }
        ]
        index.rebuild(files)
      })

      it('should return matching paths', () => {
        const results = index.get('Button.tsx')
        expect(results).toHaveLength(2)
        expect(results).toContain('/src/Button.tsx')
        expect(results).toContain('/ui/Button.tsx')
      })

      it('should be case-insensitive', () => {
        expect(index.get('button.tsx')).toHaveLength(2)
        expect(index.get('BUTTON.TSX')).toHaveLength(2)
        expect(index.get('Button.TSX')).toHaveLength(2)
      })

      it('should return undefined for non-existent files', () => {
        expect(index.get('NonExistent.ts')).toBeUndefined()
      })

      it('should return single-element array for unique files', () => {
        const results = index.get('utils.ts')
        expect(results).toEqual(['/src/utils.ts'])
      })
    })

    describe('clear', () => {
      it('should reset all state', () => {
        const files: FileNode[] = [{ name: 'file.ts', path: '/file.ts', type: 'file' }]
        index.rebuild(files)

        expect(index.isBuilt).toBe(true)

        index.clear()

        expect(index.isBuilt).toBe(false)
        expect(index.size).toBe(0)
        expect(index.totalPaths).toBe(0)
        expect(index.get('file.ts')).toBeUndefined()
      })
    })
  })
})
