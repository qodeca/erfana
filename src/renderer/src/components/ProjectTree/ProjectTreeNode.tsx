// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { memo } from 'react'
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

/**
 * Height of one tree row in px. The row's CSS draws it as `--space-14`; the
 * virtualiser positions rows by this number, so the two must agree
 * (`ProjectTreeNode.test.tsx` reads the token to hold them together).
 */
export const TREE_ROW_HEIGHT = 28

interface ProjectTreeNodeProps {
  node: FileNode
  level: number
  /** 1-based position among its siblings (`aria-posinset`) */
  posInSet: number
  /** Number of siblings, itself included (`aria-setsize`) */
  setSize: number
  /** Parent folder path (null for the root row); the external-drop target lookup reads it */
  parentPath: string | null
  /** Offset from the top of the list in px (virtualised placement) */
  top: number
  isExpanded: boolean
  /**
   * Whether this row is THE selected row – the folder that paste, New file
   * and Import act on (`selectedFolder`). It drives both the lime selected
   * style and `aria-selected`, so what is announced is exactly what is drawn
   * (APG single-select tree, selection does NOT follow focus). Opening a file
   * does not select it; only a folder click or Enter on a folder does.
   */
  isSelected: boolean
  /** The one row that holds the tree's Tab stop (roving tabindex) */
  isTabStop: boolean
  onFileClick: (filePath: string) => void
  onContextMenu?: (e: React.MouseEvent, node: FileNode) => void
  onToggleFolder: (folderPath: string) => void
  // Drag-drop props
  isDragging?: boolean
  isDropTarget?: boolean
  isDropInvalid?: boolean
  clipboardCut?: boolean
  dragDisabled?: boolean
  /**
   * The row sits inside the folder highlighted as a drop target – `internal`
   * for a tree drag, `external` for a drag from the OS. A flat list has no
   * children container to tint, so each row inside the folder is tinted.
   */
  inDropZone?: 'internal' | 'external' | null
  /** Git status, resolved by the parent for this row only */
  gitStatus?: GitDisplayStatus
  // External file drop props (Spec #012)
  /** Whether an external drag is currently active over the project tree */
  isExternalDragActive?: boolean
  /** Whether this row is the folder hovered during an external drag */
  isExternalDropTarget?: boolean
}

/**
 * One row of the project tree.
 *
 * The row does not render its children: `ProjectTree` flattens the expanded
 * part of the tree (`buildVisibleRows`) and virtualises it, so the tree's
 * structure is stated with `aria-level` / `aria-posinset` / `aria-setsize` on
 * each row instead of nested `role="group"` containers – which also stops an
 * expanded folder's accessible name swallowing every descendant name (#89).
 *
 * Every prop but `node` is a primitive or a stable callback, and the
 * component is memoised: a click, a focus move, a drag hover or a status
 * refresh re-renders only the rows whose own state changed. Before, the whole
 * `expandedFolders` Set and the selection went to every row, so any change
 * re-rendered all of them. `node` stays the same object only while the tree is
 * unchanged: a tree refresh (a watcher event, a rename) builds fresh nodes, so
 * every mounted row – a screenful – re-renders once after one.
 */
function ProjectTreeNodeRow({
  node,
  level,
  posInSet,
  setSize,
  parentPath,
  top,
  isExpanded,
  isSelected,
  isTabStop,
  onFileClick,
  onContextMenu,
  onToggleFolder,
  isDragging = false,
  isDropTarget = false,
  isDropInvalid = false,
  clipboardCut = false,
  dragDisabled = false,
  inDropZone = null,
  gitStatus,
  isExternalDragActive = false,
  isExternalDropTarget = false
}: ProjectTreeNodeProps) {
  // Drag-drop integration - separate draggable and droppable
  const {
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
  const isSensitive = node.type === 'file' && isSensitiveFile(node.name)
  const isHidden = node.name.startsWith('.')
  const isSymlink = node.isSymlink === true

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
  const isExternalDropTargetNode = isExternalDropTarget && node.type === 'directory'
  // External drag hover: file being hovered during external drag (invalid target)
  const isExternalDragHover = isExternalDragActive && node.type !== 'directory'

  return (
    <div
      className="project-tree-node"
      ref={setRefs}
      // `top`, not a translateY: dnd-kit measures droppables transform-agnostic
      // (getTransformAgnosticClientRect), so a transformed row would be
      // measured at the top of the list and no drop would ever land on it.
      style={{ top }}
      data-dragging={actuallyDragging}
      data-drop-highlight={showDropHighlight}
      data-external-drop-highlight={isExternalDropTargetNode}
      data-in-drop-zone={inDropZone ?? undefined}
      data-level={level}
      data-testid={getDynamicTestId(TEST_IDS.PROJECT_TREE_NODE, node.path)}
      data-path={node.path}
      data-type={node.type}
      data-parent-path={parentPath ?? undefined}
    >
      {/*
        The focusable element carries the role, the state and the click (#87,
        #89): one element is what a screen reader announces, what the keyboard
        lands on and what a click activates. dnd-kit's `attributes` are NOT
        spread here: they put tabIndex 0 on every row (a Tab stop per row) and
        role="button" / aria-roledescription="draggable" over the treeitem
        role, and describe a keyboard drag this tree has no sensor for. Only
        the pointer listeners are needed.
      */}
      <div
        className={`project-tree-item ${node.type} ${isSelected ? 'selected' : ''}`}
        // The indent itself is CSS (tokens); the row only says how deep it is.
        style={{ '--tree-level': level } as React.CSSProperties}
        role="treeitem"
        aria-level={level + 1}
        aria-posinset={posInSet}
        aria-setsize={setSize}
        aria-expanded={node.type === 'directory' ? isExpanded : undefined}
        aria-selected={isSelected}
        tabIndex={isTabStop ? 0 : -1}
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
        data-parent-path={parentPath ?? undefined}
        // @dnd-kit handles drag - terminal drop is detected in ProjectTree's handleDragEnd
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
          data-git-status={gitStatus}
          title={isSensitive ? 'Sensitive file - may contain credentials' : undefined}
        >
          {isSensitive && <AlertTriangle size={14} className="sensitive-icon" aria-label="Warning: sensitive file" />}
          {isSymlink && <LinkIcon size={12} className="symlink-icon" aria-label="Symlink" />}
          {node.name}
        </span>
        {gitStatus && gitStatus !== 'unmodified' && (
          <GitErrorBoundary>
            <GitStatusBadge status={gitStatus} isFolder={node.type === 'directory'} />
          </GitErrorBoundary>
        )}
      </div>
    </div>
  )
}

export const ProjectTreeNode = memo(ProjectTreeNodeRow)
