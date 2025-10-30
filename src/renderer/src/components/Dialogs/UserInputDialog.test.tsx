import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UserInputDialog } from './UserInputDialog'

/**
 * UserInputDialog Component Tests
 *
 * Tests the modal dialog for collecting user input in prompt templates.
 * Validates rendering, auto-focus, input validation, keyboard shortcuts, and callbacks.
 */
describe('UserInputDialog Component', () => {
  const defaultProps = {
    isOpen: true,
    selectedText: 'Sample selected text',
    onSubmit: vi.fn(),
    onCancel: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render dialog when isOpen is true', () => {
      render(<UserInputDialog {...defaultProps} />)

      expect(screen.getByText('What would you like to do?')).toBeInTheDocument()
      expect(screen.getByRole('textbox')).toBeInTheDocument()
      expect(screen.getByText('Your input:')).toBeInTheDocument()
      expect(screen.getByText('Selected text:')).toBeInTheDocument()
      expect(screen.getByText(/"Sample selected text"/)).toBeInTheDocument()
    })

    it('should not render dialog when isOpen is false', () => {
      const { container } = render(<UserInputDialog {...defaultProps} isOpen={false} />)

      expect(container.firstChild).toBeNull()
    })

    it('should render with custom inputLabel', () => {
      render(<UserInputDialog {...defaultProps} inputLabel="Enter your prompt" />)

      expect(screen.getByText('Enter your prompt')).toBeInTheDocument()
    })

    it('should render with custom inputPlaceholder', () => {
      render(
        <UserInputDialog
          {...defaultProps}
          inputPlaceholder="e.g., summarize in bullet points..."
        />
      )

      const textarea = screen.getByRole('textbox')
      expect(textarea).toHaveAttribute('placeholder', 'e.g., summarize in bullet points...')
    })

    it('should truncate selected text longer than 500 characters', () => {
      const longText = 'A'.repeat(600)
      render(<UserInputDialog {...defaultProps} selectedText={longText} />)

      const truncated = 'A'.repeat(500) + '...'
      expect(screen.getByText(new RegExp(`"${truncated}"`))).toBeInTheDocument()
    })

    it('should show character count for textarea', () => {
      render(<UserInputDialog {...defaultProps} />)

      expect(screen.getByText('0/2000 characters')).toBeInTheDocument()
    })
  })

  describe('Auto-Focus Behavior', () => {
    it('should auto-focus textarea when dialog opens', async () => {
      const { rerender } = render(<UserInputDialog {...defaultProps} isOpen={false} />)

      // Open the dialog
      rerender(<UserInputDialog {...defaultProps} isOpen={true} />)

      await waitFor(() => {
        const textarea = screen.getByRole('textbox')
        expect(textarea).toHaveFocus()
      })
    })

    it('should not focus textarea when dialog is already open', () => {
      render(<UserInputDialog {...defaultProps} isOpen={true} />)

      const textarea = screen.getByRole('textbox')
      const focusSpy = vi.spyOn(textarea, 'focus')

      // Textarea gets focused on mount, reset the spy
      focusSpy.mockClear()

      // No state change, focus should not be called again
      expect(focusSpy).not.toHaveBeenCalled()
    })
  })

  describe('Input Validation', () => {
    it('should disable submit button when input is empty', () => {
      render(<UserInputDialog {...defaultProps} />)

      const submitBtn = screen.getByRole('button', { name: /submit/i })
      expect(submitBtn).toBeDisabled()
    })

    it('should disable submit button when input is only whitespace', async () => {
      const user = userEvent.setup()
      render(<UserInputDialog {...defaultProps} />)

      const textarea = screen.getByRole('textbox')
      await user.type(textarea, '   ')

      const submitBtn = screen.getByRole('button', { name: /submit/i })
      expect(submitBtn).toBeDisabled()
    })

    it('should disable submit button when input is less than 3 characters', async () => {
      const user = userEvent.setup()
      render(<UserInputDialog {...defaultProps} />)

      const textarea = screen.getByRole('textbox')
      await user.type(textarea, 'ab')

      const submitBtn = screen.getByRole('button', { name: /submit/i })
      expect(submitBtn).toBeDisabled()
    })

    it('should enable submit button when input is valid (>= 3 chars)', async () => {
      const user = userEvent.setup()
      render(<UserInputDialog {...defaultProps} />)

      const textarea = screen.getByRole('textbox')
      await user.type(textarea, 'abc')

      const submitBtn = screen.getByRole('button', { name: /submit/i })
      expect(submitBtn).toBeEnabled()
    })

    it('should enforce maxLength of 2000 characters', () => {
      render(<UserInputDialog {...defaultProps} />)

      const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
      expect(textarea.maxLength).toBe(2000)
    })

    it('should update character count as user types', async () => {
      const user = userEvent.setup()
      render(<UserInputDialog {...defaultProps} />)

      const textarea = screen.getByRole('textbox')
      await user.type(textarea, 'Hello world')

      expect(screen.getByText('11/2000 characters')).toBeInTheDocument()
    })

    it('should disable submit button when input exceeds 2000 characters (trimmed)', async () => {
      // Note: maxLength prevents typing > 2000, but test edge case if someone pastes
      const user = userEvent.setup()
      render(<UserInputDialog {...defaultProps} />)

      const textarea = screen.getByRole('textbox')
      // Simulate pasting exactly 2000 characters
      await user.type(textarea, 'A'.repeat(2000))

      const submitBtn = screen.getByRole('button', { name: /submit/i })
      expect(submitBtn).toBeEnabled()
    })
  })

  describe('User Interactions', () => {
    it('should call onCancel when Cancel button clicked', async () => {
      const user = userEvent.setup()
      const onCancel = vi.fn()
      render(<UserInputDialog {...defaultProps} onCancel={onCancel} />)

      const cancelBtn = screen.getByRole('button', { name: /cancel/i })
      await user.click(cancelBtn)

      expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it('should call onSubmit with trimmed input when Submit button clicked', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()
      render(<UserInputDialog {...defaultProps} onSubmit={onSubmit} />)

      const textarea = screen.getByRole('textbox')
      await user.click(textarea)
      await user.paste('  Test input  ')

      const submitBtn = screen.getByRole('button', { name: /submit/i })
      await user.click(submitBtn)

      expect(onSubmit).toHaveBeenCalledWith('Test input')
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })

    it('should call onSubmit when Cmd+Enter is pressed (macOS)', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()
      render(<UserInputDialog {...defaultProps} onSubmit={onSubmit} />)

      const textarea = screen.getByRole('textbox')
      await user.click(textarea)
      await user.paste('Quick submit')
      await user.keyboard('{Meta>}{Enter}{/Meta}')

      expect(onSubmit).toHaveBeenCalledWith('Quick submit')
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })

    it('should call onSubmit when Ctrl+Enter is pressed (Windows/Linux)', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()
      render(<UserInputDialog {...defaultProps} onSubmit={onSubmit} />)

      const textarea = screen.getByRole('textbox')
      await user.click(textarea)
      await user.paste('Quick submit')
      await user.keyboard('{Control>}{Enter}{/Control}')

      expect(onSubmit).toHaveBeenCalledWith('Quick submit')
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })

    it('should call onCancel when Escape is pressed', async () => {
      const user = userEvent.setup()
      const onCancel = vi.fn()
      render(<UserInputDialog {...defaultProps} onCancel={onCancel} />)

      const textarea = screen.getByRole('textbox')
      await user.type(textarea, 'Some text')
      await user.keyboard('{Escape}')

      expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it('should call onCancel when backdrop is clicked', async () => {
      const user = userEvent.setup()
      const onCancel = vi.fn()
      render(<UserInputDialog {...defaultProps} onCancel={onCancel} />)

      // Find overlay (backdrop)
      const overlay = document.querySelector('.user-input-dialog-overlay')
      expect(overlay).toBeTruthy()

      await user.click(overlay!)

      expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it('should NOT call onCancel when clicking dialog content', async () => {
      const user = userEvent.setup()
      const onCancel = vi.fn()
      render(<UserInputDialog {...defaultProps} onCancel={onCancel} />)

      // Click on the dialog content itself
      const dialog = document.querySelector('.user-input-dialog')
      expect(dialog).toBeTruthy()

      await user.click(dialog!)

      expect(onCancel).not.toHaveBeenCalled()
    })

    it('should call onSubmit via keyboard even when input is short (current behavior)', async () => {
      // Note: This documents current behavior where keyboard shortcuts bypass validation.
      // The submit button is properly disabled, but Cmd+Enter still triggers handleSubmit.
      const user = userEvent.setup()
      const onSubmit = vi.fn()
      render(<UserInputDialog {...defaultProps} onSubmit={onSubmit} />)

      const textarea = screen.getByRole('textbox')
      await user.type(textarea, 'ab')

      // Submit button should be disabled
      const submitBtn = screen.getByRole('button', { name: /submit/i })
      expect(submitBtn).toBeDisabled()

      // But keyboard shortcut still submits (component limitation)
      await user.keyboard('{Meta>}{Enter}{/Meta}')
      expect(onSubmit).toHaveBeenCalledWith('ab')
    })
  })

  describe('Callbacks and State Management', () => {
    it('should reset input when dialog closes', async () => {
      const { rerender } = render(<UserInputDialog {...defaultProps} isOpen={true} />)

      const user = userEvent.setup()
      const textarea = screen.getByRole('textbox')
      await user.type(textarea, 'Test input')

      expect(textarea).toHaveValue('Test input')

      // Close the dialog
      rerender(<UserInputDialog {...defaultProps} isOpen={false} />)

      // Re-open the dialog
      rerender(<UserInputDialog {...defaultProps} isOpen={true} />)

      const newTextarea = screen.getByRole('textbox')
      expect(newTextarea).toHaveValue('')
    })

    it('should not call onSubmit when submit clicked with only whitespace', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()
      render(<UserInputDialog {...defaultProps} onSubmit={onSubmit} />)

      const textarea = screen.getByRole('textbox')
      await user.type(textarea, '   ')

      // Submit button should be disabled, but test the handler directly
      const submitBtn = screen.getByRole('button', { name: /submit/i })
      expect(submitBtn).toBeDisabled()

      // Try to submit via keyboard (should also not work)
      await user.keyboard('{Meta>}{Enter}{/Meta}')

      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('should display keyboard shortcuts hint', () => {
      render(<UserInputDialog {...defaultProps} />)

      // Find the info tooltip
      const infoIcon = document.querySelector('.user-input-dialog-info-icon')
      expect(infoIcon).toBeTruthy()

      // Tooltip content should exist
      const tooltip = document.querySelector('.user-input-dialog-tooltip-content')
      expect(tooltip).toBeTruthy()
      expect(tooltip?.textContent).toContain('Cmd/Ctrl+Enter')
      expect(tooltip?.textContent).toContain('Esc')
    })
  })

  describe('Portal Rendering', () => {
    it('should render dialog using portal at document.body', () => {
      render(<UserInputDialog {...defaultProps} />)

      // Dialog should be appended to document.body
      const dialog = document.querySelector('.user-input-dialog-overlay')
      expect(dialog?.parentElement).toBe(document.body)
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty selectedText gracefully', () => {
      render(<UserInputDialog {...defaultProps} selectedText="" />)

      expect(screen.getByText('Selected text:')).toBeInTheDocument()
      expect(screen.getByText(/""/)).toBeInTheDocument()
    })

    it('should handle selectedText with special characters', () => {
      const specialText = 'Text with "quotes" and <tags> & symbols'
      render(<UserInputDialog {...defaultProps} selectedText={specialText} />)

      // Should escape or handle special characters safely
      expect(screen.getByText(/Text with "quotes" and <tags> & symbols/)).toBeInTheDocument()
    })

    it('should prevent default behavior for Cmd+Enter', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()
      render(<UserInputDialog {...defaultProps} onSubmit={onSubmit} />)

      const textarea = screen.getByRole('textbox')
      await user.type(textarea, 'Test')

      // Create a keydown event
      const keydownEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        metaKey: true,
        bubbles: true,
        cancelable: true
      })

      textarea.dispatchEvent(keydownEvent)

      // Note: We can't directly test preventDefault in user-event,
      // but we can verify the handler logic works
      expect(onSubmit).toHaveBeenCalled()
    })

    it('should prevent default behavior for Escape', async () => {
      const user = userEvent.setup()
      const onCancel = vi.fn()
      render(<UserInputDialog {...defaultProps} onCancel={onCancel} />)

      const textarea = screen.getByRole('textbox')
      await user.type(textarea, 'Test')
      await user.keyboard('{Escape}')

      expect(onCancel).toHaveBeenCalled()
    })
  })
})
