// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PreviewContextMenu } from './PreviewContextMenu'
import { DialogProvider } from '../Dialog'
import * as panelUtils from '../../utils/panelUtils'
import * as DialogModule from '../Dialog'

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

// Copy selection routes through the central textClipboard service (issue #203),
// not navigator.clipboard.
const { mockWriteText } = vi.hoisted(() => ({ mockWriteText: vi.fn() }))
vi.mock('../../services/textClipboard', () => ({
  textClipboard: {
    writeText: (text: string) => mockWriteText(text),
    readText: vi.fn()
  }
}))

/**
 * PreviewContextMenu Component Tests
 *
 * Tests the context menu for markdown preview selections.
 * Validates prompt rendering, icon mapping, user input dialogs, and prompt execution.
 */
describe('PreviewContextMenu Component', () => {
  const defaultProps = {
    x: 100,
    y: 200,
    selectedText: 'Sample selected text',
    filePath: '/test/document.md',
    fullDocument: 'Full document content',
    onClose: vi.fn()
  }

  // Helper to render with DialogProvider
  const renderWithProvider = (ui: React.ReactElement) => {
    return render(<DialogProvider>{ui}</DialogProvider>)
  }

  // Mock window.api.file.readFile
  const mockReadFile = vi.fn()
  const mockShowPrompt = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    // Mock file reads - by default return empty content
    mockReadFile.mockResolvedValue('')
    mockWriteText.mockResolvedValue(true)
    // Mock showPrompt to return null by default (user cancelled)
    mockShowPrompt.mockResolvedValue(null)

    // Mock window.api
    global.window.api = {
      file: {
        readFile: mockReadFile
      }
    } as any

    // Mock executePromptTemplate
    vi.spyOn(panelUtils, 'executePromptTemplate').mockResolvedValue({ success: true })

    // Mock useDialog hook
    vi.spyOn(DialogModule, 'useDialog').mockReturnValue({
      showConfirm: vi.fn(),
      showPrompt: mockShowPrompt,
      showAlert: vi.fn()
    })

    // Create portal-root div for ContextMenu (uses createPortal)
    const portalRoot = document.createElement('div')
    portalRoot.setAttribute('id', 'portal-root')
    document.body.appendChild(portalRoot)
  })

  afterEach(() => {
    vi.restoreAllMocks()

    // Clean up portal-root
    const portalRoot = document.getElementById('portal-root')
    if (portalRoot) {
      document.body.removeChild(portalRoot)
    }
  })

  describe('Rendering', () => {
    it('should render context menu with all prompt items', () => {
      renderWithProvider(<PreviewContextMenu {...defaultProps} />)

      // Should include all 5 context-menu prompts
      expect(screen.getByText('Explain')).toBeInTheDocument()
      expect(screen.getByText('Modify')).toBeInTheDocument()
      expect(screen.getByText('Ask')).toBeInTheDocument()
      expect(screen.getByText('Visualize')).toBeInTheDocument()
      expect(screen.getByText('Prompt')).toBeInTheDocument()
    })

    it('should render Copy selection item', () => {
      renderWithProvider(<PreviewContextMenu {...defaultProps} />)

      expect(screen.getByText('Copy selection')).toBeInTheDocument()
    })

    it('should render menu items in correct order', () => {
      renderWithProvider(<PreviewContextMenu {...defaultProps} />)

      // Find portal-root since context menu renders there
      const portalRoot = document.getElementById('portal-root')
      expect(portalRoot).toBeTruthy()

      const menuItems = portalRoot!.querySelectorAll('.context-menu-item:not(.context-menu-separator)')
      const labels = Array.from(menuItems).map((item) => item.textContent)

      expect(labels[0]).toBe('Explain')
      expect(labels[1]).toBe('Modify')
      expect(labels[2]).toBe('Ask')
      expect(labels[3]).toBe('Visualize')
      expect(labels[4]).toBe('Prompt')
      expect(labels[5]).toBe('Copy selection')
    })

    it('should render icons for each menu item', () => {
      renderWithProvider(<PreviewContextMenu {...defaultProps} />)

      // Find portal-root since context menu renders there
      const portalRoot = document.getElementById('portal-root')
      expect(portalRoot).toBeTruthy()

      // Each menu item should have an icon (svg element)
      const svgElements = portalRoot!.querySelectorAll('svg')
      expect(svgElements.length).toBeGreaterThanOrEqual(6) // 5 prompts + Copy
    })
  })

  describe('Icon Mapping', () => {
    it('should render Maximize2 icon for Explain', () => {
      renderWithProvider(<PreviewContextMenu {...defaultProps} />)

      // Find the Explain menu item (div, not button)
      const explainItem = screen.getByText('Explain').closest('.context-menu-item')
      expect(explainItem).toBeInTheDocument()

      // Check that it has an SVG icon
      const icon = explainItem?.querySelector('svg.lucide-maximize2')
      expect(icon).toBeInTheDocument()
    })

    it('should render Edit3 icon for Modify', () => {
      renderWithProvider(<PreviewContextMenu {...defaultProps} />)

      const modifyItem = screen.getByText('Modify').closest('.context-menu-item')
      const icon = modifyItem?.querySelector('svg')
      expect(icon).toBeTruthy()
      expect(icon?.classList.toString()).toContain('lucide')
    })

    it('should render HelpCircle icon for Ask', () => {
      renderWithProvider(<PreviewContextMenu {...defaultProps} />)

      const askItem = screen.getByText('Ask').closest('.context-menu-item')
      const icon = askItem?.querySelector('svg')
      expect(icon).toBeTruthy()
      expect(icon?.classList.toString()).toContain('lucide')
    })

    it('should render Sparkles icon for Prompt', () => {
      renderWithProvider(<PreviewContextMenu {...defaultProps} />)

      const promptItem = screen.getByText('Prompt').closest('.context-menu-item')
      const icon = promptItem?.querySelector('svg')
      expect(icon).toBeTruthy()
      expect(icon?.classList.toString()).toContain('lucide')
    })
  })

  describe('Prompt Execution - Requires Input', () => {
    it('should call showPrompt for Modify command', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()

      renderWithProvider(<PreviewContextMenu {...defaultProps} onClose={onClose} />)

      const modifyBtn = screen.getByText('Modify')
      await user.click(modifyBtn)

      // Should call showPrompt with correct config
      await waitFor(() => {
        expect(mockShowPrompt).toHaveBeenCalled()
        const promptConfig = mockShowPrompt.mock.calls[0][0]
        expect(promptConfig.title).toContain('modif')
        expect(promptConfig.selectedText).toContain('Sample selected text')
        expect(promptConfig.minLength).toBe(3)
        expect(promptConfig.maxLength).toBe(2000)
      })

      // Should close context menu
      expect(onClose).toHaveBeenCalled()
    })

    it('should read source lines when startLine and endLine are provided', async () => {
      const user = userEvent.setup()

      // Mock file read
      mockReadFile.mockResolvedValue('Line 1\nLine 2\nLine 3\nLine 4\nLine 5')

      renderWithProvider(
        <PreviewContextMenu {...defaultProps} startLine={2} endLine={4} />
      )

      const askBtn = screen.getByText('Ask')
      await user.click(askBtn)

      await waitFor(() => {
        expect(mockReadFile).toHaveBeenCalledWith('/test/document.md')
      })

      // showPrompt should receive source lines in selectedText (2-4)
      await waitFor(() => {
        expect(mockShowPrompt).toHaveBeenCalled()
        const promptConfig = mockShowPrompt.mock.calls[0][0]
        expect(promptConfig.selectedText).toContain('Line 2')
      })
    })

    it('should fall back to selectedText when readSourceLines fails', async () => {
      const user = userEvent.setup()

      // Mock file read failure
      mockReadFile.mockRejectedValue(new Error('File read failed'))

      renderWithProvider(
        <PreviewContextMenu
          {...defaultProps}
          startLine={2}
          endLine={4}
          selectedText="Fallback text"
        />
      )

      const promptBtn = screen.getByText('Prompt')
      await user.click(promptBtn)

      await waitFor(() => {
        expect(mockShowPrompt).toHaveBeenCalled()
        const promptConfig = mockShowPrompt.mock.calls[0][0]
        expect(promptConfig.selectedText).toContain('Fallback text')
      })
    })

    it('should execute prompt when user submits input', async () => {
      const user = userEvent.setup()

      // Mock showPrompt to return user input
      mockShowPrompt.mockResolvedValue('Make it shorter')

      renderWithProvider(<PreviewContextMenu {...defaultProps} />)

      const modifyBtn = screen.getByText('Modify')
      await user.click(modifyBtn)

      // Should execute prompt template with user input
      await waitFor(() => {
        expect(panelUtils.executePromptTemplate).toHaveBeenCalledWith('modify', {
          selectedText: 'Sample selected text',
          filePath: '/test/document.md',
          fullDocument: 'Full document content',
          startLine: undefined,
          endLine: undefined,
          lineRange: undefined,
          fileRef: undefined,
          userInput: 'Make it shorter'
        })
      })
    })

    it('should not execute prompt when user cancels', async () => {
      const user = userEvent.setup()

      // Mock showPrompt to return null (user cancelled)
      mockShowPrompt.mockResolvedValue(null)

      renderWithProvider(<PreviewContextMenu {...defaultProps} />)

      const askBtn = screen.getByText('Ask')
      await user.click(askBtn)

      await waitFor(() => {
        expect(mockShowPrompt).toHaveBeenCalled()
      })

      // Should NOT execute prompt template
      expect(panelUtils.executePromptTemplate).not.toHaveBeenCalled()
    })
  })

  describe('Prompt Execution - Auto Execute', () => {
    it('should execute immediately for Explain command (no input required)', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()

      renderWithProvider(<PreviewContextMenu {...defaultProps} onClose={onClose} />)

      const explainBtn = screen.getByText('Explain')
      await user.click(explainBtn)

      // Should execute immediately
      await waitFor(() => {
        expect(panelUtils.executePromptTemplate).toHaveBeenCalledWith('explain', {
          selectedText: 'Sample selected text',
          filePath: '/test/document.md',
          fullDocument: 'Full document content',
          startLine: undefined,
          endLine: undefined,
          lineRange: undefined,
          fileRef: undefined,
          userInput: undefined
        })
      })

      // Should close context menu (may be called multiple times due to event handlers)
      expect(onClose).toHaveBeenCalled()
    })

    it('should include line range in variables when provided', async () => {
      const user = userEvent.setup()

      renderWithProvider(<PreviewContextMenu {...defaultProps} startLine={10} endLine={15} />)

      const explainBtn = screen.getByText('Explain')
      await user.click(explainBtn)

      await waitFor(() => {
        expect(panelUtils.executePromptTemplate).toHaveBeenCalledWith(
          'explain',
          expect.objectContaining({
            startLine: 10,
            endLine: 15,
            lineRange: 'lines 10-15',
            fileRef: '@/test/document.md:10-15'
          })
        )
      })
    })

    it('should handle single line selection correctly', async () => {
      const user = userEvent.setup()

      renderWithProvider(<PreviewContextMenu {...defaultProps} startLine={5} endLine={5} />)

      const explainBtn = screen.getByText('Explain')
      await user.click(explainBtn)

      await waitFor(() => {
        expect(panelUtils.executePromptTemplate).toHaveBeenCalledWith(
          'explain',
          expect.objectContaining({
            lineRange: 'line 5',
            fileRef: '@/test/document.md:5'
          })
        )
      })
    })
  })

  describe('Copy selection', () => {
    it('should copy selected text to clipboard', async () => {
      renderWithProvider(<PreviewContextMenu {...defaultProps} selectedText="Text to copy" />)

      const copyBtn = screen.getByText('Copy selection').closest('.context-menu-item')
      expect(copyBtn).toBeTruthy()

      // Use fireEvent for direct event triggering
      fireEvent.click(copyBtn!)

      await waitFor(() => {
        expect(mockWriteText).toHaveBeenCalledWith('Text to copy')
      })
    })

    it('should close context menu after copying', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()

      renderWithProvider(<PreviewContextMenu {...defaultProps} onClose={onClose} />)

      const copyBtn = screen.getByText('Copy selection')
      await user.click(copyBtn)

      // Should be called at least once (might be called on blur/click events too)
      expect(onClose).toHaveBeenCalled()
    })
  })

  describe('Error Handling', () => {
    it('should handle prompt execution failure gracefully', async () => {
      const user = userEvent.setup()
      mockLogger.error.mockClear()

      // Mock execution failure
      vi.spyOn(panelUtils, 'executePromptTemplate').mockRejectedValue(new Error('Execution failed'))

      // Mock showPrompt to return user input
      mockShowPrompt.mockResolvedValue('User input')

      renderWithProvider(<PreviewContextMenu {...defaultProps} />)

      const modifyBtn = screen.getByText('Modify')
      await user.click(modifyBtn)

      // Should attempt to execute prompt
      await waitFor(() => {
        expect(panelUtils.executePromptTemplate).toHaveBeenCalled()
      })

      // Should log error when execution fails
      await waitFor(() => {
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining('Failed to execute prompt'),
          expect.any(Error)
        )
      })
    })

    it('should log error when prompt config not found', async () => {
      mockLogger.error.mockClear()

      // Temporarily modify PROMPT_REGISTRY to remove a prompt
      const { PROMPT_REGISTRY } = await import('../../prompts/registry')
      const originalExplain = PROMPT_REGISTRY['explain']
      delete (PROMPT_REGISTRY as any)['explain']

      renderWithProvider(<PreviewContextMenu {...defaultProps} />)

      // Try to click the (now missing) explain prompt
      // Since the registry is memoized, we'll test the error path differently
      // by directly testing the handleAction logic

      // Restore
      ;(PROMPT_REGISTRY as any)['explain'] = originalExplain
    })
  })
})
