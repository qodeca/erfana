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
 * - Portal fallback (1 test)
 * - Keyboard event handling (2 tests)
 * - Store integration (2 tests)
 * - Logging section (6 tests)
 * - Editor section (5 tests)
 * - Git status section (11 tests)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsOverlay } from './SettingsOverlay'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { useGlobalSettingsStore } from '../../stores/useGlobalSettingsStore'
import type { GlobalSettings } from '../../../../shared/ipc/global-settings-schema'

// Mock logger
const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn()
  }
}))
vi.mock('../../utils/logger', () => ({ logger: mockLogger }))

describe('SettingsOverlay', () => {
  beforeEach(() => {
    // Create portal-root div for portal rendering
    const portalRoot = document.createElement('div')
    portalRoot.setAttribute('id', 'portal-root')
    document.body.appendChild(portalRoot)

    // Reset store state
    useSettingsStore.setState({ isOpen: false })

    // Clear logger mocks
    vi.clearAllMocks()

    // Mock window.api.transcription for component's useEffect
    ;(window as any).api = {
      transcription: {
        hasApiKey: vi.fn().mockResolvedValue(false),
        setApiKey: vi.fn().mockResolvedValue({ success: true }),
        clearApiKey: vi.fn().mockResolvedValue({ success: true })
      }
    }
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

    it('has settings content section', () => {
      render(<SettingsOverlay />)

      const portalRoot = document.getElementById('portal-root')
      const settingsContent = portalRoot?.querySelector('.settings-content')
      expect(settingsContent).toBeTruthy()
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

      mockLogger.error.mockClear()
      useSettingsStore.setState({ isOpen: true })

      render(<SettingsOverlay />)

      expect(mockLogger.error).toHaveBeenCalledWith(
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

  describe('Logging section', () => {
    beforeEach(() => {
      useSettingsStore.setState({ isOpen: true })
    })

    it('renders logging section with section title', () => {
      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false },
          gitStatus: { pollingEnabled: true, pollingInterval: 5000 },
          transcription: { backend: 'openai' as const, openaiApiKeyStored: false }
        },
        isLoading: false,
        error: null,
        isInitialized: true,
        wasCorruptionRecovered: false,
        loadSettings: vi.fn(),
        updateLoggingLevel: vi.fn(),
        updatePreserveLineBreaks: vi.fn(),
        updateGitStatusPollingEnabled: vi.fn(),
        updateGitStatusPollingInterval: vi.fn(),
        resetSettings: vi.fn(),
        clearCorruptionFlag: vi.fn(),
        _handleSettingsChanged: vi.fn(),
        updateTranscriptionBackend: vi.fn()
      })

      render(<SettingsOverlay />)

      const heading = screen.getByRole('heading', { name: 'Logging' })
      expect(heading).toBeInTheDocument()
      expect(heading).toHaveClass('settings-section-title')
    })

    it('renders log level dropdown with current value', () => {
      const mockSettings: GlobalSettings = {
        logging: { level: 'debug' },
        editor: { preserveLineBreaks: false },
        gitStatus: { pollingEnabled: true, pollingInterval: 5000 },
        transcription: { backend: 'openai' as const, openaiApiKeyStored: false }
      }
      useGlobalSettingsStore.setState({
        settings: mockSettings,
        isLoading: false,
        error: null,
        isInitialized: true,
        wasCorruptionRecovered: false,
        loadSettings: vi.fn(),
        updateLoggingLevel: vi.fn(),
        updatePreserveLineBreaks: vi.fn(),
        updateGitStatusPollingEnabled: vi.fn(),
        updateGitStatusPollingInterval: vi.fn(),
        resetSettings: vi.fn(),
        clearCorruptionFlag: vi.fn(),
        _handleSettingsChanged: vi.fn(),
        updateTranscriptionBackend: vi.fn()
      })

      render(<SettingsOverlay />)

      const dropdown = screen.getByRole('combobox', { name: 'Log level' })
      expect(dropdown).toBeInTheDocument()
      expect(dropdown).toHaveValue('debug')
    })

    it('dropdown displays all 6 log levels', () => {
      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false },
          gitStatus: { pollingEnabled: true, pollingInterval: 5000 },
          transcription: { backend: 'openai' as const, openaiApiKeyStored: false }
        },
        isLoading: false,
        error: null,
        isInitialized: true,
        wasCorruptionRecovered: false,
        loadSettings: vi.fn(),
        updateLoggingLevel: vi.fn(),
        updatePreserveLineBreaks: vi.fn(),
        updateGitStatusPollingEnabled: vi.fn(),
        updateGitStatusPollingInterval: vi.fn(),
        resetSettings: vi.fn(),
        clearCorruptionFlag: vi.fn(),
        _handleSettingsChanged: vi.fn(),
        updateTranscriptionBackend: vi.fn()
      })

      render(<SettingsOverlay />)

      const dropdown = screen.getByRole('combobox', { name: 'Log level' })
      const options = Array.from(dropdown.querySelectorAll('option'))

      expect(options).toHaveLength(6)
      expect(options[0]).toHaveTextContent('Trace')
      expect(options[0]).toHaveValue('trace')
      expect(options[1]).toHaveTextContent('Debug')
      expect(options[1]).toHaveValue('debug')
      expect(options[2]).toHaveTextContent('Info')
      expect(options[2]).toHaveValue('info')
      expect(options[3]).toHaveTextContent('Warn')
      expect(options[3]).toHaveValue('warn')
      expect(options[4]).toHaveTextContent('Error')
      expect(options[4]).toHaveValue('error')
      expect(options[5]).toHaveTextContent('Fatal')
      expect(options[5]).toHaveValue('fatal')
    })

    it('changing dropdown calls updateLoggingLevel', () => {
      const mockUpdateLoggingLevel = vi.fn()
      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false },
          gitStatus: { pollingEnabled: true, pollingInterval: 5000 },
          transcription: { backend: 'openai' as const, openaiApiKeyStored: false }
        },
        isLoading: false,
        error: null,
        isInitialized: true,
        wasCorruptionRecovered: false,
        loadSettings: vi.fn(),
        updateLoggingLevel: mockUpdateLoggingLevel,
        updatePreserveLineBreaks: vi.fn(),
        updateGitStatusPollingEnabled: vi.fn(),
        updateGitStatusPollingInterval: vi.fn(),
        resetSettings: vi.fn(),
        clearCorruptionFlag: vi.fn(),
        _handleSettingsChanged: vi.fn(),
        updateTranscriptionBackend: vi.fn()
      })

      render(<SettingsOverlay />)

      const dropdown = screen.getByRole('combobox', { name: 'Log level' })
      fireEvent.change(dropdown, { target: { value: 'debug' } })

      expect(mockUpdateLoggingLevel).toHaveBeenCalledTimes(1)
      expect(mockUpdateLoggingLevel).toHaveBeenCalledWith('debug')
    })

    it('dropdown is disabled when settings is null', () => {
      useGlobalSettingsStore.setState({
        settings: null,
        isLoading: false,
        error: null,
        isInitialized: false,
        wasCorruptionRecovered: false,
        loadSettings: vi.fn(),
        updateLoggingLevel: vi.fn(),
        updatePreserveLineBreaks: vi.fn(),
        updateGitStatusPollingEnabled: vi.fn(),
        updateGitStatusPollingInterval: vi.fn(),
        resetSettings: vi.fn(),
        clearCorruptionFlag: vi.fn(),
        _handleSettingsChanged: vi.fn(),
        updateTranscriptionBackend: vi.fn()
      })

      render(<SettingsOverlay />)

      const dropdown = screen.getByRole('combobox', { name: 'Log level' })
      expect(dropdown).toBeDisabled()
    })

    it('dropdown defaults to "info" when settings is null', () => {
      useGlobalSettingsStore.setState({
        settings: null,
        isLoading: false,
        error: null,
        isInitialized: false,
        wasCorruptionRecovered: false,
        loadSettings: vi.fn(),
        updateLoggingLevel: vi.fn(),
        updatePreserveLineBreaks: vi.fn(),
        updateGitStatusPollingEnabled: vi.fn(),
        updateGitStatusPollingInterval: vi.fn(),
        resetSettings: vi.fn(),
        clearCorruptionFlag: vi.fn(),
        _handleSettingsChanged: vi.fn(),
        updateTranscriptionBackend: vi.fn()
      })

      render(<SettingsOverlay />)

      const dropdown = screen.getByRole('combobox', { name: 'Log level' })
      expect(dropdown).toHaveValue('info')
    })
  })

  describe('Editor section', () => {
    beforeEach(() => {
      useSettingsStore.setState({ isOpen: true })
    })

    it('renders editor section with section title', () => {
      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false },
          gitStatus: { pollingEnabled: true, pollingInterval: 5000 },
          transcription: { backend: 'openai' as const, openaiApiKeyStored: false }
        },
        isLoading: false,
        error: null,
        isInitialized: true,
        wasCorruptionRecovered: false,
        loadSettings: vi.fn(),
        updateLoggingLevel: vi.fn(),
        updatePreserveLineBreaks: vi.fn(),
        updateGitStatusPollingEnabled: vi.fn(),
        updateGitStatusPollingInterval: vi.fn(),
        resetSettings: vi.fn(),
        clearCorruptionFlag: vi.fn(),
        _handleSettingsChanged: vi.fn(),
        updateTranscriptionBackend: vi.fn()
      })

      render(<SettingsOverlay />)

      const heading = screen.getByRole('heading', { name: 'Editor' })
      expect(heading).toBeInTheDocument()
      expect(heading).toHaveClass('settings-section-title')
    })

    it('renders preserve line breaks checkbox with current value (unchecked)', () => {
      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false },
          gitStatus: { pollingEnabled: true, pollingInterval: 5000 },
          transcription: { backend: 'openai' as const, openaiApiKeyStored: false }
        },
        isLoading: false,
        error: null,
        isInitialized: true,
        wasCorruptionRecovered: false,
        loadSettings: vi.fn(),
        updateLoggingLevel: vi.fn(),
        updatePreserveLineBreaks: vi.fn(),
        updateGitStatusPollingEnabled: vi.fn(),
        updateGitStatusPollingInterval: vi.fn(),
        resetSettings: vi.fn(),
        clearCorruptionFlag: vi.fn(),
        _handleSettingsChanged: vi.fn(),
        updateTranscriptionBackend: vi.fn()
      })

      render(<SettingsOverlay />)

      const checkbox = screen.getByRole('checkbox', { name: 'Preserve line breaks' })
      expect(checkbox).toBeInTheDocument()
      expect(checkbox).not.toBeChecked()
    })

    it('renders preserve line breaks checkbox with current value (checked)', () => {
      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: true },
          gitStatus: { pollingEnabled: true, pollingInterval: 5000 },
          transcription: { backend: 'openai' as const, openaiApiKeyStored: false }
        },
        isLoading: false,
        error: null,
        isInitialized: true,
        wasCorruptionRecovered: false,
        loadSettings: vi.fn(),
        updateLoggingLevel: vi.fn(),
        updatePreserveLineBreaks: vi.fn(),
        updateGitStatusPollingEnabled: vi.fn(),
        updateGitStatusPollingInterval: vi.fn(),
        resetSettings: vi.fn(),
        clearCorruptionFlag: vi.fn(),
        _handleSettingsChanged: vi.fn(),
        updateTranscriptionBackend: vi.fn()
      })

      render(<SettingsOverlay />)

      const checkbox = screen.getByRole('checkbox', { name: 'Preserve line breaks' })
      expect(checkbox).toBeInTheDocument()
      expect(checkbox).toBeChecked()
    })

    it('changing checkbox calls updatePreserveLineBreaks', async () => {
      const mockUpdatePreserveLineBreaks = vi.fn()
      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false },
          gitStatus: { pollingEnabled: true, pollingInterval: 5000 },
          transcription: { backend: 'openai' as const, openaiApiKeyStored: false }
        },
        isLoading: false,
        error: null,
        isInitialized: true,
        wasCorruptionRecovered: false,
        loadSettings: vi.fn(),
        updateLoggingLevel: vi.fn(),
        updatePreserveLineBreaks: mockUpdatePreserveLineBreaks,
        updateGitStatusPollingEnabled: vi.fn(),
        updateGitStatusPollingInterval: vi.fn(),
        resetSettings: vi.fn(),
        clearCorruptionFlag: vi.fn(),
        _handleSettingsChanged: vi.fn(),
        updateTranscriptionBackend: vi.fn()
      })

      render(<SettingsOverlay />)

      const checkbox = screen.getByRole('checkbox', { name: 'Preserve line breaks' })
      fireEvent.click(checkbox)

      expect(mockUpdatePreserveLineBreaks).toHaveBeenCalledTimes(1)
      expect(mockUpdatePreserveLineBreaks).toHaveBeenCalledWith(true)
    })

    it('checkbox is disabled when settings is null', () => {
      useGlobalSettingsStore.setState({
        settings: null,
        isLoading: false,
        error: null,
        isInitialized: false,
        wasCorruptionRecovered: false,
        loadSettings: vi.fn(),
        updateLoggingLevel: vi.fn(),
        updatePreserveLineBreaks: vi.fn(),
        updateGitStatusPollingEnabled: vi.fn(),
        updateGitStatusPollingInterval: vi.fn(),
        resetSettings: vi.fn(),
        clearCorruptionFlag: vi.fn(),
        _handleSettingsChanged: vi.fn(),
        updateTranscriptionBackend: vi.fn()
      })

      render(<SettingsOverlay />)

      const checkbox = screen.getByRole('checkbox', { name: 'Preserve line breaks' })
      expect(checkbox).toBeDisabled()
    })
  })

  describe('Git status section', () => {
    beforeEach(() => {
      useSettingsStore.setState({ isOpen: true })
    })

    it('renders git status section with section title', () => {
      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false },
          gitStatus: { pollingEnabled: true, pollingInterval: 5000 },
          transcription: { backend: 'openai' as const, openaiApiKeyStored: false }
        },
        isLoading: false,
        error: null,
        isInitialized: true,
        wasCorruptionRecovered: false,
        loadSettings: vi.fn(),
        updateLoggingLevel: vi.fn(),
        updatePreserveLineBreaks: vi.fn(),
        updateGitStatusPollingEnabled: vi.fn(),
        updateGitStatusPollingInterval: vi.fn(),
        resetSettings: vi.fn(),
        clearCorruptionFlag: vi.fn(),
        _handleSettingsChanged: vi.fn(),
        updateTranscriptionBackend: vi.fn()
      })

      render(<SettingsOverlay />)

      const heading = screen.getByRole('heading', { name: 'Git status' })
      expect(heading).toBeInTheDocument()
      expect(heading).toHaveClass('settings-section-title')
    })

    it('renders polling enabled checkbox with current value (checked)', () => {
      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false },
          gitStatus: { pollingEnabled: true, pollingInterval: 5000 },
          transcription: { backend: 'openai' as const, openaiApiKeyStored: false }
        },
        isLoading: false,
        error: null,
        isInitialized: true,
        wasCorruptionRecovered: false,
        loadSettings: vi.fn(),
        updateLoggingLevel: vi.fn(),
        updatePreserveLineBreaks: vi.fn(),
        updateGitStatusPollingEnabled: vi.fn(),
        updateGitStatusPollingInterval: vi.fn(),
        resetSettings: vi.fn(),
        clearCorruptionFlag: vi.fn(),
        _handleSettingsChanged: vi.fn(),
        updateTranscriptionBackend: vi.fn()
      })

      render(<SettingsOverlay />)

      const checkbox = screen.getByRole('checkbox', { name: 'Enable polling fallback' })
      expect(checkbox).toBeInTheDocument()
      expect(checkbox).toBeChecked()
    })

    it('renders polling enabled checkbox with current value (unchecked)', () => {
      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false },
          gitStatus: { pollingEnabled: false, pollingInterval: 5000 },
          transcription: { backend: 'openai' as const, openaiApiKeyStored: false }
        },
        isLoading: false,
        error: null,
        isInitialized: true,
        wasCorruptionRecovered: false,
        loadSettings: vi.fn(),
        updateLoggingLevel: vi.fn(),
        updatePreserveLineBreaks: vi.fn(),
        updateGitStatusPollingEnabled: vi.fn(),
        updateGitStatusPollingInterval: vi.fn(),
        resetSettings: vi.fn(),
        clearCorruptionFlag: vi.fn(),
        _handleSettingsChanged: vi.fn(),
        updateTranscriptionBackend: vi.fn()
      })

      render(<SettingsOverlay />)

      const checkbox = screen.getByRole('checkbox', { name: 'Enable polling fallback' })
      expect(checkbox).toBeInTheDocument()
      expect(checkbox).not.toBeChecked()
    })

    it('changing checkbox calls updateGitStatusPollingEnabled', () => {
      const mockUpdateGitStatusPollingEnabled = vi.fn()
      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false },
          gitStatus: { pollingEnabled: false, pollingInterval: 5000 },
          transcription: { backend: 'openai' as const, openaiApiKeyStored: false }
        },
        isLoading: false,
        error: null,
        isInitialized: true,
        wasCorruptionRecovered: false,
        loadSettings: vi.fn(),
        updateLoggingLevel: vi.fn(),
        updatePreserveLineBreaks: vi.fn(),
        updateGitStatusPollingEnabled: mockUpdateGitStatusPollingEnabled,
        updateGitStatusPollingInterval: vi.fn(),
        resetSettings: vi.fn(),
        clearCorruptionFlag: vi.fn(),
        _handleSettingsChanged: vi.fn(),
        updateTranscriptionBackend: vi.fn()
      })

      render(<SettingsOverlay />)

      const checkbox = screen.getByRole('checkbox', { name: 'Enable polling fallback' })
      fireEvent.click(checkbox)

      expect(mockUpdateGitStatusPollingEnabled).toHaveBeenCalledTimes(1)
      expect(mockUpdateGitStatusPollingEnabled).toHaveBeenCalledWith(true)
    })

    it('renders polling interval dropdown with current value', () => {
      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false },
          gitStatus: { pollingEnabled: true, pollingInterval: 7000 },
          transcription: { backend: 'openai' as const, openaiApiKeyStored: false }
        },
        isLoading: false,
        error: null,
        isInitialized: true,
        wasCorruptionRecovered: false,
        loadSettings: vi.fn(),
        updateLoggingLevel: vi.fn(),
        updatePreserveLineBreaks: vi.fn(),
        updateGitStatusPollingEnabled: vi.fn(),
        updateGitStatusPollingInterval: vi.fn(),
        resetSettings: vi.fn(),
        clearCorruptionFlag: vi.fn(),
        _handleSettingsChanged: vi.fn(),
        updateTranscriptionBackend: vi.fn()
      })

      render(<SettingsOverlay />)

      const dropdown = screen.getByRole('combobox', { name: 'Polling interval' })
      expect(dropdown).toBeInTheDocument()
      expect(dropdown).toHaveValue('7000')
    })

    it('polling interval dropdown displays all 4 options', () => {
      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false },
          gitStatus: { pollingEnabled: true, pollingInterval: 5000 },
          transcription: { backend: 'openai' as const, openaiApiKeyStored: false }
        },
        isLoading: false,
        error: null,
        isInitialized: true,
        wasCorruptionRecovered: false,
        loadSettings: vi.fn(),
        updateLoggingLevel: vi.fn(),
        updatePreserveLineBreaks: vi.fn(),
        updateGitStatusPollingEnabled: vi.fn(),
        updateGitStatusPollingInterval: vi.fn(),
        resetSettings: vi.fn(),
        clearCorruptionFlag: vi.fn(),
        _handleSettingsChanged: vi.fn(),
        updateTranscriptionBackend: vi.fn()
      })

      render(<SettingsOverlay />)

      const dropdown = screen.getByRole('combobox', { name: 'Polling interval' })
      const options = Array.from(dropdown.querySelectorAll('option'))

      expect(options).toHaveLength(4)
      expect(options[0]).toHaveTextContent('3s')
      expect(options[0]).toHaveValue('3000')
      expect(options[1]).toHaveTextContent('5s')
      expect(options[1]).toHaveValue('5000')
      expect(options[2]).toHaveTextContent('7s')
      expect(options[2]).toHaveValue('7000')
      expect(options[3]).toHaveTextContent('10s')
      expect(options[3]).toHaveValue('10000')
    })

    it('changing dropdown calls updateGitStatusPollingInterval', () => {
      const mockUpdateGitStatusPollingInterval = vi.fn()
      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false },
          gitStatus: { pollingEnabled: true, pollingInterval: 5000 },
          transcription: { backend: 'openai' as const, openaiApiKeyStored: false }
        },
        isLoading: false,
        error: null,
        isInitialized: true,
        wasCorruptionRecovered: false,
        loadSettings: vi.fn(),
        updateLoggingLevel: vi.fn(),
        updatePreserveLineBreaks: vi.fn(),
        updateGitStatusPollingEnabled: vi.fn(),
        updateGitStatusPollingInterval: mockUpdateGitStatusPollingInterval,
        resetSettings: vi.fn(),
        clearCorruptionFlag: vi.fn(),
        _handleSettingsChanged: vi.fn(),
        updateTranscriptionBackend: vi.fn()
      })

      render(<SettingsOverlay />)

      const dropdown = screen.getByRole('combobox', { name: 'Polling interval' })
      fireEvent.change(dropdown, { target: { value: '10000' } })

      expect(mockUpdateGitStatusPollingInterval).toHaveBeenCalledTimes(1)
      expect(mockUpdateGitStatusPollingInterval).toHaveBeenCalledWith(10000)
    })

    it('polling interval dropdown is disabled when polling is disabled', () => {
      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false },
          gitStatus: { pollingEnabled: false, pollingInterval: 5000 },
          transcription: { backend: 'openai' as const, openaiApiKeyStored: false }
        },
        isLoading: false,
        error: null,
        isInitialized: true,
        wasCorruptionRecovered: false,
        loadSettings: vi.fn(),
        updateLoggingLevel: vi.fn(),
        updatePreserveLineBreaks: vi.fn(),
        updateGitStatusPollingEnabled: vi.fn(),
        updateGitStatusPollingInterval: vi.fn(),
        resetSettings: vi.fn(),
        clearCorruptionFlag: vi.fn(),
        _handleSettingsChanged: vi.fn(),
        updateTranscriptionBackend: vi.fn()
      })

      render(<SettingsOverlay />)

      const dropdown = screen.getByRole('combobox', { name: 'Polling interval' })
      expect(dropdown).toBeDisabled()
    })

    it('polling interval dropdown is enabled when polling is enabled', () => {
      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false },
          gitStatus: { pollingEnabled: true, pollingInterval: 5000 },
          transcription: { backend: 'openai' as const, openaiApiKeyStored: false }
        },
        isLoading: false,
        error: null,
        isInitialized: true,
        wasCorruptionRecovered: false,
        loadSettings: vi.fn(),
        updateLoggingLevel: vi.fn(),
        updatePreserveLineBreaks: vi.fn(),
        updateGitStatusPollingEnabled: vi.fn(),
        updateGitStatusPollingInterval: vi.fn(),
        resetSettings: vi.fn(),
        clearCorruptionFlag: vi.fn(),
        _handleSettingsChanged: vi.fn(),
        updateTranscriptionBackend: vi.fn()
      })

      render(<SettingsOverlay />)

      const dropdown = screen.getByRole('combobox', { name: 'Polling interval' })
      expect(dropdown).not.toBeDisabled()
    })

    it('polling enabled checkbox is disabled when settings is null', () => {
      useGlobalSettingsStore.setState({
        settings: null,
        isLoading: false,
        error: null,
        isInitialized: false,
        wasCorruptionRecovered: false,
        loadSettings: vi.fn(),
        updateLoggingLevel: vi.fn(),
        updatePreserveLineBreaks: vi.fn(),
        updateGitStatusPollingEnabled: vi.fn(),
        updateGitStatusPollingInterval: vi.fn(),
        resetSettings: vi.fn(),
        clearCorruptionFlag: vi.fn(),
        _handleSettingsChanged: vi.fn(),
        updateTranscriptionBackend: vi.fn()
      })

      render(<SettingsOverlay />)

      const checkbox = screen.getByRole('checkbox', { name: 'Enable polling fallback' })
      expect(checkbox).toBeDisabled()
    })

    it('polling interval dropdown defaults to 5000 when settings is null', () => {
      useGlobalSettingsStore.setState({
        settings: null,
        isLoading: false,
        error: null,
        isInitialized: false,
        wasCorruptionRecovered: false,
        loadSettings: vi.fn(),
        updateLoggingLevel: vi.fn(),
        updatePreserveLineBreaks: vi.fn(),
        updateGitStatusPollingEnabled: vi.fn(),
        updateGitStatusPollingInterval: vi.fn(),
        resetSettings: vi.fn(),
        clearCorruptionFlag: vi.fn(),
        _handleSettingsChanged: vi.fn(),
        updateTranscriptionBackend: vi.fn()
      })

      render(<SettingsOverlay />)

      const dropdown = screen.getByRole('combobox', { name: 'Polling interval' })
      expect(dropdown).toHaveValue('5000')
    })
  })
})
