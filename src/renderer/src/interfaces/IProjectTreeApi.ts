// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ProjectTree API Interface
 *
 * Abstracts the window.api calls used by ProjectTree component.
 * This interface follows the Dependency Inversion Principle (DIP)
 * by allowing the component to depend on an abstraction rather than
 * the concrete window.api implementation.
 *
 * Benefits:
 * - Improved testability (easier to mock)
 * - Reduced coupling to Electron IPC
 * - Clear contract for required operations
 * - Type safety for API calls
 */

import type { FileBridge, FileNode } from '../../../shared/ipc/file-schema'
import type { TerminalBridge } from '../../../shared/ipc/terminal-schema'
import type { DirectoryChangedPayload } from '../../../shared/ipc/directory-watch-schema'

/** File node type – defined in shared/ipc/file-schema */
export type { FileNode }

export interface IProjectTreeApi {
  /**
   * File operations
   */
  file: Pick<
    FileBridge,
    | 'openProject'
    | 'openProjectByPath'
    | 'closeProject'
    | 'readDirectory'
    | 'onProjectChanged'
    | 'createFile'
    | 'createFolder'
    | 'deleteFile'
    | 'deleteFolder'
    | 'rename'
    | 'moveItem'
    | 'copyItem'
    | 'checkConflict'
    | 'revealInFileManager'
  >

  /**
   * Directory watching operations
   */
  directoryWatch: {
    start(projectPath: string): Promise<{ success: boolean }>
    stop(projectPath: string): Promise<{ success: boolean }>
    pause(projectPath: string): Promise<{ success: boolean }>
    resume(projectPath: string): Promise<{ success: boolean }>
    onDirectoryChanged(
      callback: (data: DirectoryChangedPayload) => void
    ): () => void
    onProjectDeleted(callback: () => void): () => void
    onDirectoryError(callback: (data: { error: string }) => void): () => void
  }

  /**
   * Terminal operations (limited scope for ProjectTree)
   */
  terminal: Pick<TerminalBridge, 'write'>
}
