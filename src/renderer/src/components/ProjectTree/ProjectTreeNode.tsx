import { ChevronRight, ChevronDown, File, FileText } from 'lucide-react'
import type { FileNode } from '../../../../preload/index'
import './ProjectTree.css'

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
        <span className={`file-name ${isMarkdown ? 'markdown' : ''}`}>
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
