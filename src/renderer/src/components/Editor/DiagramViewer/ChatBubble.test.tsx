// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Component Tests for ChatBubble
 *
 * Tests for ChatBubble component:
 * - Rendering behavior (collapsed/expanded states)
 * - User interactions (click to expand, click outside to collapse)
 * - Keyboard shortcuts (Cmd/Ctrl+Enter to submit, Escape to close)
 * - Validation states and character counting
 * - Message submission
 * - Accessibility attributes
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ChatBubble } from './ChatBubble'

// Helper to type into textarea (fireEvent.change is more reliable than userEvent in tests)
const typeIntoTextarea = (textarea: HTMLTextAreaElement, value: string) => {
  fireEvent.change(textarea, { target: { value } })
}

// Mock executePromptTemplate
vi.mock('../../../utils/panelUtils', () => ({
  executePromptTemplate: vi.fn().mockResolvedValue({ success: true })
}))

// Mock useTerminalStore (issue #60 - scroll lock uses this store)
vi.mock('../../../stores/useTerminalStore', () => ({
  useTerminalStore: vi.fn((selector) => {
    const state = { scrollLocked: false }
    return selector ? selector(state) : state
  })
}))

// Import after mock to get the mocked version
import { executePromptTemplate } from '../../../utils/panelUtils'

describe('ChatBubble', () => {
  const defaultProps = {
    mermaidCode: 'flowchart TD\n  A --> B',
    filePath: '/path/to/file.md',
    startLine: 10,
    endLine: 15,
    // Zoom control props (issue #37)
    transform: { scale: 1, translateX: 0, translateY: 0 },
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onFitToView: vi.fn(),
    onReset: vi.fn(),
    zoomInDisabled: false,
    zoomOutDisabled: false
  }

  beforeEach(() => {
    vi.clearAllMocks()
    // Ensure mock returns success for each test
    vi.mocked(executePromptTemplate).mockResolvedValue({ success: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('rendering behavior', () => {
    it('does not render when filePath is missing', () => {
      // @ts-expect-error - Testing behavior when filePath is undefined
      render(
        <ChatBubble
          mermaidCode="flowchart TD"
          transform={{ scale: 1, translateX: 0, translateY: 0 }}
          onZoomIn={vi.fn()}
          onZoomOut={vi.fn()}
          onFitToView={vi.fn()}
          onReset={vi.fn()}
          zoomInDisabled={false}
          zoomOutDisabled={false}
        />
      )
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    it('renders FAB button when filePath is provided', () => {
      render(<ChatBubble {...defaultProps} />)
      expect(screen.getByRole('button', { name: /open panel/i })).toBeInTheDocument()
    })

    it('shows collapsed state by default', () => {
      render(<ChatBubble {...defaultProps} />)
      expect(screen.getByRole('button', { name: /open panel/i })).toBeInTheDocument()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  describe('expand/collapse interactions', () => {
    it('expands when FAB button is clicked', async () => {
      render(<ChatBubble {...defaultProps} />)

      const fabButton = screen.getByRole('button', { name: /open panel/i })
      fireEvent.click(fabButton)

      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByPlaceholderText(/describe changes/i)).toBeInTheDocument()
    })

    it('collapses when Escape key is pressed (issue #37 - no close button in header)', async () => {
      render(<ChatBubble {...defaultProps} />)

      // Expand
      fireEvent.click(screen.getByRole('button', { name: /open panel/i }))
      expect(screen.getByRole('dialog')).toBeInTheDocument()

      // Press Escape in the textarea
      const textarea = screen.getByPlaceholderText(/describe changes/i)
      fireEvent.keyDown(textarea, { key: 'Escape' })

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('preserves message draft when collapsing', () => {
      render(<ChatBubble {...defaultProps} />)

      // Expand and type
      fireEvent.click(screen.getByRole('button', { name: /open panel/i }))
      const textarea = screen.getByPlaceholderText(/describe changes/i) as HTMLTextAreaElement
      typeIntoTextarea(textarea, 'My draft message')

      // Collapse
      fireEvent.keyDown(textarea, { key: 'Escape' })

      // Re-expand
      fireEvent.click(screen.getByRole('button', { name: /open panel/i }))
      const reopenedTextarea = screen.getByPlaceholderText(/describe changes/i) as HTMLTextAreaElement
      expect(reopenedTextarea.value).toBe('My draft message')
    })
  })

  describe('text input', () => {
    it('accepts text input', () => {
      render(<ChatBubble {...defaultProps} />)

      fireEvent.click(screen.getByRole('button', { name: /open panel/i }))
      const textarea = screen.getByPlaceholderText(/describe changes/i) as HTMLTextAreaElement

      typeIntoTextarea(textarea, 'Add a new node')
      expect(textarea.value).toBe('Add a new node')
    })

    it('shows character count', () => {
      render(<ChatBubble {...defaultProps} />)

      fireEvent.click(screen.getByRole('button', { name: /open panel/i }))
      const textarea = screen.getByPlaceholderText(/describe changes/i) as HTMLTextAreaElement

      typeIntoTextarea(textarea, 'Hello')
      expect(screen.getByText('5/2000 characters')).toBeInTheDocument()
    })

    it('enforces max length', () => {
      render(<ChatBubble {...defaultProps} />)

      fireEvent.click(screen.getByRole('button', { name: /open panel/i }))
      const textarea = screen.getByPlaceholderText(/describe changes/i) as HTMLTextAreaElement

      // Try to type text exceeding max length
      const longText = 'a'.repeat(2100)
      typeIntoTextarea(textarea, longText)

      // Should not exceed max length (enforced at input level)
      expect(textarea.value.length).toBeLessThanOrEqual(2000)
    })
  })

  describe('validation states', () => {
    it('disables send button when message is too short', () => {
      render(<ChatBubble {...defaultProps} />)

      fireEvent.click(screen.getByRole('button', { name: /open panel/i }))
      const sendButton = screen.getByRole('button', { name: /send message/i })

      expect(sendButton).toBeDisabled()
    })

    it('enables send button when message is valid', () => {
      render(<ChatBubble {...defaultProps} />)

      fireEvent.click(screen.getByRole('button', { name: /open panel/i }))
      const textarea = screen.getByPlaceholderText(/describe changes/i) as HTMLTextAreaElement
      const sendButton = screen.getByRole('button', { name: /send message/i })

      typeIntoTextarea(textarea, 'Add a new node')
      expect(sendButton).not.toBeDisabled()
    })

    it('shows warning when approaching character limit', () => {
      render(<ChatBubble {...defaultProps} />)

      fireEvent.click(screen.getByRole('button', { name: /open panel/i }))
      const textarea = screen.getByPlaceholderText(/describe changes/i) as HTMLTextAreaElement

      // Type text above warning threshold (1000 chars)
      typeIntoTextarea(textarea, 'a'.repeat(1500))
      expect(screen.getByText(/500 characters remaining/i)).toBeInTheDocument()
    })
  })

  describe('message submission', () => {
    it('submits message with Cmd+Enter', async () => {
      const { executePromptTemplate } = await import('../../../utils/panelUtils')

      render(<ChatBubble {...defaultProps} />)

      fireEvent.click(screen.getByRole('button', { name: /open panel/i }))
      const textarea = screen.getByPlaceholderText(/describe changes/i) as HTMLTextAreaElement

      typeIntoTextarea(textarea, 'Add a new node')
      fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true })

      await waitFor(() => {
        expect(executePromptTemplate).toHaveBeenCalledWith('diagram-chat', expect.objectContaining({
          mermaidCode: 'flowchart TD\n  A --> B',
          filePath: '/path/to/file.md',
          userInstruction: 'Add a new node'
        }))
      })
    })

    it('submits message with Ctrl+Enter', async () => {
      const { executePromptTemplate } = await import('../../../utils/panelUtils')

      render(<ChatBubble {...defaultProps} />)

      fireEvent.click(screen.getByRole('button', { name: /open panel/i }))
      const textarea = screen.getByPlaceholderText(/describe changes/i) as HTMLTextAreaElement

      typeIntoTextarea(textarea, 'Make it horizontal')
      fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })

      await waitFor(() => {
        expect(executePromptTemplate).toHaveBeenCalledWith('diagram-chat', expect.objectContaining({
          userInstruction: 'Make it horizontal'
        }))
      })
    })

    it('submits message when send button is clicked', async () => {
      const { executePromptTemplate } = await import('../../../utils/panelUtils')

      render(<ChatBubble {...defaultProps} />)

      fireEvent.click(screen.getByRole('button', { name: /open panel/i }))
      const textarea = screen.getByPlaceholderText(/describe changes/i) as HTMLTextAreaElement

      typeIntoTextarea(textarea, 'Change colors')
      fireEvent.click(screen.getByRole('button', { name: /send message/i }))

      await waitFor(() => {
        expect(executePromptTemplate).toHaveBeenCalledWith('diagram-chat', expect.objectContaining({
          userInstruction: 'Change colors'
        }))
      })
    })

    it('clears message after successful submission', async () => {
      render(<ChatBubble {...defaultProps} />)

      fireEvent.click(screen.getByRole('button', { name: /open panel/i }))
      const textarea = screen.getByPlaceholderText(/describe changes/i) as HTMLTextAreaElement

      typeIntoTextarea(textarea, 'Add a node')
      fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true })

      await waitFor(() => {
        expect(textarea.value).toBe('')
      })
    })

    it('stays expanded after submission', async () => {
      render(<ChatBubble {...defaultProps} />)

      fireEvent.click(screen.getByRole('button', { name: /open panel/i }))
      const textarea = screen.getByPlaceholderText(/describe changes/i) as HTMLTextAreaElement

      typeIntoTextarea(textarea, 'Add a node')
      fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true })

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })
    })

    it('does not submit when message is too short', async () => {
      const { executePromptTemplate } = await import('../../../utils/panelUtils')

      render(<ChatBubble {...defaultProps} />)

      fireEvent.click(screen.getByRole('button', { name: /open panel/i }))
      const textarea = screen.getByPlaceholderText(/describe changes/i) as HTMLTextAreaElement

      typeIntoTextarea(textarea, 'ab') // Only 2 chars
      fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true })

      expect(executePromptTemplate).not.toHaveBeenCalled()
    })

    it('does not submit with plain Enter', async () => {
      const { executePromptTemplate } = await import('../../../utils/panelUtils')

      render(<ChatBubble {...defaultProps} />)

      fireEvent.click(screen.getByRole('button', { name: /open panel/i }))
      const textarea = screen.getByPlaceholderText(/describe changes/i) as HTMLTextAreaElement

      typeIntoTextarea(textarea, 'Valid message text')
      fireEvent.keyDown(textarea, { key: 'Enter' })

      expect(executePromptTemplate).not.toHaveBeenCalled()
    })

    it('includes correct context in submission', async () => {
      const { executePromptTemplate } = await import('../../../utils/panelUtils')

      render(<ChatBubble {...defaultProps} />)

      fireEvent.click(screen.getByRole('button', { name: /open panel/i }))
      const textarea = screen.getByPlaceholderText(/describe changes/i) as HTMLTextAreaElement

      typeIntoTextarea(textarea, 'Test message')
      fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true })

      await waitFor(() => {
        expect(executePromptTemplate).toHaveBeenCalledWith('diagram-chat', {
          selectedText: '',
          filePath: '/path/to/file.md',
          fullDocument: '',
          startLine: 10,
          endLine: 15,
          lineRange: 'lines 10-15',
          fileRef: '@/path/to/file.md:10-15',
          mermaidCode: 'flowchart TD\n  A --> B',
          userInstruction: 'Test message'
        })
      })
    })
  })

  describe('accessibility', () => {
    it('FAB button has correct aria attributes', () => {
      render(<ChatBubble {...defaultProps} />)

      const fabButton = screen.getByRole('button', { name: /open panel/i })
      expect(fabButton).toHaveAttribute('aria-expanded', 'false')
      expect(fabButton).toHaveAttribute('title', 'Edit diagram')
    })

    it('expanded panel has dialog role', () => {
      render(<ChatBubble {...defaultProps} />)

      fireEvent.click(screen.getByRole('button', { name: /open panel/i }))

      const dialog = screen.getByRole('dialog')
      expect(dialog).toHaveAttribute('aria-label', 'Chat about diagram')
    })

    it('textarea has correct aria-label', () => {
      render(<ChatBubble {...defaultProps} />)

      fireEvent.click(screen.getByRole('button', { name: /open panel/i }))

      const textarea = screen.getByPlaceholderText(/describe changes/i)
      expect(textarea).toHaveAttribute('aria-label')
    })

    it('info tooltip is keyboard accessible', () => {
      render(<ChatBubble {...defaultProps} />)

      fireEvent.click(screen.getByRole('button', { name: /open panel/i }))

      const infoButton = screen.getByRole('button', { name: /view keyboard shortcuts/i })
      expect(infoButton).toBeInTheDocument()
    })

    it('shows tooltip on focus', async () => {
      render(<ChatBubble {...defaultProps} />)

      fireEvent.click(screen.getByRole('button', { name: /open panel/i }))

      const infoButton = screen.getByRole('button', { name: /view keyboard shortcuts/i })
      fireEvent.focus(infoButton)

      // Check tooltip becomes visible
      const tooltip = screen.getByRole('tooltip')
      expect(tooltip).toHaveClass('visible')
    })
  })

  describe('edge cases', () => {
    it('handles missing startLine/endLine gracefully', async () => {
      const { executePromptTemplate } = await import('../../../utils/panelUtils')

      render(
        <ChatBubble
          mermaidCode="flowchart TD"
          filePath="/path/file.md"
          transform={{ scale: 1, translateX: 0, translateY: 0 }}
          onZoomIn={vi.fn()}
          onZoomOut={vi.fn()}
          onFitToView={vi.fn()}
          onReset={vi.fn()}
          zoomInDisabled={false}
          zoomOutDisabled={false}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: /open panel/i }))
      const textarea = screen.getByPlaceholderText(/describe changes/i) as HTMLTextAreaElement

      typeIntoTextarea(textarea, 'Test message')
      fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true })

      await waitFor(() => {
        expect(executePromptTemplate).toHaveBeenCalledWith('diagram-chat', expect.objectContaining({
          fileRef: '@/path/file.md',
          lineRange: undefined
        }))
      })
    })

    it('trims whitespace from message', async () => {
      const { executePromptTemplate } = await import('../../../utils/panelUtils')

      render(<ChatBubble {...defaultProps} />)

      fireEvent.click(screen.getByRole('button', { name: /open panel/i }))
      const textarea = screen.getByPlaceholderText(/describe changes/i) as HTMLTextAreaElement

      typeIntoTextarea(textarea, '   Trimmed message   ')
      fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true })

      await waitFor(() => {
        expect(executePromptTemplate).toHaveBeenCalledWith('diagram-chat', expect.objectContaining({
          userInstruction: 'Trimmed message'
        }))
      })
    })
  })
})
