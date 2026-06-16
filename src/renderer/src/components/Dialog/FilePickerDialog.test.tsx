// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for FilePickerDialog Component
 *
 * Tests the file picker dialog used for disambiguating
 * multiple file matches in smart path resolution.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { FilePickerDialog } from './FilePickerDialog'
import type { PathScore } from '../../utils/pathScoring'
import { showErrorToast } from '../../utils/toastHelpers'

// Mock createPortal to render in the same container
vi.mock('react-dom', async () => {
  const actual = await vi.importActual('react-dom')
  return {
    ...actual,
    createPortal: (node: React.ReactNode) => node
  }
})

// Copy-path routes through the central textClipboard service (issue #203),
// not navigator.clipboard.
const mockWriteText = vi.fn()
vi.mock('../../services/textClipboard', () => ({
  textClipboard: {
    writeText: (text: string) => mockWriteText(text),
    readText: vi.fn()
  }
}))

// Spy on the toast helper to assert the copy never surfaces a toast.
vi.mock('../../utils/toastHelpers', () => ({
  showErrorToast: vi.fn()
}))

describe('FilePickerDialog', () => {
  const mockCandidates: PathScore[] = [
    { path: '/project/src/components/Button.tsx', score: 97, matchType: 'exact-filename' },
    { path: '/project/src/ui/Button.tsx', score: 96, matchType: 'exact-filename' },
    { path: '/project/legacy/Button.tsx', score: 95, matchType: 'exact-filename' }
  ]

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onSelect: vi.fn(),
    candidates: mockCandidates,
    query: 'Button.tsx',
    projectRoot: '/project'
  }

  beforeEach(() => {
    vi.clearAllMocks()
    // Add portal root for BaseDialog
    if (!document.getElementById('portal-root')) {
      const portalRoot = document.createElement('div')
      portalRoot.id = 'portal-root'
      document.body.appendChild(portalRoot)
    }

    mockWriteText.mockReset().mockResolvedValue(true)
  })

  describe('rendering', () => {
    it('should render when isOpen is true', () => {
      render(<FilePickerDialog {...defaultProps} />)
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('should not render when isOpen is false', () => {
      render(<FilePickerDialog {...defaultProps} isOpen={false} />)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('should display the query in the title', () => {
      render(<FilePickerDialog {...defaultProps} />)
      // Title uses escaped quotes which render as actual quote characters
      const title = screen.getByRole('heading', { level: 2 })
      expect(title).toHaveTextContent(/Multiple files match/)
      expect(title).toHaveTextContent(/Button\.tsx/)
    })

    it('should display all candidates', () => {
      render(<FilePickerDialog {...defaultProps} />)
      expect(screen.getByText('src/components/Button.tsx')).toBeInTheDocument()
      expect(screen.getByText('src/ui/Button.tsx')).toBeInTheDocument()
      expect(screen.getByText('legacy/Button.tsx')).toBeInTheDocument()
    })

    it('should show filename for each candidate', () => {
      render(<FilePickerDialog {...defaultProps} />)
      // All should show Button.tsx as filename
      const filenames = screen.getAllByText('Button.tsx')
      expect(filenames.length).toBe(3)
    })

    it('should show Cancel button', () => {
      render(<FilePickerDialog {...defaultProps} />)
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    })

    it('should return null when candidates is empty', () => {
      const { container } = render(
        <FilePickerDialog {...defaultProps} candidates={[]} />
      )
      expect(container.firstChild).toBeNull()
    })
  })

  describe('selection', () => {
    it('should select first item by default', () => {
      render(<FilePickerDialog {...defaultProps} />)
      const listbox = screen.getByRole('listbox')
      const items = within(listbox).getAllByRole('option')
      expect(items[0]).toHaveAttribute('aria-selected', 'true')
    })

    it('should call onSelect when item is clicked', () => {
      const onSelect = vi.fn()
      render(<FilePickerDialog {...defaultProps} onSelect={onSelect} />)

      const listbox = screen.getByRole('listbox')
      const items = within(listbox).getAllByRole('option')
      fireEvent.click(items[1])

      expect(onSelect).toHaveBeenCalledWith('/project/src/ui/Button.tsx')
    })

    it('should update selection on mouse hover', () => {
      render(<FilePickerDialog {...defaultProps} />)

      const listbox = screen.getByRole('listbox')
      const items = within(listbox).getAllByRole('option')

      fireEvent.mouseEnter(items[2])

      expect(items[2]).toHaveAttribute('aria-selected', 'true')
      expect(items[0]).toHaveAttribute('aria-selected', 'false')
    })
  })

  describe('keyboard navigation', () => {
    it('should move selection down with ArrowDown', () => {
      render(<FilePickerDialog {...defaultProps} />)

      const dialog = screen.getByRole('dialog')
      const content = dialog.querySelector('.dialog-content')!
      fireEvent.keyDown(content, { key: 'ArrowDown' })

      const listbox = screen.getByRole('listbox')
      const items = within(listbox).getAllByRole('option')
      expect(items[1]).toHaveAttribute('aria-selected', 'true')
    })

    it('should move selection up with ArrowUp', () => {
      render(<FilePickerDialog {...defaultProps} />)

      const dialog = screen.getByRole('dialog')
      const content = dialog.querySelector('.dialog-content')!

      // Move down first
      fireEvent.keyDown(content, { key: 'ArrowDown' })
      fireEvent.keyDown(content, { key: 'ArrowDown' })

      // Then move up
      fireEvent.keyDown(content, { key: 'ArrowUp' })

      const listbox = screen.getByRole('listbox')
      const items = within(listbox).getAllByRole('option')
      expect(items[1]).toHaveAttribute('aria-selected', 'true')
    })

    it('should not go below last item', () => {
      render(<FilePickerDialog {...defaultProps} />)

      const dialog = screen.getByRole('dialog')
      const content = dialog.querySelector('.dialog-content')!

      // Press down many times
      for (let i = 0; i < 10; i++) {
        fireEvent.keyDown(content, { key: 'ArrowDown' })
      }

      const listbox = screen.getByRole('listbox')
      const items = within(listbox).getAllByRole('option')
      expect(items[2]).toHaveAttribute('aria-selected', 'true')
    })

    it('should not go above first item', () => {
      render(<FilePickerDialog {...defaultProps} />)

      const dialog = screen.getByRole('dialog')
      const content = dialog.querySelector('.dialog-content')!

      // Press up when already at first
      fireEvent.keyDown(content, { key: 'ArrowUp' })

      const listbox = screen.getByRole('listbox')
      const items = within(listbox).getAllByRole('option')
      expect(items[0]).toHaveAttribute('aria-selected', 'true')
    })

    it('should select with Enter key', () => {
      const onSelect = vi.fn()
      render(<FilePickerDialog {...defaultProps} onSelect={onSelect} />)

      const dialog = screen.getByRole('dialog')
      const content = dialog.querySelector('.dialog-content')!
      fireEvent.keyDown(content, { key: 'Enter' })

      expect(onSelect).toHaveBeenCalledWith('/project/src/components/Button.tsx')
    })

    it('should call onClose with Escape key', () => {
      const onClose = vi.fn()
      render(<FilePickerDialog {...defaultProps} onClose={onClose} />)

      const dialog = screen.getByRole('dialog')
      const content = dialog.querySelector('.dialog-content')!
      fireEvent.keyDown(content, { key: 'Escape' })

      expect(onClose).toHaveBeenCalled()
    })
  })

  describe('cancel', () => {
    it('should call onClose when Cancel button is clicked', () => {
      const onClose = vi.fn()
      render(<FilePickerDialog {...defaultProps} onClose={onClose} />)

      fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

      expect(onClose).toHaveBeenCalled()
    })
  })

  describe('relative paths', () => {
    it('should show relative paths when projectRoot provided', () => {
      render(<FilePickerDialog {...defaultProps} />)

      // Should show relative path, not absolute
      expect(screen.getByText('src/components/Button.tsx')).toBeInTheDocument()
      expect(screen.queryByText('/project/src/components/Button.tsx')).not.toBeInTheDocument()
    })

    it('should show full paths when projectRoot is null', () => {
      render(<FilePickerDialog {...defaultProps} projectRoot={null} />)

      // Should show full path
      expect(screen.getByText('/project/src/components/Button.tsx')).toBeInTheDocument()
    })
  })

  describe('accessibility', () => {
    it('should have listbox role', () => {
      render(<FilePickerDialog {...defaultProps} />)
      expect(screen.getByRole('listbox')).toBeInTheDocument()
    })

    it('should have option role for items', () => {
      render(<FilePickerDialog {...defaultProps} />)
      const options = screen.getAllByRole('option')
      expect(options.length).toBe(3)
    })

    it('should have aria-selected on items', () => {
      render(<FilePickerDialog {...defaultProps} />)
      const listbox = screen.getByRole('listbox')
      const items = within(listbox).getAllByRole('option')

      expect(items[0]).toHaveAttribute('aria-selected', 'true')
      expect(items[1]).toHaveAttribute('aria-selected', 'false')
    })

    it('should have aria-activedescendant', () => {
      render(<FilePickerDialog {...defaultProps} />)
      const listbox = screen.getByRole('listbox')
      expect(listbox).toHaveAttribute('aria-activedescendant', 'file-item-0')
    })
  })

  describe('clipboard copy', () => {
    it('should copy selected file path with Cmd+C', () => {
      render(<FilePickerDialog {...defaultProps} />)

      const dialog = screen.getByRole('dialog')
      const content = dialog.querySelector('.dialog-content')!

      fireEvent.keyDown(content, { key: 'c', metaKey: true })

      expect(mockWriteText).toHaveBeenCalledWith('/project/src/components/Button.tsx')
    })

    it('should copy selected file path with Ctrl+C', () => {
      render(<FilePickerDialog {...defaultProps} />)

      const dialog = screen.getByRole('dialog')
      const content = dialog.querySelector('.dialog-content')!

      fireEvent.keyDown(content, { key: 'c', ctrlKey: true })

      expect(mockWriteText).toHaveBeenCalledWith('/project/src/components/Button.tsx')
    })

    it('should copy without showing toast notification', async () => {
      render(<FilePickerDialog {...defaultProps} />)

      const dialog = screen.getByRole('dialog')
      const content = dialog.querySelector('.dialog-content')!

      fireEvent.keyDown(content, { key: 'c', metaKey: true })
      // Flush the awaited writeText microtask.
      await Promise.resolve()

      expect(mockWriteText).toHaveBeenCalledWith('/project/src/components/Button.tsx')
      // A successful copy is silent — no toast (transport errors are the
      // service's concern, and there are none here).
      expect(showErrorToast).not.toHaveBeenCalled()
    })

    it('should copy the currently selected item path', () => {
      render(<FilePickerDialog {...defaultProps} />)

      const dialog = screen.getByRole('dialog')
      const content = dialog.querySelector('.dialog-content')!

      // Move to second item
      fireEvent.keyDown(content, { key: 'ArrowDown' })

      // Copy
      fireEvent.keyDown(content, { key: 'c', metaKey: true })

      expect(mockWriteText).toHaveBeenCalledWith('/project/src/ui/Button.tsx')
    })

    it('should copy the item path after mouse hover selection', () => {
      render(<FilePickerDialog {...defaultProps} />)

      const listbox = screen.getByRole('listbox')
      const items = within(listbox).getAllByRole('option')

      // Hover over third item
      fireEvent.mouseEnter(items[2])

      const dialog = screen.getByRole('dialog')
      const content = dialog.querySelector('.dialog-content')!

      // Copy
      fireEvent.keyDown(content, { key: 'c', metaKey: true })

      expect(mockWriteText).toHaveBeenCalledWith('/project/legacy/Button.tsx')
    })

    it('should not interfere with other keyboard shortcuts', () => {
      const onSelect = vi.fn()
      render(<FilePickerDialog {...defaultProps} onSelect={onSelect} />)

      const dialog = screen.getByRole('dialog')
      const content = dialog.querySelector('.dialog-content')!

      // Press Enter (should still select)
      fireEvent.keyDown(content, { key: 'Enter' })

      expect(onSelect).toHaveBeenCalledWith('/project/src/components/Button.tsx')
    })

    it('should handle copy when candidates list is empty', () => {
      const { container } = render(
        <FilePickerDialog {...defaultProps} candidates={[]} />
      )

      // Component returns null for empty candidates, so no keydown to test
      expect(container.firstChild).toBeNull()
    })
  })
})
