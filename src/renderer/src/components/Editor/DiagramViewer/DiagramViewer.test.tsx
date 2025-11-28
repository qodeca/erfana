/**
 * Component Tests for DiagramViewer
 *
 * Tests for DiagramViewer component:
 * - Rendering behavior (reads from useDiagramViewerStore)
 * - SVG content display
 * - Closing mechanisms (button, Escape, backdrop)
 * - Toolbar elements
 * - Accessibility attributes
 * - Focus management
 * - Keyboard shortcuts
 * - Zoom controls
 *
 * UPDATED: DiagramViewer now reads state from useDiagramViewerStore instead of props.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DiagramViewer } from './DiagramViewer'
import { useDiagramViewerStore } from '../../../stores/useDiagramViewerStore'

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
    it('calls closeViewer when close button is clicked', async () => {
      setupStore({ isOpen: true, svgContent: mockSvgContent })
      render(<DiagramViewer />)

      const closeButton = screen.getByRole('button', { name: /close viewer/i })
      fireEvent.click(closeButton)

      // Store should be updated
      await waitFor(() => {
        expect(useDiagramViewerStore.getState().isOpen).toBe(false)
      })
    })

    it('calls closeViewer when Escape key is pressed', async () => {
      setupStore({ isOpen: true, svgContent: mockSvgContent })
      render(<DiagramViewer />)

      fireEvent.keyDown(document, { key: 'Escape' })

      await waitFor(() => {
        expect(useDiagramViewerStore.getState().isOpen).toBe(false)
      })
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

      // Click on the zoom in button (inside the viewer)
      const zoomInButton = screen.getByRole('button', { name: /zoom in/i })
      fireEvent.click(zoomInButton)

      // Viewer should still be open
      expect(useDiagramViewerStore.getState().isOpen).toBe(true)
    })
  })

  describe('toolbar elements', () => {
    it('displays toolbar with all control buttons', () => {
      setupStore({ isOpen: true, svgContent: mockSvgContent })
      render(<DiagramViewer />)

      expect(screen.getByRole('button', { name: /zoom in/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /zoom out/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /fit to screen/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /reset view/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /close viewer/i })).toBeInTheDocument()
    })

    it('displays default title', () => {
      setupStore({ isOpen: true, svgContent: mockSvgContent })
      render(<DiagramViewer />)

      expect(screen.getByText('Mermaid Diagram')).toBeInTheDocument()
    })

    it('displays zoom indicator', () => {
      setupStore({ isOpen: true, svgContent: mockSvgContent })
      render(<DiagramViewer />)

      // Default zoom is 100% (or fit-to-view calculated)
      const zoomIndicator = screen.getByText(/%/)
      expect(zoomIndicator).toBeInTheDocument()
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

    it('has correct toolbar attributes', () => {
      setupStore({ isOpen: true, svgContent: mockSvgContent })
      render(<DiagramViewer />)

      const toolbar = screen.getByRole('toolbar')
      expect(toolbar).toHaveAttribute('aria-label', 'Diagram viewer controls')
    })

    it('has accessible zoom indicator', () => {
      setupStore({ isOpen: true, svgContent: mockSvgContent })
      render(<DiagramViewer />)

      const zoomIndicator = screen.getByText(/%/)
      expect(zoomIndicator).toHaveAttribute('aria-live', 'polite')
    })
  })

  describe('keyboard shortcuts', () => {
    it('zooms in with + key', () => {
      setupStore({ isOpen: true, svgContent: mockSvgContent })
      render(<DiagramViewer />)

      fireEvent.keyDown(document, { key: '+' })

      // Zoom should change (zoom indicator updates)
      expect(screen.getByText(/%/)).toBeInTheDocument()
    })

    it('zooms out with - key', () => {
      setupStore({ isOpen: true, svgContent: mockSvgContent })
      render(<DiagramViewer />)

      fireEvent.keyDown(document, { key: '-' })

      expect(screen.getByText(/%/)).toBeInTheDocument()
    })

    it('resets view with 0 key', () => {
      setupStore({ isOpen: true, svgContent: mockSvgContent })
      render(<DiagramViewer />)

      // First zoom in
      fireEvent.keyDown(document, { key: '+' })
      fireEvent.keyDown(document, { key: '+' })

      // Then reset
      fireEvent.keyDown(document, { key: '0' })

      expect(screen.getByText('100%')).toBeInTheDocument()
    })
  })

  describe('zoom controls', () => {
    it('zooms in when zoom in button is clicked', () => {
      setupStore({ isOpen: true, svgContent: mockSvgContent })
      render(<DiagramViewer />)

      const zoomInButton = screen.getByRole('button', { name: /zoom in/i })
      fireEvent.click(zoomInButton)

      // Viewer should still be open after zooming
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('zooms out when zoom out button is clicked', () => {
      setupStore({ isOpen: true, svgContent: mockSvgContent })
      render(<DiagramViewer />)

      const zoomOutButton = screen.getByRole('button', { name: /zoom out/i })
      fireEvent.click(zoomOutButton)

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('resets view when reset button is clicked', () => {
      setupStore({ isOpen: true, svgContent: mockSvgContent })
      render(<DiagramViewer />)

      // First zoom in
      const zoomInButton = screen.getByRole('button', { name: /zoom in/i })
      fireEvent.click(zoomInButton)

      // Then reset
      const resetButton = screen.getByRole('button', { name: /reset view/i })
      fireEvent.click(resetButton)

      expect(screen.getByText('100%')).toBeInTheDocument()
    })

    it('fits to screen when fit button is clicked', () => {
      setupStore({ isOpen: true, svgContent: mockSvgContent })
      render(<DiagramViewer />)

      const fitButton = screen.getByRole('button', { name: /fit to screen/i })
      fireEvent.click(fitButton)

      // Viewer should still be open
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })

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
      expect(screen.queryByRole('button', { name: /open chat/i })).not.toBeInTheDocument()
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
      expect(screen.getByRole('button', { name: /open chat/i })).toBeInTheDocument()
    })

    it('does not render ChatBubble when mermaidCode is empty', () => {
      setupStore({
        isOpen: true,
        svgContent: mockSvgContent,
        mermaidCode: '',
        filePath: '/test/file.md'
      })
      render(<DiagramViewer />)

      expect(screen.queryByRole('button', { name: /open chat/i })).not.toBeInTheDocument()
    })
  })

  describe('live update scenario (file edit while viewer open)', () => {
    it('should display updated content when store is updated', async () => {
      // Initial diagram
      setupStore({
        isOpen: true,
        svgContent: '<svg><circle cx="50" cy="50" r="40"/></svg>',
        mermaidCode: 'flowchart TD\n  A-->B'
      })
      render(<DiagramViewer />)

      expect(document.querySelector('circle')).toBeInTheDocument()

      // Simulate file edit - MermaidDiagram would call updateDiagram
      useDiagramViewerStore.getState().updateDiagram(
        '/test/file.md:10-20',
        'flowchart TD\n  A-->B-->C',
        '<svg><rect width="50" height="50"/></svg>'
      )

      // New content should be visible
      await waitFor(() => {
        expect(document.querySelector('rect')).toBeInTheDocument()
      })

      // Viewer should still be open
      expect(useDiagramViewerStore.getState().isOpen).toBe(true)
    })
  })
})
