// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Context Menu Type Definitions
 *
 * Defines interfaces for the Context Menu Strategy Pattern implementation.
 * Supports Strategy + Command + Factory patterns for extensible, type-safe menu generation.
 *
 * Key Types:
 * - FileNode discriminated unions (file vs directory)
 * - IClipboard: Clipboard store operations
 * - Dialogs: Dialog functions for user input
 * - MenuContext: Dependency injection container for commands
 * - IMenuItem: Menu item with execute method
 * - IContextMenuStrategy: Strategy interface for menu generation
 * - IContextMenuFactory: Factory for selecting strategies
 */

import type { ReactNode } from 'react'
import type { FileNode as PreloadFileNode } from '../../../../../preload/index'
import type { IProjectTreeApi } from '../../../interfaces/IProjectTreeApi'

/**
 * Discriminated FileNode unions for type safety
 */
export type FileNodeFile = PreloadFileNode & { type: 'file' }
export type FileNodeDirectory = PreloadFileNode & { type: 'directory' }
export type FileNode = FileNodeFile | FileNodeDirectory

/**
 * Clipboard store interface (abstraction of useClipboardStore)
 */
export interface IClipboard {
  itemPath: string | null
  itemName: string | null
  itemType: 'file' | 'directory' | null
  cut: (path: string, name: string, type: 'file' | 'directory') => void
  copy: (path: string, name: string, type: 'file' | 'directory') => void
  paste: (targetPath: string, replaceExisting?: boolean) => Promise<{
    success: boolean
    newPath?: string
    isSymlink?: boolean
    error?: string
  }>
  hasClipboard: () => boolean
  getOperation: () => 'cut' | 'copy' | null
}

/**
 * Dialog functions interface (from useDialog hook)
 */
export interface Dialogs {
  showConfirm: (opts: {
    title: string
    message: string
    confirmLabel?: string
    cancelLabel?: string
    danger?: boolean
  }) => Promise<boolean>
  showRename: (opts: {
    title: string
    message: string
    currentName: string
    itemPath: string
    itemType: 'file' | 'directory'
    parentPath: string
    existingNames: string[]
  }) => Promise<string | null>
  showNewFile: (opts: {
    title: string
    message: string
    parentPath: string
    inputPlaceholder?: string
  }) => Promise<string | null>
  showNewFolder: (opts: {
    title: string
    message: string
    parentPath: string
    inputPlaceholder?: string
  }) => Promise<string | null>
}

/**
 * Toast notification function type
 */
export type ToastFn = (args: {
  type: 'success' | 'error' | 'info' | 'warning'
  title: string
  message: string
}) => void

/**
 * Menu context - dependency injection container for commands
 * Provides all services needed by command execution
 */
export interface MenuContext {
  projectPath: string | null
  clipboard: IClipboard
  dialogs: Dialogs
  toast: ToastFn
  api: IProjectTreeApi['file']
  withWatcherPause: <T>(op: () => Promise<T>) => Promise<T>
  refreshProjectTree: () => Promise<void>
  /** Callback to refresh git status after file operations */
  onGitRefresh?: () => void
  formatFileOperationError: (
    error: unknown,
    op: 'rename' | 'paste' | 'move' | 'delete' | 'create'
  ) => string
  // For rename duplicate checking
  getSiblingNames: (nodePath: string, currentName: string) => string[]
  // For file import command
  importFile?: () => Promise<string | null>
}

/**
 * Menu item with execute method (Command pattern)
 */
export interface IMenuItem {
  label: string
  icon?: ReactNode
  danger?: boolean
  separator?: boolean
  execute: () => void | Promise<void>
}

/**
 * Context menu strategy interface (Strategy pattern)
 * Each strategy builds menus for a specific node type
 */
export interface IContextMenuStrategy {
  supports(node: FileNode): boolean
  build(node: FileNode, ctx: MenuContext): IMenuItem[]
}

/**
 * Context menu factory interface (Factory pattern)
 * Selects appropriate strategy and builds menu
 */
export interface IContextMenuFactory {
  build(node: FileNode, ctx: MenuContext): IMenuItem[]
}
