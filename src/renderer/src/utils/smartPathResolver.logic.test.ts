// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for smartPathResolver.logic.ts
 *
 * Tests the smart path resolution orchestration logic.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  isFilenameOnly,
  extractFilenameFromPath,
  ensureIndexBuilt,
  resolveFromIndex,
  resolvePathSmartSync,
  resolvePathSmart,
  createSmartResolver
} from './smartPathResolver.logic'
import { createFilenameIndex, type FilenameIndex } from './filenameIndex'
import type { FileNode } from '../../../preload/index'

describe('smartPathResolver', () => {
  describe('isFilenameOnly', () => {
    it('should return true for filename only', () => {
      expect(isFilenameOnly('Button.tsx')).toBe(true)
    })

    it('should return false for POSIX path', () => {
      expect(isFilenameOnly('src/Button.tsx')).toBe(false)
    })

    it('should return false for Windows path', () => {
      expect(isFilenameOnly('src\\Button.tsx')).toBe(false)
    })

    it('should return true for filename with dots', () => {
      expect(isFilenameOnly('Button.test.tsx')).toBe(true)
    })

    it('should return true for dotfiles', () => {
      expect(isFilenameOnly('.gitignore')).toBe(true)
    })
  })

  describe('extractFilenameFromPath', () => {
    it('should extract filename from path', () => {
      expect(extractFilenameFromPath('/project/src/Button.tsx')).toBe('Button.tsx')
    })

    it('should strip line number suffix', () => {
      expect(extractFilenameFromPath('Button.tsx:42')).toBe('Button.tsx')
    })

    it('should strip line:column suffix', () => {
      expect(extractFilenameFromPath('Button.tsx:42:10')).toBe('Button.tsx')
    })

    it('should handle Windows paths with line numbers', () => {
      expect(extractFilenameFromPath('C:\\project\\Button.tsx:42')).toBe('Button.tsx')
    })

    it('should handle path with line number', () => {
      expect(extractFilenameFromPath('/project/src/Button.tsx:42:10')).toBe('Button.tsx')
    })

    it('should handle filename only', () => {
      expect(extractFilenameFromPath('Button.tsx')).toBe('Button.tsx')
    })

    it('should handle TypeScript parenthesis format', () => {
      expect(extractFilenameFromPath('Button.tsx(15,7)')).toBe('Button.tsx')
    })

    it('should handle TypeScript format with line only', () => {
      expect(extractFilenameFromPath('file.ts(42)')).toBe('file.ts')
    })

    it('should handle path with TypeScript format', () => {
      expect(extractFilenameFromPath('src/components/Button.tsx(15,7)')).toBe('Button.tsx')
    })

    it('should not strip parentheses from regular filenames', () => {
      expect(extractFilenameFromPath('Component(HOC).tsx')).toBe('Component(HOC).tsx')
    })
  })

  describe('ensureIndexBuilt', () => {
    it('should build index when not built', () => {
      const index = createFilenameIndex()
      const files: FileNode[] = [{ name: 'file.ts', path: '/file.ts', type: 'file' }]

      expect(index.isBuilt).toBe(false)
      ensureIndexBuilt(index, files)
      expect(index.isBuilt).toBe(true)
    })

    it('should not rebuild when already built', () => {
      const index = createFilenameIndex()
      const files: FileNode[] = [{ name: 'file.ts', path: '/file.ts', type: 'file' }]

      index.rebuild(files)
      const sizeBefore = index.size

      ensureIndexBuilt(index, files)

      expect(index.size).toBe(sizeBefore)
    })

    it('should not build with empty files', () => {
      const index = createFilenameIndex()
      ensureIndexBuilt(index, [])
      expect(index.isBuilt).toBe(false)
    })
  })

  describe('resolveFromIndex', () => {
    let index: FilenameIndex

    beforeEach(() => {
      index = createFilenameIndex()
    })

    it('should return no-match when file not found', () => {
      const files: FileNode[] = [{ name: 'other.ts', path: '/other.ts', type: 'file' }]
      index.rebuild(files)

      const result = resolveFromIndex('Button.tsx', 'Button.tsx', index)

      expect(result.status).toBe('no-match')
      expect(result.wasSmartResolved).toBe(true)
    })

    it('should return single-match for unique file', () => {
      const files: FileNode[] = [{ name: 'Button.tsx', path: '/src/Button.tsx', type: 'file' }]
      index.rebuild(files)

      const result = resolveFromIndex('Button.tsx', 'Button.tsx', index)

      expect(result.status).toBe('single-match')
      expect(result.resolvedPath).toBe('/src/Button.tsx')
      expect(result.wasSmartResolved).toBe(true)
    })

    it('should return multiple-matches with ranked candidates', () => {
      const files: FileNode[] = [
        { name: 'Button.tsx', path: '/src/components/Button.tsx', type: 'file' },
        { name: 'Button.tsx', path: '/src/ui/Button.tsx', type: 'file' },
        { name: 'Button.tsx', path: '/legacy/Button.tsx', type: 'file' }
      ]
      index.rebuild(files)

      const result = resolveFromIndex('Button.tsx', 'Button.tsx', index)

      expect(result.status).toBe('multiple-matches')
      expect(result.candidates).toHaveLength(3)
      expect(result.candidates![0]).toHaveProperty('path')
      expect(result.candidates![0]).toHaveProperty('score')
      expect(result.wasSmartResolved).toBe(true)
    })

    it('should rank candidates by partial path match', () => {
      const files: FileNode[] = [
        { name: 'Button.tsx', path: '/other/Button.tsx', type: 'file' },
        { name: 'Button.tsx', path: '/components/Button.tsx', type: 'file' }
      ]
      index.rebuild(files)

      const result = resolveFromIndex('Button.tsx', 'components/Button.tsx', index)

      expect(result.status).toBe('multiple-matches')
      // The one matching the query path should rank first
      expect(result.candidates![0].path).toBe('/components/Button.tsx')
    })
  })

  describe('resolvePathSmartSync', () => {
    it('should resolve filename to single match', () => {
      const index = createFilenameIndex()
      const files: FileNode[] = [{ name: 'Button.tsx', path: '/src/Button.tsx', type: 'file' }]

      const result = resolvePathSmartSync('Button.tsx', index, files)

      expect(result.status).toBe('single-match')
      expect(result.resolvedPath).toBe('/src/Button.tsx')
    })

    it('should build index lazily', () => {
      const index = createFilenameIndex()
      const files: FileNode[] = [{ name: 'file.ts', path: '/file.ts', type: 'file' }]

      expect(index.isBuilt).toBe(false)

      resolvePathSmartSync('file.ts', index, files)

      expect(index.isBuilt).toBe(true)
    })

    it('should extract filename from path with line numbers', () => {
      const index = createFilenameIndex()
      const files: FileNode[] = [{ name: 'Button.tsx', path: '/src/Button.tsx', type: 'file' }]

      const result = resolvePathSmartSync('Button.tsx:42:10', index, files)

      expect(result.status).toBe('single-match')
      expect(result.resolvedPath).toBe('/src/Button.tsx')
    })

    it('should handle full path with filename extraction', () => {
      const index = createFilenameIndex()
      const files: FileNode[] = [{ name: 'Button.tsx', path: '/project/src/Button.tsx', type: 'file' }]

      const result = resolvePathSmartSync('/wrong/path/Button.tsx', index, files)

      expect(result.status).toBe('single-match')
      expect(result.resolvedPath).toBe('/project/src/Button.tsx')
    })
  })

  describe('resolvePathSmart', () => {
    it('should return exact match when validation passes', async () => {
      const index = createFilenameIndex()
      const files: FileNode[] = [{ name: 'Button.tsx', path: '/src/Button.tsx', type: 'file' }]
      const validateExactPath = vi.fn().mockResolvedValue(true)

      const result = await resolvePathSmart({
        path: '/src/Button.tsx',
        cwd: null,
        projectRoot: '/project',
        index,
        files,
        validateExactPath
      })

      expect(result.status).toBe('exact')
      expect(result.resolvedPath).toBe('/src/Button.tsx')
      expect(result.wasSmartResolved).toBe(false)
    })

    it('should fall back to smart resolution when exact fails', async () => {
      const index = createFilenameIndex()
      const files: FileNode[] = [{ name: 'Button.tsx', path: '/src/Button.tsx', type: 'file' }]
      const validateExactPath = vi.fn().mockResolvedValue(false)

      const result = await resolvePathSmart({
        path: 'Button.tsx',
        cwd: null,
        projectRoot: '/project',
        index,
        files,
        validateExactPath
      })

      expect(result.status).toBe('single-match')
      expect(result.wasSmartResolved).toBe(true)
    })

    it('should use smart resolution directly when no validateExactPath', async () => {
      const index = createFilenameIndex()
      const files: FileNode[] = [{ name: 'Button.tsx', path: '/src/Button.tsx', type: 'file' }]

      const result = await resolvePathSmart({
        path: 'Button.tsx',
        cwd: null,
        projectRoot: '/project',
        index,
        files
        // No validateExactPath
      })

      expect(result.status).toBe('single-match')
      expect(result.wasSmartResolved).toBe(true)
    })

    it('should resolve relative paths using cwd', async () => {
      const index = createFilenameIndex()
      const files: FileNode[] = [{ name: 'file.ts', path: '/project/src/file.ts', type: 'file' }]
      const validateExactPath = vi.fn().mockResolvedValue(true)

      await resolvePathSmart({
        path: 'src/file.ts',
        cwd: '/project',
        projectRoot: '/project',
        index,
        files,
        validateExactPath
      })

      // Should have tried to validate /project/src/file.ts
      expect(validateExactPath).toHaveBeenCalledWith('/project/src/file.ts')
    })
  })

  describe('createSmartResolver', () => {
    it('should create resolver with index', () => {
      const files: FileNode[] = [{ name: 'file.ts', path: '/src/file.ts', type: 'file' }]
      const resolver = createSmartResolver(files, '/project')

      expect(resolver.index).toBeDefined()
      expect(typeof resolver.resolve).toBe('function')
    })

    it('should resolve paths via created resolver', async () => {
      const files: FileNode[] = [{ name: 'Button.tsx', path: '/src/Button.tsx', type: 'file' }]
      const resolver = createSmartResolver(files, '/project')

      const result = await resolver.resolve('Button.tsx', null)

      expect(result.status).toBe('single-match')
      expect(result.resolvedPath).toBe('/src/Button.tsx')
    })

    it('should support validateExactPath in resolver', async () => {
      const files: FileNode[] = [{ name: 'Button.tsx', path: '/src/Button.tsx', type: 'file' }]
      const resolver = createSmartResolver(files, '/project')
      const validate = vi.fn().mockResolvedValue(true)

      const result = await resolver.resolve('/exact/Button.tsx', null, validate)

      expect(result.status).toBe('exact')
      expect(validate).toHaveBeenCalled()
    })

    it('should share index across multiple resolve calls', async () => {
      const files: FileNode[] = [{ name: 'file.ts', path: '/src/file.ts', type: 'file' }]
      const resolver = createSmartResolver(files, '/project')

      await resolver.resolve('file.ts', null)
      expect(resolver.index.isBuilt).toBe(true)

      // Second call should reuse built index
      const indexSizeBefore = resolver.index.size
      await resolver.resolve('file.ts', null)
      expect(resolver.index.size).toBe(indexSizeBefore)
    })
  })

  describe('integration scenarios', () => {
    it('should handle TypeScript error format', async () => {
      const index = createFilenameIndex()
      const files: FileNode[] = [
        { name: 'Button.tsx', path: '/project/src/components/Button.tsx', type: 'file' }
      ]

      const result = await resolvePathSmart({
        path: 'src/components/Button.tsx(15,7)',
        cwd: null,
        projectRoot: '/project',
        index,
        files
      })

      // Should extract Button.tsx from the error format
      expect(result.status).toBe('single-match')
    })

    it('should prefer matching partial path in multiple matches', async () => {
      const index = createFilenameIndex()
      const files: FileNode[] = [
        { name: 'index.ts', path: '/project/src/pages/index.ts', type: 'file' },
        { name: 'index.ts', path: '/project/src/components/index.ts', type: 'file' },
        { name: 'index.ts', path: '/project/src/utils/index.ts', type: 'file' }
      ]

      const result = await resolvePathSmart({
        path: 'pages/index.ts',
        cwd: null,
        projectRoot: '/project',
        index,
        files
      })

      expect(result.status).toBe('multiple-matches')
      // First candidate should be the pages one
      expect(result.candidates![0].path).toBe('/project/src/pages/index.ts')
    })

    it('should handle case-insensitive filenames', async () => {
      const index = createFilenameIndex()
      const files: FileNode[] = [
        { name: 'README.md', path: '/project/README.md', type: 'file' }
      ]

      const result = await resolvePathSmart({
        path: 'readme.md',
        cwd: null,
        projectRoot: '/project',
        index,
        files
      })

      expect(result.status).toBe('single-match')
      expect(result.resolvedPath).toBe('/project/README.md')
    })
  })
})
