// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for ProjectTreeNode Component
 *
 * Covers accessibility attributes, dynamic test IDs, click handlers,
 * folder expand/collapse, drag overlay styling, and the flat, virtualised
 * row contract (#87, #89, review finding [33]).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { TEST_IDS, getDynamicTestId } from '../../constants/testids'
import type { FileNode } from '../../../../preload/index'

// Mock @dnd-kit/core
vi.mock('@dnd-kit/core', () => ({
  // The attributes dnd-kit really returns: a Tab stop and a button role on
  // every row. The row must not spread them (#87).
  useDraggable: () => ({
    attributes: {
      role: 'button',
      tabIndex: 0,
      'aria-disabled': false,
      'aria-pressed': undefined,
      'aria-roledescription': 'draggable',
      'aria-describedby': 'DndDescribedBy-0'
    },
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
import { ProjectTreeNode, TREE_ROW_HEIGHT } from './ProjectTreeNode'

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
  posInSet: 1,
  setSize: 1,
  parentPath: null,
  top: 0,
  isExpanded: false,
  isSelected: false,
  isTabStop: false,
  onFileClick: vi.fn(),
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
      <ProjectTreeNode {...defaultProps} node={node} isSelected={true} />
    )

    const treeitem = screen.getByRole('treeitem')
    expect(treeitem).toHaveAttribute('aria-selected', 'true')
  })

  // 5. Non-selected node has aria-selected="false"
  it('non-selected node has aria-selected="false"', () => {
    const node = makeFileNode({ path: '/project/readme.md' })
    render(
      <ProjectTreeNode {...defaultProps} node={node} isSelected={false} />
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
        isExternalDropTarget={true}
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

describe('ProjectTreeNode – one element is the tree item (#87, #89)', () => {
  it('puts role, state, focus and the click on the same element', async () => {
    const user = userEvent.setup()
    const onToggleFolder = vi.fn()
    const nodePath = '/project/src'
    render(
      <ProjectTreeNode
        {...defaultProps}
        node={makeFolderNode({ path: nodePath })}
        isExpanded={true}
        isSelected={true}
        isTabStop={true}
        onToggleFolder={onToggleFolder}
      />
    )

    const treeitem = screen.getByRole('treeitem')
    expect(treeitem).toBe(screen.getByTestId(getDynamicTestId(TEST_IDS.PROJECT_TREE_NODE_FOLDER, nodePath)))
    expect(treeitem).toHaveAttribute('aria-expanded', 'true')
    expect(treeitem).toHaveAttribute('aria-selected', 'true')
    expect(treeitem).toHaveAttribute('tabindex', '0')
    await user.click(treeitem)
    expect(onToggleFolder).toHaveBeenCalledWith(nodePath)
  })

  it('states its place in the tree, since a virtualised tree has no nesting to infer it from', () => {
    render(<ProjectTreeNode {...defaultProps} node={makeFileNode()} level={2} posInSet={3} setSize={7} />)

    const treeitem = screen.getByRole('treeitem')
    expect(treeitem).toHaveAttribute('aria-level', '3')
    expect(treeitem).toHaveAttribute('aria-posinset', '3')
    expect(treeitem).toHaveAttribute('aria-setsize', '7')
  })

  it('does not take dnd-kit attributes, so a row is not its own Tab stop or a button', () => {
    render(<ProjectTreeNode {...defaultProps} node={makeFileNode()} isTabStop={false} />)

    const treeitem = screen.getByRole('treeitem')
    expect(treeitem).toHaveAttribute('tabindex', '-1')
    expect(treeitem).not.toHaveAttribute('aria-roledescription')
    expect(treeitem).not.toHaveAttribute('aria-describedby')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('does not render the children of an expanded folder (the list is flat)', () => {
    const folder = makeFolderNode({ children: [makeFileNode({ name: 'inner.md', path: '/project/src/inner.md' })] })
    render(<ProjectTreeNode {...defaultProps} node={folder} isExpanded={true} />)

    expect(screen.getAllByRole('treeitem')).toHaveLength(1)
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
    expect(screen.queryByText('inner.md')).not.toBeInTheDocument()
  })

  it('names its folder for the external-drop target lookup', () => {
    render(<ProjectTreeNode {...defaultProps} node={makeFileNode()} parentPath="/project" />)

    expect(screen.getByRole('treeitem')).toHaveAttribute('data-parent-path', '/project')
  })

  it('tints a row inside the folder a drag will land in', () => {
    render(<ProjectTreeNode {...defaultProps} node={makeFileNode()} inDropZone="external" />)

    const wrapper = screen.getByTestId(getDynamicTestId(TEST_IDS.PROJECT_TREE_NODE, '/project/readme.md'))
    expect(wrapper).toHaveAttribute('data-in-drop-zone', 'external')
  })

  it('is placed by `top`, not a transform dnd-kit would not see', () => {
    render(<ProjectTreeNode {...defaultProps} node={makeFileNode()} top={56} />)

    const wrapper = screen.getByTestId(getDynamicTestId(TEST_IDS.PROJECT_TREE_NODE, '/project/readme.md'))
    expect(wrapper.style.top).toBe('56px')
    expect(wrapper.style.transform).toBe('')
  })

  it('passes its depth to CSS, which draws the indent in tokens (no px in the component)', () => {
    render(<ProjectTreeNode {...defaultProps} node={makeFileNode({ isSymlink: true })} level={3} />)

    const treeitem = screen.getByRole('treeitem')
    expect(treeitem.style.getPropertyValue('--tree-level')).toBe('3')
    expect(treeitem.style.paddingLeft).toBe('')
    expect(screen.getByLabelText('Symlink')).toHaveClass('symlink-icon')
    const css = readFileSync(resolve(__dirname, './ProjectTree.css'), 'utf8')
    expect(css).toMatch(/padding-left:\s*calc\(var\(--space-4\) \+ var\(--tree-level, 0\) \* var\(--space-8\)\)/)
  })

  it('is memoised, so unchanged props skip the render', () => {
    expect(ProjectTreeNode).toHaveProperty('$$typeof', Symbol.for('react.memo'))
  })
})

describe('TREE_ROW_HEIGHT', () => {
  it('matches the --space-14 token the row CSS draws its height with', () => {
    const tokens = readFileSync(resolve(__dirname, '../../styles/design-tokens.css'), 'utf8')
    const css = readFileSync(resolve(__dirname, './ProjectTree.css'), 'utf8')

    expect(css).toMatch(/\.project-tree-item\s*\{[^}]*height:\s*var\(--space-14\)/)
    expect(tokens).toMatch(new RegExp(`--space-14:\\s*${TREE_ROW_HEIGHT}px`))
  })
})
