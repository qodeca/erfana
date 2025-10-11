import { useState } from 'react'
import { ChevronRight, ChevronDown, File, FileText } from 'lucide-react'
import type { FileNode } from '../../../../preload/index'
import './FileTree.css'

interface FileTreeNodeProps {
  node: FileNode
  level: number
  onFileClick: (filePath: string) => void
  onContextMenu?: (e: React.MouseEvent, node: FileNode, elementRect: DOMRect) => void
  selectedFolder?: string | null
}

export function FileTreeNode({
  node,
  level,
  onFileClick,
  onContextMenu,
  selectedFolder
}: FileTreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(level === 0)

  const handleClick = () => {
    if (node.type === 'directory') {
      setIsExpanded(!isExpanded)
    } else {
      onFileClick(node.path)
    }
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    if (onContextMenu) {
      const element = e.currentTarget as HTMLElement
      const elementRect = element.getBoundingClientRect()
      onContextMenu(e, node, elementRect)
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
    <div className="file-tree-node">
      <div
        className={`file-tree-item ${node.type} ${isSelected ? 'selected' : ''}`}
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
        <div className="file-tree-children">
          {node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              level={level + 1}
              onFileClick={onFileClick}
              onContextMenu={onContextMenu}
              selectedFolder={selectedFolder}
            />
          ))}
        </div>
      )}
    </div>
  )
}
