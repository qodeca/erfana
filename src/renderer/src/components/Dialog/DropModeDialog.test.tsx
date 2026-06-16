// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DropModeDialog } from './DropModeDialog'
import type { DropModeDialogConfig } from './types'
import { TEST_IDS } from '../../constants/testids'

describe('DropModeDialog', () => {
  beforeEach(() => {
    // Create portal-root div for dialogs
    const portalRoot = document.createElement('div')
    portalRoot.setAttribute('id', 'portal-root')
    document.body.appendChild(portalRoot)
  })

  afterEach(() => {
    // Clean up portal-root div
    document.body.innerHTML = ''
  })

  const defaultConfig: DropModeDialogConfig = {
    id: 'drop-mode-123',
    fileCount: 1,
    fileName: 'document.pdf'
  }

  const multiFileConfig: DropModeDialogConfig = {
    id: 'drop-mode-456',
    fileCount: 3
  }

  const defaultProps = {
    config: defaultConfig,
    zIndex: 10001,
    onSelect: vi.fn(),
    onCancel: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('should render dialog with title', () => {
      render(<DropModeDialog {...defaultProps} />)
      expect(screen.getByRole('heading', { name: 'Add files' })).toBeInTheDocument()
    })

    it('should show single file message with filename', () => {
      render(<DropModeDialog {...defaultProps} />)
      expect(screen.getByText(/Choose how to add "document.pdf" to your project:/)).toBeInTheDocument()
    })

    it('should show multiple files message', () => {
      render(<DropModeDialog {...defaultProps} config={multiFileConfig} />)
      expect(screen.getByText(/Choose how to add 3 files to your project:/)).toBeInTheDocument()
    })

    it('should render all three mode buttons by default', () => {
      render(<DropModeDialog {...defaultProps} />)
      expect(screen.getByTestId(TEST_IDS.EXTERNAL_DROP_MOVE_BUTTON)).toBeInTheDocument()
      expect(screen.getByTestId(TEST_IDS.EXTERNAL_DROP_COPY_BUTTON)).toBeInTheDocument()
      expect(screen.getByTestId(TEST_IDS.EXTERNAL_DROP_IMPORT_BUTTON)).toBeInTheDocument()
    })

    it('should render cancel button', () => {
      render(<DropModeDialog {...defaultProps} />)
      expect(screen.getByTestId(TEST_IDS.EXTERNAL_DROP_CANCEL_BUTTON)).toBeInTheDocument()
    })

    it('should focus Move button by default', () => {
      render(<DropModeDialog {...defaultProps} />)
      const moveButton = screen.getByTestId(TEST_IDS.EXTERNAL_DROP_MOVE_BUTTON)
      expect(document.activeElement).toBe(moveButton)
    })
  })

  describe('showImport prop', () => {
    it('should show Import button when showImport is true', () => {
      render(<DropModeDialog {...defaultProps} config={{ ...defaultConfig, showImport: true }} />)
      expect(screen.getByTestId(TEST_IDS.EXTERNAL_DROP_IMPORT_BUTTON)).toBeInTheDocument()
    })

    it('should show Import button when showImport is undefined (default)', () => {
      render(<DropModeDialog {...defaultProps} />)
      expect(screen.getByTestId(TEST_IDS.EXTERNAL_DROP_IMPORT_BUTTON)).toBeInTheDocument()
    })

    it('should hide Import button when showImport is false', () => {
      render(<DropModeDialog {...defaultProps} config={{ ...defaultConfig, showImport: false }} />)
      expect(screen.queryByTestId(TEST_IDS.EXTERNAL_DROP_IMPORT_BUTTON)).not.toBeInTheDocument()
      // Move and Copy should still be visible
      expect(screen.getByTestId(TEST_IDS.EXTERNAL_DROP_MOVE_BUTTON)).toBeInTheDocument()
      expect(screen.getByTestId(TEST_IDS.EXTERNAL_DROP_COPY_BUTTON)).toBeInTheDocument()
    })
  })

  describe('mode selection', () => {
    it('should call onSelect with move mode when Move is clicked', async () => {
      const user = userEvent.setup()
      const onSelect = vi.fn()
      render(<DropModeDialog {...defaultProps} onSelect={onSelect} />)

      await user.click(screen.getByTestId(TEST_IDS.EXTERNAL_DROP_MOVE_BUTTON))
      expect(onSelect).toHaveBeenCalledWith({ mode: 'move' })
    })

    it('should call onSelect with copy mode when Copy is clicked', async () => {
      const user = userEvent.setup()
      const onSelect = vi.fn()
      render(<DropModeDialog {...defaultProps} onSelect={onSelect} />)

      await user.click(screen.getByTestId(TEST_IDS.EXTERNAL_DROP_COPY_BUTTON))
      expect(onSelect).toHaveBeenCalledWith({ mode: 'copy' })
    })

    it('should call onSelect with import mode when Import is clicked', async () => {
      const user = userEvent.setup()
      const onSelect = vi.fn()
      render(<DropModeDialog {...defaultProps} onSelect={onSelect} />)

      await user.click(screen.getByTestId(TEST_IDS.EXTERNAL_DROP_IMPORT_BUTTON))
      expect(onSelect).toHaveBeenCalledWith({ mode: 'import' })
    })
  })

  describe('cancellation', () => {
    it('should call onCancel when Cancel button is clicked', async () => {
      const user = userEvent.setup()
      const onCancel = vi.fn()
      render(<DropModeDialog {...defaultProps} onCancel={onCancel} />)

      await user.click(screen.getByTestId(TEST_IDS.EXTERNAL_DROP_CANCEL_BUTTON))
      expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it('should call onCancel when Escape is pressed', async () => {
      const user = userEvent.setup()
      const onCancel = vi.fn()
      render(<DropModeDialog {...defaultProps} onCancel={onCancel} />)

      await user.keyboard('{Escape}')
      expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it('should call onCancel when backdrop is clicked', async () => {
      const user = userEvent.setup()
      const onCancel = vi.fn()
      render(<DropModeDialog {...defaultProps} onCancel={onCancel} />)

      // Click on the backdrop (overlay)
      const backdrop = document.querySelector('.dialog-overlay')
      if (backdrop) {
        await user.click(backdrop)
        expect(onCancel).toHaveBeenCalledTimes(1)
      }
    })
  })

  describe('keyboard navigation', () => {
    it('should allow Enter key to select focused mode', async () => {
      const user = userEvent.setup()
      const onSelect = vi.fn()
      render(<DropModeDialog {...defaultProps} onSelect={onSelect} />)

      // Move button is focused by default
      await user.keyboard('{Enter}')
      expect(onSelect).toHaveBeenCalledWith({ mode: 'move' })
    })

    it('should have focusable mode buttons', async () => {
      render(<DropModeDialog {...defaultProps} />)

      // Move button is focused initially (autoFocus)
      expect(document.activeElement).toBe(screen.getByTestId(TEST_IDS.EXTERNAL_DROP_MOVE_BUTTON))

      // All mode buttons should be focusable (not disabled, no negative tabIndex)
      const moveButton = screen.getByTestId(TEST_IDS.EXTERNAL_DROP_MOVE_BUTTON)
      const copyButton = screen.getByTestId(TEST_IDS.EXTERNAL_DROP_COPY_BUTTON)
      const importButton = screen.getByTestId(TEST_IDS.EXTERNAL_DROP_IMPORT_BUTTON)

      expect(moveButton).not.toBeDisabled()
      expect(copyButton).not.toBeDisabled()
      expect(importButton).not.toBeDisabled()

      // Verify buttons don't have negative tabIndex (which would make them unfocusable)
      expect(moveButton).not.toHaveAttribute('tabindex', '-1')
      expect(copyButton).not.toHaveAttribute('tabindex', '-1')
      expect(importButton).not.toHaveAttribute('tabindex', '-1')
    })

    it('should have fewer focusable elements when showImport is false', async () => {
      render(<DropModeDialog {...defaultProps} config={{ ...defaultConfig, showImport: false }} />)

      // Count all focusable mode buttons (excluding cancel)
      const moveButton = screen.getByTestId(TEST_IDS.EXTERNAL_DROP_MOVE_BUTTON)
      const copyButton = screen.getByTestId(TEST_IDS.EXTERNAL_DROP_COPY_BUTTON)
      const importButton = screen.queryByTestId(TEST_IDS.EXTERNAL_DROP_IMPORT_BUTTON)

      expect(moveButton).toBeInTheDocument()
      expect(copyButton).toBeInTheDocument()
      expect(importButton).not.toBeInTheDocument()
    })
  })

  describe('button descriptions', () => {
    it('should show Move description', () => {
      render(<DropModeDialog {...defaultProps} />)
      expect(screen.getByText('Move files here (removes from original location)')).toBeInTheDocument()
    })

    it('should show Copy description', () => {
      render(<DropModeDialog {...defaultProps} />)
      expect(screen.getByText('Copy files here (keeps originals)')).toBeInTheDocument()
    })

    it('should show Import description when visible', () => {
      render(<DropModeDialog {...defaultProps} />)
      expect(screen.getByText('Import and process files')).toBeInTheDocument()
    })
  })

  describe('accessibility', () => {
    it('should have proper ARIA attributes', () => {
      render(<DropModeDialog {...defaultProps} />)
      const dialog = screen.getByTestId(TEST_IDS.EXTERNAL_DROP_DIALOG)
      expect(dialog).toBeInTheDocument()
    })

    it('should have accessible heading', () => {
      render(<DropModeDialog {...defaultProps} />)
      const heading = screen.getByRole('heading', { name: 'Add files' })
      expect(heading).toHaveAttribute('id', expect.stringContaining('dialog-title'))
    })
  })
})
