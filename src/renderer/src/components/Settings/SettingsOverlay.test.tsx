// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
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
 * - Transcription section (31 tests)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
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

    // Mock window.api for component's useEffect hooks
    ;(window as any).api = {
      transcription: {
        hasApiKey: vi.fn().mockResolvedValue(false),
        setApiKey: vi.fn().mockResolvedValue({ success: true }),
        clearApiKey: vi.fn().mockResolvedValue({ success: true })
      },
      whisper: {
        ensureBinary: vi.fn().mockResolvedValue({ success: true, path: '/path/to/binary' }),
        ensureModel: vi.fn().mockResolvedValue({ success: true, path: '/path/to/model' }),
        listModels: vi.fn().mockResolvedValue({ success: true, models: [] }),
        deleteModel: vi.fn().mockResolvedValue({ success: true }),
        onDownloadProgress: vi.fn().mockReturnValue(vi.fn())
      },
      logging: {
        getLogsDir: vi.fn().mockResolvedValue('/Users/test/.erfana/logs'),
        openLogsFolder: vi.fn().mockResolvedValue('')
      },
      utils: {
        getPlatform: vi.fn().mockReturnValue('darwin'),
        getArch: vi.fn().mockReturnValue('arm64')
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
    // The production component sets focus via `setTimeout(() => ..., 10)` to
    // wait for overlay mount. Previous wall-clock `waitFor({ timeout: 100 })`
    // assertions were Windows-flaky — worker pre-emption could push the 10 ms
    // timer past the 100 ms budget. Fake timers + `vi.advanceTimersByTime(11)`
    // make the assertion deterministic; `act()` wrapping is defensive against
    // React 18 microtask scheduling around the focus call.
    beforeEach(() => {
      useSettingsStore.setState({ isOpen: true })
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('focuses close button when opened', () => {
      render(<SettingsOverlay />)

      const closeButton = screen.getByRole('button', { name: 'Close settings' })

      // Deterministically advance past the component's 10 ms FOCUS_DELAY_MS.
      act(() => {
        vi.advanceTimersByTime(11)
      })

      expect(closeButton).toHaveFocus()
    })

    it('restores focus when closed', () => {
      // Create a button to have focus before opening overlay
      const testButton = document.createElement('button')
      testButton.textContent = 'Test Button'
      document.body.appendChild(testButton)
      testButton.focus()

      expect(document.activeElement).toBe(testButton)

      const { rerender } = render(<SettingsOverlay />)

      // Advance past the focus-on-open timer.
      act(() => {
        vi.advanceTimersByTime(11)
      })

      const closeButton = screen.getByRole('button', { name: 'Close settings' })
      expect(closeButton).toHaveFocus()

      // Close the overlay — cleanup runs synchronously on re-render.
      useSettingsStore.setState({ isOpen: false })
      rerender(<SettingsOverlay />)

      // Flush any close-side timers (harmless no-op if none registered).
      act(() => {
        vi.advanceTimersByTime(11)
      })

      expect(document.activeElement).toBe(testButton)

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
          transcription: { backend: 'openai' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
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
        transcription: { backend: 'openai' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
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
          transcription: { backend: 'openai' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
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
          transcription: { backend: 'openai' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
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
          transcription: { backend: 'openai' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
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
          transcription: { backend: 'openai' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
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
          transcription: { backend: 'openai' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
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
          transcription: { backend: 'openai' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
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
          transcription: { backend: 'openai' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
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
          transcription: { backend: 'openai' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
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
          transcription: { backend: 'openai' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
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
          transcription: { backend: 'openai' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
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
          transcription: { backend: 'openai' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
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
          transcription: { backend: 'openai' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
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
          transcription: { backend: 'openai' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
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
          transcription: { backend: 'openai' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
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
          transcription: { backend: 'openai' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
      })

      render(<SettingsOverlay />)

      const dropdown = screen.getByRole('combobox', { name: 'Polling interval' })
      expect(dropdown).toHaveValue('5000')
    })
  })

  describe('Transcription section', () => {
    beforeEach(() => {
      useSettingsStore.setState({ isOpen: true })
    })

    it('renders transcription section with heading "Transcription"', () => {
      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false },
          gitStatus: { pollingEnabled: true, pollingInterval: 5000 },
          transcription: { backend: 'openai' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
      })

      render(<SettingsOverlay />)

      const heading = screen.getByRole('heading', { name: 'Transcription' })
      expect(heading).toBeInTheDocument()
      expect(heading).toHaveClass('settings-section-title')
    })

    it('backend dropdown renders with "openai" selected by default', () => {
      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false },
          gitStatus: { pollingEnabled: true, pollingInterval: 5000 },
          transcription: { backend: 'openai' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
      })

      render(<SettingsOverlay />)

      const dropdown = screen.getByTestId('settings-select-transcription-backend')
      expect(dropdown).toBeInTheDocument()
      expect(dropdown).toHaveValue('openai')
    })

    it('changing backend to "local" shows whisper model UI and hides API key UI', () => {
      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false },
          gitStatus: { pollingEnabled: true, pollingInterval: 5000 },
          transcription: { backend: 'local' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
      })

      render(<SettingsOverlay />)

      expect(screen.getByTestId('settings-select-whisper-model')).toBeInTheDocument()
      expect(screen.queryByTestId('settings-input-api-key')).not.toBeInTheDocument()
      expect(screen.queryByTestId('settings-btn-clear-api-key')).not.toBeInTheDocument()
    })

    it('changing backend to "openai" shows API key UI and hides whisper model UI', () => {
      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false },
          gitStatus: { pollingEnabled: true, pollingInterval: 5000 },
          transcription: { backend: 'openai' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
      })

      render(<SettingsOverlay />)

      expect(screen.queryByTestId('settings-select-whisper-model')).not.toBeInTheDocument()
      expect(screen.queryByTestId('settings-btn-whisper-model')).not.toBeInTheDocument()
    })

    it('API key input renders when hasApiKey is false and backend is "openai"', async () => {
      ;(window as any).api.transcription.hasApiKey = vi.fn().mockResolvedValue(false)

      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false },
          gitStatus: { pollingEnabled: true, pollingInterval: 5000 },
          transcription: { backend: 'openai' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
      })

      render(<SettingsOverlay />)

      await waitFor(() => {
        expect(screen.getByTestId('settings-input-api-key')).toBeInTheDocument()
      })
      expect(screen.queryByTestId('settings-btn-clear-api-key')).not.toBeInTheDocument()
    })

    it('"Remove key" button shows when hasApiKey is true and backend is "openai"', async () => {
      ;(window as any).api.transcription.hasApiKey = vi.fn().mockResolvedValue(true)

      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false },
          gitStatus: { pollingEnabled: true, pollingInterval: 5000 },
          transcription: { backend: 'openai' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
      })

      render(<SettingsOverlay />)

      await waitFor(() => {
        expect(screen.getByTestId('settings-btn-clear-api-key')).toBeInTheDocument()
      })
      expect(screen.queryByTestId('settings-input-api-key')).not.toBeInTheDocument()
    })

    it('whisper model dropdown renders when backend is "local"', () => {
      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false },
          gitStatus: { pollingEnabled: true, pollingInterval: 5000 },
          transcription: { backend: 'local' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
      })

      render(<SettingsOverlay />)

      const whisperDropdown = screen.getByTestId('settings-select-whisper-model')
      expect(whisperDropdown).toBeInTheDocument()
      expect(whisperDropdown).toHaveValue('base')
    })

    it('"Download model" button shows when model is not installed and backend is "local"', async () => {
      ;(window as any).api.whisper.listModels = vi.fn().mockResolvedValue({
        success: true,
        models: [{ name: 'base', size: 142000000, installed: false }]
      })

      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false },
          gitStatus: { pollingEnabled: true, pollingInterval: 5000 },
          transcription: { backend: 'local' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
      })

      render(<SettingsOverlay />)

      await waitFor(() => {
        expect(screen.getByTestId('settings-btn-whisper-model')).toBeInTheDocument()
      })
      expect(screen.getByTestId('settings-btn-whisper-model')).toHaveTextContent('Download model')
    })

    it('model status shows "Ready" when model is installed and backend is "local"', async () => {
      ;(window as any).api.whisper.listModels = vi.fn().mockResolvedValue({
        success: true,
        models: [{ name: 'base', size: 142000000, installed: true }]
      })

      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false },
          gitStatus: { pollingEnabled: true, pollingInterval: 5000 },
          transcription: { backend: 'local' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
      })

      render(<SettingsOverlay />)

      await waitFor(() => {
        expect(screen.getByTestId('settings-whisper-model-status')).toHaveTextContent('Ready')
      })
      expect(screen.queryByTestId('settings-btn-whisper-model')).not.toBeInTheDocument()
    })

    it('local option is ENABLED on Windows x64 (Phase 4 Windows parity)', () => {
      ;(window as any).api.utils.getPlatform = vi.fn().mockReturnValue('win32')
      ;(window as any).api.utils.getArch = vi.fn().mockReturnValue('x64')

      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false },
          gitStatus: { pollingEnabled: true, pollingInterval: 5000 },
          transcription: { backend: 'openai' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
      })

      render(<SettingsOverlay />)

      const backendDropdown = screen.getByTestId('settings-select-transcription-backend')
      const localOption = Array.from(backendDropdown.querySelectorAll('option')).find(
        (opt) => opt.value === 'local'
      )

      expect(localOption).toBeInTheDocument()
      expect(localOption).toHaveTextContent('Local (whisper.cpp)')
      expect(localOption).not.toBeDisabled()
    })

    it('local option is disabled on Windows ARM64 with ARM64-specific copy', () => {
      ;(window as any).api.utils.getPlatform = vi.fn().mockReturnValue('win32')
      ;(window as any).api.utils.getArch = vi.fn().mockReturnValue('arm64')

      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false },
          gitStatus: { pollingEnabled: true, pollingInterval: 5000 },
          transcription: { backend: 'openai' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
      })

      render(<SettingsOverlay />)

      const backendDropdown = screen.getByTestId('settings-select-transcription-backend')
      const localOption = Array.from(backendDropdown.querySelectorAll('option')).find(
        (opt) => opt.value === 'local'
      )

      expect(localOption).toBeInTheDocument()
      expect(localOption).toHaveTextContent('ARM64 not supported')
      expect(localOption).toBeDisabled()
    })

    it('local option is disabled on Linux with generic copy', () => {
      ;(window as any).api.utils.getPlatform = vi.fn().mockReturnValue('linux')
      ;(window as any).api.utils.getArch = vi.fn().mockReturnValue('x64')

      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false },
          gitStatus: { pollingEnabled: true, pollingInterval: 5000 },
          transcription: { backend: 'openai' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
      })

      render(<SettingsOverlay />)

      const backendDropdown = screen.getByTestId('settings-select-transcription-backend')
      const localOption = Array.from(backendDropdown.querySelectorAll('option')).find(
        (opt) => opt.value === 'local'
      )

      expect(localOption).toBeInTheDocument()
      expect(localOption).toHaveTextContent('macOS / Windows x64 only')
      expect(localOption).toBeDisabled()
    })

    it('changing backend dropdown calls updateTranscriptionBackend', () => {
      const mockUpdateTranscriptionBackend = vi.fn()

      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false },
          gitStatus: { pollingEnabled: true, pollingInterval: 5000 },
          transcription: { backend: 'openai' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
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
        updateTranscriptionBackend: mockUpdateTranscriptionBackend,
        updateWhisperModel: vi.fn()
      })

      render(<SettingsOverlay />)

      const dropdown = screen.getByTestId('settings-select-transcription-backend')
      fireEvent.change(dropdown, { target: { value: 'local' } })

      expect(mockUpdateTranscriptionBackend).toHaveBeenCalledWith('local')
    })

    it('changing whisper model dropdown calls updateWhisperModel', () => {
      const mockUpdateWhisperModel = vi.fn()

      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false },
          gitStatus: { pollingEnabled: true, pollingInterval: 5000 },
          transcription: { backend: 'local' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: mockUpdateWhisperModel
      })

      render(<SettingsOverlay />)

      const dropdown = screen.getByTestId('settings-select-whisper-model')
      fireEvent.change(dropdown, { target: { value: 'small' } })

      expect(mockUpdateWhisperModel).toHaveBeenCalledWith('small')
    })

    it('clicking "Download model" calls ensureBinary and ensureModel', async () => {
      ;(window as any).api.whisper.listModels = vi.fn().mockResolvedValue({
        success: true,
        models: [{ name: 'base', size: 142000000, installed: false }]
      })

      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false },
          gitStatus: { pollingEnabled: true, pollingInterval: 5000 },
          transcription: { backend: 'local' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
      })

      render(<SettingsOverlay />)

      await waitFor(() => {
        expect(screen.getByTestId('settings-btn-whisper-model')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('settings-btn-whisper-model'))

      await waitFor(() => {
        expect((window as any).api.whisper.ensureBinary).toHaveBeenCalled()
      })
      await waitFor(() => {
        expect((window as any).api.whisper.ensureModel).toHaveBeenCalledWith('base')
      })
    })

    it('download progress shows percentage in status and "Downloading..." on button', async () => {
      let progressCallback: ((progress: { percent: number; downloadedBytes: number; totalBytes: number }) => void) | undefined
      ;(window as any).api.whisper.onDownloadProgress = vi.fn().mockImplementation((cb: any) => {
        progressCallback = cb
        return vi.fn()
      })
      ;(window as any).api.whisper.listModels = vi.fn().mockResolvedValue({
        success: true,
        models: [{ name: 'base', size: 142000000, installed: false }]
      })
      // Make ensureBinary return a promise that won't resolve during the test
      ;(window as any).api.whisper.ensureBinary = vi.fn().mockReturnValue(new Promise(() => {}))

      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false },
          gitStatus: { pollingEnabled: true, pollingInterval: 5000 },
          transcription: { backend: 'local' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
      })

      render(<SettingsOverlay />)

      await waitFor(() => {
        expect(screen.getByTestId('settings-btn-whisper-model')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('settings-btn-whisper-model'))

      // Button should show "Downloading..."
      await waitFor(() => {
        expect(screen.getByTestId('settings-btn-whisper-model')).toHaveTextContent('Downloading...')
      })

      // Trigger progress callback
      progressCallback?.({ percent: 42, downloadedBytes: 59640000, totalBytes: 142000000 })

      await waitFor(() => {
        expect(screen.getByTestId('settings-whisper-model-status')).toHaveTextContent('Downloading... (42%)')
      })
    })

    it('model status shows "Model not downloaded" when model is not installed', async () => {
      ;(window as any).api.whisper.listModels = vi.fn().mockResolvedValue({
        success: true,
        models: [{ name: 'base', size: 142000000, installed: false }]
      })

      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false },
          gitStatus: { pollingEnabled: true, pollingInterval: 5000 },
          transcription: { backend: 'local' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
      })

      render(<SettingsOverlay />)

      await waitFor(() => {
        expect(screen.getByTestId('settings-whisper-model-status')).toHaveTextContent('Model not downloaded')
      })
    })

    it('API key input blur saves key via IPC', async () => {
      ;(window as any).api.transcription.hasApiKey = vi.fn().mockResolvedValue(false)

      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false },
          gitStatus: { pollingEnabled: true, pollingInterval: 5000 },
          transcription: { backend: 'openai' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
      })

      render(<SettingsOverlay />)

      await waitFor(() => {
        expect(screen.getByTestId('settings-input-api-key')).toBeInTheDocument()
      })

      const input = screen.getByTestId('settings-input-api-key')
      fireEvent.blur(input, { target: { value: 'sk-testkey12345678901234567890' } })

      await waitFor(() => {
        expect((window as any).api.transcription.setApiKey).toHaveBeenCalledWith('sk-testkey12345678901234567890')
      })
    })

    it('API key shorter than 8 characters is silently rejected', async () => {
      ;(window as any).api.transcription.hasApiKey = vi.fn().mockResolvedValue(false)

      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false },
          gitStatus: { pollingEnabled: true, pollingInterval: 5000 },
          transcription: { backend: 'openai' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
      })

      render(<SettingsOverlay />)

      await waitFor(() => {
        expect(screen.getByTestId('settings-input-api-key')).toBeInTheDocument()
      })

      const input = screen.getByTestId('settings-input-api-key')
      fireEvent.blur(input, { target: { value: 'short' } })

      // Should not call setApiKey for keys shorter than 8 characters
      expect((window as any).api.transcription.setApiKey).not.toHaveBeenCalled()
    })

    it('"Remove key" click calls clearApiKey', async () => {
      ;(window as any).api.transcription.hasApiKey = vi.fn().mockResolvedValue(true)

      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false },
          gitStatus: { pollingEnabled: true, pollingInterval: 5000 },
          transcription: { backend: 'openai' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
      })

      render(<SettingsOverlay />)

      await waitFor(() => {
        expect(screen.getByTestId('settings-btn-clear-api-key')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('settings-btn-clear-api-key'))

      await waitFor(() => {
        expect((window as any).api.transcription.clearApiKey).toHaveBeenCalled()
      })
    })

    it('backend dropdown is disabled when settings is null', () => {
      useGlobalSettingsStore.setState({
        settings: null as unknown as GlobalSettings,
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
      })

      render(<SettingsOverlay />)

      const dropdown = screen.getByTestId('settings-select-transcription-backend')
      expect(dropdown).toBeDisabled()
    })

    it('whisper model dropdown is disabled during download', async () => {
      ;(window as any).api.whisper.listModels = vi.fn().mockResolvedValue({
        success: true,
        models: [{ name: 'base', size: 142000000, installed: false }]
      })
      // Never-resolving promise keeps download in progress
      ;(window as any).api.whisper.ensureBinary = vi.fn().mockReturnValue(new Promise(() => {}))

      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false },
          gitStatus: { pollingEnabled: true, pollingInterval: 5000 },
          transcription: { backend: 'local' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
      })

      render(<SettingsOverlay />)

      await waitFor(() => {
        expect(screen.getByTestId('settings-btn-whisper-model')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('settings-btn-whisper-model'))

      await waitFor(() => {
        expect(screen.getByTestId('settings-select-whisper-model')).toBeDisabled()
      })
    })

    it('local option is enabled and shows "Local (whisper.cpp)" on macOS', () => {
      ;(window as any).api.utils.getPlatform = vi.fn().mockReturnValue('darwin')

      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false },
          gitStatus: { pollingEnabled: true, pollingInterval: 5000 },
          transcription: { backend: 'openai' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
      })

      render(<SettingsOverlay />)

      const backendDropdown = screen.getByTestId('settings-select-transcription-backend')
      const localOption = Array.from(backendDropdown.querySelectorAll('option')).find(
        (opt) => opt.value === 'local'
      )

      expect(localOption).toBeInTheDocument()
      expect(localOption).toHaveTextContent('Local (whisper.cpp)')
      expect(localOption).not.toBeDisabled()
    })

    it('download failure shows inline error message', async () => {
      ;(window as any).api.whisper.listModels = vi.fn().mockResolvedValue({
        success: true,
        models: [{ name: 'base', size: 142000000, installed: false }]
      })
      ;(window as any).api.whisper.ensureBinary = vi.fn().mockRejectedValue(new Error('Network error'))

      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false },
          gitStatus: { pollingEnabled: true, pollingInterval: 5000 },
          transcription: { backend: 'local' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
      })

      render(<SettingsOverlay />)

      await waitFor(() => {
        expect(screen.getByTestId('settings-btn-whisper-model')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('settings-btn-whisper-model'))

      await waitFor(() => {
        expect(screen.getByTestId('settings-whisper-download-error')).toBeInTheDocument()
      })
      expect(screen.getByTestId('settings-whisper-download-error')).toHaveTextContent('Network error')
    })

    it('ensureBinary succeeds but ensureModel returns { success: false } shows error', async () => {
      ;(window as any).api.whisper.listModels = vi.fn().mockResolvedValue({
        success: true,
        models: [{ name: 'base', size: 142000000, installed: false }]
      })
      ;(window as any).api.whisper.ensureBinary = vi.fn().mockResolvedValue({ success: true, path: '/path/to/binary' })
      ;(window as any).api.whisper.ensureModel = vi.fn().mockResolvedValue({ success: false, error: 'Model download failed' })

      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false },
          gitStatus: { pollingEnabled: true, pollingInterval: 5000 },
          transcription: { backend: 'local' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
      })

      render(<SettingsOverlay />)

      await waitFor(() => {
        expect(screen.getByTestId('settings-btn-whisper-model')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('settings-btn-whisper-model'))

      await waitFor(() => {
        expect(screen.getByTestId('settings-whisper-download-error')).toHaveTextContent('Model download failed')
      })
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to download whisper model',
        expect.objectContaining({ error: 'Model download failed' })
      )
    })

    it('ensureModel returns { success: false } without error field shows fallback message', async () => {
      ;(window as any).api.whisper.listModels = vi.fn().mockResolvedValue({
        success: true,
        models: [{ name: 'base', size: 142000000, installed: false }]
      })
      ;(window as any).api.whisper.ensureBinary = vi.fn().mockResolvedValue({ success: true, path: '/path/to/binary' })
      ;(window as any).api.whisper.ensureModel = vi.fn().mockResolvedValue({ success: false })

      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false },
          gitStatus: { pollingEnabled: true, pollingInterval: 5000 },
          transcription: { backend: 'local' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
      })

      render(<SettingsOverlay />)

      await waitFor(() => {
        expect(screen.getByTestId('settings-btn-whisper-model')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('settings-btn-whisper-model'))

      await waitFor(() => {
        expect(screen.getByTestId('settings-whisper-download-error')).toHaveTextContent('Download failed')
      })
    })

    it('download error clears when whisper model dropdown changes', async () => {
      ;(window as any).api.whisper.listModels = vi.fn().mockResolvedValue({
        success: true,
        models: [{ name: 'base', size: 142000000, installed: false }]
      })
      ;(window as any).api.whisper.ensureBinary = vi.fn().mockRejectedValue(new Error('Network error'))

      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false },
          gitStatus: { pollingEnabled: true, pollingInterval: 5000 },
          transcription: { backend: 'local' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
      })

      render(<SettingsOverlay />)

      await waitFor(() => {
        expect(screen.getByTestId('settings-btn-whisper-model')).toBeInTheDocument()
      })

      // Trigger download failure
      fireEvent.click(screen.getByTestId('settings-btn-whisper-model'))

      await waitFor(() => {
        expect(screen.getByTestId('settings-whisper-download-error')).toBeInTheDocument()
      })

      // Change whisper model – error should clear
      const dropdown = screen.getByTestId('settings-select-whisper-model')
      fireEvent.change(dropdown, { target: { value: 'small' } })

      expect(screen.queryByTestId('settings-whisper-download-error')).not.toBeInTheDocument()
    })

    it('download error clears on backend switch', async () => {
      ;(window as any).api.whisper.listModels = vi.fn().mockResolvedValue({
        success: true,
        models: [{ name: 'base', size: 142000000, installed: false }]
      })
      ;(window as any).api.whisper.ensureBinary = vi.fn().mockRejectedValue(new Error('Network error'))

      const mockUpdateTranscriptionBackend = vi.fn()

      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false },
          gitStatus: { pollingEnabled: true, pollingInterval: 5000 },
          transcription: { backend: 'local' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
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
        updateTranscriptionBackend: mockUpdateTranscriptionBackend,
        updateWhisperModel: vi.fn()
      })

      render(<SettingsOverlay />)

      await waitFor(() => {
        expect(screen.getByTestId('settings-btn-whisper-model')).toBeInTheDocument()
      })

      // Trigger download failure
      fireEvent.click(screen.getByTestId('settings-btn-whisper-model'))

      await waitFor(() => {
        expect(screen.getByTestId('settings-whisper-download-error')).toBeInTheDocument()
      })

      // Switch backend to openai – downloadError should be cleared
      const backendDropdown = screen.getByTestId('settings-select-transcription-backend')
      fireEvent.change(backendDropdown, { target: { value: 'openai' } })

      expect(mockUpdateTranscriptionBackend).toHaveBeenCalledWith('openai')
      // The local section unmounts on backend switch, but downloadError state was cleared
      // by the onChange handler before the re-render
      expect(screen.queryByTestId('settings-whisper-download-error')).not.toBeInTheDocument()
    })

    it('API key with exactly 8 characters is accepted', async () => {
      ;(window as any).api.transcription.hasApiKey = vi.fn().mockResolvedValue(false)

      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false },
          gitStatus: { pollingEnabled: true, pollingInterval: 5000 },
          transcription: { backend: 'openai' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
      })

      render(<SettingsOverlay />)

      await waitFor(() => {
        expect(screen.getByTestId('settings-input-api-key')).toBeInTheDocument()
      })

      const input = screen.getByTestId('settings-input-api-key')
      fireEvent.blur(input, { target: { value: '12345678' } })

      await waitFor(() => {
        expect((window as any).api.transcription.setApiKey).toHaveBeenCalledWith('12345678')
      })
    })

    it('API key with 7 characters is rejected', async () => {
      ;(window as any).api.transcription.hasApiKey = vi.fn().mockResolvedValue(false)

      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false },
          gitStatus: { pollingEnabled: true, pollingInterval: 5000 },
          transcription: { backend: 'openai' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
      })

      render(<SettingsOverlay />)

      await waitFor(() => {
        expect(screen.getByTestId('settings-input-api-key')).toBeInTheDocument()
      })

      const input = screen.getByTestId('settings-input-api-key')
      fireEvent.blur(input, { target: { value: '1234567' } })

      expect((window as any).api.transcription.setApiKey).not.toHaveBeenCalled()
    })

    it('API key with whitespace-only is rejected', async () => {
      ;(window as any).api.transcription.hasApiKey = vi.fn().mockResolvedValue(false)

      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false },
          gitStatus: { pollingEnabled: true, pollingInterval: 5000 },
          transcription: { backend: 'openai' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
      })

      render(<SettingsOverlay />)

      await waitFor(() => {
        expect(screen.getByTestId('settings-input-api-key')).toBeInTheDocument()
      })

      const input = screen.getByTestId('settings-input-api-key')
      fireEvent.blur(input, { target: { value: '        ' } })

      expect((window as any).api.transcription.setApiKey).not.toHaveBeenCalled()
    })

    it('download progress at boundary values (0% and 100%)', async () => {
      let progressCallback: ((progress: { percent: number; downloadedBytes: number; totalBytes: number }) => void) | undefined
      ;(window as any).api.whisper.onDownloadProgress = vi.fn().mockImplementation((cb: any) => {
        progressCallback = cb
        return vi.fn()
      })
      ;(window as any).api.whisper.listModels = vi.fn().mockResolvedValue({
        success: true,
        models: [{ name: 'base', size: 142000000, installed: false }]
      })
      // Never-resolving promise keeps download in progress
      ;(window as any).api.whisper.ensureBinary = vi.fn().mockReturnValue(new Promise(() => {}))

      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false },
          gitStatus: { pollingEnabled: true, pollingInterval: 5000 },
          transcription: { backend: 'local' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
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
        updateTranscriptionBackend: vi.fn(),
        updateWhisperModel: vi.fn()
      })

      render(<SettingsOverlay />)

      await waitFor(() => {
        expect(screen.getByTestId('settings-btn-whisper-model')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('settings-btn-whisper-model'))

      // Wait for downloading state
      await waitFor(() => {
        expect(screen.getByTestId('settings-btn-whisper-model')).toHaveTextContent('Downloading...')
      })

      // Test 0%
      progressCallback?.({ percent: 0, downloadedBytes: 0, totalBytes: 142000000 })

      await waitFor(() => {
        expect(screen.getByTestId('settings-whisper-model-status')).toHaveTextContent('Downloading... (0%)')
      })

      // Test 100%
      progressCallback?.({ percent: 100, downloadedBytes: 142000000, totalBytes: 142000000 })

      await waitFor(() => {
        expect(screen.getByTestId('settings-whisper-model-status')).toHaveTextContent('Downloading... (100%)')
      })
    })

    it('invalid backend value is rejected by Zod and logs warning', () => {
      const mockUpdateTranscriptionBackend = vi.fn()

      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false },
          gitStatus: { pollingEnabled: true, pollingInterval: 5000 },
          transcription: { backend: 'openai' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
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
        updateTranscriptionBackend: mockUpdateTranscriptionBackend,
        updateWhisperModel: vi.fn()
      })

      render(<SettingsOverlay />)

      // jsdom resets <select> to "" when value doesn't match any option
      const dropdown = screen.getByTestId('settings-select-transcription-backend')
      fireEvent.change(dropdown, { target: { value: 'invalid_backend' } })

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Invalid transcription backend selected',
        expect.objectContaining({ value: expect.any(String) })
      )
      expect(mockUpdateTranscriptionBackend).not.toHaveBeenCalled()
    })
  })
})
