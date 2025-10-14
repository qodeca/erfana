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
      }
      fileWatch: {
        start: (filePath: string) => Promise<{ success: boolean; error?: string }>
        stop: (filePath: string) => Promise<{ success: boolean; error?: string }>
        stopAll: () => Promise<{ success: boolean; error?: string }>
        pause: (filePath: string) => Promise<{ success: boolean; error?: string }>
        resume: (filePath: string) => Promise<{ success: boolean; error?: string }>
        getStats: () => Promise<{ success: boolean; stats?: any; error?: string }>
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
        getStats: () => Promise<{ success: boolean; stats?: any; error?: string }>
        onDirectoryChanged: (
          callback: (data: { dirPath: string; eventCount: number; summary: any }) => void
        ) => () => void
        onProjectDeleted: (callback: (data: { dirPath: string }) => void) => () => void
        onDirectoryError: (
          callback: (data: { dirPath: string; error: string }) => void
        ) => () => void
      }
      claudeCode: {
        // Session lifecycle
        startSession: (projectPath: string, planningMode?: boolean) => Promise<{ success: boolean; error?: string }>
        stopSession: () => Promise<{ success: boolean; error?: string }>
        getSessionState: () => Promise<{
          success: boolean
          state?: 'stopped' | 'starting' | 'ready' | 'error'
          error?: string
        }>
        // Send message
        sendMessage: (prompt: string, context: any, sessionId: string) => void
        stop: () => void
        // CLI installation and authentication
        isInstalled: () => Promise<boolean>
        checkAuth: () => Promise<{
          isAuthenticated: boolean
          username?: string
          error?: string
        }>
        setToken: (token: string) => Promise<{ success: boolean; error?: string }>
        // Tool approval
        approveTool: (
          toolName: string,
          remember: boolean
        ) => Promise<{ success: boolean; error?: string }>
        denyTool: (toolName: string) => Promise<{ success: boolean; error?: string }>
        // Event listeners - Messages
        onMessage: (
          callback: (data: {
            sessionId: string
            message: {
              id: string
              type: 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'system' | 'error'
              content: string
              metadata?: any
              timestamp: Date
            }
          }) => void
        ) => () => void
        // Streaming message updates (--include-partial-messages)
        onMessageUpdate: (
          callback: (data: {
            message: {
              id: string
              type: 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'system' | 'error'
              content: string
              metadata?: any
              timestamp: Date
            }
          }) => void
        ) => () => void
        onMessageComplete: (
          callback: (data: {
            message: {
              id: string
              type: 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'system' | 'error'
              content: string
              metadata?: any
              timestamp: Date
            }
          }) => void
        ) => () => void
        onComplete: (callback: (data: { sessionId: string }) => void) => () => void
        onError: (callback: (data: { sessionId: string; error: string }) => void) => () => void
        // Event listeners - Session lifecycle
        onSessionStarted: (callback: (data: { projectPath: string }) => void) => () => void
        onSessionStopped: (callback: () => void) => () => void
        onSessionRestarting: (
          callback: (data: { attempt: number; maxAttempts: number }) => void
        ) => () => void
        onSessionError: (
          callback: (error: { message: string; recoverable: boolean }) => void
        ) => () => void
        // Event listeners - Tool approval
        onToolApprovalNeeded: (
          callback: (request: {
            toolName: string
            toolId: string
            input: any
            description: string
          }) => void
        ) => () => void
        onSessionResumed: (
          callback: (data: { projectPath: string; approvedTools: string[] }) => void
        ) => () => void
      }
      settings: {
        getApprovedTools: () => Promise<{ success: boolean; tools?: string[]; error?: string }>
        setApprovedTools: (
          tools: string[]
        ) => Promise<{ success: boolean; error?: string }>
        addApprovedTool: (
          toolName: string
        ) => Promise<{ success: boolean; error?: string }>
        removeApprovedTool: (
          toolName: string
        ) => Promise<{ success: boolean; error?: string }>
        resetApprovedTools: () => Promise<{ success: boolean; error?: string }>
        getProjectFilterMode: () => Promise<{ success: boolean; mode?: string; error?: string }>
        setProjectFilterMode: (mode: string) => Promise<{ success: boolean; error?: string }>
      }
    }
  }
}
