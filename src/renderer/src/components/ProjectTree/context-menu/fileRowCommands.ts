// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Commands that act on a row's item the way the keyboard and a file row need
 * (#463): Paste on a file row, and the delete the tree's Delete key runs.
 */
import type { MenuContext, FileNode, FileNodeFile } from './types'
import { getDirname } from '../../../utils/fileUtils'
import { DeleteDirectoryCommand, DeleteFileCommand, PasteIntoDirectoryCommand } from './commands'

/**
 * Paste on a FILE row: the item lands in the file's folder, as it would on
 * that folder's row.
 */
export class PasteIntoParentFolderCommand extends PasteIntoDirectoryCommand {
  constructor(ctx: MenuContext, node: FileNodeFile) {
    super(ctx, node)
  }

  protected override targetPath(): string {
    return getDirname(this.node.path) || this.ctx.projectPath || this.node.path
  }
}

/**
 * The delete command for a node – what the menu's Delete item runs, so the
 * tree's Delete key asks the same confirmation and deletes the same way.
 *
 * @param ctx - The menu context
 * @param node - The file or folder to delete
 * @returns Its delete command; call `execute()`
 */
export function deleteCommandFor(ctx: MenuContext, node: FileNode): DeleteFileCommand | DeleteDirectoryCommand {
  return node.type === 'directory' ? new DeleteDirectoryCommand(ctx, node) : new DeleteFileCommand(ctx, node)
}
