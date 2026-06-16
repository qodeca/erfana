// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for Context Menu Commands
 *
 * Comprehensive test coverage for all 11 command classes implementing
 * the Command pattern for context menu actions.
 *
 * Commands tested:
 * - CutCommand, CopyCommand
 * - PasteIntoDirectoryCommand
 * - RenameFileCommand, RenameDirectoryCommand
 * - DeleteFileCommand, DeleteDirectoryCommand
 * - NewFileInDirectoryCommand, NewFolderInDirectoryCommand
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  CutCommand,
  CopyCommand,
  PasteIntoDirectoryCommand,
  RenameFileCommand,
  RenameDirectoryCommand,
  DeleteFileCommand,
  DeleteDirectoryCommand,
  NewFileInDirectoryCommand,
  NewFolderInDirectoryCommand,
  RevealInFileManagerCommand,
  separatorItem
} from './commands'
import { createMockMenuContext, createMockFileNode } from '../__test__/testUtils'
import type { MenuContext, FileNodeDirectory, FileNodeFile } from './types'
import type { Mock } from 'vitest'

describe('Context Menu Commands', () => {
  let ctx: MenuContext

  beforeEach(() => {
    ctx = createMockMenuContext()
  })

  describe('CutCommand', () => {
    it('should construct with correct label and icon', () => {
      const node = createMockFileNode('test.md', 'file')
      const cmd = new CutCommand(ctx, node as FileNodeFile)

      expect(cmd.label).toBe('Cut')
      expect(cmd.icon).toBeDefined()
    })

    it('should call clipboard.cut with correct params', () => {
      const node = createMockFileNode('test.md', 'file')
      const cmd = new CutCommand(ctx, node as FileNodeFile)

      cmd.execute()

      expect(ctx.clipboard.cut).toHaveBeenCalledWith('/test/project/test.md', 'test.md', 'file')
    })

    it('should show info toast with cut message', () => {
      const node = createMockFileNode('test.md', 'file')
      const cmd = new CutCommand(ctx, node as FileNodeFile)

      cmd.execute()

      expect(ctx.toast).toHaveBeenCalledWith({
        type: 'info',
        title: 'Cut',
        message: '"test.md" ready to move'
      })
    })

    it('should convert to menu item correctly', () => {
      const node = createMockFileNode('test.md', 'file')
      const cmd = new CutCommand(ctx, node as FileNodeFile)
      const menuItem = cmd.toMenuItem()

      expect(menuItem.label).toBe('Cut')
      expect(menuItem.icon).toBeDefined()
      expect(typeof menuItem.execute).toBe('function')
    })

    it('should work with directory nodes', () => {
      const node = createMockFileNode('folder', 'directory')
      const cmd = new CutCommand(ctx, node as FileNodeDirectory)

      cmd.execute()

      expect(ctx.clipboard.cut).toHaveBeenCalledWith('/test/project/folder', 'folder', 'directory')
    })
  })

  describe('CopyCommand', () => {
    it('should construct with correct label and icon', () => {
      const node = createMockFileNode('test.md', 'file')
      const cmd = new CopyCommand(ctx, node as FileNodeFile)

      expect(cmd.label).toBe('Copy')
      expect(cmd.icon).toBeDefined()
    })

    it('should call clipboard.copy with correct params', () => {
      const node = createMockFileNode('test.md', 'file')
      const cmd = new CopyCommand(ctx, node as FileNodeFile)

      cmd.execute()

      expect(ctx.clipboard.copy).toHaveBeenCalledWith('/test/project/test.md', 'test.md', 'file')
    })

    it('should show info toast with copy message', () => {
      const node = createMockFileNode('test.md', 'file')
      const cmd = new CopyCommand(ctx, node as FileNodeFile)

      cmd.execute()

      expect(ctx.toast).toHaveBeenCalledWith({
        type: 'info',
        title: 'Copied',
        message: '"test.md" ready to paste'
      })
    })

    it('should convert to menu item correctly', () => {
      const node = createMockFileNode('test.md', 'file')
      const cmd = new CopyCommand(ctx, node as FileNodeFile)
      const menuItem = cmd.toMenuItem()

      expect(menuItem.label).toBe('Copy')
      expect(menuItem.icon).toBeDefined()
    })

    it('should work with directory nodes', () => {
      const node = createMockFileNode('folder', 'directory')
      const cmd = new CopyCommand(ctx, node as FileNodeDirectory)

      cmd.execute()

      expect(ctx.clipboard.copy).toHaveBeenCalledWith('/test/project/folder', 'folder', 'directory')
    })
  })

  describe('PasteIntoDirectoryCommand', () => {
    it('should construct with correct label and icon', () => {
      const node = createMockFileNode('target', 'directory')
      const cmd = new PasteIntoDirectoryCommand(ctx, node as FileNodeDirectory)

      expect(cmd.label).toBe('Paste')
      expect(cmd.icon).toBeDefined()
    })

    it('should check for conflicts when operation is cut', async () => {
      const node = createMockFileNode('target', 'directory')
      ctx.clipboard.itemName = 'file.md'
      ctx.clipboard.itemType = 'file'
      vi.mocked(ctx.clipboard.getOperation).mockReturnValue('cut')
      vi.mocked(ctx.api.checkConflict).mockResolvedValue(false)

      const cmd = new PasteIntoDirectoryCommand(ctx, node as FileNodeDirectory)
      await cmd.execute()

      expect(ctx.api.checkConflict).toHaveBeenCalledWith('/test/project/target', 'file.md')
    })

    it('should not check conflicts when operation is copy', async () => {
      const node = createMockFileNode('target', 'directory')
      vi.mocked(ctx.clipboard.getOperation).mockReturnValue('copy')

      const cmd = new PasteIntoDirectoryCommand(ctx, node as FileNodeDirectory)
      await cmd.execute()

      expect(ctx.api.checkConflict).not.toHaveBeenCalled()
    })

    it('should show replace confirmation when conflict exists', async () => {
      const node = createMockFileNode('target', 'directory')
      ctx.clipboard.itemName = 'file.md'
      ctx.clipboard.itemType = 'file'
      vi.mocked(ctx.clipboard.getOperation).mockReturnValue('cut')
      vi.mocked(ctx.api.checkConflict).mockResolvedValue(true)
      vi.mocked(ctx.dialogs.showConfirm).mockResolvedValue(true)

      const cmd = new PasteIntoDirectoryCommand(ctx, node as FileNodeDirectory)
      await cmd.execute()

      expect(ctx.dialogs.showConfirm).toHaveBeenCalledWith({
        title: 'Replace Item',
        message: 'A file named "file.md" already exists in the target folder. Do you want to replace it?',
        confirmLabel: 'Replace',
        cancelLabel: 'Cancel',
        danger: true
      })
    })

    it('should cancel when user declines replace', async () => {
      const node = createMockFileNode('target', 'directory')
      ctx.clipboard.itemName = 'file.md'
      vi.mocked(ctx.clipboard.getOperation).mockReturnValue('cut')
      vi.mocked(ctx.api.checkConflict).mockResolvedValue(true)
      vi.mocked(ctx.dialogs.showConfirm).mockResolvedValue(false)

      const cmd = new PasteIntoDirectoryCommand(ctx, node as FileNodeDirectory)
      await cmd.execute()

      expect(ctx.clipboard.paste).not.toHaveBeenCalled()
    })

    it('should set replaceExisting=true when confirmed', async () => {
      const node = createMockFileNode('target', 'directory')
      ctx.clipboard.itemName = 'file.md'
      vi.mocked(ctx.clipboard.getOperation).mockReturnValue('cut')
      vi.mocked(ctx.api.checkConflict).mockResolvedValue(true)
      vi.mocked(ctx.dialogs.showConfirm).mockResolvedValue(true)
      vi.mocked(ctx.clipboard.paste).mockResolvedValue({ success: true })

      const cmd = new PasteIntoDirectoryCommand(ctx, node as FileNodeDirectory)
      await cmd.execute()

      expect(ctx.clipboard.paste).toHaveBeenCalledWith('/test/project/target', true)
    })

    it('should call clipboard.paste with correct params', async () => {
      const node = createMockFileNode('target', 'directory')
      vi.mocked(ctx.clipboard.paste).mockResolvedValue({ success: true })

      const cmd = new PasteIntoDirectoryCommand(ctx, node as FileNodeDirectory)
      await cmd.execute()

      expect(ctx.clipboard.paste).toHaveBeenCalledWith('/test/project/target', false)
    })

    it('should wrap operation with withWatcherPause', async () => {
      const node = createMockFileNode('target', 'directory')
      vi.mocked(ctx.clipboard.paste).mockResolvedValue({ success: true })

      const cmd = new PasteIntoDirectoryCommand(ctx, node as FileNodeDirectory)
      await cmd.execute()

      expect(ctx.withWatcherPause).toHaveBeenCalled()
    })

    it('should refresh tree after paste', async () => {
      const node = createMockFileNode('target', 'directory')
      vi.mocked(ctx.clipboard.paste).mockResolvedValue({ success: true })

      const cmd = new PasteIntoDirectoryCommand(ctx, node as FileNodeDirectory)
      await cmd.execute()

      expect(ctx.refreshProjectTree).toHaveBeenCalled()
    })

    it('should show success toast for normal paste', async () => {
      const node = createMockFileNode('target', 'directory')
      vi.mocked(ctx.clipboard.paste).mockResolvedValue({ success: true })
      vi.mocked(ctx.clipboard.getOperation).mockReturnValue('copy')

      const cmd = new PasteIntoDirectoryCommand(ctx, node as FileNodeDirectory)
      await cmd.execute()

      expect(ctx.toast).toHaveBeenCalledWith({
        type: 'success',
        title: 'Success',
        message: 'Item copied'
      })
    })

    it('should show warning toast for symlink paste', async () => {
      const node = createMockFileNode('target', 'directory')
      vi.mocked(ctx.clipboard.paste).mockResolvedValue({ success: true, isSymlink: true })
      vi.mocked(ctx.clipboard.getOperation).mockReturnValue('cut')

      const cmd = new PasteIntoDirectoryCommand(ctx, node as FileNodeDirectory)
      await cmd.execute()

      expect(ctx.toast).toHaveBeenCalledWith({
        type: 'warning',
        title: 'Symlink Moved',
        message: expect.stringContaining('Warning: You moved a symbolic link')
      })
    })

    it('should include "replaced" in message when replacing', async () => {
      const node = createMockFileNode('target', 'directory')
      ctx.clipboard.itemName = 'file.md'
      vi.mocked(ctx.clipboard.getOperation).mockReturnValue('cut')
      vi.mocked(ctx.api.checkConflict).mockResolvedValue(true)
      vi.mocked(ctx.dialogs.showConfirm).mockResolvedValue(true)
      vi.mocked(ctx.clipboard.paste).mockResolvedValue({ success: true })

      const cmd = new PasteIntoDirectoryCommand(ctx, node as FileNodeDirectory)
      await cmd.execute()

      expect(ctx.toast).toHaveBeenCalledWith({
        type: 'success',
        title: 'Success',
        message: 'Item moved and replaced existing item'
      })
    })

    it('should show error toast on paste failure', async () => {
      const node = createMockFileNode('target', 'directory')
      vi.mocked(ctx.clipboard.paste).mockResolvedValue({ success: false, error: 'Paste failed' })

      const cmd = new PasteIntoDirectoryCommand(ctx, node as FileNodeDirectory)
      await cmd.execute()

      expect(ctx.toast).toHaveBeenCalledWith({
        type: 'error',
        title: 'Error',
        message: 'Paste failed'
      })
    })

    it('should handle checkConflict errors gracefully', async () => {
      const node = createMockFileNode('target', 'directory')
      ctx.clipboard.itemName = 'file.md'
      vi.mocked(ctx.clipboard.getOperation).mockReturnValue('cut')
      vi.mocked(ctx.api.checkConflict).mockRejectedValue(new Error('Check failed'))
      vi.mocked(ctx.clipboard.paste).mockResolvedValue({ success: true })

      const cmd = new PasteIntoDirectoryCommand(ctx, node as FileNodeDirectory)
      await cmd.execute()

      // Should fall through to normal paste
      expect(ctx.clipboard.paste).toHaveBeenCalled()
    })
  })

  describe('RenameFileCommand', () => {
    it('should construct with correct label and icon', () => {
      const node = createMockFileNode('test.md', 'file')
      const cmd = new RenameFileCommand(ctx, node as FileNodeFile)

      expect(cmd.label).toBe('Rename')
      expect(cmd.icon).toBeDefined()
    })

    it('should extract parent path correctly', async () => {
      const node = createMockFileNode('test.md', 'file', '/test/project/folder/test.md')
      vi.mocked(ctx.dialogs.showRename).mockResolvedValue('newname.md')
      vi.mocked(ctx.getSiblingNames).mockReturnValue([])

      const cmd = new RenameFileCommand(ctx, node as FileNodeFile)
      await cmd.execute()

      expect(ctx.dialogs.showRename).toHaveBeenCalledWith(
        expect.objectContaining({
          parentPath: '/test/project/folder'
        })
      )
    })

    it('should call getSiblingNames for duplicates', async () => {
      const node = createMockFileNode('test.md', 'file')
      vi.mocked(ctx.dialogs.showRename).mockResolvedValue('newname.md')

      const cmd = new RenameFileCommand(ctx, node as FileNodeFile)
      await cmd.execute()

      expect(ctx.getSiblingNames).toHaveBeenCalledWith('/test/project/test.md', 'test.md')
    })

    it('should show rename dialog with file params', async () => {
      const node = createMockFileNode('test.md', 'file')
      vi.mocked(ctx.dialogs.showRename).mockResolvedValue('newname.md')
      vi.mocked(ctx.getSiblingNames).mockReturnValue(['other.md'])

      const cmd = new RenameFileCommand(ctx, node as FileNodeFile)
      await cmd.execute()

      expect(ctx.dialogs.showRename).toHaveBeenCalledWith({
        title: 'Rename File',
        message: '',
        currentName: 'test.md',
        itemPath: '/test/project/test.md',
        itemType: 'file',
        parentPath: '/test/project',
        existingNames: ['other.md']
      })
    })

    it('should cancel when user dismisses dialog', async () => {
      const node = createMockFileNode('test.md', 'file')
      vi.mocked(ctx.dialogs.showRename).mockResolvedValue(null)

      const cmd = new RenameFileCommand(ctx, node as FileNodeFile)
      await cmd.execute()

      expect(ctx.api.rename).not.toHaveBeenCalled()
    })

    it('should call api.rename with new name', async () => {
      const node = createMockFileNode('test.md', 'file')
      vi.mocked(ctx.dialogs.showRename).mockResolvedValue('newname.md')

      const cmd = new RenameFileCommand(ctx, node as FileNodeFile)
      await cmd.execute()

      expect(ctx.api.rename).toHaveBeenCalledWith('/test/project/test.md', 'newname.md')
    })

    it('should show success toast', async () => {
      const node = createMockFileNode('test.md', 'file')
      vi.mocked(ctx.dialogs.showRename).mockResolvedValue('newname.md')

      const cmd = new RenameFileCommand(ctx, node as FileNodeFile)
      await cmd.execute()

      expect(ctx.toast).toHaveBeenCalledWith({
        type: 'success',
        title: 'Success',
        message: 'Item renamed successfully'
      })
    })

    it('should show error toast on failure', async () => {
      const node = createMockFileNode('test.md', 'file')
      vi.mocked(ctx.dialogs.showRename).mockResolvedValue('newname.md')
      vi.mocked(ctx.api.rename).mockRejectedValue(new Error('Rename failed'))
      vi.mocked(ctx.formatFileOperationError).mockReturnValue('Rename failed')

      const cmd = new RenameFileCommand(ctx, node as FileNodeFile)
      await cmd.execute()

      expect(ctx.toast).toHaveBeenCalledWith({
        type: 'error',
        title: 'Error',
        message: 'Rename failed'
      })
    })
  })

  describe('RenameDirectoryCommand', () => {
    it('should construct with correct label and icon', () => {
      const node = createMockFileNode('folder', 'directory')
      const cmd = new RenameDirectoryCommand(ctx, node as FileNodeDirectory)

      expect(cmd.label).toBe('Rename')
      expect(cmd.icon).toBeDefined()
    })

    it('should show rename dialog with directory params', async () => {
      const node = createMockFileNode('folder', 'directory')
      vi.mocked(ctx.dialogs.showRename).mockResolvedValue('newfolder')
      vi.mocked(ctx.getSiblingNames).mockReturnValue([])

      const cmd = new RenameDirectoryCommand(ctx, node as FileNodeDirectory)
      await cmd.execute()

      expect(ctx.dialogs.showRename).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Rename Folder',
          itemType: 'directory'
        })
      )
    })
  })

  describe('DeleteFileCommand', () => {
    it('should construct with correct label, icon, danger flag', () => {
      const node = createMockFileNode('test.md', 'file')
      const cmd = new DeleteFileCommand(ctx, node as FileNodeFile)

      expect(cmd.label).toBe('Delete')
      expect(cmd.icon).toBeDefined()
      expect(cmd.danger).toBe(true)
    })

    it('should show confirmation with file-specific message', async () => {
      const node = createMockFileNode('test.md', 'file')
      vi.mocked(ctx.dialogs.showConfirm).mockResolvedValue(true)

      const cmd = new DeleteFileCommand(ctx, node as FileNodeFile)
      await cmd.execute()

      expect(ctx.dialogs.showConfirm).toHaveBeenCalledWith({
        title: 'Delete File',
        message: 'Are you sure you want to delete "test.md"? This action cannot be undone.',
        confirmLabel: 'Delete',
        danger: true
      })
    })

    it('should include "cannot be undone" warning', async () => {
      const node = createMockFileNode('test.md', 'file')
      vi.mocked(ctx.dialogs.showConfirm).mockResolvedValue(true)

      const cmd = new DeleteFileCommand(ctx, node as FileNodeFile)
      await cmd.execute()

      expect(ctx.dialogs.showConfirm).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('cannot be undone')
        })
      )
    })

    it('should cancel when user declines', async () => {
      const node = createMockFileNode('test.md', 'file')
      vi.mocked(ctx.dialogs.showConfirm).mockResolvedValue(false)

      const cmd = new DeleteFileCommand(ctx, node as FileNodeFile)
      await cmd.execute()

      expect(ctx.api.deleteFile).not.toHaveBeenCalled()
    })

    it('should call api.deleteFile when confirmed', async () => {
      const node = createMockFileNode('test.md', 'file')
      vi.mocked(ctx.dialogs.showConfirm).mockResolvedValue(true)

      const cmd = new DeleteFileCommand(ctx, node as FileNodeFile)
      await cmd.execute()

      expect(ctx.api.deleteFile).toHaveBeenCalledWith('/test/project/test.md')
    })

    it('should refresh tree after deletion', async () => {
      const node = createMockFileNode('test.md', 'file')
      vi.mocked(ctx.dialogs.showConfirm).mockResolvedValue(true)

      const cmd = new DeleteFileCommand(ctx, node as FileNodeFile)
      await cmd.execute()

      expect(ctx.refreshProjectTree).toHaveBeenCalled()
    })

    it('should show error toast on failure', async () => {
      const node = createMockFileNode('test.md', 'file')
      vi.mocked(ctx.dialogs.showConfirm).mockResolvedValue(true)
      vi.mocked(ctx.api.deleteFile).mockRejectedValue(new Error('Delete failed'))
      vi.mocked(ctx.formatFileOperationError).mockReturnValue('Delete failed')

      const cmd = new DeleteFileCommand(ctx, node as FileNodeFile)
      await cmd.execute()

      expect(ctx.toast).toHaveBeenCalledWith({
        type: 'error',
        title: 'Error',
        message: 'Delete failed'
      })
    })

    it('should wrap operation with withWatcherPause', async () => {
      const node = createMockFileNode('test.md', 'file')
      vi.mocked(ctx.dialogs.showConfirm).mockResolvedValue(true)

      const cmd = new DeleteFileCommand(ctx, node as FileNodeFile)
      await cmd.execute()

      expect(ctx.withWatcherPause).toHaveBeenCalled()
    })
  })

  describe('DeleteDirectoryCommand', () => {
    it('should construct with correct label, icon, danger flag', () => {
      const node = createMockFileNode('folder', 'directory')
      const cmd = new DeleteDirectoryCommand(ctx, node as FileNodeDirectory)

      expect(cmd.label).toBe('Delete')
      expect(cmd.danger).toBe(true)
    })

    it('should show confirmation with folder-specific message', async () => {
      const node = createMockFileNode('folder', 'directory')
      vi.mocked(ctx.dialogs.showConfirm).mockResolvedValue(true)

      const cmd = new DeleteDirectoryCommand(ctx, node as FileNodeDirectory)
      await cmd.execute()

      expect(ctx.dialogs.showConfirm).toHaveBeenCalledWith({
        title: 'Delete Folder',
        message: 'Are you sure you want to delete "folder" and all its contents? This action cannot be undone.',
        confirmLabel: 'Delete',
        danger: true
      })
    })

    it('should warn about deleting "all its contents"', async () => {
      const node = createMockFileNode('folder', 'directory')
      vi.mocked(ctx.dialogs.showConfirm).mockResolvedValue(true)

      const cmd = new DeleteDirectoryCommand(ctx, node as FileNodeDirectory)
      await cmd.execute()

      expect(ctx.dialogs.showConfirm).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('all its contents')
        })
      )
    })

    it('should call api.deleteFolder when confirmed', async () => {
      const node = createMockFileNode('folder', 'directory')
      vi.mocked(ctx.dialogs.showConfirm).mockResolvedValue(true)

      const cmd = new DeleteDirectoryCommand(ctx, node as FileNodeDirectory)
      await cmd.execute()

      expect(ctx.api.deleteFolder).toHaveBeenCalledWith('/test/project/folder')
    })
  })

  describe('NewFileInDirectoryCommand', () => {
    it('should construct with correct label and icon', () => {
      const node = createMockFileNode('folder', 'directory')
      const cmd = new NewFileInDirectoryCommand(ctx, node as FileNodeDirectory)

      expect(cmd.label).toBe('New File')
      expect(cmd.icon).toBeDefined()
    })

    it('should calculate relative path correctly', async () => {
      const node = createMockFileNode('folder', 'directory')
      vi.mocked(ctx.dialogs.showNewFile).mockResolvedValue('file.md')

      const cmd = new NewFileInDirectoryCommand(ctx, node as FileNodeDirectory)
      await cmd.execute()

      expect(ctx.dialogs.showNewFile).toHaveBeenCalledWith(
        expect.objectContaining({
          parentPath: '/folder'
        })
      )
    })

    it('should show new file dialog', async () => {
      const node = createMockFileNode('folder', 'directory')
      vi.mocked(ctx.dialogs.showNewFile).mockResolvedValue('file.md')

      const cmd = new NewFileInDirectoryCommand(ctx, node as FileNodeDirectory)
      await cmd.execute()

      expect(ctx.dialogs.showNewFile).toHaveBeenCalledWith({
        title: 'Create New File',
        message: '',
        parentPath: '/folder',
        inputPlaceholder: 'notes.md'
      })
    })

    it('should cancel when user dismisses dialog', async () => {
      const node = createMockFileNode('folder', 'directory')
      vi.mocked(ctx.dialogs.showNewFile).mockResolvedValue(null)

      const cmd = new NewFileInDirectoryCommand(ctx, node as FileNodeDirectory)
      await cmd.execute()

      expect(ctx.api.createFile).not.toHaveBeenCalled()
    })

    it('should call api.createFile with parent path', async () => {
      const node = createMockFileNode('folder', 'directory')
      vi.mocked(ctx.dialogs.showNewFile).mockResolvedValue('file.md')

      const cmd = new NewFileInDirectoryCommand(ctx, node as FileNodeDirectory)
      await cmd.execute()

      expect(ctx.api.createFile).toHaveBeenCalledWith('/test/project/folder', 'file.md')
    })

    it('should refresh tree after creation', async () => {
      const node = createMockFileNode('folder', 'directory')
      vi.mocked(ctx.dialogs.showNewFile).mockResolvedValue('file.md')

      const cmd = new NewFileInDirectoryCommand(ctx, node as FileNodeDirectory)
      await cmd.execute()

      expect(ctx.refreshProjectTree).toHaveBeenCalled()
    })

    it('should show error toast on failure', async () => {
      const node = createMockFileNode('folder', 'directory')
      vi.mocked(ctx.dialogs.showNewFile).mockResolvedValue('file.md')
      vi.mocked(ctx.api.createFile).mockRejectedValue(new Error('Create failed'))
      vi.mocked(ctx.formatFileOperationError).mockReturnValue('Create failed')

      const cmd = new NewFileInDirectoryCommand(ctx, node as FileNodeDirectory)
      await cmd.execute()

      expect(ctx.toast).toHaveBeenCalledWith({
        type: 'error',
        title: 'Error',
        message: 'Create failed'
      })
    })

    it('should wrap operation with withWatcherPause', async () => {
      const node = createMockFileNode('folder', 'directory')
      vi.mocked(ctx.dialogs.showNewFile).mockResolvedValue('file.md')

      const cmd = new NewFileInDirectoryCommand(ctx, node as FileNodeDirectory)
      await cmd.execute()

      expect(ctx.withWatcherPause).toHaveBeenCalled()
    })
  })

  describe('NewFolderInDirectoryCommand', () => {
    it('should construct with correct label and icon', () => {
      const node = createMockFileNode('folder', 'directory')
      const cmd = new NewFolderInDirectoryCommand(ctx, node as FileNodeDirectory)

      expect(cmd.label).toBe('New Folder')
      expect(cmd.icon).toBeDefined()
    })

    it('should calculate relative path correctly', async () => {
      const node = createMockFileNode('folder', 'directory')
      vi.mocked(ctx.dialogs.showNewFolder).mockResolvedValue('subfolder')

      const cmd = new NewFolderInDirectoryCommand(ctx, node as FileNodeDirectory)
      await cmd.execute()

      expect(ctx.dialogs.showNewFolder).toHaveBeenCalledWith(
        expect.objectContaining({
          parentPath: '/folder'
        })
      )
    })

    it('should show new folder dialog', async () => {
      const node = createMockFileNode('folder', 'directory')
      vi.mocked(ctx.dialogs.showNewFolder).mockResolvedValue('subfolder')

      const cmd = new NewFolderInDirectoryCommand(ctx, node as FileNodeDirectory)
      await cmd.execute()

      expect(ctx.dialogs.showNewFolder).toHaveBeenCalledWith({
        title: 'Create New Folder',
        message: '',
        parentPath: '/folder',
        inputPlaceholder: 'docs'
      })
    })

    it('should cancel when user dismisses dialog', async () => {
      const node = createMockFileNode('folder', 'directory')
      vi.mocked(ctx.dialogs.showNewFolder).mockResolvedValue(null)

      const cmd = new NewFolderInDirectoryCommand(ctx, node as FileNodeDirectory)
      await cmd.execute()

      expect(ctx.api.createFolder).not.toHaveBeenCalled()
    })

    it('should call api.createFolder with parent path', async () => {
      const node = createMockFileNode('folder', 'directory')
      vi.mocked(ctx.dialogs.showNewFolder).mockResolvedValue('subfolder')

      const cmd = new NewFolderInDirectoryCommand(ctx, node as FileNodeDirectory)
      await cmd.execute()

      expect(ctx.api.createFolder).toHaveBeenCalledWith('/test/project/folder', 'subfolder')
    })

    it('should refresh tree after creation', async () => {
      const node = createMockFileNode('folder', 'directory')
      vi.mocked(ctx.dialogs.showNewFolder).mockResolvedValue('subfolder')

      const cmd = new NewFolderInDirectoryCommand(ctx, node as FileNodeDirectory)
      await cmd.execute()

      expect(ctx.refreshProjectTree).toHaveBeenCalled()
    })

    it('should show error toast on failure', async () => {
      const node = createMockFileNode('folder', 'directory')
      vi.mocked(ctx.dialogs.showNewFolder).mockResolvedValue('subfolder')
      vi.mocked(ctx.api.createFolder).mockRejectedValue(new Error('Create failed'))
      vi.mocked(ctx.formatFileOperationError).mockReturnValue('Create failed')

      const cmd = new NewFolderInDirectoryCommand(ctx, node as FileNodeDirectory)
      await cmd.execute()

      expect(ctx.toast).toHaveBeenCalledWith({
        type: 'error',
        title: 'Error',
        message: 'Create failed'
      })
    })

    it('should wrap operation with withWatcherPause', async () => {
      const node = createMockFileNode('folder', 'directory')
      vi.mocked(ctx.dialogs.showNewFolder).mockResolvedValue('subfolder')

      const cmd = new NewFolderInDirectoryCommand(ctx, node as FileNodeDirectory)
      await cmd.execute()

      expect(ctx.withWatcherPause).toHaveBeenCalled()
    })
  })

  describe('separatorItem', () => {
    it('should create separator with empty label', () => {
      const item = separatorItem()

      expect(item.label).toBe('')
    })

    it('should have separator=true flag', () => {
      const item = separatorItem()

      expect(item.separator).toBe(true)
    })

    it('should have no-op execute function', () => {
      const item = separatorItem()

      expect(typeof item.execute).toBe('function')
      expect(() => item.execute()).not.toThrow()
    })
  })
})

describe('RevealInFileManagerCommand', () => {
  let ctx: MenuContext

  beforeEach(() => {
    ctx = createMockMenuContext()
  })

  it('reveals the node path and shows no toast on success', async () => {
    const node = createMockFileNode('test.md', 'file')
    ;(ctx.api.revealInFileManager as Mock).mockResolvedValue('')

    await new RevealInFileManagerCommand(ctx, node).execute()

    expect(ctx.api.revealInFileManager).toHaveBeenCalledWith('/test/project/test.md')
    expect(ctx.toast).not.toHaveBeenCalled()
  })

  it('shows an error toast when reveal fails', async () => {
    const node = createMockFileNode('gone.md', 'file')
    ;(ctx.api.revealInFileManager as Mock).mockResolvedValue('Item no longer exists on disk')

    await new RevealInFileManagerCommand(ctx, node).execute()

    expect(ctx.toast).toHaveBeenCalledWith({
      type: 'error',
      title: 'Reveal failed',
      message: 'Item no longer exists on disk'
    })
  })
})
