// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Component Tests for DiagramViewer
 *
 * Tests for DiagramViewer component:
 * - Rendering behavior (reads from useDiagramViewerStore)
 * - SVG content display
 * - Closing mechanisms (button, backdrop) - Note: Escape intentionally removed
 * - Toolbar elements
 * - Accessibility attributes
 * - Focus management
 * - Keyboard shortcuts
 * - Zoom controls
 *
 * UPDATED: DiagramViewer now reads state from useDiagramViewerStore instead of props.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DiagramViewer } from './DiagramViewer'
import { useDiagramViewerStore } from '../../../stores/useDiagramViewerStore'

// Mock useTerminalStore (issue #60 - ChatBubble uses this for scroll lock)
vi.mock('../../../stores/useTerminalStore', () => ({
  useTerminalStore: vi.fn((selector) => {
    const state = { scrollLocked: false }
    return selector ? selector(state) : state
  })
}))

// Helper to set up store state before rendering
function setupStore(options: {
  isOpen?: boolean
  svgContent?: string
  mermaidCode?: string
  filePath?: string
  startLine?: number
  endLine?: number
} = {}) {
  const {
    isOpen = true,
    svgContent = '<svg width="100" height="100"><circle cx="50" cy="50" r="40"/></svg>',
    mermaidCode = 'flowchart TD\n  A-->B',
    filePath = '/test/file.md',
    startLine = 10,
    endLine = 20
  } = options

  useDiagramViewerStore.setState({
    isOpen,
    diagramId: `${filePath}:${startLine}-${endLine}`,
    svgContent,
    mermaidCode,
    filePath,
    startLine,
    endLine
  })
}

// Helper to reset store
function resetStore() {
  useDiagramViewerStore.setState({
    isOpen: false,
    diagramId: null,
    mermaidCode: '',
    svgContent: '',
    filePath: null,
    startLine: undefined,
    endLine: undefined
  })
}

describe('DiagramViewer', () => {
  // Mock SVG content
  const mockSvgContent = '<svg width="100" height="100"><circle cx="50" cy="50" r="40"/></svg>'

  beforeEach(() => {
    // Create portal root
    const portalRoot = document.createElement('div')
    portalRoot.id = 'portal-root'
    document.body.appendChild(portalRoot)

    // Reset store to clean state
    resetStore()
  })

  afterEach(() => {
    // Cleanup portal root
    document.getElementById('portal-root')?.remove()
    // Reset store
    resetStore()
  })

  describe('rendering behavior', () => {
    it('does not render when isOpen is false', () => {
      setupStore({ isOpen: false })
      render(<DiagramViewer />)

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('renders when isOpen is true', () => {
      setupStore({ isOpen: true, svgContent: mockSvgContent })
      render(<DiagramViewer />)

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('returns null when portal root does not exist', () => {
      // Remove portal root
      document.getElementById('portal-root')?.remove()

      setupStore({ isOpen: true, svgContent: mockSvgContent })
      const { container } = render(<DiagramViewer />)

      expect(container.firstChild).toBeNull()
    })
  })

  describe('SVG content display', () => {
    it('displays SVG content correctly', () => {
      setupStore({ isOpen: true, svgContent: mockSvgContent })
      render(<DiagramViewer />)

      // Check if SVG is in the document
      const svg = document.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })

    it('renders complex SVG content', () => {
      const complexSvg = `
        <svg viewBox="0 0 200 200">
          <rect x="10" y="10" width="80" height="80" fill="blue"/>
          <circle cx="150" cy="50" r="40" fill="red"/>
        </svg>
      `
      setupStore({ isOpen: true, svgContent: complexSvg })
      render(<DiagramViewer />)

      const rect = document.querySelector('rect')
      const circle = document.querySelector('circle')
      expect(rect).toBeInTheDocument()
      expect(circle).toBeInTheDocument()
    })

    it('updates SVG content when store changes', async () => {
      setupStore({ isOpen: true, svgContent: mockSvgContent })
      render(<DiagramViewer />)

      // Initial SVG
      expect(document.querySelector('circle')).toBeInTheDocument()

      // Update store with new SVG
      const newSvg = '<svg width="100" height="100"><rect width="50" height="50"/></svg>'
      useDiagramViewerStore.setState({ svgContent: newSvg })

      // Wait for React to re-render with new SVG
      await waitFor(() => {
        expect(document.querySelector('rect')).toBeInTheDocument()
      })
    })
  })

  describe('closing mechanisms', () => {
    it('calls closeViewer when floating close button is clicked (issue #37)', async () => {
      setupStore({ isOpen: true, svgContent: mockSvgContent })
      render(<DiagramViewer />)

      // Floating close button has aria-label "Close diagram viewer"
      const closeButton = screen.getByRole('button', { name: /close diagram viewer/i })
      fireEvent.click(closeButton)

      // Store should be updated
      await waitFor(() => {
        expect(useDiagramViewerStore.getState().isOpen).toBe(false)
      })
    })

    it('does NOT close viewer when Escape key is pressed (floating close button only)', () => {
      setupStore({ isOpen: true, svgContent: mockSvgContent })
      render(<DiagramViewer />)

      fireEvent.keyDown(document, { key: 'Escape' })

      // Escape should NOT close the viewer - use X button instead
      expect(useDiagramViewerStore.getState().isOpen).toBe(true)
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('calls closeViewer when backdrop is clicked', async () => {
      setupStore({ isOpen: true, svgContent: mockSvgContent })
      render(<DiagramViewer />)

      const dialog = screen.getByRole('dialog')
      // Click on the overlay (dialog element itself, not its children)
      fireEvent.click(dialog)

      await waitFor(() => {
        expect(useDiagramViewerStore.getState().isOpen).toBe(false)
      })
    })

    it('does not close when clicking inside the viewer content', () => {
      setupStore({ isOpen: true, svgContent: mockSvgContent })
      render(<DiagramViewer />)

      // Click on the floating close button (which is inside the viewer but should close)
      // Instead test by clicking on the SVG container area
      const svgElement = document.querySelector('.diagram-viewer-content')
      expect(svgElement).toBeInTheDocument()

      if (svgElement) {
        fireEvent.click(svgElement)
      }

      // Viewer should still be open (clicking content doesn't close)
      expect(useDiagramViewerStore.getState().isOpen).toBe(true)
    })
  })

  describe('floating close button (issue #37)', () => {
    it('displays floating close button', () => {
      setupStore({ isOpen: true, svgContent: mockSvgContent })
      render(<DiagramViewer />)

      // Floating close button (toolbar removed in #37)
      expect(screen.getByRole('button', { name: /close diagram viewer/i })).toBeInTheDocument()
    })

    it('floating close button has correct styling class', () => {
      setupStore({ isOpen: true, svgContent: mockSvgContent })
      render(<DiagramViewer />)

      const closeButton = screen.getByRole('button', { name: /close diagram viewer/i })
      expect(closeButton).toHaveClass('diagram-viewer-close-floating')
    })

    it('FAB button is visible when filePath is present', () => {
      setupStore({ isOpen: true, svgContent: mockSvgContent, filePath: '/test/file.md' })
      render(<DiagramViewer />)

      // FAB button for opening the control panel
      expect(screen.getByRole('button', { name: /open panel/i })).toBeInTheDocument()
    })
  })

  describe('accessibility', () => {
    it('has correct dialog attributes', () => {
      setupStore({ isOpen: true, svgContent: mockSvgContent })
      render(<DiagramViewer />)

      const dialog = screen.getByRole('dialog')
      expect(dialog).toHaveAttribute('aria-modal', 'true')
      expect(dialog).toHaveAttribute('aria-label', 'Mermaid Diagram')
    })

    it('floating close button has accessible label', () => {
      setupStore({ isOpen: true, svgContent: mockSvgContent })
      render(<DiagramViewer />)

      const closeButton = screen.getByRole('button', { name: /close diagram viewer/i })
      expect(closeButton).toHaveAttribute('aria-label', 'Close diagram viewer')
    })
  })

  describe('keyboard shortcuts', () => {
    it('zooms in with + key (viewer stays open)', () => {
      setupStore({ isOpen: true, svgContent: mockSvgContent })
      render(<DiagramViewer />)

      fireEvent.keyDown(document, { key: '+' })

      // Viewer should still be open after zoom
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('zooms out with - key (viewer stays open)', () => {
      setupStore({ isOpen: true, svgContent: mockSvgContent })
      render(<DiagramViewer />)

      fireEvent.keyDown(document, { key: '-' })

      // Viewer should still be open after zoom
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('resets view with 0 key (viewer stays open)', () => {
      setupStore({ isOpen: true, svgContent: mockSvgContent })
      render(<DiagramViewer />)

      // First zoom in
      fireEvent.keyDown(document, { key: '+' })
      fireEvent.keyDown(document, { key: '+' })

      // Then reset
      fireEvent.keyDown(document, { key: '0' })

      // Viewer should still be open after reset
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('fits to view with f key (viewer stays open)', () => {
      setupStore({ isOpen: true, svgContent: mockSvgContent })
      render(<DiagramViewer />)

      fireEvent.keyDown(document, { key: 'f' })

      // Viewer should still be open after fit
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('does not intercept keyboard shortcuts when typing in textarea', async () => {
      setupStore({
        isOpen: true,
        svgContent: mockSvgContent,
        mermaidCode: 'flowchart TD\n  A-->B',
        filePath: '/test/file.md'
      })
      render(<DiagramViewer />)

      // Open the chat panel
      const openButton = screen.getByRole('button', { name: /open panel/i })
      fireEvent.click(openButton)

      // Wait for textarea to appear
      const textarea = await screen.findByPlaceholderText('Describe changes to this diagram...')
      expect(textarea).toBeInTheDocument()

      // Focus the textarea
      textarea.focus()

      // Simulate typing keys that would normally trigger zoom
      fireEvent.keyDown(textarea, { key: '+', target: textarea })
      fireEvent.keyDown(textarea, { key: '-', target: textarea })
      fireEvent.keyDown(textarea, { key: '0', target: textarea })
      fireEvent.keyDown(textarea, { key: 'f', target: textarea })

      // Viewer should still be open (shortcuts should be ignored when textarea is focused)
      expect(screen.getByRole('dialog', { name: 'Mermaid Diagram' })).toBeInTheDocument()
      // Textarea should still be there
      expect(textarea).toBeInTheDocument()
    })

    it('does not intercept keyboard shortcuts when typing in input', () => {
      setupStore({ isOpen: true, svgContent: mockSvgContent })
      render(<DiagramViewer />)

      // Create a mock input element inside the viewer
      const input = document.createElement('input')
      input.type = 'text'
      document.body.appendChild(input)
      input.focus()

      // Simulate typing keys that would normally trigger zoom
      fireEvent.keyDown(input, { key: '+', target: input })
      fireEvent.keyDown(input, { key: '-', target: input })

      // Viewer should still be open
      expect(screen.getByRole('dialog')).toBeInTheDocument()

      // Cleanup
      document.body.removeChild(input)
    })
  })

  // Note: Zoom control buttons are now in ChatBubble header (issue #37)
  // These tests are covered in ChatBubble.test.tsx

  describe('edge cases', () => {
    it('handles empty SVG content gracefully', () => {
      setupStore({ isOpen: true, svgContent: '' })
      render(<DiagramViewer />)

      // Dialog should still render even with empty content
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('handles SVG content with special characters', () => {
      const specialSvg = '<svg><text>&lt;script&gt;</text></svg>'
      setupStore({ isOpen: true, svgContent: specialSvg })
      render(<DiagramViewer />)

      // Verify dialog renders
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('handles missing filePath', () => {
      useDiagramViewerStore.setState({
        isOpen: true,
        diagramId: 'unknown:0-0',
        svgContent: mockSvgContent,
        mermaidCode: 'flowchart TD',
        filePath: null,
        startLine: undefined,
        endLine: undefined
      })
      render(<DiagramViewer />)

      // Should render without chat bubble (filePath required)
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      // ChatBubble shouldn't render without filePath
      expect(screen.queryByRole('button', { name: /open panel/i })).not.toBeInTheDocument()
    })
  })

  describe('ChatBubble integration', () => {
    it('renders ChatBubble when mermaidCode and filePath are present', () => {
      setupStore({
        isOpen: true,
        svgContent: mockSvgContent,
        mermaidCode: 'flowchart TD\n  A-->B',
        filePath: '/test/file.md',
        startLine: 10,
        endLine: 20
      })
      render(<DiagramViewer />)

      // ChatBubble should be visible (collapsed state shows FAB button)
      expect(screen.getByRole('button', { name: /open panel/i })).toBeInTheDocument()
    })

    it('does not render ChatBubble when mermaidCode is empty', () => {
      setupStore({
        isOpen: true,
        svgContent: mockSvgContent,
        mermaidCode: '',
        filePath: '/test/file.md'
      })
      render(<DiagramViewer />)

      expect(screen.queryByRole('button', { name: /open panel/i })).not.toBeInTheDocument()
    })
  })

  describe('live update scenario (file edit while viewer open)', () => {
    it('should display updated content when store is updated', async () => {
      // Initial diagram - include filePath since we now match by filePath
      setupStore({
        isOpen: true,
        svgContent: '<svg><circle cx="50" cy="50" r="40"/></svg>',
        mermaidCode: 'flowchart TD\n  A-->B',
        filePath: '/test/file.md',
        startLine: 10,
        endLine: 20
      })
      render(<DiagramViewer />)

      expect(document.querySelector('circle')).toBeInTheDocument()

      // Simulate file edit - MermaidDiagram would call updateDiagram
      useDiagramViewerStore.getState().updateDiagram({
        filePath: '/test/file.md',
        mermaidCode: 'flowchart TD\n  A-->B-->C',
        svgContent: '<svg><rect width="50" height="50"/></svg>',
        startLine: 10,
        endLine: 20
      })

      // New content should be visible
      await waitFor(() => {
        expect(document.querySelector('rect')).toBeInTheDocument()
      })

      // Viewer should still be open
      expect(useDiagramViewerStore.getState().isOpen).toBe(true)
    })
  })
})
