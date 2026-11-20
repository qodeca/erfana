// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The project tree's Delete for a file and a folder – the menu item and the
 * Delete key (`fileRowCommands.deleteCommandFor`) both run these (#463, #486).
 * The item goes to the Recycle Bin / Trash; the questions are in `treeDelete.ts`.
 */
import type { FileNodeDirectory, FileNodeFile } from './types'
import { CommandBase } from './commands'
import { clipboardIcon, clipboardShortcut } from '../../ContextMenu/clipboardMenuItems'
import { TreeItemInUseError, confirmAndDeleteTreeItem, type TreeDeleteKind } from './treeDelete'
import type { DeleteEntryResult } from '../../../../../shared/ipc/file-schema'

/** Confirms, deletes and refreshes; a failure becomes an error toast. */
abstract class DeleteCommandBase<T extends FileNodeFile | FileNodeDirectory> extends CommandBase {
  label = 'Delete'
  danger = true
  icon = clipboardIcon('delete')
  shortcut = clipboardShortcut('delete', 'item')
  protected abstract confirmTitle: string
  protected abstract kind: TreeDeleteKind
  protected abstract doDelete(node: T, permanent: boolean): Promise<DeleteEntryResult>

  async execute(): Promise<void> {
    const node = this.node as T
    try {
      const removed = await confirmAndDeleteTreeItem(
        {
          showConfirm: this.ctx.dialogs.showConfirm,
          withWatcherPause: this.ctx.withWatcherPause,
          remove: (permanent) => this.doDelete(node, permanent),
          refreshProjectTree: this.ctx.refreshProjectTree
        },
        this.kind,
        node.name,
        this.confirmTitle
      )
      if (removed) this.ctx.onGitRefresh?.()
    } catch (err) {
      // An item in use already carries the sentence the person needs
      const msg = err instanceof TreeItemInUseError ? err.message : this.ctx.formatFileOperationError(err, 'delete')
      this.ctx.toast({ type: 'error', title: 'Error', message: msg })
    }
  }
}

/** Delete file command */
export class DeleteFileCommand extends DeleteCommandBase<FileNodeFile> {
  protected confirmTitle = 'Delete File'
  protected kind = 'file' as const

  protected doDelete(node: FileNodeFile, permanent: boolean): Promise<DeleteEntryResult> {
    return this.ctx.api.deleteFile(permanent ? { filePath: node.path, permanent } : { filePath: node.path })
  }
}

/** Delete directory command */
export class DeleteDirectoryCommand extends DeleteCommandBase<FileNodeDirectory> {
  protected confirmTitle = 'Delete Folder'
  protected kind = 'folder' as const

  protected doDelete(node: FileNodeDirectory, permanent: boolean): Promise<DeleteEntryResult> {
    return this.ctx.api.deleteFolder(permanent ? { filePath: node.path, permanent } : { filePath: node.path })
  }
}
