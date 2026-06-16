// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Context Menu Commands
 *
 * Command pattern implementation for context menu actions.
 * Each command encapsulates an operation with its dependencies injected via MenuContext.
 *
 * Command Classes:
 * - CutCommand, CopyCommand: Clipboard operations
 * - PasteIntoDirectoryCommand: Paste with conflict checking
 * - RenameFileCommand, RenameDirectoryCommand: Rename with duplicate detection
 * - DeleteFileCommand, DeleteDirectoryCommand: Delete with confirmation
 * - NewFileInDirectoryCommand, NewFolderInDirectoryCommand: Create operations
 *
 * All commands are testable via dependency injection (MenuContext).
 */

import { Copy, Scissors, Clipboard as ClipboardIcon, Edit, Trash, FilePlus, FolderPlus, FileUp, FolderOpen } from 'lucide-react'
import type { IMenuItem, MenuContext, FileNode, FileNodeDirectory, FileNodeFile } from './types'
import { isMacOS, isWindows } from '../../../utils/platform'
import { getDirname } from '../../../utils/fileUtils'

/**
 * Base class for all commands
 * Provides toMenuItem() conversion and common structure
 */
abstract class CommandBase {
  abstract label: string
  icon?: JSX.Element
  danger?: boolean

  constructor(protected ctx: MenuContext, protected node: FileNode) {}

  abstract execute(): Promise<void> | void

  toMenuItem(): IMenuItem {
    return {
      label: this.label,
      icon: this.icon,
      danger: this.danger,
      execute: () => this.execute()
    }
  }
}

/* ========== Clipboard Commands (Cut/Copy/Paste) ========== */

/**
 * Cut command - marks item for move operation
 */
export class CutCommand extends CommandBase {
  label = 'Cut'
  icon = <Scissors size={14} strokeWidth={2} />

  execute(): void {
    this.ctx.clipboard.cut(this.node.path, this.node.name, this.node.type)
    this.ctx.toast({
      type: 'info',
      title: 'Cut',
      message: `"${this.node.name}" ready to move`
    })
  }
}

/**
 * Copy command - marks item for copy operation
 */
export class CopyCommand extends CommandBase {
  label = 'Copy'
  icon = <Copy size={14} strokeWidth={2} />

  execute(): void {
    this.ctx.clipboard.copy(this.node.path, this.node.name, this.node.type)
    this.ctx.toast({
      type: 'info',
      title: 'Copied',
      message: `"${this.node.name}" ready to paste`
    })
  }
}

/**
 * Paste command - executes clipboard operation into target directory
 * Handles conflict detection for cut (move) operations
 */
export class PasteIntoDirectoryCommand extends CommandBase {
  label = 'Paste'
  icon = <ClipboardIcon size={14} strokeWidth={2} />

  constructor(ctx: MenuContext, node: FileNodeDirectory) {
    super(ctx, node)
  }

  async execute(): Promise<void> {
    const { clipboard, dialogs } = this.ctx
    const targetPath = (this.node as FileNodeDirectory).path

    // Pre-check conflicts only for CUT (move) to mirror current behavior
    const sourceItemName = clipboard.itemName
    const sourceItemType = clipboard.itemType
    let replaceExisting = false

    if (sourceItemName && clipboard.getOperation() === 'cut') {
      try {
        const hasConflict = await this.ctx.api.checkConflict(targetPath, sourceItemName)
        if (hasConflict) {
          const itemTypeLabel = sourceItemType === 'directory' ? 'folder' : 'file'
          const confirmed = await dialogs.showConfirm({
            title: 'Replace Item',
            message: `A ${itemTypeLabel} named "${sourceItemName}" already exists in the target folder. Do you want to replace it?`,
            confirmLabel: 'Replace',
            cancelLabel: 'Cancel',
            danger: true
          })
          if (!confirmed) return
          replaceExisting = true
        }
      } catch {
        // Fall through to normal paste; backend will enforce safety
      }
    }

    try {
      const result = await this.ctx.withWatcherPause(async () => {
        const res = await clipboard.paste(targetPath, replaceExisting)
        if (res.success && this.ctx.projectPath) {
          await this.ctx.refreshProjectTree()
        }
        return res
      })

      if (result.success) {
        this.ctx.onGitRefresh?.()
        if (result.isSymlink) {
          const op = clipboard.getOperation() === 'cut' ? 'Moved' : 'Copied'
          this.ctx.toast({
            type: 'warning',
            title: `Symlink ${op}`,
            message: `Warning: You ${op.toLowerCase()} a symbolic link. The target file remains at its original location.`
          })
        } else {
          const opLabel = clipboard.getOperation() === 'cut' ? 'moved' : 'copied'
          const replacedLabel = replaceExisting ? ' and replaced existing item' : ''
          this.ctx.toast({
            type: 'success',
            title: 'Success',
            message: `Item ${opLabel}${replacedLabel}`
          })
        }
      } else {
        this.ctx.toast({
          type: 'error',
          title: 'Error',
          message: result.error || 'Failed to paste'
        })
      }
    } catch (err) {
      const msg = this.ctx.formatFileOperationError(err, 'paste')
      this.ctx.toast({ type: 'error', title: 'Error', message: msg })
    }
  }
}

/* ========== Rename Commands ========== */

/**
 * Base class for rename commands
 * Handles rename dialog, validation, and execution
 */
abstract class RenameCommandBase<T extends FileNodeFile | FileNodeDirectory> extends CommandBase {
  icon = <Edit size={14} strokeWidth={2} />
  protected abstract itemType: 'file' | 'directory'

  protected getParentPath(fullPath: string): string {
    return getDirname(fullPath) || '/'
  }

  async execute(): Promise<void> {
    const node = this.node as T
    const parentPath = this.getParentPath(node.path)
    const existingNames = this.ctx.getSiblingNames(node.path, node.name)

    const newName = await this.ctx.dialogs.showRename({
      title: this.itemType === 'file' ? 'Rename File' : 'Rename Folder',
      message: '',
      currentName: node.name,
      itemPath: node.path,
      itemType: this.itemType,
      parentPath,
      existingNames
    })

    if (!newName) return

    try {
      await this.ctx.withWatcherPause(async () => {
        await this.ctx.api.rename(node.path, newName)
        await this.ctx.refreshProjectTree()
      })
      this.ctx.onGitRefresh?.()
      this.ctx.toast({
        type: 'success',
        title: 'Success',
        message: 'Item renamed successfully'
      })
    } catch (err) {
      const msg = this.ctx.formatFileOperationError(err, 'rename')
      this.ctx.toast({ type: 'error', title: 'Error', message: msg })
    }
  }
}

/**
 * Rename file command
 */
export class RenameFileCommand extends RenameCommandBase<FileNodeFile> {
  label = 'Rename'
  protected itemType = 'file' as const
}

/**
 * Rename directory command
 */
export class RenameDirectoryCommand extends RenameCommandBase<FileNodeDirectory> {
  label = 'Rename'
  protected itemType = 'directory' as const
}

/* ========== Delete Commands ========== */

/**
 * Base class for delete commands
 * Handles confirmation dialog and deletion
 */
abstract class DeleteCommandBase<T extends FileNodeFile | FileNodeDirectory> extends CommandBase {
  danger = true
  icon = <Trash size={14} strokeWidth={2} />
  protected abstract confirmTitle: string
  protected abstract confirmMessage(name: string): string
  protected abstract doDelete(node: T): Promise<void>

  async execute(): Promise<void> {
    const node = this.node as T
    const confirmed = await this.ctx.dialogs.showConfirm({
      title: this.confirmTitle,
      message: this.confirmMessage(node.name),
      confirmLabel: 'Delete',
      danger: true
    })
    if (!confirmed) return

    try {
      await this.ctx.withWatcherPause(async () => {
        await this.doDelete(node)
        await this.ctx.refreshProjectTree()
      })
      this.ctx.onGitRefresh?.()
    } catch (err) {
      const msg = this.ctx.formatFileOperationError(err, 'delete')
      this.ctx.toast({ type: 'error', title: 'Error', message: msg })
    }
  }
}

/**
 * Delete file command
 */
export class DeleteFileCommand extends DeleteCommandBase<FileNodeFile> {
  label = 'Delete'
  protected confirmTitle = 'Delete File'
  protected confirmMessage = (name: string) =>
    `Are you sure you want to delete "${name}"? This action cannot be undone.`

  protected async doDelete(node: FileNodeFile): Promise<void> {
    await this.ctx.api.deleteFile(node.path)
  }
}

/**
 * Delete directory command
 */
export class DeleteDirectoryCommand extends DeleteCommandBase<FileNodeDirectory> {
  label = 'Delete'
  protected confirmTitle = 'Delete Folder'
  protected confirmMessage = (name: string) =>
    `Are you sure you want to delete "${name}" and all its contents? This action cannot be undone.`

  protected async doDelete(node: FileNodeDirectory): Promise<void> {
    await this.ctx.api.deleteFolder(node.path)
  }
}

/* ========== Create Commands ========== */

/**
 * New file command - creates a new file in directory
 */
export class NewFileInDirectoryCommand extends CommandBase {
  label = 'New File'
  icon = <FilePlus size={14} strokeWidth={2} />

  constructor(ctx: MenuContext, node: FileNodeDirectory) {
    super(ctx, node)
  }

  async execute(): Promise<void> {
    const parentPath = (this.node as FileNodeDirectory).path
    const relative = this.ctx.projectPath
      ? parentPath.replace(this.ctx.projectPath, '') || '/'
      : '/'

    const name = await this.ctx.dialogs.showNewFile({
      title: 'Create New File',
      message: '',
      parentPath: relative,
      inputPlaceholder: 'notes.md'
    })

    if (!name) return

    try {
      await this.ctx.withWatcherPause(async () => {
        await this.ctx.api.createFile(parentPath, name)
        await this.ctx.refreshProjectTree()
      })
      this.ctx.onGitRefresh?.()
    } catch (err) {
      const msg = this.ctx.formatFileOperationError(err, 'create')
      this.ctx.toast({ type: 'error', title: 'Error', message: msg })
    }
  }
}

/**
 * New folder command - creates a new folder in directory
 */
export class NewFolderInDirectoryCommand extends CommandBase {
  label = 'New Folder'
  icon = <FolderPlus size={14} strokeWidth={2} />

  constructor(ctx: MenuContext, node: FileNodeDirectory) {
    super(ctx, node)
  }

  async execute(): Promise<void> {
    const parentPath = (this.node as FileNodeDirectory).path
    const relative = this.ctx.projectPath
      ? parentPath.replace(this.ctx.projectPath, '') || '/'
      : '/'

    const name = await this.ctx.dialogs.showNewFolder({
      title: 'Create New Folder',
      message: '',
      parentPath: relative,
      inputPlaceholder: 'docs'
    })

    if (!name) return

    try {
      await this.ctx.withWatcherPause(async () => {
        await this.ctx.api.createFolder(parentPath, name)
        await this.ctx.refreshProjectTree()
      })
      this.ctx.onGitRefresh?.()
    } catch (err) {
      const msg = this.ctx.formatFileOperationError(err, 'create')
      this.ctx.toast({ type: 'error', title: 'Error', message: msg })
    }
  }
}

/* ========== Import Commands ========== */

/**
 * Import command - imports a file (PDF, text, or other supported formats)
 * Uses the useImport hook indirectly via passed callback
 */
export class ImportCommand extends CommandBase {
  label = 'Import...'
  icon = <FileUp size={14} strokeWidth={2} />

  private importFile: () => Promise<string | null>

  constructor(ctx: MenuContext, node: FileNodeDirectory, importFile: () => Promise<string | null>) {
    super(ctx, node)
    this.importFile = importFile
  }

  async execute(): Promise<void> {
    const result = await this.importFile()
    // Refresh git status if import was successful (result contains the output path)
    if (result) {
      this.ctx.onGitRefresh?.()
    }
  }
}

/**
 * @deprecated Use ImportCommand instead
 */
export const ImportPdfCommand = ImportCommand

/* ========== Utility ========== */

/**
 * Reveal a file or folder in the native OS file manager (Finder / Explorer).
 * Works for both file and directory nodes (and the project root node).
 */
export class RevealInFileManagerCommand extends CommandBase {
  label = isMacOS()
    ? 'Reveal in Finder'
    : isWindows()
      ? 'Reveal in Explorer'
      : 'Reveal in File Manager'
  icon = <FolderOpen size={14} strokeWidth={2} />

  async execute(): Promise<void> {
    const error = await this.ctx.api.revealInFileManager(this.node.path)
    if (error) {
      this.ctx.toast({ type: 'error', title: 'Reveal failed', message: error })
    }
  }
}

/**
 * Creates a separator menu item
 */
export const separatorItem = (): IMenuItem => ({
  label: '',
  separator: true,
  execute: () => {}
})
