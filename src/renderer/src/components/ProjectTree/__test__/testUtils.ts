// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Shared Test Utilities for ProjectTree Tests
 *
 * Provides mock factories and helper functions for testing
 * ProjectTree components, hooks, and utilities.
 */

import { vi } from 'vitest'
import type { IProjectTreeApi, FileNode } from '../../../interfaces/IProjectTreeApi'
import type { MenuContext, IClipboard, Dialogs } from '../context-menu/types'

/**
 * Mock window.api for ProjectTree tests
 */
export const createMockProjectTreeApi = (overrides?: Partial<IProjectTreeApi>): IProjectTreeApi => {
  return {
    file: {
      openProject: vi.fn().mockResolvedValue('/test/project'),
      openProjectByPath: vi.fn().mockResolvedValue('/test/project'),
      closeProject: vi.fn().mockResolvedValue(true),
      getLastProjectPath: vi.fn().mockResolvedValue(null),
      readDirectory: vi.fn().mockResolvedValue([]),
      onProjectChanged: vi.fn().mockReturnValue(() => {}),
      createFile: vi.fn().mockResolvedValue('/test/project/file.md'),
      createFolder: vi.fn().mockResolvedValue('/test/project/folder'),
      deleteFile: vi.fn().mockResolvedValue(undefined),
      deleteFolder: vi.fn().mockResolvedValue(undefined),
      rename: vi.fn().mockResolvedValue(undefined),
      moveItem: vi.fn().mockResolvedValue({ path: '/moved', isSymlink: false }),
      copyItem: vi.fn().mockResolvedValue({ path: '/copied', isSymlink: false }),
      checkConflict: vi.fn().mockResolvedValue(false),
      revealInFileManager: vi.fn().mockResolvedValue(''),
      ...overrides?.file
    },
    directoryWatch: {
      start: vi.fn().mockResolvedValue({ success: true }),
      stop: vi.fn().mockResolvedValue({ success: true }),
      pause: vi.fn().mockResolvedValue({ success: true }),
      resume: vi.fn().mockResolvedValue({ success: true }),
      onDirectoryChanged: vi.fn().mockReturnValue(() => {}),
      onProjectDeleted: vi.fn().mockReturnValue(() => {}),
      onDirectoryError: vi.fn().mockReturnValue(() => {}),
      ...overrides?.directoryWatch
    },
    terminal: {
      write: vi.fn().mockResolvedValue(undefined),
      ...overrides?.terminal
    }
  }
}

/**
 * Mock clipboard store
 */
export const createMockClipboard = (overrides?: Partial<IClipboard>): IClipboard => {
  return {
    itemPath: '/test/item.md',
    itemName: 'item.md',
    itemType: 'file',
    cut: vi.fn(),
    copy: vi.fn(),
    paste: vi.fn().mockResolvedValue({ success: true }),
    hasClipboard: vi.fn().mockReturnValue(true),
    getOperation: vi.fn().mockReturnValue('cut'),
    ...overrides
  }
}

/**
 * Mock dialogs
 */
export const createMockDialogs = (overrides?: Partial<Dialogs>): Dialogs => {
  return {
    showConfirm: vi.fn().mockResolvedValue(true),
    showRename: vi.fn().mockResolvedValue('newname.md'),
    showNewFile: vi.fn().mockResolvedValue('file.md'),
    showNewFolder: vi.fn().mockResolvedValue('folder'),
    ...overrides
  }
}

/**
 * Mock MenuContext
 */
export const createMockMenuContext = (overrides?: Partial<MenuContext>): MenuContext => {
  const api = createMockProjectTreeApi()

  return {
    projectPath: '/test/project',
    clipboard: createMockClipboard(),
    dialogs: createMockDialogs(),
    toast: vi.fn(),
    api: api.file,
    withWatcherPause: vi.fn((op) => op()),
    refreshProjectTree: vi.fn().mockResolvedValue(undefined),
    formatFileOperationError: vi.fn((err) => String(err)),
    getSiblingNames: vi.fn().mockReturnValue([]),
    ...overrides
  }
}

/**
 * Create mock file nodes
 */
export const createMockFileNode = (
  name: string,
  type: 'file' | 'directory',
  path?: string
): FileNode => ({
  name,
  path: path || `/test/project/${name}`,
  type,
  children: type === 'directory' ? [] : undefined,
  extension: type === 'file' ? name.split('.').pop() : undefined,
  isSymlink: false
})

/**
 * Create mock file tree
 */
export const createMockFileTree = (): FileNode[] => [
  createMockFileNode('file1.md', 'file'),
  createMockFileNode('file2.md', 'file'),
  createMockFileNode('folder1', 'directory'),
  createMockFileNode('folder2', 'directory')
]

/**
 * Wait for async operations
 */
export const waitForAsync = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * Spy on console methods
 */
export const spyConsole = (): {
  warn: ReturnType<typeof vi.spyOn>
  error: ReturnType<typeof vi.spyOn>
  log: ReturnType<typeof vi.spyOn>
} => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})

  return { warn, error, log }
}
