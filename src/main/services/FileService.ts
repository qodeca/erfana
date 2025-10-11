import { readdir, readFile, writeFile, stat } from 'fs/promises'
import { join, extname, basename } from 'path'

export interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
  extension?: string
}

export class FileService {
  private projectPath: string | null = null

  setProjectPath(path: string): void {
    this.projectPath = path
  }

  getProjectPath(): string | null {
    return this.projectPath
  }

  async readDirectory(dirPath: string): Promise<FileNode[]> {
    const entries = await readdir(dirPath, { withFileTypes: true })
    const nodes: FileNode[] = []

    for (const entry of entries) {
      // Skip hidden files and node_modules
      if (entry.name.startsWith('.') || entry.name === 'node_modules') {
        continue
      }

      const fullPath = join(dirPath, entry.name)
      const node: FileNode = {
        name: entry.name,
        path: fullPath,
        type: entry.isDirectory() ? 'directory' : 'file'
      }

      if (node.type === 'file') {
        node.extension = extname(entry.name)
      }

      // Recursively read subdirectories for markdown files
      if (node.type === 'directory') {
        try {
          node.children = await this.readDirectory(fullPath)
        } catch (error) {
          console.error(`Error reading directory ${fullPath}:`, error)
          node.children = []
        }
      }

      nodes.push(node)
    }

    // Sort: directories first, then files alphabetically
    return nodes.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })
  }

  async readFile(filePath: string): Promise<string> {
    return await readFile(filePath, 'utf-8')
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    await writeFile(filePath, content, 'utf-8')
  }

  async getFileStats(filePath: string) {
    return await stat(filePath)
  }

  isMarkdownFile(filePath: string): boolean {
    const ext = extname(filePath).toLowerCase()
    return ext === '.md' || ext === '.markdown'
  }
}

// Singleton instance
export const fileService = new FileService()
