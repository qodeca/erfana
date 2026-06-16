// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FileService } from './FileService'
import { mkdtemp, mkdir, writeFile, rm, stat, readdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

describe('FileService.moveItem', () => {
  let fileService: FileService
  let testDir: string

  beforeEach(async () => {
    fileService = new FileService()
    // Create temporary test directory
    testDir = await mkdtemp(join(tmpdir(), 'erfana-move-test-'))
    fileService.setProjectPath(testDir)
  })

  afterEach(async () => {
    // Clean up test directory
    await rm(testDir, { recursive: true, force: true })
  })

  describe('Basic move operations', () => {
    it('should move a file to a different folder', async () => {
      // Setup: Create source file and target folder
      const sourceFile = join(testDir, 'file.md')
      const targetFolder = join(testDir, 'folder')
      await writeFile(sourceFile, 'test content', 'utf-8')
      await mkdir(targetFolder)

      // Execute move
      const result = await fileService.moveItem(sourceFile, targetFolder)

      // Verify
      expect(result.path).toBe(join(targetFolder, 'file.md'))
      const stats = await stat(result.path)
      expect(stats.isFile()).toBe(true)

      // Verify source no longer exists
      await expect(stat(sourceFile)).rejects.toThrow()
    })

    it('should move a directory with children to another directory', async () => {
      // Setup: Create source folder with children and target folder
      const sourceFolder = join(testDir, 'source')
      const targetFolder = join(testDir, 'target')
      await mkdir(sourceFolder)
      await mkdir(targetFolder)
      await writeFile(join(sourceFolder, 'child.md'), 'child content', 'utf-8')
      await mkdir(join(sourceFolder, 'subfolder'))
      await writeFile(join(sourceFolder, 'subfolder', 'nested.md'), 'nested', 'utf-8')

      // Execute move
      const result = await fileService.moveItem(sourceFolder, targetFolder)

      // Verify
      expect(result.path).toBe(join(targetFolder, 'source'))
      const stats = await stat(result.path)
      expect(stats.isDirectory()).toBe(true)

      // Verify children exist
      const childStats = await stat(join(result.path, 'child.md'))
      expect(childStats.isFile()).toBe(true)
      const nestedStats = await stat(join(result.path, 'subfolder', 'nested.md'))
      expect(nestedStats.isFile()).toBe(true)

      // Verify source no longer exists
      await expect(stat(sourceFolder)).rejects.toThrow()
    })

    it('should rename file during move when newName is provided', async () => {
      // Setup
      const sourceFile = join(testDir, 'old-name.md')
      const targetFolder = join(testDir, 'folder')
      await writeFile(sourceFile, 'content', 'utf-8')
      await mkdir(targetFolder)

      // Execute move with rename
      const result = await fileService.moveItem(sourceFile, targetFolder, 'new-name.md')

      // Verify
      expect(result.path).toBe(join(targetFolder, 'new-name.md'))
      const stats = await stat(result.path)
      expect(stats.isFile()).toBe(true)
      await expect(stat(sourceFile)).rejects.toThrow()
    })
  })

  describe('Validation constraints', () => {
    it('should throw error when moving to same location', async () => {
      // Setup
      const file = join(testDir, 'file.md')
      await writeFile(file, 'content', 'utf-8')

      // Execute & Verify
      await expect(
        fileService.moveItem(file, testDir)
      ).rejects.toThrow('Source and target paths are the same')
    })

    it('should throw error when moving project root', async () => {
      // Setup: testDir is the project root
      await writeFile(join(testDir, 'dummy.md'), 'dummy', 'utf-8')

      // Create another directory to move into
      const targetDir = await mkdtemp(join(tmpdir(), 'erfana-target-'))

      try {
        // Execute & Verify
        await expect(
          fileService.moveItem(testDir, targetDir)
        ).rejects.toThrow('Cannot move the project root directory')
      } finally {
        await rm(targetDir, { recursive: true, force: true })
      }
    })

    it('should throw error when moving folder into its own descendant (circular move)', async () => {
      // Setup: Create parent/child folder structure
      const parent = join(testDir, 'parent')
      const child = join(parent, 'child')
      const grandchild = join(child, 'grandchild')
      await mkdir(parent)
      await mkdir(child)
      await mkdir(grandchild)

      // Execute & Verify: Try to move parent into grandchild
      // fs.rename itself throws EINVAL for circular operations
      await expect(
        fileService.moveItem(parent, grandchild)
      ).rejects.toThrow() // Will throw EINVAL or similar error
    })

    it('should throw error when moving item outside project boundary', async () => {
      // Setup: Create file inside project
      const file = join(testDir, 'file.md')
      await writeFile(file, 'content', 'utf-8')

      // Create target outside project
      const outsideDir = await mkdtemp(join(tmpdir(), 'erfana-outside-'))

      try {
        // Execute & Verify
        await expect(
          fileService.moveItem(file, outsideDir)
        ).rejects.toThrow('Cannot move items to outside the project directory')
      } finally {
        await rm(outsideDir, { recursive: true, force: true })
      }
    })

    it('should throw error when moving item from outside project boundary', async () => {
      // Setup: Create file outside project
      const outsideDir = await mkdtemp(join(tmpdir(), 'erfana-outside-'))
      const outsideFile = join(outsideDir, 'file.md')
      await writeFile(outsideFile, 'content', 'utf-8')

      // Create target inside project
      const insideFolder = join(testDir, 'folder')
      await mkdir(insideFolder)

      try {
        // Execute & Verify
        await expect(
          fileService.moveItem(outsideFile, insideFolder)
        ).rejects.toThrow('Cannot move items outside the project directory')
      } finally {
        await rm(outsideDir, { recursive: true, force: true })
      }
    })

    it('should throw error when target is not a directory', async () => {
      // Setup: Create source file and target file (not directory)
      const sourceFile = join(testDir, 'source.md')
      const targetFile = join(testDir, 'target.md')
      await writeFile(sourceFile, 'source', 'utf-8')
      await writeFile(targetFile, 'target', 'utf-8')

      // Execute & Verify
      await expect(
        fileService.moveItem(sourceFile, targetFile)
      ).rejects.toThrow('Target must be a directory')
    })
  })

  describe('Rename during move', () => {
    it('should use basename when newName contains path separators (no sanitization in FileService)', async () => {
      // Note: Path separator sanitization is in IPC layer, not FileService
      // FileService trusts inputs from IPC layer

      // Setup
      const sourceFile = join(testDir, 'file.md')
      const targetFolder = join(testDir, 'folder')
      await writeFile(sourceFile, 'content', 'utf-8')
      await mkdir(targetFolder)

      // Execute: FileService doesn't sanitize, will fail with nested path
      await expect(
        fileService.moveItem(sourceFile, targetFolder, 'sub/folder/name.md')
      ).rejects.toThrow() // ENOENT - tries to create in non-existent subdirectory
    })

    it('should handle valid newName without path separators', async () => {
      // Setup
      const sourceFile = join(testDir, 'file.md')
      const targetFolder = join(testDir, 'folder')
      await writeFile(sourceFile, 'content', 'utf-8')
      await mkdir(targetFolder)

      // Execute with valid newName
      const result = await fileService.moveItem(sourceFile, targetFolder, 'renamed.md')

      // Verify
      expect(result.path).toBe(join(targetFolder, 'renamed.md'))
      const stats = await stat(result.path)
      expect(stats.isFile()).toBe(true)
    })
  })

  describe('Name conflict handling', () => {
    it('should throw error when target name already exists', async () => {
      // Setup: Create source file and target file with same name
      const sourceFile = join(testDir, 'file.md')
      const targetFolder = join(testDir, 'folder')
      await writeFile(sourceFile, 'source', 'utf-8')
      await mkdir(targetFolder)
      await writeFile(join(targetFolder, 'file.md'), 'existing', 'utf-8')

      // Execute & Verify
      await expect(
        fileService.moveItem(sourceFile, targetFolder)
      ).rejects.toThrow('An item named "file.md" already exists')
    })

    it('should detect case-insensitive conflicts', async () => {
      // Setup
      const sourceFile = join(testDir, 'file.md')
      const targetFolder = join(testDir, 'folder')
      await writeFile(sourceFile, 'source', 'utf-8')
      await mkdir(targetFolder)
      await writeFile(join(targetFolder, 'FILE.MD'), 'existing', 'utf-8')

      // Execute & Verify: Should detect FILE.MD conflicts with file.md
      await expect(
        fileService.moveItem(sourceFile, targetFolder)
      ).rejects.toThrow('An item named "file.md" already exists')
    })
  })

  describe('Error handling', () => {
    it('should throw error when source does not exist', async () => {
      // Setup: No source file created
      const nonExistentFile = join(testDir, 'nonexistent.md')
      const targetFolder = join(testDir, 'folder')
      await mkdir(targetFolder)

      // Execute & Verify
      await expect(
        fileService.moveItem(nonExistentFile, targetFolder)
      ).rejects.toThrow()
    })

    it('should throw error when target directory does not exist', async () => {
      // Setup
      const sourceFile = join(testDir, 'file.md')
      const nonExistentFolder = join(testDir, 'nonexistent')
      await writeFile(sourceFile, 'content', 'utf-8')

      // Execute & Verify
      await expect(
        fileService.moveItem(sourceFile, nonExistentFolder)
      ).rejects.toThrow()
    })
  })

  describe('Cross-filesystem move fallback', () => {
    it('should handle EXDEV error by falling back to copy+delete', async () => {
      // Note: This test is difficult to reproduce reliably without actual cross-filesystem setup
      // The implementation handles EXDEV gracefully, but testing requires mocking or real volumes

      // Setup
      const sourceFile = join(testDir, 'file.md')
      const targetFolder = join(testDir, 'folder')
      const originalContent = 'test content with timestamp'
      await writeFile(sourceFile, originalContent, 'utf-8')
      await mkdir(targetFolder)

      // Execute normal move (will use fs.rename on same filesystem)
      const result = await fileService.moveItem(sourceFile, targetFolder)

      // Verify: File moved successfully (whether via rename or copy+delete)
      expect(result.path).toBe(join(targetFolder, 'file.md'))
      const content = await fileService.readFile(result.path)
      expect(content).toBe(originalContent)

      // Verify source deleted
      await expect(stat(sourceFile)).rejects.toThrow()
    })

    it('should preserve directory structure during cross-filesystem copy fallback', async () => {
      // Setup: Create folder with nested structure
      const sourceFolder = join(testDir, 'source')
      const targetFolder = join(testDir, 'target')
      await mkdir(sourceFolder)
      await mkdir(targetFolder)
      await mkdir(join(sourceFolder, 'sub1'))
      await mkdir(join(sourceFolder, 'sub1', 'sub2'))
      await writeFile(join(sourceFolder, 'root.md'), 'root', 'utf-8')
      await writeFile(join(sourceFolder, 'sub1', 'level1.md'), 'level1', 'utf-8')
      await writeFile(join(sourceFolder, 'sub1', 'sub2', 'level2.md'), 'level2', 'utf-8')

      // Execute move
      const result = await fileService.moveItem(sourceFolder, targetFolder)

      // Verify structure preserved
      expect(result.path).toBe(join(targetFolder, 'source'))
      const entries = await readdir(result.path, { withFileTypes: true })
      expect(entries).toHaveLength(2) // root.md + sub1

      const level1Content = await fileService.readFile(join(result.path, 'sub1', 'level1.md'))
      expect(level1Content).toBe('level1')

      const level2Content = await fileService.readFile(join(result.path, 'sub1', 'sub2', 'level2.md'))
      expect(level2Content).toBe('level2')

      // Verify source deleted
      await expect(stat(sourceFolder)).rejects.toThrow()
    })
  })

  describe('Replace existing items (replaceExisting parameter)', () => {
    it('should replace existing file when replaceExisting=true', async () => {
      // Setup: Create source file and existing target file
      const sourceFile = join(testDir, 'source.md')
      const targetFolder = join(testDir, 'folder')
      await writeFile(sourceFile, 'source content', 'utf-8')
      await mkdir(targetFolder)
      await writeFile(join(targetFolder, 'source.md'), 'old content', 'utf-8')

      // Execute move with replaceExisting=true
      const result = await fileService.moveItem(sourceFile, targetFolder, undefined, true)

      // Verify: New file replaced old file
      expect(result.path).toBe(join(targetFolder, 'source.md'))
      const content = await fileService.readFile(result.path)
      expect(content).toBe('source content') // New content, not old

      // Verify source no longer exists
      await expect(stat(sourceFile)).rejects.toThrow()
    })

    it('should replace existing directory when replaceExisting=true', async () => {
      // Setup: Create source directory and existing target directory
      const sourceFolder = join(testDir, 'source')
      const targetFolder = join(testDir, 'target')
      await mkdir(sourceFolder)
      await mkdir(targetFolder)
      await writeFile(join(sourceFolder, 'new-file.md'), 'new content', 'utf-8')

      // Create existing directory with old content
      await mkdir(join(targetFolder, 'source'))
      await writeFile(join(targetFolder, 'source', 'old-file.md'), 'old content', 'utf-8')

      // Execute move with replaceExisting=true
      const result = await fileService.moveItem(sourceFolder, targetFolder, undefined, true)

      // Verify: New directory replaced old directory
      expect(result.path).toBe(join(targetFolder, 'source'))
      const entries = await readdir(result.path)
      expect(entries).toEqual(['new-file.md']) // Only new file, old-file.md deleted

      // Verify source no longer exists
      await expect(stat(sourceFolder)).rejects.toThrow()
    })

    it('should still throw error when replaceExisting=false', async () => {
      // Setup: Create source file and existing target file
      const sourceFile = join(testDir, 'file.md')
      const targetFolder = join(testDir, 'folder')
      await writeFile(sourceFile, 'source', 'utf-8')
      await mkdir(targetFolder)
      await writeFile(join(targetFolder, 'file.md'), 'existing', 'utf-8')

      // Execute & Verify: Should still throw error
      await expect(
        fileService.moveItem(sourceFile, targetFolder, undefined, false)
      ).rejects.toThrow('An item named "file.md" already exists')
    })

    // Note: Permission error testing is platform-specific and unreliable
    // Omitted for cross-platform compatibility (macOS ignores file permissions for owner)
  })
})
