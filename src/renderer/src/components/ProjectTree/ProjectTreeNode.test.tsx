// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for ProjectTreeNode Component
 *
 * Covers accessibility attributes, dynamic test IDs, click handlers,
 * folder expand/collapse, and drag overlay styling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TEST_IDS, getDynamicTestId } from '../../constants/testids'
import type { FileNode } from '../../../../preload/index'

// Mock @dnd-kit/core
vi.mock('@dnd-kit/core', () => ({
  useDraggable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    isDragging: false
  }),
  useDroppable: () => ({
    setNodeRef: vi.fn(),
    isOver: false
  })
}))

// Mock GitStatusBadge as a pass-through
vi.mock('./GitStatusBadge', () => ({
  GitStatusBadge: ({ status }: { status: string }) => (
    <span data-testid="git-status-badge">{status}</span>
  )
}))

// Mock GitErrorBoundary as a pass-through
vi.mock('./GitErrorBoundary', () => ({
  GitErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

// Mock the CSS import
vi.mock('./ProjectTree.css', () => ({}))

// Import after mocks
import { ProjectTreeNode } from './ProjectTreeNode'

const makeFileNode = (overrides: Partial<FileNode> = {}): FileNode => ({
  name: 'readme.md',
  path: '/project/readme.md',
  type: 'file',
  extension: '.md',
  ...overrides
})

const makeFolderNode = (overrides: Partial<FileNode> = {}): FileNode => ({
  name: 'src',
  path: '/project/src',
  type: 'directory',
  children: [],
  ...overrides
})

const defaultProps = {
  level: 0,
  onFileClick: vi.fn(),
  expandedFolders: new Set<string>(),
  onToggleFolder: vi.fn()
}

describe('ProjectTreeNode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // 1. Renders with role="treeitem"
  it('renders with role="treeitem"', () => {
    render(<ProjectTreeNode {...defaultProps} node={makeFileNode()} />)

    expect(screen.getByRole('treeitem')).toBeInTheDocument()
  })

  // 2. Directories have aria-expanded attribute
  it('directories have aria-expanded attribute', () => {
    render(<ProjectTreeNode {...defaultProps} node={makeFolderNode()} />)

    const treeitem = screen.getByRole('treeitem')
    expect(treeitem).toHaveAttribute('aria-expanded')
  })

  // 3. Files do NOT have aria-expanded
  it('files do NOT have aria-expanded', () => {
    render(<ProjectTreeNode {...defaultProps} node={makeFileNode()} />)

    const treeitem = screen.getByRole('treeitem')
    expect(treeitem).not.toHaveAttribute('aria-expanded')
  })

  // 4. Selected node has aria-selected="true"
  it('selected node has aria-selected="true"', () => {
    const node = makeFileNode({ path: '/project/readme.md' })
    render(
      <ProjectTreeNode {...defaultProps} node={node} selectedFolder="/project/readme.md" />
    )

    const treeitem = screen.getByRole('treeitem')
    expect(treeitem).toHaveAttribute('aria-selected', 'true')
  })

  // 5. Non-selected node has aria-selected="false"
  it('non-selected node has aria-selected="false"', () => {
    const node = makeFileNode({ path: '/project/readme.md' })
    render(
      <ProjectTreeNode {...defaultProps} node={node} selectedFolder="/project/other.md" />
    )

    const treeitem = screen.getByRole('treeitem')
    expect(treeitem).toHaveAttribute('aria-selected', 'false')
  })

  // 6. Dynamic test ID: PROJECT_TREE_NODE with getDynamicTestId for the node
  it('has dynamic test ID for PROJECT_TREE_NODE on the outer wrapper', () => {
    const nodePath = '/project/readme.md'
    render(<ProjectTreeNode {...defaultProps} node={makeFileNode({ path: nodePath })} />)

    const expectedTestId = getDynamicTestId(TEST_IDS.PROJECT_TREE_NODE, nodePath)
    expect(screen.getByTestId(expectedTestId)).toBeInTheDocument()
  })

  // 7. Dynamic test ID: PROJECT_TREE_NODE_FILE for file nodes
  it('has dynamic test ID for PROJECT_TREE_NODE_FILE on the inner item', () => {
    const nodePath = '/project/readme.md'
    render(<ProjectTreeNode {...defaultProps} node={makeFileNode({ path: nodePath })} />)

    const expectedTestId = getDynamicTestId(TEST_IDS.PROJECT_TREE_NODE_FILE, nodePath)
    expect(screen.getByTestId(expectedTestId)).toBeInTheDocument()
  })

  // 8. Dynamic test ID: PROJECT_TREE_NODE_FOLDER for folder nodes
  it('has dynamic test ID for PROJECT_TREE_NODE_FOLDER on the inner item', () => {
    const nodePath = '/project/src'
    render(<ProjectTreeNode {...defaultProps} node={makeFolderNode({ path: nodePath })} />)

    const expectedTestId = getDynamicTestId(TEST_IDS.PROJECT_TREE_NODE_FOLDER, nodePath)
    expect(screen.getByTestId(expectedTestId)).toBeInTheDocument()
  })

  // 9. Dynamic test ID: PROJECT_TREE_TOGGLE for expand/collapse toggle (directories only)
  it('has dynamic test ID for PROJECT_TREE_TOGGLE on directory icon span', () => {
    const nodePath = '/project/src'
    render(<ProjectTreeNode {...defaultProps} node={makeFolderNode({ path: nodePath })} />)

    const expectedTestId = getDynamicTestId(TEST_IDS.PROJECT_TREE_TOGGLE, nodePath)
    expect(screen.getByTestId(expectedTestId)).toBeInTheDocument()
  })

  // 10. Drop target test ID: PROJECT_TREE_DROP_TARGET present for folders (when drop highlight active)
  it('shows PROJECT_TREE_DROP_TARGET test ID for folders when isDropTarget is true', () => {
    // The drop target test ID appears when the folder has showDropHighlight or isExternalDropTargetNode.
    // Since useDraggable mock returns isDragging: false and useDroppable mock returns isOver: false,
    // we use externalDropTarget to trigger the external drop target state.
    const nodePath = '/project/src'
    render(
      <ProjectTreeNode
        {...defaultProps}
        node={makeFolderNode({ path: nodePath })}
        isExternalDragActive={true}
        externalDropTarget={nodePath}
      />
    )

    const expectedTestId = getDynamicTestId(TEST_IDS.PROJECT_TREE_DROP_TARGET, nodePath)
    expect(screen.getByTestId(expectedTestId)).toBeInTheDocument()
  })

  // 11. Click handler fires on node click
  it('fires onFileClick when a file node is clicked', async () => {
    const user = userEvent.setup()
    const onFileClick = vi.fn()
    const nodePath = '/project/readme.md'

    render(
      <ProjectTreeNode
        {...defaultProps}
        node={makeFileNode({ path: nodePath })}
        onFileClick={onFileClick}
      />
    )

    const fileTestId = getDynamicTestId(TEST_IDS.PROJECT_TREE_NODE_FILE, nodePath)
    await user.click(screen.getByTestId(fileTestId))

    expect(onFileClick).toHaveBeenCalledWith(nodePath)
    expect(onFileClick).toHaveBeenCalledTimes(1)
  })

  // 12. Toggle handler fires on expand/collapse click (directory)
  it('fires onToggleFolder when a directory node is clicked', async () => {
    const user = userEvent.setup()
    const onToggleFolder = vi.fn()
    const onFileClick = vi.fn()
    const nodePath = '/project/src'

    render(
      <ProjectTreeNode
        {...defaultProps}
        node={makeFolderNode({ path: nodePath })}
        onToggleFolder={onToggleFolder}
        onFileClick={onFileClick}
      />
    )

    const folderTestId = getDynamicTestId(TEST_IDS.PROJECT_TREE_NODE_FOLDER, nodePath)
    await user.click(screen.getByTestId(folderTestId))

    expect(onToggleFolder).toHaveBeenCalledWith(nodePath)
    expect(onToggleFolder).toHaveBeenCalledTimes(1)
    // Directory click also calls onFileClick
    expect(onFileClick).toHaveBeenCalledWith(nodePath)
  })

  // 13. Node renders the file/folder name
  it('renders the file name', () => {
    render(<ProjectTreeNode {...defaultProps} node={makeFileNode({ name: 'notes.md' })} />)

    expect(screen.getByText('notes.md')).toBeInTheDocument()
  })

  it('renders the folder name', () => {
    render(<ProjectTreeNode {...defaultProps} node={makeFolderNode({ name: 'components' })} />)

    expect(screen.getByText('components')).toBeInTheDocument()
  })

  // 14. Drag overlay styling (if isDragging)
  it('sets data-dragging attribute when isDragging is true', () => {
    const nodePath = '/project/readme.md'
    render(
      <ProjectTreeNode
        {...defaultProps}
        node={makeFileNode({ path: nodePath })}
        isDragging={true}
      />
    )

    const treeitem = screen.getByRole('treeitem')
    expect(treeitem).toHaveAttribute('data-dragging', 'true')
  })

  it('sets data-dragging to false when not dragging', () => {
    render(<ProjectTreeNode {...defaultProps} node={makeFileNode()} />)

    const treeitem = screen.getByRole('treeitem')
    expect(treeitem).toHaveAttribute('data-dragging', 'false')
  })
})
