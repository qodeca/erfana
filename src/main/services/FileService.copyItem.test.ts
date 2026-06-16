// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FileService } from './FileService'
import { mkdtemp, mkdir, writeFile, rm, stat } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

describe('FileService.copyItem', () => {
  let fileService: FileService
  let testDir: string

  beforeEach(async () => {
    fileService = new FileService()
    // Create temporary test directory
    testDir = await mkdtemp(join(tmpdir(), 'erfana-copy-test-'))
    fileService.setProjectPath(testDir)
  })

  afterEach(async () => {
    // Clean up test directory
    await rm(testDir, { recursive: true, force: true })
  })

  describe('Basic copy operations', () => {
    it('should copy a file to a different folder', async () => {
      // Setup
      const sourceFile = join(testDir, 'file.md')
      const targetFolder = join(testDir, 'folder')
      await writeFile(sourceFile, 'test content', 'utf-8')
      await mkdir(targetFolder)

      // Execute copy
      const result = await fileService.copyItem(sourceFile, targetFolder)

      // Verify
      expect(result.path).toBe(join(targetFolder, 'file.md'))
      const targetStats = await stat(result.path)
      expect(targetStats.isFile()).toBe(true)

      // Verify source still exists
      const sourceStats = await stat(sourceFile)
      expect(sourceStats.isFile()).toBe(true)

      // Verify content copied
      const content = await fileService.readFile(result.path)
      expect(content).toBe('test content')
    })

    it('should copy a directory with children recursively', async () => {
      // Setup
      const sourceFolder = join(testDir, 'source')
      const targetFolder = join(testDir, 'target')
      await mkdir(sourceFolder)
      await mkdir(targetFolder)
      await writeFile(join(sourceFolder, 'child.md'), 'child content', 'utf-8')
      await mkdir(join(sourceFolder, 'subfolder'))
      await writeFile(join(sourceFolder, 'subfolder', 'nested.md'), 'nested', 'utf-8')

      // Execute copy
      const result = await fileService.copyItem(sourceFolder, targetFolder)

      // Verify
      expect(result.path).toBe(join(targetFolder, 'source'))
      const stats = await stat(result.path)
      expect(stats.isDirectory()).toBe(true)

      // Verify children copied
      const childStats = await stat(join(result.path, 'child.md'))
      expect(childStats.isFile()).toBe(true)
      const nestedStats = await stat(join(result.path, 'subfolder', 'nested.md'))
      expect(nestedStats.isFile()).toBe(true)

      // Verify source still exists
      const sourceStats = await stat(sourceFolder)
      expect(sourceStats.isDirectory()).toBe(true)
    })

    it('should rename file during copy when newName is provided', async () => {
      // Setup
      const sourceFile = join(testDir, 'original.md')
      const targetFolder = join(testDir, 'folder')
      await writeFile(sourceFile, 'content', 'utf-8')
      await mkdir(targetFolder)

      // Execute copy with rename
      const result = await fileService.copyItem(sourceFile, targetFolder, 'renamed.md')

      // Verify
      expect(result.path).toBe(join(targetFolder, 'renamed.md'))
      const stats = await stat(result.path)
      expect(stats.isFile()).toBe(true)

      // Verify source still exists
      await stat(sourceFile) // Should not throw
    })
  })

  describe('Auto-numbering for name conflicts', () => {
    it('should auto-number when target name already exists', async () => {
      // Setup: Create source and existing target with same name
      const sourceFile = join(testDir, 'file.md')
      const targetFolder = join(testDir, 'folder')
      await writeFile(sourceFile, 'source', 'utf-8')
      await mkdir(targetFolder)
      await writeFile(join(targetFolder, 'file.md'), 'existing', 'utf-8')

      // Execute copy
      const result = await fileService.copyItem(sourceFile, targetFolder)

      // Verify: Should create "file (1).md"
      expect(result.path).toBe(join(targetFolder, 'file (1).md'))
      const stats = await stat(result.path)
      expect(stats.isFile()).toBe(true)

      // Verify original still exists
      const originalStats = await stat(join(targetFolder, 'file.md'))
      expect(originalStats.isFile()).toBe(true)
    })

    it('should increment numbering for multiple conflicts', async () => {
      // Setup
      const sourceFile = join(testDir, 'file.md')
      const targetFolder = join(testDir, 'folder')
      await writeFile(sourceFile, 'source', 'utf-8')
      await mkdir(targetFolder)
      await writeFile(join(targetFolder, 'file.md'), 'existing', 'utf-8')
      await writeFile(join(targetFolder, 'file (1).md'), 'copy1', 'utf-8')
      await writeFile(join(targetFolder, 'file (2).md'), 'copy2', 'utf-8')

      // Execute copy
      const result = await fileService.copyItem(sourceFile, targetFolder)

      // Verify: Should create "file (3).md"
      expect(result.path).toBe(join(targetFolder, 'file (3).md'))
      const stats = await stat(result.path)
      expect(stats.isFile()).toBe(true)
    })

    it('should preserve file extension during auto-numbering', async () => {
      // Setup
      const sourceFile = join(testDir, 'document.markdown')
      const targetFolder = join(testDir, 'folder')
      await writeFile(sourceFile, 'source', 'utf-8')
      await mkdir(targetFolder)
      await writeFile(join(targetFolder, 'document.markdown'), 'existing', 'utf-8')

      // Execute copy
      const result = await fileService.copyItem(sourceFile, targetFolder)

      // Verify: Extension preserved
      expect(result.path).toBe(join(targetFolder, 'document (1).markdown'))
      const stats = await stat(result.path)
      expect(stats.isFile()).toBe(true)
    })

    it('should handle files without extension during auto-numbering', async () => {
      // Setup
      const sourceFile = join(testDir, 'README')
      const targetFolder = join(testDir, 'folder')
      await writeFile(sourceFile, 'source', 'utf-8')
      await mkdir(targetFolder)
      await writeFile(join(targetFolder, 'README'), 'existing', 'utf-8')

      // Execute copy
      const result = await fileService.copyItem(sourceFile, targetFolder)

      // Verify: No extension
      expect(result.path).toBe(join(targetFolder, 'README (1)'))
      const stats = await stat(result.path)
      expect(stats.isFile()).toBe(true)
    })

    // NOTE: the MAX_COPY_ATTEMPTS boundary test was moved to
    // `FileService.copyItem.limit.test.ts` with mocked fs so it runs in <100 ms
    // cross-platform instead of 25+ s on Windows NTFS. See docs/windows/contributing.md
    // "Test-file split policy".
  })

  describe('Validation constraints', () => {
    it('should throw error when copying item outside project boundary', async () => {
      // Setup
      const file = join(testDir, 'file.md')
      await writeFile(file, 'content', 'utf-8')

      // Create target outside project
      const outsideDir = await mkdtemp(join(tmpdir(), 'erfana-outside-'))

      try {
        // Execute & Verify
        await expect(
          fileService.copyItem(file, outsideDir)
        ).rejects.toThrow('Cannot copy items to outside the project directory')
      } finally {
        await rm(outsideDir, { recursive: true, force: true })
      }
    })

    it('should throw error when copying item from outside project boundary', async () => {
      // Setup
      const outsideDir = await mkdtemp(join(tmpdir(), 'erfana-outside-'))
      const outsideFile = join(outsideDir, 'file.md')
      await writeFile(outsideFile, 'content', 'utf-8')

      // Create target inside project
      const insideFolder = join(testDir, 'folder')
      await mkdir(insideFolder)

      try {
        // Execute & Verify
        await expect(
          fileService.copyItem(outsideFile, insideFolder)
        ).rejects.toThrow('Cannot copy items outside the project directory')
      } finally {
        await rm(outsideDir, { recursive: true, force: true })
      }
    })

    it('should throw error when target is not a directory', async () => {
      // Setup
      const sourceFile = join(testDir, 'source.md')
      const targetFile = join(testDir, 'target.md')
      await writeFile(sourceFile, 'source', 'utf-8')
      await writeFile(targetFile, 'target', 'utf-8')

      // Execute & Verify
      await expect(
        fileService.copyItem(sourceFile, targetFile)
      ).rejects.toThrow('Target must be a directory')
    })
  })

  describe('Error handling', () => {
    it('should throw error when source does not exist', async () => {
      // Setup
      const nonExistentFile = join(testDir, 'nonexistent.md')
      const targetFolder = join(testDir, 'folder')
      await mkdir(targetFolder)

      // Execute & Verify
      await expect(
        fileService.copyItem(nonExistentFile, targetFolder)
      ).rejects.toThrow()
    })

    it('should throw error when target directory does not exist', async () => {
      // Setup
      const sourceFile = join(testDir, 'file.md')
      const nonExistentFolder = join(testDir, 'nonexistent')
      await writeFile(sourceFile, 'content', 'utf-8')

      // Execute & Verify
      await expect(
        fileService.copyItem(sourceFile, nonExistentFolder)
      ).rejects.toThrow()
    })
  })

  describe('Copy to same location', () => {
    it('should auto-number when copying to same directory', async () => {
      // Setup
      const sourceFile = join(testDir, 'file.md')
      await writeFile(sourceFile, 'content', 'utf-8')

      // Execute: Copy to same directory (testDir)
      const result = await fileService.copyItem(sourceFile, testDir)

      // Verify: Should create "file (1).md" in same directory
      expect(result.path).toBe(join(testDir, 'file (1).md'))
      const stats = await stat(result.path)
      expect(stats.isFile()).toBe(true)

      // Verify original still exists
      const sourceStats = await stat(sourceFile)
      expect(sourceStats.isFile()).toBe(true)
    })
  })
})
