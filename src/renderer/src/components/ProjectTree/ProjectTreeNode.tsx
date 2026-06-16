// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { ChevronRight, ChevronDown, File, FileText, AlertTriangle, Link as LinkIcon } from 'lucide-react'
import type { FileNode } from '../../../../preload/index'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import type { GitDisplayStatus } from '../../../../shared/ipc/git-schema'
import { GitStatusBadge } from './GitStatusBadge'
import { GitErrorBoundary } from './GitErrorBoundary'
import { TEST_IDS, getDynamicTestId } from '../../constants/testids'
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
  // Drag-drop props
  isDragging?: boolean
  isDropTarget?: boolean
  isDropInvalid?: boolean
  clipboardCut?: boolean
  dragDisabled?: boolean
  // Git status props
  gitStatus?: GitDisplayStatus
  getFileStatus?: (path: string) => GitDisplayStatus | undefined
  getFolderStatus?: (path: string) => GitDisplayStatus | undefined
  // External file drop props (Spec #012)
  /** Whether an external drag is currently active over the project tree */
  isExternalDragActive?: boolean
  /** Path of the folder being hovered during external drag */
  externalDropTarget?: string | null
}

export function ProjectTreeNode({
  node,
  level,
  onFileClick,
  onContextMenu,
  selectedFolder,
  expandedFolders,
  onToggleFolder,
  isDragging = false,
  isDropTarget = false,
  isDropInvalid = false,
  clipboardCut = false,
  dragDisabled = false,
  gitStatus,
  getFileStatus,
  getFolderStatus,
  isExternalDragActive = false,
  externalDropTarget = null
}: ProjectTreeNodeProps) {
  // Controlled component - check if this folder is expanded
  const isExpanded = expandedFolders.has(node.path)

  // Drag-drop integration - separate draggable and droppable
  const {
    attributes: dragAttributes,
    listeners: dragListeners,
    setNodeRef: setDragRef,
    isDragging: draggableIsDragging
  } = useDraggable({
    id: node.path,
    disabled: dragDisabled,
    data: {
      type: node.type,
      path: node.path,
      name: node.name
    }
  })

  const {
    setNodeRef: setDropRef,
    isOver
  } = useDroppable({
    id: node.path,
    data: {
      type: node.type,
      path: node.path,
      accepts: ['file', 'directory'] // Accepts both files and directories
    }
  })

  // Combine refs - element needs to be both draggable and droppable
  const setRefs = (element: HTMLDivElement | null) => {
    setDragRef(element)
    setDropRef(element)
  }

  const handleClick = () => {
    if (node.type === 'directory') {
      onToggleFolder(node.path)
      onFileClick(node.path)  // Also notify parent for folder selection
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
  const isSelected = node.path === selectedFolder  // Show selection for both files and directories
  const isSensitive = node.type === 'file' && isSensitiveFile(node.name)
  const isHidden = node.name.startsWith('.')
  const isSymlink = node.isSymlink === true

  // Determine git status for this node
  const currentGitStatus = gitStatus || (
    node.type === 'file'
      ? getFileStatus?.(node.path)
      : getFolderStatus?.(node.path)
  )

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

  const actuallyDragging = isDragging || draggableIsDragging
  // Show drop target highlight if: 1) something is being dragged over this node, 2) it's a valid drop target (folder)
  const showDropHighlight = isOver && node.type === 'directory' && !actuallyDragging

  // External drop target: this folder is being hovered during external drag (Spec #012)
  const isExternalDropTargetNode = externalDropTarget === node.path && node.type === 'directory'
  // External drag hover: file being hovered during external drag (invalid target)
  const isExternalDragHover = isExternalDragActive && node.type !== 'directory'

  return (
    <div
      className="project-tree-node"
      ref={setRefs}
      role="treeitem"
      aria-expanded={node.type === 'directory' ? isExpanded : undefined}
      aria-selected={isSelected}
      data-dragging={actuallyDragging}
      data-drop-highlight={showDropHighlight}
      data-external-drop-highlight={isExternalDropTargetNode}
      data-testid={getDynamicTestId(TEST_IDS.PROJECT_TREE_NODE, node.path)}
      data-path={node.path}
      data-type={node.type}
    >
      <div
        className={`project-tree-item ${node.type} ${isSelected ? 'selected' : ''}`}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        data-dragging={actuallyDragging}
        data-drop-target={isDropTarget || showDropHighlight}
        data-drop-invalid={isDropInvalid}
        data-clipboard-cut={clipboardCut}
        data-external-drop-target={isExternalDropTargetNode}
        data-external-drag-hover={isExternalDragHover}
        data-testid={
          node.type === 'directory' && (showDropHighlight || isExternalDropTargetNode)
            ? getDynamicTestId(TEST_IDS.PROJECT_TREE_DROP_TARGET, node.path)
            : getDynamicTestId(
                node.type === 'file' ? TEST_IDS.PROJECT_TREE_NODE_FILE : TEST_IDS.PROJECT_TREE_NODE_FOLDER,
                node.path
              )
        }
        data-path={node.path}
        data-type={node.type}
        // @dnd-kit handles drag - terminal drop is detected in ProjectTree's handleDragEnd
        {...dragAttributes}
        {...dragListeners}
      >
        <span
          className={`file-icon ${isMarkdown ? 'markdown' : ''}`}
          data-testid={node.type === 'directory' ? getDynamicTestId(TEST_IDS.PROJECT_TREE_TOGGLE, node.path) : undefined}
        >
          {renderIcon()}
        </span>
        <span
          className={`file-name ${isMarkdown ? 'markdown' : ''} ${isSensitive ? 'sensitive' : ''} ${isHidden ? 'hidden-file' : ''}`}
          data-git-status={currentGitStatus}
          title={isSensitive ? 'Sensitive file - may contain credentials' : undefined}
        >
          {isSensitive && <AlertTriangle size={14} className="sensitive-icon" aria-label="Warning: sensitive file" />}
          {isSymlink && <LinkIcon size={12} style={{ marginRight: 4, opacity: 0.8 }} aria-label="Symlink" />}
          {node.name}
        </span>
        {currentGitStatus && currentGitStatus !== 'unmodified' && (
          <GitErrorBoundary>
            <GitStatusBadge status={currentGitStatus} isFolder={node.type === 'directory'} />
          </GitErrorBoundary>
        )}
      </div>
      {node.type === 'directory' && isExpanded && node.children && (
        <div className="project-tree-children" role="group">
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
              dragDisabled={dragDisabled}
              getFileStatus={getFileStatus}
              getFolderStatus={getFolderStatus}
              isExternalDragActive={isExternalDragActive}
              externalDropTarget={externalDropTarget}
            />
          ))}
        </div>
      )}
    </div>
  )
}
