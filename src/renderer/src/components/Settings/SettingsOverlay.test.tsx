/**
 * SettingsOverlay.test.tsx
 *
 * Test coverage for SettingsOverlay component
 *
 * Test groups:
 * - Rendering (3 tests)
 * - Structure (4 tests)
 * - Close behavior (2 tests)
 * - Accessibility (3 tests)
 * - Focus management (2 tests)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsOverlay } from './SettingsOverlay'
import { useSettingsStore } from '../../stores/useSettingsStore'

describe('SettingsOverlay', () => {
  beforeEach(() => {
    // Create portal-root div for portal rendering
    const portalRoot = document.createElement('div')
    portalRoot.setAttribute('id', 'portal-root')
    document.body.appendChild(portalRoot)

    // Reset store state
    useSettingsStore.setState({ isOpen: false })

    // Mock console.error to suppress error from missing portal-root in some tests
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.clearAllMocks()

    // Clean up portal-root
    const portalRoot = document.getElementById('portal-root')
    if (portalRoot) {
      document.body.removeChild(portalRoot)
    }

    // Clean up any remaining elements
    document.body.innerHTML = ''
  })

  describe('Rendering', () => {
    it('renders when isOpen is true', () => {
      useSettingsStore.setState({ isOpen: true })
      render(<SettingsOverlay />)

      expect(screen.getByTestId('settings-overlay')).toBeInTheDocument()
    })

    it('does not render when isOpen is false', () => {
      useSettingsStore.setState({ isOpen: false })
      render(<SettingsOverlay />)

      expect(screen.queryByTestId('settings-overlay')).not.toBeInTheDocument()
    })

    it('renders to portal-root', () => {
      useSettingsStore.setState({ isOpen: true })
      render(<SettingsOverlay />)

      const portalRoot = document.getElementById('portal-root')
      const overlay = portalRoot?.querySelector('.settings-overlay')

      expect(overlay).toBeInTheDocument()
    })
  })

  describe('Structure', () => {
    beforeEach(() => {
      useSettingsStore.setState({ isOpen: true })
    })

    it('has header with Settings title', () => {
      render(<SettingsOverlay />)

      const title = screen.getByText('Settings')
      expect(title).toBeInTheDocument()
      expect(title).toHaveClass('settings-title')
    })

    it('has close button with X icon', () => {
      render(<SettingsOverlay />)

      const closeButton = screen.getByRole('button', { name: 'Close settings' })
      expect(closeButton).toBeInTheDocument()
      expect(closeButton).toHaveClass('settings-close-btn')
    })

    it('has empty state placeholder text', () => {
      render(<SettingsOverlay />)

      expect(screen.getByText('Settings coming soon')).toBeInTheDocument()
    })

    it('has settings-container element', () => {
      render(<SettingsOverlay />)

      const portalRoot = document.getElementById('portal-root')
      const settingsContainer = portalRoot?.querySelector('.settings-container')
      expect(settingsContainer).toBeTruthy()
    })
  })

  describe('Close behavior', () => {
    beforeEach(() => {
      useSettingsStore.setState({ isOpen: true })
    })

    it('closes when close button is clicked', async () => {
      const user = userEvent.setup()
      render(<SettingsOverlay />)

      const closeButton = screen.getByRole('button', { name: 'Close settings' })
      await user.click(closeButton)

      await waitFor(() => {
        expect(useSettingsStore.getState().isOpen).toBe(false)
      })
    })

    it('closes when Escape key is pressed', async () => {
      const user = userEvent.setup()
      render(<SettingsOverlay />)

      await user.keyboard('{Escape}')

      await waitFor(() => {
        expect(useSettingsStore.getState().isOpen).toBe(false)
      })
    })
  })

  describe('Accessibility', () => {
    beforeEach(() => {
      useSettingsStore.setState({ isOpen: true })
    })

    it('has role="dialog" attribute', () => {
      render(<SettingsOverlay />)

      const dialog = screen.getByRole('dialog')
      expect(dialog).toBeInTheDocument()
    })

    it('has aria-modal="true" attribute', () => {
      render(<SettingsOverlay />)

      const dialog = screen.getByRole('dialog')
      expect(dialog).toHaveAttribute('aria-modal', 'true')
    })

    it('has aria-labelledby pointing to title', () => {
      render(<SettingsOverlay />)

      const dialog = screen.getByRole('dialog')
      expect(dialog).toHaveAttribute('aria-labelledby', 'settings-title')

      const title = document.getElementById('settings-title')
      expect(title).toBeInTheDocument()
      expect(title?.textContent).toBe('Settings')
    })
  })

  describe('Focus management', () => {
    beforeEach(() => {
      useSettingsStore.setState({ isOpen: true })
    })

    it('focuses close button when opened', async () => {
      render(<SettingsOverlay />)

      const closeButton = screen.getByRole('button', { name: 'Close settings' })

      // Wait for focus to be set (uses 10ms delay in component)
      await waitFor(
        () => {
          expect(closeButton).toHaveFocus()
        },
        { timeout: 100 }
      )
    })

    it('restores focus when closed', async () => {
      // Create a button to have focus before opening overlay
      const testButton = document.createElement('button')
      testButton.textContent = 'Test Button'
      document.body.appendChild(testButton)
      testButton.focus()

      expect(document.activeElement).toBe(testButton)

      const { rerender } = render(<SettingsOverlay />)

      // Wait for close button to be focused
      const closeButton = screen.getByRole('button', { name: 'Close settings' })
      await waitFor(
        () => {
          expect(closeButton).toHaveFocus()
        },
        { timeout: 100 }
      )

      // Close the overlay
      useSettingsStore.setState({ isOpen: false })
      rerender(<SettingsOverlay />)

      // Focus should be restored to the test button
      await waitFor(() => {
        expect(document.activeElement).toBe(testButton)
      })

      // Clean up
      document.body.removeChild(testButton)
    })
  })

  describe('Portal fallback', () => {
    it('logs error when portal-root is missing', () => {
      // Remove portal-root
      const portalRoot = document.getElementById('portal-root')
      if (portalRoot) {
        document.body.removeChild(portalRoot)
      }

      const consoleError = vi.spyOn(console, 'error')
      useSettingsStore.setState({ isOpen: true })

      render(<SettingsOverlay />)

      expect(consoleError).toHaveBeenCalledWith(
        'SettingsOverlay: #portal-root element not found'
      )

      // Component should not crash
      expect(screen.queryByTestId('settings-overlay')).not.toBeInTheDocument()
    })
  })

  describe('Keyboard event handling', () => {
    beforeEach(() => {
      useSettingsStore.setState({ isOpen: true })
    })

    it('prevents default on Escape key', async () => {
      render(<SettingsOverlay />)

      // Create a custom Escape event with preventDefault spy
      const escapeEvent = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true
      })
      const preventDefaultSpy = vi.spyOn(escapeEvent, 'preventDefault')
      const stopPropagationSpy = vi.spyOn(escapeEvent, 'stopPropagation')

      document.dispatchEvent(escapeEvent)

      await waitFor(() => {
        expect(preventDefaultSpy).toHaveBeenCalled()
        expect(stopPropagationSpy).toHaveBeenCalled()
      })
    })

    it('does not handle other keys', async () => {
      const user = userEvent.setup()
      render(<SettingsOverlay />)

      // Press a different key
      await user.keyboard('{Enter}')

      // Settings should still be open
      expect(useSettingsStore.getState().isOpen).toBe(true)
    })
  })

  describe('Store integration', () => {
    it('updates visibility when store changes', () => {
      useSettingsStore.setState({ isOpen: false })
      const { rerender } = render(<SettingsOverlay />)

      expect(screen.queryByTestId('settings-overlay')).not.toBeInTheDocument()

      useSettingsStore.setState({ isOpen: true })
      rerender(<SettingsOverlay />)

      expect(screen.getByTestId('settings-overlay')).toBeInTheDocument()
    })

    it('calls closeSettings from store when close button clicked', async () => {
      const user = userEvent.setup()

      // Track the initial state
      useSettingsStore.setState({ isOpen: true })
      render(<SettingsOverlay />)

      const closeButton = screen.getByRole('button', { name: 'Close settings' })
      await user.click(closeButton)

      // Verify that the store's isOpen was set to false
      await waitFor(() => {
        expect(useSettingsStore.getState().isOpen).toBe(false)
      })
    })
  })
})
