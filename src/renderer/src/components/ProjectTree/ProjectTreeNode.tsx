import { ChevronRight, ChevronDown, File, FileText, AlertTriangle } from 'lucide-react'
import type { FileNode } from '../../../../preload/index'
import './ProjectTree.css'

/**
 * Detect potentially sensitive files using precise pattern matching
 * Minimizes false positives while catching real credential files
 */
const isSensitiveFile = (fileName: string): boolean => {
  const lower = fileName.toLowerCase()

  // Category 1: Exact filename matches (credentials, secrets, SSH keys)
  const exactMatches = [
    'credentials',
    'secrets',
    'id_rsa',
    'id_dsa',
    'id_ecdsa',
    'id_ed25519',
    'known_hosts',
    'authorized_keys'
  ]
  if (exactMatches.includes(lower)) {
    return true
  }

  // Category 2: Dotfile patterns (.env, .env.local, .env.production, etc.)
  const dotfilePatterns = ['.env', '.npmrc', '.netrc', '.dockercfg', '.pypirc']
  if (dotfilePatterns.some(pattern => lower === pattern || lower.startsWith(pattern + '.'))) {
    return true
  }

  // Category 3: Directory paths (must contain exact directory name)
  const directoryPatterns = ['.aws/', '.ssh/', '.gnupg/']
  if (directoryPatterns.some(pattern => fileName.includes(pattern))) {
    return true
  }

  // Category 4: File extensions for keys/certificates
  const sensitiveExtensions = ['.key', '.pem', '.p12', '.pfx', '.keystore', '.jks', '.crt', '.cer']
  if (sensitiveExtensions.some(ext => lower.endsWith(ext))) {
    return true
  }

  // Category 5: Password/token files
  if (lower.includes('password') && (lower.endsWith('.txt') || lower.endsWith('.json'))) {
    return true
  }
  if (lower.includes('token') && (lower.endsWith('.txt') || lower.endsWith('.json'))) {
    return true
  }

  return false
}

interface ProjectTreeNodeProps {
  node: FileNode
  level: number
  onFileClick: (filePath: string) => void
  onContextMenu?: (e: React.MouseEvent, node: FileNode) => void
  selectedFolder?: string | null
  expandedFolders: Set<string>
  onToggleFolder: (folderPath: string) => void
}

export function ProjectTreeNode({
  node,
  level,
  onFileClick,
  onContextMenu,
  selectedFolder,
  expandedFolders,
  onToggleFolder
}: ProjectTreeNodeProps) {
  // Controlled component - check if this folder is expanded
  const isExpanded = expandedFolders.has(node.path)

  const handleClick = () => {
    if (node.type === 'directory') {
      onToggleFolder(node.path)
    } else {
      onFileClick(node.path)
    }
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    if (onContextMenu) {
      onContextMenu(e, node)
    }
  }

  const isMarkdown = node.extension === '.md' || node.extension === '.markdown'
  const isSelected = node.type === 'directory' && node.path === selectedFolder
  const isSensitive = node.type === 'file' && isSensitiveFile(node.name)
  const isHidden = node.name.startsWith('.')

  const renderIcon = () => {
    if (node.type === 'directory') {
      return isExpanded ? (
        <ChevronDown size={16} strokeWidth={2} />
      ) : (
        <ChevronRight size={16} strokeWidth={2} />
      )
    } else if (isMarkdown) {
      return <FileText size={16} strokeWidth={2} />
    } else {
      return <File size={16} strokeWidth={2} />
    }
  }

  return (
    <div className="project-tree-node">
      <div
        className={`project-tree-item ${node.type} ${isSelected ? 'selected' : ''}`}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        <span className="file-icon">{renderIcon()}</span>
        <span
          className={`file-name ${isMarkdown ? 'markdown' : ''} ${isSensitive ? 'sensitive' : ''} ${isHidden ? 'hidden-file' : ''}`}
          title={isSensitive ? 'Sensitive file - may contain credentials' : undefined}
        >
          {isSensitive && <AlertTriangle size={14} className="sensitive-icon" aria-label="Warning: sensitive file" />}
          {node.name}
        </span>
      </div>
      {node.type === 'directory' && isExpanded && node.children && (
        <div className="project-tree-children">
          {node.children.map((child) => (
            <ProjectTreeNode
              key={child.path}
              node={child}
              level={level + 1}
              onFileClick={onFileClick}
              onContextMenu={onContextMenu}
              selectedFolder={selectedFolder}
              expandedFolders={expandedFolders}
              onToggleFolder={onToggleFolder}
            />
          ))}
        </div>
      )}
    </div>
  )
}
