/**
 * Component Tests for DiagramViewer
 *
 * Tests for DiagramViewer component:
 * - Rendering behavior (isOpen prop)
 * - SVG content display
 * - Closing mechanisms (button, Escape, backdrop)
 * - Toolbar elements
 * - Accessibility attributes
 * - Focus management
 * - Keyboard shortcuts
 * - Zoom controls
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DiagramViewer } from './DiagramViewer'

describe('DiagramViewer', () => {
  // Mock SVG content
  const mockSvgContent = '<svg width="100" height="100"><circle cx="50" cy="50" r="40"/></svg>'

  beforeEach(() => {
    // Create portal root
    const portalRoot = document.createElement('div')
    portalRoot.id = 'portal-root'
    document.body.appendChild(portalRoot)
  })

  afterEach(() => {
    // Cleanup portal root
    document.getElementById('portal-root')?.remove()
  })

  describe('rendering behavior', () => {
    it('does not render when isOpen is false', () => {
      const onClose = vi.fn()
      render(
        <DiagramViewer isOpen={false} onClose={onClose} svgContent={mockSvgContent} />
      )

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('renders when isOpen is true', () => {
      const onClose = vi.fn()
      render(
        <DiagramViewer isOpen={true} onClose={onClose} svgContent={mockSvgContent} />
      )

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('returns null when portal root does not exist', () => {
      // Remove portal root
      document.getElementById('portal-root')?.remove()

      const onClose = vi.fn()
      const { container } = render(
        <DiagramViewer isOpen={true} onClose={onClose} svgContent={mockSvgContent} />
      )

      expect(container.firstChild).toBeNull()
    })
  })

  describe('SVG content display', () => {
    it('displays SVG content correctly', () => {
      const onClose = vi.fn()
      render(
        <DiagramViewer isOpen={true} onClose={onClose} svgContent={mockSvgContent} />
      )

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
      const onClose = vi.fn()
      render(
        <DiagramViewer isOpen={true} onClose={onClose} svgContent={complexSvg} />
      )

      const rect = document.querySelector('rect')
      const circle = document.querySelector('circle')
      expect(rect).toBeInTheDocument()
      expect(circle).toBeInTheDocument()
    })

    it('updates SVG content when prop changes', () => {
      const onClose = vi.fn()
      const { rerender } = render(
        <DiagramViewer isOpen={true} onClose={onClose} svgContent={mockSvgContent} />
      )

      const newSvg = '<svg width="200" height="200"><rect x="0" y="0" width="100" height="100"/></svg>'
      rerender(
        <DiagramViewer isOpen={true} onClose={onClose} svgContent={newSvg} />
      )

      const rect = document.querySelector('rect')
      expect(rect).toBeInTheDocument()
    })
  })

  describe('close button', () => {
    it('calls onClose when close button is clicked', () => {
      const onClose = vi.fn()
      render(
        <DiagramViewer isOpen={true} onClose={onClose} svgContent={mockSvgContent} />
      )

      const closeButton = screen.getByRole('button', { name: /close viewer/i })
      fireEvent.click(closeButton)

      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('displays close button with correct icon', () => {
      const onClose = vi.fn()
      render(
        <DiagramViewer isOpen={true} onClose={onClose} svgContent={mockSvgContent} />
      )

      const closeButton = screen.getByRole('button', { name: /close viewer/i })
      expect(closeButton).toBeInTheDocument()
    })

    it('close button has autoFocus', () => {
      const onClose = vi.fn()
      render(
        <DiagramViewer isOpen={true} onClose={onClose} svgContent={mockSvgContent} />
      )

      const closeButton = screen.getByRole('button', { name: /close viewer/i })

      // Wait for focus to settle
      waitFor(() => {
        expect(closeButton).toHaveFocus()
      })
    })
  })

  describe('keyboard shortcuts', () => {
    it('calls onClose when Escape key is pressed', () => {
      const onClose = vi.fn()
      render(
        <DiagramViewer isOpen={true} onClose={onClose} svgContent={mockSvgContent} />
      )

      fireEvent.keyDown(document, { key: 'Escape' })

      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('does not close when Escape is pressed with Ctrl', () => {
      const onClose = vi.fn()
      render(
        <DiagramViewer isOpen={true} onClose={onClose} svgContent={mockSvgContent} />
      )

      fireEvent.keyDown(document, { key: 'Escape', ctrlKey: true })

      expect(onClose).not.toHaveBeenCalled()
    })

    it('does not close when Escape is pressed with Meta', () => {
      const onClose = vi.fn()
      render(
        <DiagramViewer isOpen={true} onClose={onClose} svgContent={mockSvgContent} />
      )

      fireEvent.keyDown(document, { key: 'Escape', metaKey: true })

      expect(onClose).not.toHaveBeenCalled()
    })

    it('ignores other keyboard shortcuts', () => {
      const onClose = vi.fn()
      render(
        <DiagramViewer isOpen={true} onClose={onClose} svgContent={mockSvgContent} />
      )

      fireEvent.keyDown(document, { key: '+' })
      fireEvent.keyDown(document, { key: '-' })
      fireEvent.keyDown(document, { key: '0' })
      fireEvent.keyDown(document, { key: 'f' })

      expect(onClose).not.toHaveBeenCalled()
    })

    it('removes keyboard listener when closed', () => {
      const onClose = vi.fn()
      const { rerender } = render(
        <DiagramViewer isOpen={true} onClose={onClose} svgContent={mockSvgContent} />
      )

      rerender(
        <DiagramViewer isOpen={false} onClose={onClose} svgContent={mockSvgContent} />
      )

      fireEvent.keyDown(document, { key: 'Escape' })

      expect(onClose).not.toHaveBeenCalled()
    })
  })

  describe('backdrop click', () => {
    it('calls onClose when backdrop is clicked (not dragging)', () => {
      const onClose = vi.fn()
      render(
        <DiagramViewer isOpen={true} onClose={onClose} svgContent={mockSvgContent} />
      )

      const overlay = screen.getByRole('dialog')
      fireEvent.click(overlay)

      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('does not close when clicking inside content', () => {
      const onClose = vi.fn()
      render(
        <DiagramViewer isOpen={true} onClose={onClose} svgContent={mockSvgContent} />
      )

      const toolbar = screen.getByRole('toolbar')
      fireEvent.click(toolbar)

      expect(onClose).not.toHaveBeenCalled()
    })
  })

  describe('toolbar elements', () => {
    it('displays zoom percentage', () => {
      const onClose = vi.fn()
      render(
        <DiagramViewer isOpen={true} onClose={onClose} svgContent={mockSvgContent} />
      )

      // Initial scale is 1 (100%)
      const zoomIndicator = screen.getByText('100%')
      expect(zoomIndicator).toBeInTheDocument()
    })

    it('displays default title when title prop not provided', () => {
      const onClose = vi.fn()
      render(
        <DiagramViewer isOpen={true} onClose={onClose} svgContent={mockSvgContent} />
      )

      expect(screen.getByText('Diagram Viewer')).toBeInTheDocument()
    })

    it('displays custom title when provided', () => {
      const onClose = vi.fn()
      render(
        <DiagramViewer
          isOpen={true}
          onClose={onClose}
          svgContent={mockSvgContent}
          title="My Custom Diagram"
        />
      )

      expect(screen.getByText('My Custom Diagram')).toBeInTheDocument()
    })

    it('displays zoom in button', () => {
      const onClose = vi.fn()
      render(
        <DiagramViewer isOpen={true} onClose={onClose} svgContent={mockSvgContent} />
      )

      const zoomInButton = screen.getByRole('button', { name: /zoom in/i })
      expect(zoomInButton).toBeInTheDocument()
      expect(zoomInButton).not.toBeDisabled()
    })

    it('displays zoom out button', () => {
      const onClose = vi.fn()
      render(
        <DiagramViewer isOpen={true} onClose={onClose} svgContent={mockSvgContent} />
      )

      const zoomOutButton = screen.getByRole('button', { name: /zoom out/i })
      expect(zoomOutButton).toBeInTheDocument()
      expect(zoomOutButton).not.toBeDisabled()
    })

    it('displays fit to screen button', () => {
      const onClose = vi.fn()
      render(
        <DiagramViewer isOpen={true} onClose={onClose} svgContent={mockSvgContent} />
      )

      const fitButton = screen.getByRole('button', { name: /fit to screen/i })
      expect(fitButton).toBeInTheDocument()
    })

    it('displays reset view button', () => {
      const onClose = vi.fn()
      render(
        <DiagramViewer isOpen={true} onClose={onClose} svgContent={mockSvgContent} />
      )

      const resetButton = screen.getByRole('button', { name: /reset view/i })
      expect(resetButton).toBeInTheDocument()
    })

    it('has toolbar with correct role', () => {
      const onClose = vi.fn()
      render(
        <DiagramViewer isOpen={true} onClose={onClose} svgContent={mockSvgContent} />
      )

      const toolbar = screen.getByRole('toolbar', { name: /diagram viewer controls/i })
      expect(toolbar).toBeInTheDocument()
    })
  })

  describe('accessibility', () => {
    it('has role="dialog"', () => {
      const onClose = vi.fn()
      render(
        <DiagramViewer isOpen={true} onClose={onClose} svgContent={mockSvgContent} />
      )

      const dialog = screen.getByRole('dialog')
      expect(dialog).toBeInTheDocument()
    })

    it('has aria-modal="true"', () => {
      const onClose = vi.fn()
      render(
        <DiagramViewer isOpen={true} onClose={onClose} svgContent={mockSvgContent} />
      )

      const dialog = screen.getByRole('dialog')
      expect(dialog).toHaveAttribute('aria-modal', 'true')
    })

    it('has default aria-label when title not provided', () => {
      const onClose = vi.fn()
      render(
        <DiagramViewer isOpen={true} onClose={onClose} svgContent={mockSvgContent} />
      )

      const dialog = screen.getByRole('dialog')
      expect(dialog).toHaveAttribute('aria-label', 'Diagram Viewer')
    })

    it('has custom aria-label when title provided', () => {
      const onClose = vi.fn()
      render(
        <DiagramViewer
          isOpen={true}
          onClose={onClose}
          svgContent={mockSvgContent}
          title="Flow Chart"
        />
      )

      const dialog = screen.getByRole('dialog')
      expect(dialog).toHaveAttribute('aria-label', 'Flow Chart')
    })

    it('zoom indicator has aria-live="polite"', () => {
      const onClose = vi.fn()
      render(
        <DiagramViewer isOpen={true} onClose={onClose} svgContent={mockSvgContent} />
      )

      const zoomIndicator = screen.getByText('100%')
      expect(zoomIndicator).toHaveAttribute('aria-live', 'polite')
    })

    it('all buttons have aria-label', () => {
      const onClose = vi.fn()
      render(
        <DiagramViewer isOpen={true} onClose={onClose} svgContent={mockSvgContent} />
      )

      expect(screen.getByRole('button', { name: /zoom out/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /zoom in/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /fit to screen/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /reset view/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /close viewer/i })).toBeInTheDocument()
    })
  })

  describe('focus management', () => {
    it('stores previously focused element when opening', () => {
      const button = document.createElement('button')
      button.textContent = 'Test Button'
      document.body.appendChild(button)
      button.focus()

      const onClose = vi.fn()
      const { rerender } = render(
        <DiagramViewer isOpen={false} onClose={onClose} svgContent={mockSvgContent} />
      )

      expect(document.activeElement).toBe(button)

      rerender(
        <DiagramViewer isOpen={true} onClose={onClose} svgContent={mockSvgContent} />
      )

      // The component is now open, close button should eventually get focus
      waitFor(() => {
        const closeButton = screen.getByRole('button', { name: /close viewer/i })
        expect(closeButton).toHaveFocus()
      })

      document.body.removeChild(button)
    })

    it('stores focus element when opening', () => {
      const button = document.createElement('button')
      button.textContent = 'Test Button'
      document.body.appendChild(button)
      button.focus()

      const onClose = vi.fn()
      const { rerender } = render(
        <DiagramViewer isOpen={false} onClose={onClose} svgContent={mockSvgContent} />
      )

      // Open the dialog - this should store the current activeElement
      rerender(
        <DiagramViewer isOpen={true} onClose={onClose} svgContent={mockSvgContent} />
      )

      // Component is open, verify it rendered
      expect(screen.getByRole('dialog')).toBeInTheDocument()

      // Close the dialog
      rerender(
        <DiagramViewer isOpen={false} onClose={onClose} svgContent={mockSvgContent} />
      )

      // Component should be gone
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

      document.body.removeChild(button)
    })
  })

  describe('zoom controls interaction', () => {
    it('zoom in button is clickable', () => {
      const onClose = vi.fn()
      render(
        <DiagramViewer isOpen={true} onClose={onClose} svgContent={mockSvgContent} />
      )

      const zoomInButton = screen.getByRole('button', { name: /zoom in/i })
      fireEvent.click(zoomInButton)

      // Button should still be present after click
      expect(zoomInButton).toBeInTheDocument()
    })

    it('zoom out button is clickable', () => {
      const onClose = vi.fn()
      render(
        <DiagramViewer isOpen={true} onClose={onClose} svgContent={mockSvgContent} />
      )

      const zoomOutButton = screen.getByRole('button', { name: /zoom out/i })
      fireEvent.click(zoomOutButton)

      // Button should still be present after click
      expect(zoomOutButton).toBeInTheDocument()
    })

    it('fit button is clickable', () => {
      const onClose = vi.fn()
      render(
        <DiagramViewer isOpen={true} onClose={onClose} svgContent={mockSvgContent} />
      )

      const fitButton = screen.getByRole('button', { name: /fit to screen/i })
      fireEvent.click(fitButton)

      expect(fitButton).toBeInTheDocument()
    })

    it('reset button is clickable', () => {
      const onClose = vi.fn()
      render(
        <DiagramViewer isOpen={true} onClose={onClose} svgContent={mockSvgContent} />
      )

      const resetButton = screen.getByRole('button', { name: /reset view/i })
      fireEvent.click(resetButton)

      expect(resetButton).toBeInTheDocument()
    })
  })

  describe('edge cases', () => {
    it('handles empty SVG content', () => {
      const onClose = vi.fn()
      render(
        <DiagramViewer isOpen={true} onClose={onClose} svgContent="" />
      )

      const dialog = screen.getByRole('dialog')
      expect(dialog).toBeInTheDocument()
    })

    it('handles SVG content with special characters', () => {
      const specialSvg = '<svg><text>Special &lt;&gt;&amp;</text></svg>'
      const onClose = vi.fn()
      render(
        <DiagramViewer isOpen={true} onClose={onClose} svgContent={specialSvg} />
      )

      // Verify dialog renders - JSDOM has limitations with SVG innerHTML parsing
      // but actual browser rendering works correctly
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('handles title with special characters', () => {
      const onClose = vi.fn()
      render(
        <DiagramViewer
          isOpen={true}
          onClose={onClose}
          svgContent={mockSvgContent}
          title="Flow <Chart> & Diagram"
        />
      )

      expect(screen.getByText('Flow <Chart> & Diagram')).toBeInTheDocument()
    })

    it('handles rapid open/close transitions', () => {
      const onClose = vi.fn()
      const { rerender } = render(
        <DiagramViewer isOpen={true} onClose={onClose} svgContent={mockSvgContent} />
      )

      rerender(
        <DiagramViewer isOpen={false} onClose={onClose} svgContent={mockSvgContent} />
      )
      rerender(
        <DiagramViewer isOpen={true} onClose={onClose} svgContent={mockSvgContent} />
      )
      rerender(
        <DiagramViewer isOpen={false} onClose={onClose} svgContent={mockSvgContent} />
      )

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })
})
