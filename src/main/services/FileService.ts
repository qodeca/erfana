import { readdir, readFile, writeFile, stat, rm, mkdir } from 'fs/promises'
import { join, extname } from 'path'

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

  async createFile(dirPath: string, fileName: string): Promise<string> {
    // Ensure .md extension
    if (!fileName.endsWith('.md') && !fileName.endsWith('.markdown')) {
      fileName = `${fileName}.md`
    }

    const filePath = join(dirPath, fileName)

    // Check if file already exists
    try {
      await stat(filePath)
      throw new Error(`File "${fileName}" already exists`)
    } catch (error: any) {
      // File doesn't exist - good, we can create it
      if (error.code !== 'ENOENT') {
        throw error
      }
    }

    // Create empty file
    await writeFile(filePath, '', 'utf-8')

    return filePath
  }

  async createFolder(dirPath: string, folderName: string): Promise<string> {
    // Sanitize folder name - remove path separators
    folderName = folderName.replace(/[/\\]/g, '')

    if (!folderName) {
      throw new Error('Folder name cannot be empty')
    }

    const folderPath = join(dirPath, folderName)

    // Check if folder already exists
    try {
      await stat(folderPath)
      throw new Error(`Folder "${folderName}" already exists`)
    } catch (error: any) {
      // Folder doesn't exist - good, we can create it
      if (error.code !== 'ENOENT') {
        throw error
      }
    }

    // Create folder
    await mkdir(folderPath)

    return folderPath
  }

  async deleteFile(filePath: string): Promise<void> {
    // Verify it's a file, not a directory
    const stats = await stat(filePath)
    if (stats.isDirectory()) {
      throw new Error('Cannot delete a directory using deleteFile. Use deleteFolder instead.')
    }

    // Prevent deleting files outside project
    if (this.projectPath && !filePath.startsWith(this.projectPath)) {
      throw new Error('Cannot delete files outside the project directory')
    }

    await rm(filePath)
  }

  async deleteFolder(folderPath: string): Promise<void> {
    // Verify it's a directory
    const stats = await stat(folderPath)
    if (!stats.isDirectory()) {
      throw new Error('Path is not a directory')
    }

    // Prevent deleting project root
    if (this.projectPath && folderPath === this.projectPath) {
      throw new Error('Cannot delete the project root directory')
    }

    // Prevent deleting folders outside project
    if (this.projectPath && !folderPath.startsWith(this.projectPath)) {
      throw new Error('Cannot delete folders outside the project directory')
    }

    // Delete folder recursively
    await rm(folderPath, { recursive: true, force: true })
  }
}

// Singleton instance
export const fileService = new FileService()
