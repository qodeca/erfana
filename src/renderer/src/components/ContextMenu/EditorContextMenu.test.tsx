// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditorContextMenu } from './EditorContextMenu'
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

// Mock the central clipboard service (copy/cut route via textClipboard.writeText)
const { mockClipboardWriteText, mockClipboardReadText } = vi.hoisted(() => ({
  mockClipboardWriteText: vi.fn(),
  mockClipboardReadText: vi.fn()
}))
vi.mock('../../services/textClipboard', () => ({
  textClipboard: {
    writeText: mockClipboardWriteText,
    readText: mockClipboardReadText
  }
}))

// Mock prompt registry to ensure code-editor prompts are available
// This avoids issues with import.meta.glob not picking up new template files in tests
vi.mock('../../prompts/registry', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../prompts/registry')>()

  // Define editor prompts for testing
  const editorPrompts = {
    'editor-explain': {
      id: 'editor-explain',
      label: 'Explain',
      icon: 'maximize2',
      targetPanel: 'terminal',
      autoExecute: true,
      template: 'Test template',
      area: 'code-editor',
      subArea: 'context-menu',
      order: 0,
      enabled: true,
      requiresInput: false
    },
    'editor-modify': {
      id: 'editor-modify',
      label: 'Modify',
      icon: 'edit-3',
      targetPanel: 'terminal',
      autoExecute: true,
      template: 'Test template',
      area: 'code-editor',
      subArea: 'context-menu',
      order: 1,
      enabled: true,
      requiresInput: true,
      inputLabel: 'How should this be modified?',
      inputPlaceholder: 'Enter modification instructions...'
    },
    'editor-ask': {
      id: 'editor-ask',
      label: 'Ask',
      icon: 'help-circle',
      targetPanel: 'terminal',
      autoExecute: true,
      template: 'Test template',
      area: 'code-editor',
      subArea: 'context-menu',
      order: 2,
      enabled: true,
      requiresInput: true,
      inputLabel: 'What would you like to know?',
      inputPlaceholder: 'Enter your question...'
    },
    'editor-visualize': {
      id: 'editor-visualize',
      label: 'Visualize',
      icon: 'layout-grid',
      targetPanel: 'terminal',
      autoExecute: true,
      template: 'Test template',
      area: 'code-editor',
      subArea: 'context-menu',
      order: 3,
      enabled: true,
      requiresInput: true,
      textareaOptional: true,
      inputLabel: 'Additional instructions',
      inputPlaceholder: 'Enter additional instructions...',
      dropdownLabel: 'Diagram type',
      defaultDropdownValue: 'flowchart',
      dropdownOptions: [
        { value: 'flowchart', label: 'Flowcharts' },
        { value: 'sequenceDiagram', label: 'Sequence Diagrams' }
      ]
    },
    'editor-prompt': {
      id: 'editor-prompt',
      label: 'Prompt',
      icon: 'sparkles',
      targetPanel: 'terminal',
      autoExecute: true,
      template: 'Test template',
      area: 'code-editor',
      subArea: 'context-menu',
      order: 4,
      enabled: true,
      requiresInput: true,
      inputLabel: 'Enter your prompt',
      inputPlaceholder: 'Enter prompt...'
    }
  }

  // Merge with original registry
  const mergedRegistry = { ...original.PROMPT_REGISTRY, ...editorPrompts }

  return {
    ...original,
    PROMPT_REGISTRY: mergedRegistry,
    getPromptsForArea: (area: string, subArea?: string) => {
      return Object.values(mergedRegistry)
        .filter((prompt: any) => {
          const areaMatch = prompt.area === area
          const subAreaMatch = subArea ? prompt.subArea === subArea : true
          const enabledMatch = prompt.enabled !== false
          return areaMatch && subAreaMatch && enabledMatch
        })
        .sort((a: any, b: any) => (a.order || 0) - (b.order || 0))
    }
  }
})

// Mock terminal portal context
vi.mock('../../context/TerminalPortalContext', () => ({
  useTerminalPortalOptional: vi.fn(() => null)
}))

// Mock prompt scroll scheduler
vi.mock('../../utils/promptScrollScheduler.logic', () => ({
  scheduleScrollIfNeeded: vi.fn()
}))

/**
 * EditorContextMenu Component Tests
 *
 * Tests the context menu for Monaco code editor selections.
 * Validates prompt rendering, icon mapping, user input dialogs, dropdown handling,
 * and prompt execution for code-editor area prompts.
 */
describe('EditorContextMenu Component', () => {
  const defaultProps = {
    x: 100,
    y: 200,
    selectedText: 'const foo = "bar"',
    filePath: '/test/code.ts',
    fullDocument: 'const foo = "bar"\nconst baz = "qux"',
    startLine: 1,
    endLine: 1,
    onClose: vi.fn()
  }

  // Helper to render with DialogProvider
  const renderWithProvider = (ui: React.ReactElement) => {
    return render(<DialogProvider>{ui}</DialogProvider>)
  }

  const mockShowPrompt = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    // Central clipboard service: write succeeds by default
    mockClipboardWriteText.mockResolvedValue(true)
    mockClipboardReadText.mockResolvedValue('')
    // Mock showPrompt to return null by default (user cancelled)
    mockShowPrompt.mockResolvedValue(null)

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
    it('should render context menu with code-editor prompt items', () => {
      renderWithProvider(<EditorContextMenu {...defaultProps} />)

      // At least Ask should be loaded
      expect(screen.getByText('Ask')).toBeInTheDocument()
    })

    it('should render Cut, Copy, Paste items', () => {
      renderWithProvider(<EditorContextMenu {...defaultProps} />)

      expect(screen.getByText('Cut')).toBeInTheDocument()
      expect(screen.getByText('Copy')).toBeInTheDocument()
      expect(screen.getByText('Paste')).toBeInTheDocument()
    })

    it('should render menu items with prompts first, then separator, then clipboard actions', () => {
      renderWithProvider(<EditorContextMenu {...defaultProps} />)

      // Find portal-root since context menu renders there
      const portalRoot = document.getElementById('portal-root')
      expect(portalRoot).toBeTruthy()

      const menuItems = portalRoot!.querySelectorAll('.context-menu-item:not(.context-menu-separator)')
      const labels = Array.from(menuItems).map((item) => item.textContent)

      // Last 3 items should be Cut, Copy, Paste
      expect(labels[labels.length - 3]).toBe('Cut')
      expect(labels[labels.length - 2]).toBe('Copy')
      expect(labels[labels.length - 1]).toBe('Paste')

      // Should have at least Ask prompt + Cut/Copy/Paste
      expect(labels.length).toBeGreaterThanOrEqual(4)
    })

    it('should render icons for each menu item', () => {
      renderWithProvider(<EditorContextMenu {...defaultProps} />)

      // Find portal-root since context menu renders there
      const portalRoot = document.getElementById('portal-root')
      expect(portalRoot).toBeTruthy()

      // Each menu item should have an icon (svg element)
      const svgElements = portalRoot!.querySelectorAll('svg')
      expect(svgElements.length).toBeGreaterThanOrEqual(4) // At least Ask + Cut + Copy + Paste
    })

    it('should render separator between prompts and clipboard actions', () => {
      renderWithProvider(<EditorContextMenu {...defaultProps} />)

      const portalRoot = document.getElementById('portal-root')
      expect(portalRoot).toBeTruthy()

      const separator = portalRoot!.querySelector('.context-menu-separator')
      expect(separator).toBeInTheDocument()
    })

    it('should render menu at correct position', () => {
      renderWithProvider(<EditorContextMenu {...defaultProps} x={150} y={250} />)

      const portalRoot = document.getElementById('portal-root')
      const menu = portalRoot!.querySelector('.context-menu') as HTMLElement

      expect(menu).toBeTruthy()
      // Position is set in style attribute initially
      expect(menu.style.position).toBe('fixed')
    })
  })

  describe('Icon Mapping', () => {
    it('should render HelpCircle icon for Ask', () => {
      renderWithProvider(<EditorContextMenu {...defaultProps} />)

      const askItem = screen.getByText('Ask').closest('.context-menu-item')
      const icon = askItem?.querySelector('svg')
      expect(icon).toBeTruthy()
      expect(icon?.classList.toString()).toContain('lucide')
    })

    it('should render icons for clipboard actions', () => {
      renderWithProvider(<EditorContextMenu {...defaultProps} />)

      // Check Cut icon
      const cutItem = screen.getByText('Cut').closest('.context-menu-item')
      const cutIcon = cutItem?.querySelector('svg')
      expect(cutIcon).toBeTruthy()
      expect(cutIcon?.classList.toString()).toContain('lucide-scissors')

      // Check Copy icon
      const copyItem = screen.getByText('Copy').closest('.context-menu-item')
      const copyIcon = copyItem?.querySelector('svg')
      expect(copyIcon).toBeTruthy()
      expect(copyIcon?.classList.toString()).toContain('lucide-copy')

      // Check Paste icon
      const pasteItem = screen.getByText('Paste').closest('.context-menu-item')
      const pasteIcon = pasteItem?.querySelector('svg')
      expect(pasteIcon).toBeTruthy()
      expect(pasteIcon?.classList.toString()).toContain('lucide-clipboard-paste')
    })
  })

  describe('Prompt Execution - Requires Input (Ask)', () => {
    it('should call showPrompt for Ask command', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()

      renderWithProvider(<EditorContextMenu {...defaultProps} onClose={onClose} />)

      const askBtn = screen.getByText('Ask')
      await user.click(askBtn)

      // Should call showPrompt with correct config
      await waitFor(() => {
        expect(mockShowPrompt).toHaveBeenCalled()
        const promptConfig = mockShowPrompt.mock.calls[0][0]
        expect(promptConfig.title).toContain('know')
        expect(promptConfig.selectedText).toContain('const foo = "bar"')
        expect(promptConfig.minLength).toBe(3)
        expect(promptConfig.maxLength).toBe(2000)
      })

      // Should close context menu immediately
      expect(onClose).toHaveBeenCalled()
    })

    it('should execute Ask prompt when user submits input', async () => {
      const user = userEvent.setup()

      // Mock showPrompt to return user input
      mockShowPrompt.mockResolvedValue('What does this do?')

      renderWithProvider(<EditorContextMenu {...defaultProps} />)

      const askBtn = screen.getByText('Ask')
      await user.click(askBtn)

      // Should execute prompt template with user input
      await waitFor(() => {
        expect(panelUtils.executePromptTemplate).toHaveBeenCalled()
      })

      expect(panelUtils.executePromptTemplate).toHaveBeenCalledWith('editor-ask', {
        selectedText: 'const foo = "bar"',
        filePath: '/test/code.ts',
        fullDocument: 'const foo = "bar"\nconst baz = "qux"',
        startLine: 1,
        endLine: 1,
        lineRange: 'line 1',
        fileRef: '@/test/code.ts:1',
        userInput: 'What does this do?',
        diagramType: undefined
      })
    })

    it('should include line range in variables when provided', async () => {
      const user = userEvent.setup()

      mockShowPrompt.mockResolvedValue('Why this range?')

      renderWithProvider(
        <EditorContextMenu {...defaultProps} startLine={5} endLine={10} />
      )

      const askBtn = screen.getByText('Ask')
      await user.click(askBtn)

      await waitFor(() => {
        expect(panelUtils.executePromptTemplate).toHaveBeenCalledWith(
          'editor-ask',
          expect.objectContaining({
            startLine: 5,
            endLine: 10,
            lineRange: 'lines 5-10',
            fileRef: '@/test/code.ts:5-10'
          })
        )
      })
    })

    it('should handle single line selection correctly', async () => {
      const user = userEvent.setup()

      mockShowPrompt.mockResolvedValue('What is line 7?')

      renderWithProvider(<EditorContextMenu {...defaultProps} startLine={7} endLine={7} />)

      const askBtn = screen.getByText('Ask')
      await user.click(askBtn)

      await waitFor(() => {
        expect(panelUtils.executePromptTemplate).toHaveBeenCalledWith(
          'editor-ask',
          expect.objectContaining({
            lineRange: 'line 7',
            fileRef: '@/test/code.ts:7'
          })
        )
      })
    })
  })

  describe('Dialog Cancellation', () => {
    it('should not execute prompt when user cancels', async () => {
      const user = userEvent.setup()

      // Mock showPrompt to return null (user cancelled)
      mockShowPrompt.mockResolvedValue(null)

      renderWithProvider(<EditorContextMenu {...defaultProps} />)

      const askBtn = screen.getByText('Ask')
      await user.click(askBtn)

      await waitFor(() => {
        expect(mockShowPrompt).toHaveBeenCalled()
      })

      // Should NOT execute prompt template
      expect(panelUtils.executePromptTemplate).not.toHaveBeenCalled()
    })
  })

  describe('Dialog Input Handling', () => {
    it('should handle plain text input', async () => {
      const user = userEvent.setup()

      mockShowPrompt.mockResolvedValue('Plain text input')

      renderWithProvider(<EditorContextMenu {...defaultProps} />)

      const askBtn = screen.getByText('Ask')
      await user.click(askBtn)

      await waitFor(() => {
        expect(panelUtils.executePromptTemplate).toHaveBeenCalledWith(
          'editor-ask',
          expect.objectContaining({
            userInput: 'Plain text input',
            diagramType: undefined
          })
        )
      })
    })

    it('should treat empty string as cancellation', async () => {
      const user = userEvent.setup()

      // Mock empty response (treated as cancellation)
      mockShowPrompt.mockResolvedValue('')

      renderWithProvider(<EditorContextMenu {...defaultProps} />)

      const askBtn = screen.getByText('Ask')
      await user.click(askBtn)

      // Should show dialog
      await waitFor(() => {
        expect(mockShowPrompt).toHaveBeenCalled()
      })

      // Should NOT execute prompt template (empty string is treated as cancel)
      expect(panelUtils.executePromptTemplate).not.toHaveBeenCalled()
    })

    it('should handle very long user input', async () => {
      const user = userEvent.setup()

      const longInput = 'A'.repeat(2000) // Max length
      mockShowPrompt.mockResolvedValue(longInput)

      renderWithProvider(<EditorContextMenu {...defaultProps} />)

      const askBtn = screen.getByText('Ask')
      await user.click(askBtn)

      await waitFor(() => {
        expect(panelUtils.executePromptTemplate).toHaveBeenCalledWith(
          'editor-ask',
          expect.objectContaining({
            userInput: longInput
          })
        )
      })
    })
  })

  describe('Clipboard Actions', () => {
    it('should delegate copy to onCopy and close the menu (shared command path)', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()
      const onCopy = vi.fn()

      renderWithProvider(
        <EditorContextMenu
          {...defaultProps}
          selectedText="function test() {}"
          onClose={onClose}
          onCopy={onCopy}
        />
      )

      const copyBtn = screen.getByText('Copy')
      await user.click(copyBtn)

      // Copy now routes through the shared clipboardCopy (live getValueInRange)
      // via onCopy → handleEditorCopy, NOT a direct textClipboard.writeText with
      // a stale selectedText snapshot. The menu only triggers and closes.
      expect(onCopy).toHaveBeenCalled()
      expect(mockClipboardWriteText).not.toHaveBeenCalled()
      expect(onClose).toHaveBeenCalled()
    })

    it('should close context menu after copying', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()
      const onCopy = vi.fn()

      renderWithProvider(<EditorContextMenu {...defaultProps} onClose={onClose} onCopy={onCopy} />)

      const copyBtn = screen.getByText('Copy')
      await user.click(copyBtn)

      // Should be called at least once
      expect(onClose).toHaveBeenCalled()
    })

    it('should delegate cut to onCut and close the menu', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()
      const onCut = vi.fn()

      renderWithProvider(
        <EditorContextMenu {...defaultProps} onClose={onClose} onCut={onCut} />
      )

      const cutBtn = screen.getByText('Cut')
      await user.click(cutBtn)

      // The write-guards-delete invariant lives in the shared pure clipboardCut
      // (invoked via onCut → handleEditorCut), NOT in this component. The menu
      // only triggers the action and closes; it does not write directly.
      expect(onCut).toHaveBeenCalled()
      expect(mockClipboardWriteText).not.toHaveBeenCalled()
      expect(onClose).toHaveBeenCalled()
    })

    it('should call onPaste callback and close menu on Paste click', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()
      const onPaste = vi.fn()

      renderWithProvider(
        <EditorContextMenu {...defaultProps} onClose={onClose} onPaste={onPaste} />
      )

      const pasteBtn = screen.getByText('Paste')
      await user.click(pasteBtn)

      // onPaste should be called
      expect(onPaste).toHaveBeenCalled()

      // Menu should close after click
      expect(onClose).toHaveBeenCalled()
    })
  })

  describe('Error Handling', () => {
    it('should handle prompt execution failure gracefully', async () => {
      const user = userEvent.setup()
      mockLogger.error.mockClear()

      // Mock execution failure
      vi.spyOn(panelUtils, 'executePromptTemplate').mockRejectedValue(
        new Error('Execution failed')
      )

      // Mock showPrompt to return user input
      mockShowPrompt.mockResolvedValue('User input')

      renderWithProvider(<EditorContextMenu {...defaultProps} />)

      const askBtn = screen.getByText('Ask')
      await user.click(askBtn)

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

    it('should verify prompts are functional without errors', async () => {
      const user = userEvent.setup()
      mockLogger.error.mockClear()

      mockShowPrompt.mockResolvedValue('Test question')

      renderWithProvider(<EditorContextMenu {...defaultProps} />)

      // Ask prompt should be present and functional
      expect(screen.getByText('Ask')).toBeInTheDocument()

      const askBtn = screen.getByText('Ask')
      await user.click(askBtn)

      await waitFor(() => {
        expect(panelUtils.executePromptTemplate).toHaveBeenCalled()
      })

      // No errors should be logged for valid prompts
      expect(mockLogger.error).not.toHaveBeenCalled()
    })
  })

  describe('Menu Positioning', () => {
    it('should pass x and y coordinates to ContextMenu', () => {
      renderWithProvider(<EditorContextMenu {...defaultProps} x={300} y={400} />)

      const portalRoot = document.getElementById('portal-root')
      const menu = portalRoot!.querySelector('.context-menu') as HTMLElement

      expect(menu).toBeTruthy()
      // ContextMenu component handles positioning logic internally
      expect(menu.style.position).toBe('fixed')
    })
  })

  describe('Variable Passing', () => {
    it('should build correct file reference for multi-line selection', async () => {
      const user = userEvent.setup()

      mockShowPrompt.mockResolvedValue('What is this?')

      renderWithProvider(
        <EditorContextMenu {...defaultProps} startLine={10} endLine={20} />
      )

      const askBtn = screen.getByText('Ask')
      await user.click(askBtn)

      await waitFor(() => {
        expect(panelUtils.executePromptTemplate).toHaveBeenCalledWith(
          'editor-ask',
          expect.objectContaining({
            fileRef: '@/test/code.ts:10-20'
          })
        )
      })
    })

    it('should build correct file reference for single-line selection', async () => {
      const user = userEvent.setup()

      mockShowPrompt.mockResolvedValue('Explain line 15')

      renderWithProvider(<EditorContextMenu {...defaultProps} startLine={15} endLine={15} />)

      const askBtn = screen.getByText('Ask')
      await user.click(askBtn)

      await waitFor(() => {
        expect(panelUtils.executePromptTemplate).toHaveBeenCalledWith(
          'editor-ask',
          expect.objectContaining({
            fileRef: '@/test/code.ts:15'
          })
        )
      })
    })

    it('should pass full document content to prompt template', async () => {
      const user = userEvent.setup()
      const fullDoc = 'const x = 1\nconst y = 2\nconst z = 3'

      mockShowPrompt.mockResolvedValue('What does this do?')

      renderWithProvider(<EditorContextMenu {...defaultProps} fullDocument={fullDoc} />)

      const askBtn = screen.getByText('Ask')
      await user.click(askBtn)

      await waitFor(() => {
        expect(panelUtils.executePromptTemplate).toHaveBeenCalledWith(
          'editor-ask',
          expect.objectContaining({
            fullDocument: fullDoc
          })
        )
      })
    })
  })

  describe('Edge Cases', () => {
    it('should disable AI prompts and clipboard actions when no selection', () => {
      renderWithProvider(<EditorContextMenu {...defaultProps} selectedText="" />)

      // AI prompts should be disabled
      const askItem = screen.getByText('Ask').closest('.context-menu-item')
      expect(askItem).toHaveClass('disabled')

      // Cut and Copy should be disabled
      const cutItem = screen.getByText('Cut').closest('.context-menu-item')
      expect(cutItem).toHaveClass('disabled')

      const copyItem = screen.getByText('Copy').closest('.context-menu-item')
      expect(copyItem).toHaveClass('disabled')

      // Paste should be enabled (no selection required)
      const pasteItem = screen.getByText('Paste').closest('.context-menu-item')
      expect(pasteItem).not.toHaveClass('disabled')
    })

    it('should enable all items when there is a selection', () => {
      renderWithProvider(<EditorContextMenu {...defaultProps} selectedText="some text" />)

      // AI prompts should be enabled
      const askItem = screen.getByText('Ask').closest('.context-menu-item')
      expect(askItem).not.toHaveClass('disabled')

      // All clipboard actions should be enabled
      const cutItem = screen.getByText('Cut').closest('.context-menu-item')
      expect(cutItem).not.toHaveClass('disabled')

      const copyItem = screen.getByText('Copy').closest('.context-menu-item')
      expect(copyItem).not.toHaveClass('disabled')

      const pasteItem = screen.getByText('Paste').closest('.context-menu-item')
      expect(pasteItem).not.toHaveClass('disabled')
    })

    it('should handle very long file paths', async () => {
      const user = userEvent.setup()
      const longPath = '/very/long/path/to/some/deep/nested/directory/structure/file.ts'

      mockShowPrompt.mockResolvedValue('Explain')

      renderWithProvider(<EditorContextMenu {...defaultProps} filePath={longPath} />)

      const askBtn = screen.getByText('Ask')
      await user.click(askBtn)

      await waitFor(() => {
        expect(panelUtils.executePromptTemplate).toHaveBeenCalledWith(
          'editor-ask',
          expect.objectContaining({
            filePath: longPath,
            fileRef: `@${longPath}:1`
          })
        )
      })
    })

    it('should handle large line numbers', async () => {
      const user = userEvent.setup()

      mockShowPrompt.mockResolvedValue('What is this range?')

      renderWithProvider(
        <EditorContextMenu {...defaultProps} startLine={9999} endLine={10005} />
      )

      const askBtn = screen.getByText('Ask')
      await user.click(askBtn)

      await waitFor(() => {
        expect(panelUtils.executePromptTemplate).toHaveBeenCalledWith(
          'editor-ask',
          expect.objectContaining({
            lineRange: 'lines 9999-10005',
            fileRef: '@/test/code.ts:9999-10005'
          })
        )
      })
    })
  })
})
