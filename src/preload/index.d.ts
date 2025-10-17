import { ElectronAPI } from '@electron-toolkit/preload'
import { FileNode, FileStats } from './index'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      file: {
        openProject: () => Promise<string | null>
        getLastProjectPath: () => Promise<string | null>
        readDirectory: (dirPath: string) => Promise<FileNode[]>
        readFile: (filePath: string) => Promise<string>
        writeFile: (filePath: string, content: string) => Promise<boolean>
        getStats: (filePath: string) => Promise<FileStats>
        getProjectPath: () => Promise<string | null>
        createFile: (dirPath: string, fileName: string) => Promise<string>
        createFolder: (dirPath: string, folderName: string) => Promise<string>
        deleteFile: (filePath: string) => Promise<boolean>
        deleteFolder: (folderPath: string) => Promise<boolean>
        rename: (oldPath: string, newName: string) => Promise<string>
        onProjectChanged: (
          callback: (data: { oldPath: string | null; newPath: string | null }) => void
        ) => () => void
        closeProject: () => Promise<boolean>
      }
      fileWatch: {
        start: (filePath: string) => Promise<{ success: boolean; error?: string }>
        stop: (filePath: string) => Promise<{ success: boolean; error?: string }>
        stopAll: () => Promise<{ success: boolean; error?: string }>
        pause: (filePath: string) => Promise<{ success: boolean; error?: string }>
        resume: (filePath: string) => Promise<{ success: boolean; error?: string }>
        getStats: () => Promise<{ success: boolean; stats?: unknown; error?: string }>
        onFileChanged: (callback: (data: { filePath: string }) => void) => () => void
        onFileDeleted: (callback: (data: { filePath: string }) => void) => () => void
        onFileError: (callback: (data: { filePath: string; error: string }) => void) => () => void
      }
      directoryWatch: {
        start: (dirPath: string) => Promise<{ success: boolean; error?: string }>
        stop: (dirPath: string) => Promise<{ success: boolean; error?: string }>
        stopAll: () => Promise<{ success: boolean; error?: string }>
        pause: (dirPath: string) => Promise<{ success: boolean; error?: string }>
        resume: (dirPath: string) => Promise<{ success: boolean; error?: string }>
        getStats: () => Promise<{ success: boolean; stats?: unknown; error?: string }>
        onDirectoryChanged: (
          callback: (data: { dirPath: string; eventCount: number; summary: Record<string, number> }) => void
        ) => () => void
        onProjectDeleted: (callback: (data: { dirPath: string }) => void) => () => void
        onDirectoryError: (
          callback: (data: { dirPath: string; error: string }) => void
        ) => () => void
      }
      // Copilot removed
      settings: {
        getProjectFilterMode: () => Promise<{ success: boolean; mode?: string; error?: string }>
        setProjectFilterMode: (mode: string) => Promise<{ success: boolean; error?: string }>
      }
      terminal: {
        isAvailable: () => Promise<{ success: boolean; available: boolean }>
        create: (config?: {
          shell?: string
          cwd?: string
          env?: Record<string, string>
          cols?: number
          rows?: number
        }) => Promise<{ success: boolean; terminalId?: string; error?: string }>
        write: (terminalId: string, data: string) => void
        resize: (terminalId: string, cols: number, rows: number) => void
        kill: (terminalId: string) => Promise<{ success: boolean; error?: string }>
        getInfo: (terminalId: string) => Promise<{
          success: boolean
          info?: { id: string; cwd: string; title: string }
          error?: string
        }>
        list: () => Promise<{
          success: boolean
          terminals?: Array<{ id: string; title: string }>
          error?: string
        }>
        onData: (callback: (data: { terminalId: string; data: string }) => void) => () => void
        onExit: (
          callback: (data: { terminalId: string; exitCode: number; signal?: number }) => void
        ) => () => void
        onError: (callback: (data: { terminalId: string; error: string }) => void) => () => void
      }
    }
  }
}
