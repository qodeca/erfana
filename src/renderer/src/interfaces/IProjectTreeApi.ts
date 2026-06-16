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

/**
 * File node type - simplified for documentation purposes
 * See preload/index.ts for the full type definition
 */
export type FileNode = {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
  extension?: string
  isSymlink?: boolean
}

export interface IProjectTreeApi {
  /**
   * File operations
   */
  file: {
    openProject(): Promise<string | null>
    openProjectByPath(projectPath: string): Promise<string>
    closeProject(): Promise<boolean>
    getLastProjectPath(): Promise<string | null>
    readDirectory(path: string): Promise<FileNode[]>
    onProjectChanged(
      callback: (data: { oldPath: string | null; newPath: string | null }) => void
    ): () => void
    createFile(targetPath: string, fileName: string): Promise<string>
    createFolder(targetPath: string, folderName: string): Promise<string>
    deleteFile(filePath: string): Promise<void>
    deleteFolder(folderPath: string): Promise<void>
    rename(path: string, newName: string): Promise<void>
    moveItem(
      sourcePath: string,
      targetParent: string,
      newName?: string,
      replaceExisting?: boolean
    ): Promise<{ path: string; isSymlink?: boolean }>
    copyItem(
      sourcePath: string,
      targetParent: string,
      newName?: string
    ): Promise<{ path: string; isSymlink?: boolean }>
    checkConflict(targetPath: string, itemName: string): Promise<boolean>
    revealInFileManager(filePath: string): Promise<string>
  }

  /**
   * Directory watching operations
   */
  directoryWatch: {
    start(projectPath: string): Promise<{ success: boolean }>
    stop(projectPath: string): Promise<{ success: boolean }>
    pause(projectPath: string): Promise<{ success: boolean }>
    resume(projectPath: string): Promise<{ success: boolean }>
    onDirectoryChanged(callback: (data: { eventCount: number }) => void): () => void
    onProjectDeleted(callback: () => void): () => void
    onDirectoryError(callback: (data: { error: string }) => void): () => void
  }

  /**
   * Terminal operations (limited scope for ProjectTree)
   */
  terminal: {
    write(terminalId: string, data: string): Promise<void>
  }
}
