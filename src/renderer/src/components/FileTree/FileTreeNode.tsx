import { useState } from 'react'
import type { FileNode } from '../../../../preload/index'
import './FileTree.css'

interface FileTreeNodeProps {
  node: FileNode
  level: number
  onFileClick: (filePath: string) => void
}

export function FileTreeNode({ node, level, onFileClick }: FileTreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(level === 0)

  const handleClick = () => {
    if (node.type === 'directory') {
      setIsExpanded(!isExpanded)
    } else {
      onFileClick(node.path)
    }
  }

  const isMarkdown = node.extension === '.md' || node.extension === '.markdown'
  const icon = node.type === 'directory'
    ? (isExpanded ? '📂' : '📁')
    : isMarkdown
    ? '📝'
    : '📄'

  return (
    <div className="file-tree-node">
      <div
        className={`file-tree-item ${node.type}`}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={handleClick}
      >
        <span className="file-icon">{icon}</span>
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
            />
          ))}
        </div>
      )}
    </div>
  )
}
