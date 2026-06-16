// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Context Menu Strategies
 *
 * Strategy pattern implementation for node type-specific context menus.
 * Each strategy builds menus for a specific node type (file vs directory).
 *
 * Strategies:
 * - DirectoryContextMenuStrategy: Cut, Copy, Paste, New File, New Folder, Rename, Delete
 * - FileContextMenuStrategy: Cut, Copy, Rename, Delete
 *
 * All strategies implement IContextMenuStrategy and use Command pattern for actions.
 */

import type { IContextMenuStrategy, IMenuItem, MenuContext, FileNode, FileNodeFile, FileNodeDirectory } from './types'
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
  ImportCommand,
  RevealInFileManagerCommand,
  separatorItem
} from './commands'

/**
 * Directory context menu strategy
 * Builds menus for directory nodes with full operation set
 */
export class DirectoryContextMenuStrategy implements IContextMenuStrategy {
  supports(node: FileNode): boolean {
    return node.type === 'directory'
  }

  build(node: FileNode, ctx: MenuContext): IMenuItem[] {
    const dirNode = node as FileNodeDirectory
    const items: IMenuItem[] = []

    // Clipboard operations
    items.push(new CutCommand(ctx, dirNode).toMenuItem())
    items.push(new CopyCommand(ctx, dirNode).toMenuItem())

    // Paste (only if clipboard has items)
    if (ctx.clipboard.hasClipboard()) {
      items.push(new PasteIntoDirectoryCommand(ctx, dirNode).toMenuItem())
    }

    items.push(separatorItem())

    // Create operations
    items.push(new NewFileInDirectoryCommand(ctx, dirNode).toMenuItem())
    items.push(new NewFolderInDirectoryCommand(ctx, dirNode).toMenuItem())
    items.push(new RenameDirectoryCommand(ctx, dirNode).toMenuItem())

    // Import operations (only if importFile is provided)
    if (ctx.importFile) {
      items.push(separatorItem())
      items.push(new ImportCommand(ctx, dirNode, ctx.importFile).toMenuItem())
    }

    items.push(separatorItem())

    // Delete operation
    items.push(new DeleteDirectoryCommand(ctx, dirNode).toMenuItem())

    // Reveal in OS file manager (last, below Delete)
    items.push(separatorItem())
    items.push(new RevealInFileManagerCommand(ctx, dirNode).toMenuItem())

    return items
  }
}

/**
 * File context menu strategy
 * Builds menus for file nodes with basic operations
 */
export class FileContextMenuStrategy implements IContextMenuStrategy {
  supports(node: FileNode): boolean {
    return node.type === 'file'
  }

  build(node: FileNode, ctx: MenuContext): IMenuItem[] {
    const fileNode = node as FileNodeFile
    const items: IMenuItem[] = []

    // Clipboard operations
    items.push(new CutCommand(ctx, fileNode).toMenuItem())
    items.push(new CopyCommand(ctx, fileNode).toMenuItem())

    items.push(separatorItem())

    // Rename operation
    items.push(new RenameFileCommand(ctx, fileNode).toMenuItem())

    items.push(separatorItem())

    // Delete operation
    items.push(new DeleteFileCommand(ctx, fileNode).toMenuItem())

    // Reveal in OS file manager (last, below Delete)
    items.push(separatorItem())
    items.push(new RevealInFileManagerCommand(ctx, fileNode).toMenuItem())

    return items
  }
}
