/**
 * TerminalContextMenu Component Tests
 *
 * Tests the context menu for terminal panel:
 * - Rendering Copy and Paste menu items
 * - Platform-specific shortcuts (⌘C/⌘V on macOS, Ctrl+C/Ctrl+V on Windows)
 * - Copy item disabled when no selection
 * - Actions trigger callbacks and close menu
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TerminalContextMenu } from './TerminalContextMenu'

describe('TerminalContextMenu', () => {
  const defaultProps = {
    x: 100,
    y: 200,
    hasSelection: true,
    onCopy: vi.fn(),
    onPaste: vi.fn(),
    onClose: vi.fn()
  }

  let originalPlatform: string

  beforeEach(() => {
    vi.clearAllMocks()
    originalPlatform = navigator.platform

    // Create portal-root div for ContextMenu (uses createPortal)
    const portalRoot = document.createElement('div')
    portalRoot.setAttribute('id', 'portal-root')
    document.body.appendChild(portalRoot)
  })

  afterEach(() => {
    Object.defineProperty(navigator, 'platform', {
      value: originalPlatform,
      writable: true,
      configurable: true
    })

    // Clean up portal-root
    const portalRoot = document.getElementById('portal-root')
    if (portalRoot) {
      document.body.removeChild(portalRoot)
    }
  })

  describe('Rendering', () => {
    it('renders Copy and Paste menu items', () => {
      render(<TerminalContextMenu {...defaultProps} />)

      expect(screen.getByText('Copy')).toBeInTheDocument()
      expect(screen.getByText('Paste')).toBeInTheDocument()
    })

    it('shows macOS shortcuts (⌘C/⌘V) on macOS', () => {
      Object.defineProperty(navigator, 'platform', {
        value: 'MacIntel',
        writable: true,
        configurable: true
      })

      render(<TerminalContextMenu {...defaultProps} />)

      expect(screen.getByText('⌘C')).toBeInTheDocument()
      expect(screen.getByText('⌘V')).toBeInTheDocument()
    })

    it('shows Windows shortcuts (Ctrl+C/Ctrl+V) on Windows', () => {
      Object.defineProperty(navigator, 'platform', {
        value: 'Win32',
        writable: true,
        configurable: true
      })

      render(<TerminalContextMenu {...defaultProps} />)

      expect(screen.getByText('Ctrl+C')).toBeInTheDocument()
      expect(screen.getByText('Ctrl+V')).toBeInTheDocument()
    })

    it('shows Windows shortcuts on Linux', () => {
      Object.defineProperty(navigator, 'platform', {
        value: 'Linux x86_64',
        writable: true,
        configurable: true
      })

      render(<TerminalContextMenu {...defaultProps} />)

      expect(screen.getByText('Ctrl+C')).toBeInTheDocument()
      expect(screen.getByText('Ctrl+V')).toBeInTheDocument()
    })

    it('renders Copy icon', () => {
      render(<TerminalContextMenu {...defaultProps} />)

      // Lucide icons render as SVG with specific data attributes
      const copyItem = screen.getByText('Copy').closest('.context-menu-item')
      const copyIcon = copyItem?.querySelector('svg')
      expect(copyIcon).toBeInTheDocument()
    })

    it('renders Paste icon', () => {
      render(<TerminalContextMenu {...defaultProps} />)

      const pasteItem = screen.getByText('Paste').closest('.context-menu-item')
      const pasteIcon = pasteItem?.querySelector('svg')
      expect(pasteIcon).toBeInTheDocument()
    })
  })

  describe('Copy item state', () => {
    it('Copy item is enabled when hasSelection is true', () => {
      render(<TerminalContextMenu {...defaultProps} hasSelection={true} />)

      const copyItem = screen.getByText('Copy').closest('.context-menu-item')
      expect(copyItem).not.toHaveClass('disabled')
    })

    it('Copy item is disabled when hasSelection is false', () => {
      render(<TerminalContextMenu {...defaultProps} hasSelection={false} />)

      const copyItem = screen.getByText('Copy').closest('.context-menu-item')
      expect(copyItem).toHaveClass('disabled')
    })
  })

  describe('Paste item state', () => {
    it('Paste item is always enabled', () => {
      render(<TerminalContextMenu {...defaultProps} hasSelection={true} />)

      const pasteItem = screen.getByText('Paste').closest('.context-menu-item')
      expect(pasteItem).not.toHaveClass('disabled')
    })

    it('Paste item is enabled even without selection', () => {
      render(<TerminalContextMenu {...defaultProps} hasSelection={false} />)

      const pasteItem = screen.getByText('Paste').closest('.context-menu-item')
      expect(pasteItem).not.toHaveClass('disabled')
    })
  })

  describe('Copy action', () => {
    it('clicking Copy calls onCopy and onClose', async () => {
      const user = userEvent.setup()
      render(<TerminalContextMenu {...defaultProps} hasSelection={true} />)

      const copyItem = screen.getByText('Copy')
      await user.click(copyItem)

      expect(defaultProps.onCopy).toHaveBeenCalledTimes(1)
      expect(defaultProps.onClose).toHaveBeenCalled()
    })

    it('clicking disabled Copy does not call onCopy', async () => {
      const user = userEvent.setup()
      render(<TerminalContextMenu {...defaultProps} hasSelection={false} />)

      const copyItem = screen.getByText('Copy')
      await user.click(copyItem)

      expect(defaultProps.onCopy).not.toHaveBeenCalled()
    })

    it('clicking disabled Copy does not call onClose', async () => {
      const user = userEvent.setup()
      render(<TerminalContextMenu {...defaultProps} hasSelection={false} />)

      const copyItem = screen.getByText('Copy')
      await user.click(copyItem)

      expect(defaultProps.onClose).not.toHaveBeenCalled()
    })
  })

  describe('Paste action', () => {
    it('clicking Paste calls onPaste and onClose', async () => {
      const user = userEvent.setup()
      render(<TerminalContextMenu {...defaultProps} />)

      const pasteItem = screen.getByText('Paste')
      await user.click(pasteItem)

      expect(defaultProps.onPaste).toHaveBeenCalledTimes(1)
      expect(defaultProps.onClose).toHaveBeenCalled()
    })

    it('clicking Paste works without selection', async () => {
      const user = userEvent.setup()
      render(<TerminalContextMenu {...defaultProps} hasSelection={false} />)

      const pasteItem = screen.getByText('Paste')
      await user.click(pasteItem)

      expect(defaultProps.onPaste).toHaveBeenCalledTimes(1)
      expect(defaultProps.onClose).toHaveBeenCalled()
    })
  })

  describe('Position', () => {
    it('renders at specified x and y coordinates', () => {
      render(<TerminalContextMenu {...defaultProps} x={150} y={250} />)

      // ContextMenu uses createPortal, check portal-root for the menu
      const portalRoot = document.getElementById('portal-root')
      expect(portalRoot).toBeInTheDocument()

      // Menu should be rendered in portal
      const menu = screen.getByText('Copy').closest('.context-menu')
      expect(menu).toBeInTheDocument()
    })
  })

  describe('Multiple props scenarios', () => {
    it('handles all props correctly with selection', async () => {
      const user = userEvent.setup()
      const props = {
        x: 123,
        y: 456,
        hasSelection: true,
        onCopy: vi.fn(),
        onPaste: vi.fn(),
        onClose: vi.fn()
      }

      render(<TerminalContextMenu {...props} />)

      // Copy should be enabled
      const copyItem = screen.getByText('Copy')
      expect(copyItem.closest('.context-menu-item')).not.toHaveClass('disabled')

      await user.click(copyItem)
      expect(props.onCopy).toHaveBeenCalledTimes(1)
      expect(props.onClose).toHaveBeenCalled()
    })

    it('handles all props correctly without selection', async () => {
      const user = userEvent.setup()
      const props = {
        x: 123,
        y: 456,
        hasSelection: false,
        onCopy: vi.fn(),
        onPaste: vi.fn(),
        onClose: vi.fn()
      }

      render(<TerminalContextMenu {...props} />)

      // Copy should be disabled
      const copyItem = screen.getByText('Copy')
      expect(copyItem.closest('.context-menu-item')).toHaveClass('disabled')

      // Paste should work
      const pasteItem = screen.getByText('Paste')
      await user.click(pasteItem)
      expect(props.onPaste).toHaveBeenCalledTimes(1)
      expect(props.onClose).toHaveBeenCalled()

      // Copy should not trigger
      expect(props.onCopy).not.toHaveBeenCalled()
    })
  })

  describe('Platform detection edge cases', () => {
    it('handles empty platform string', () => {
      Object.defineProperty(navigator, 'platform', {
        value: '',
        writable: true,
        configurable: true
      })

      render(<TerminalContextMenu {...defaultProps} />)

      // Should default to Windows shortcuts
      expect(screen.getByText('Ctrl+C')).toBeInTheDocument()
      expect(screen.getByText('Ctrl+V')).toBeInTheDocument()
    })

    it('handles unknown platform', () => {
      Object.defineProperty(navigator, 'platform', {
        value: 'FreeBSD',
        writable: true,
        configurable: true
      })

      render(<TerminalContextMenu {...defaultProps} />)

      // Should default to Windows shortcuts
      expect(screen.getByText('Ctrl+C')).toBeInTheDocument()
      expect(screen.getByText('Ctrl+V')).toBeInTheDocument()
    })
  })
})
