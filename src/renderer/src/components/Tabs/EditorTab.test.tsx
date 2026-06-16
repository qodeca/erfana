// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for EditorTab Component
 *
 * Chrome-style tab component for editor panels with:
 * - Filename display with text truncation
 * - Dirty indicator for unsaved changes
 * - Close button with confirmation
 * - Middle-click to close
 * - Context menu (Close, Close Others, Close All)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditorTab } from './EditorTab'
import type { IDockviewPanelHeaderProps } from 'dockview'

// Mock useProjectStore
const mockDirtyPanelIds = new Set<string>()
const mockSetEditorDirty = vi.fn()

vi.mock('../../stores/useProjectStore', () => ({
  useProjectStore: Object.assign(
    (selector: (state: { dirtyPanelIds: Set<string> }) => boolean) => {
      return selector({ dirtyPanelIds: mockDirtyPanelIds })
    },
    {
      getState: vi.fn(() => ({
        dirtyPanelIds: mockDirtyPanelIds,
        setEditorDirty: mockSetEditorDirty,
        dockviewApi: null
      }))
    }
  )
}))

// Mock useDialog
const mockShowConfirm = vi.fn().mockResolvedValue(true)

vi.mock('../Dialog', () => ({
  useDialog: () => ({
    showConfirm: mockShowConfirm
  })
}))

// Mock useTabContextMenu
const mockContextMenuItems = [
  { label: 'Close', icon: null, action: vi.fn() },
  { label: 'Close Others', icon: null, action: vi.fn() },
  { label: '', separator: true, action: vi.fn() },
  { label: 'Close All', icon: null, action: vi.fn() }
]

vi.mock('./useTabContextMenu', () => ({
  useTabContextMenu: () => mockContextMenuItems
}))

// Mock useProjectManagementContext - mutable so individual tests can vary the base
let mockProjectPath: string | null = '/Users/test/Projects/myproject'

vi.mock('../../context/ProjectManagementContext', () => ({
  useProjectManagementContext: () => ({
    projectPath: mockProjectPath
  })
}))

// Mock ContextMenu - render children to test context menu items
vi.mock('../ContextMenu/ContextMenu', () => ({
  ContextMenu: ({ items, onClose }: { items: typeof mockContextMenuItems; onClose: () => void }) => (
    <div data-testid="context-menu">
      {items.map((item, i) =>
        item.separator ? (
          <div key={i} data-testid="context-menu-separator" />
        ) : (
          <button key={i} onClick={() => { item.action(); onClose(); }}>
            {item.label}
          </button>
        )
      )}
    </div>
  )
}))

// Helper to create mock props
function createMockProps(
  overrides: Partial<{
    filePath: string
    panelId: string
    apiId: string
  }> = {}
): IDockviewPanelHeaderProps<{ filePath?: string; panelId?: string }> {
  const apiClose = vi.fn()

  return {
    api: {
      id: overrides.apiId || 'panel-123',
      close: apiClose
    },
    params: {
      filePath: overrides.filePath ?? '/path/to/document.md',
      panelId: overrides.panelId
    },
    containerApi: {} as IDockviewPanelHeaderProps['containerApi'],
    // Required for dockview but not used in our component
    isFocused: false,
    isActive: false,
    title: '',
    group: {} as IDockviewPanelHeaderProps['group']
  } as IDockviewPanelHeaderProps<{ filePath?: string; panelId?: string }>
}

describe('EditorTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDirtyPanelIds.clear()
    mockProjectPath = '/Users/test/Projects/myproject'

    // Create portal-root for context menu
    const portalRoot = document.createElement('div')
    portalRoot.setAttribute('id', 'portal-root')
    document.body.appendChild(portalRoot)
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  describe('Rendering', () => {
    it('should render filename from filePath', () => {
      const props = createMockProps({ filePath: '/project/docs/README.md' })

      render(<EditorTab {...props} />)

      expect(screen.getByText('README.md')).toBeInTheDocument()
    })

    it('should render filename from nested path', () => {
      const props = createMockProps({ filePath: '/very/deep/nested/path/to/file.ts' })

      render(<EditorTab {...props} />)

      expect(screen.getByText('file.ts')).toBeInTheDocument()
    })

    it('should render "Untitled" when filePath is empty', () => {
      const props = createMockProps({ filePath: '' })

      render(<EditorTab {...props} />)

      expect(screen.getByText('Untitled')).toBeInTheDocument()
    })

    it('should render "Untitled" when filePath is undefined', () => {
      const props = createMockProps()
      props.params = {}

      render(<EditorTab {...props} />)

      expect(screen.getByText('Untitled')).toBeInTheDocument()
    })

    it('should have tooltip with filename and relative path', () => {
      const props = createMockProps({
        filePath: '/Users/test/Projects/myproject/docs/README.md'
      })

      render(<EditorTab {...props} />)

      // getByTitle normalizes whitespace, so the embedded newline becomes a space
      const tab = screen.getByTitle('README.md docs/README.md')
      expect(tab).toBeInTheDocument()
    })

    it('should render basename and /-separated relative path for a Windows path', () => {
      // Override the project context to a Windows base for this case
      mockProjectPath = 'C:\\proj'
      const props = createMockProps({ filePath: 'C:\\proj\\sub\\note.md' })

      render(<EditorTab {...props} />)

      expect(screen.getByText('note.md')).toBeInTheDocument()
      const tab = screen.getByTitle('note.md sub/note.md')
      expect(tab).toBeInTheDocument()
    })

    it('should fall back to basename in the tooltip for an out-of-project file', () => {
      const props = createMockProps({ filePath: '/other/place/note.md' })

      render(<EditorTab {...props} />)

      // Second tooltip line is the basename when the file is outside the project
      const tab = screen.getByTitle('note.md note.md')
      expect(tab).toBeInTheDocument()
    })

    it('should have close button with aria-label', () => {
      const props = createMockProps({ filePath: '/project/file.md' })

      render(<EditorTab {...props} />)

      expect(screen.getByRole('button', { name: 'Close file.md' })).toBeInTheDocument()
    })
  })

  describe('Dirty Indicator', () => {
    it('should not show dirty indicator when file is clean', () => {
      mockDirtyPanelIds.clear()
      const props = createMockProps()

      render(<EditorTab {...props} />)

      expect(screen.queryByLabelText('Unsaved changes')).not.toBeInTheDocument()
    })

    it('should show dirty indicator when file has unsaved changes', () => {
      const props = createMockProps({ panelId: 'dirty-panel' })
      mockDirtyPanelIds.add('dirty-panel')

      render(<EditorTab {...props} />)

      expect(screen.getByLabelText('Unsaved changes')).toBeInTheDocument()
    })

    it('should use api.id as panelId when panelId not provided', () => {
      const props = createMockProps({ apiId: 'api-panel-id' })
      props.params = { filePath: '/test.md' }
      mockDirtyPanelIds.add('api-panel-id')

      render(<EditorTab {...props} />)

      expect(screen.getByLabelText('Unsaved changes')).toBeInTheDocument()
    })
  })

  describe('Close Button', () => {
    it('should close panel on click when file is clean', async () => {
      const user = userEvent.setup()
      const props = createMockProps()
      mockDirtyPanelIds.clear()

      render(<EditorTab {...props} />)
      const closeButton = screen.getByRole('button', { name: /Close/ })

      await user.click(closeButton)

      expect(mockShowConfirm).not.toHaveBeenCalled()
      expect(props.api.close).toHaveBeenCalled()
    })

    it('should show confirmation dialog when file is dirty', async () => {
      const user = userEvent.setup()
      const props = createMockProps({ panelId: 'dirty-panel', filePath: '/project/dirty.md' })
      mockDirtyPanelIds.add('dirty-panel')
      mockShowConfirm.mockResolvedValue(true)

      render(<EditorTab {...props} />)
      const closeButton = screen.getByRole('button', { name: /Close/ })

      await user.click(closeButton)

      expect(mockShowConfirm).toHaveBeenCalledWith({
        title: 'Unsaved Changes',
        message: 'File "dirty.md" has unsaved changes. Close anyway?',
        confirmLabel: 'Close Without Saving',
        danger: true
      })
    })

    it('should close panel when user confirms in dialog', async () => {
      const user = userEvent.setup()
      const props = createMockProps({ panelId: 'dirty-panel' })
      mockDirtyPanelIds.add('dirty-panel')
      mockShowConfirm.mockResolvedValue(true)

      render(<EditorTab {...props} />)
      const closeButton = screen.getByRole('button', { name: /Close/ })

      await user.click(closeButton)

      expect(mockSetEditorDirty).toHaveBeenCalledWith('dirty-panel', false)
      expect(props.api.close).toHaveBeenCalled()
    })

    it('should not close panel when user cancels in dialog', async () => {
      const user = userEvent.setup()
      const props = createMockProps({ panelId: 'dirty-panel' })
      mockDirtyPanelIds.add('dirty-panel')
      mockShowConfirm.mockResolvedValue(false)

      render(<EditorTab {...props} />)
      const closeButton = screen.getByRole('button', { name: /Close/ })

      await user.click(closeButton)

      expect(props.api.close).not.toHaveBeenCalled()
    })

    it('should stop event propagation on close button click', async () => {
      const props = createMockProps()
      const parentClickHandler = vi.fn()

      render(
        <div onClick={parentClickHandler}>
          <EditorTab {...props} />
        </div>
      )

      const closeButton = screen.getByRole('button', { name: /Close/ })
      fireEvent.click(closeButton)

      expect(parentClickHandler).not.toHaveBeenCalled()
    })
  })

  describe('Middle-Click Close', () => {
    it('should close on middle mouse button click', async () => {
      const props = createMockProps()
      mockDirtyPanelIds.clear()

      render(<EditorTab {...props} />)
      const tab = screen.getByTitle(/document\.md/)

      // Simulate middle-click using MouseEvent with button 1
      const auxClickEvent = new MouseEvent('auxclick', {
        bubbles: true,
        cancelable: true,
        button: 1
      })
      tab.dispatchEvent(auxClickEvent)

      // Wait for async handler
      await vi.waitFor(() => {
        expect(props.api.close).toHaveBeenCalled()
      })
    })

    it('should show confirmation on middle-click when dirty', async () => {
      const props = createMockProps({ panelId: 'dirty-panel' })
      mockDirtyPanelIds.add('dirty-panel')
      mockShowConfirm.mockResolvedValue(false)

      render(<EditorTab {...props} />)
      const tab = screen.getByTitle(/document\.md/)

      // Simulate middle-click using MouseEvent with button 1
      const auxClickEvent = new MouseEvent('auxclick', {
        bubbles: true,
        cancelable: true,
        button: 1
      })
      tab.dispatchEvent(auxClickEvent)

      await vi.waitFor(() => {
        expect(mockShowConfirm).toHaveBeenCalled()
      })
    })

    it('should ignore non-middle-click auxiliary buttons', () => {
      const props = createMockProps()

      render(<EditorTab {...props} />)
      const tab = screen.getByTitle(/document\.md/)

      // Right-click (button 2) - using dispatchEvent since fireEvent.auxClick is not available
      const auxClickEvent = new MouseEvent('auxclick', {
        bubbles: true,
        cancelable: true,
        button: 2
      })
      tab.dispatchEvent(auxClickEvent)

      expect(props.api.close).not.toHaveBeenCalled()
    })
  })

  describe('Context Menu', () => {
    it('should open context menu on right-click', async () => {
      const props = createMockProps()

      render(<EditorTab {...props} />)
      const tab = screen.getByTitle(/document\.md/)

      expect(screen.queryByTestId('context-menu')).not.toBeInTheDocument()

      fireEvent.contextMenu(tab)

      expect(screen.getByTestId('context-menu')).toBeInTheDocument()
    })

    it('should display Close, Close Others, and Close All items', () => {
      const props = createMockProps()

      render(<EditorTab {...props} />)
      const tab = screen.getByTitle(/document\.md/)

      fireEvent.contextMenu(tab)

      expect(screen.getByText('Close')).toBeInTheDocument()
      expect(screen.getByText('Close Others')).toBeInTheDocument()
      expect(screen.getByText('Close All')).toBeInTheDocument()
    })

    it('should close context menu when item is clicked', async () => {
      const user = userEvent.setup()
      const props = createMockProps()

      render(<EditorTab {...props} />)
      const tab = screen.getByTitle(/document\.md/)

      fireEvent.contextMenu(tab)
      expect(screen.getByTestId('context-menu')).toBeInTheDocument()

      await user.click(screen.getByText('Close'))

      expect(screen.queryByTestId('context-menu')).not.toBeInTheDocument()
    })

    it('should stop event propagation on context menu', () => {
      const props = createMockProps()
      const parentContextMenuHandler = vi.fn()

      render(
        <div onContextMenu={parentContextMenuHandler}>
          <EditorTab {...props} />
        </div>
      )

      const tab = screen.getByTitle(/document\.md/)
      fireEvent.contextMenu(tab)

      expect(parentContextMenuHandler).not.toHaveBeenCalled()
    })
  })

  describe('Drag Prevention', () => {
    it('should prevent default on drag start', () => {
      const props = createMockProps()

      render(<EditorTab {...props} />)
      const tab = screen.getByTitle(/document\.md/)

      const dragStartEvent = fireEvent.dragStart(tab)

      // fireEvent returns false when preventDefault was called
      expect(dragStartEvent).toBe(false)
    })

    it('should have draggable attribute set to false', () => {
      const props = createMockProps()

      render(<EditorTab {...props} />)
      const tab = screen.getByTitle(/document\.md/)

      expect(tab).toHaveAttribute('draggable', 'false')
    })
  })

  describe('CSS Classes', () => {
    it('should have editor-tab class', () => {
      const props = createMockProps()

      render(<EditorTab {...props} />)
      const tab = screen.getByTitle(/document\.md/)

      expect(tab).toHaveClass('editor-tab')
    })

    it('should have editor-tab-label class on label container', () => {
      const props = createMockProps()

      const { container } = render(<EditorTab {...props} />)

      expect(container.querySelector('.editor-tab-label')).toBeInTheDocument()
    })

    it('should have editor-tab-filename class on filename', () => {
      const props = createMockProps()

      const { container } = render(<EditorTab {...props} />)

      expect(container.querySelector('.editor-tab-filename')).toBeInTheDocument()
    })

    it('should have editor-tab-close class on close button', () => {
      const props = createMockProps()

      const { container } = render(<EditorTab {...props} />)

      expect(container.querySelector('.editor-tab-close')).toBeInTheDocument()
    })

    it('should have editor-tab-dirty-indicator class when dirty', () => {
      const props = createMockProps({ panelId: 'dirty-panel' })
      mockDirtyPanelIds.add('dirty-panel')

      const { container } = render(<EditorTab {...props} />)

      expect(container.querySelector('.editor-tab-dirty-indicator')).toBeInTheDocument()
    })
  })

  describe('Accessibility', () => {
    it('should have aria-label on dirty indicator', () => {
      const props = createMockProps({ panelId: 'dirty-panel' })
      mockDirtyPanelIds.add('dirty-panel')

      render(<EditorTab {...props} />)

      expect(screen.getByLabelText('Unsaved changes')).toBeInTheDocument()
    })

    it('should have descriptive aria-label on close button', () => {
      const props = createMockProps({ filePath: '/project/important-file.md' })

      render(<EditorTab {...props} />)

      expect(screen.getByRole('button', { name: 'Close important-file.md' })).toBeInTheDocument()
    })

    it('should have title attribute on close button', () => {
      const props = createMockProps()

      render(<EditorTab {...props} />)
      const closeButton = screen.getByRole('button', { name: /Close/ })

      expect(closeButton).toHaveAttribute('title', 'Close')
    })
  })
})
