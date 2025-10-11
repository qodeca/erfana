import { ElectronAPI } from '@electron-toolkit/preload'
import { FileNode, FileStats } from './index'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      file: {
        openProject: () => Promise<string | null>
        readDirectory: (dirPath: string) => Promise<FileNode[]>
        readFile: (filePath: string) => Promise<string>
        writeFile: (filePath: string, content: string) => Promise<boolean>
        getStats: (filePath: string) => Promise<FileStats>
        getProjectPath: () => Promise<string | null>
      }
    }
  }
}
