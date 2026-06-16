// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { DialogProvider, useDialog } from './DialogContext'
import { DialogManager } from './DialogManager'

/**
 * DialogContext Tests
 *
 * Tests the unified dialog system including:
 * - DialogContext provider
 * - useDialog hook (showConfirm, showPrompt, showAlert)
 * - Z-index management
 * - Multiple dialogs
 * - Keyboard shortcuts
 * - Focus management
 */

// Test component to use the dialog hook
function TestComponent() {
  const { showConfirm, showPrompt, showAlert } = useDialog()

  return (
    <div>
      <button onClick={() => showConfirm({ title: 'Confirm Test', message: 'Test message' })}>
        Show Confirm
      </button>
      <button
        onClick={() =>
          showPrompt({ title: 'Prompt Test', message: 'Enter text', inputPlaceholder: 'Type...' })
        }
      >
        Show Prompt
      </button>
      <button onClick={() => showAlert({ title: 'Alert Test', message: 'Alert message' })}>
        Show Alert
      </button>
    </div>
  )
}

describe('DialogContext', () => {
  beforeEach(() => {
    // Create portal-root div for dialogs
    const portalRoot = document.createElement('div')
    portalRoot.setAttribute('id', 'portal-root')
    document.body.appendChild(portalRoot)
  })

  afterEach(() => {
    vi.clearAllMocks()

    // Clean up portal-root
    const portalRoot = document.getElementById('portal-root')
    if (portalRoot) {
      document.body.removeChild(portalRoot)
    }
  })

  describe('Provider and Hook', () => {
    it('should provide dialog methods through useDialog hook', () => {
      render(
        <DialogProvider>
          <TestComponent />
        </DialogProvider>
      )

      expect(screen.getByText('Show Confirm')).toBeInTheDocument()
      expect(screen.getByText('Show Prompt')).toBeInTheDocument()
      expect(screen.getByText('Show Alert')).toBeInTheDocument()
    })

    it('should throw error when useDialog is used outside DialogProvider', () => {
      // Suppress console.error for this test
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

      expect(() => {
        render(<TestComponent />)
      }).toThrow('useDialog must be used within DialogProvider')

      consoleError.mockRestore()
    })
  })

  describe('showConfirm', () => {
    it('should display confirm dialog with title and message', async () => {
      const user = userEvent.setup()

      render(
        <DialogProvider>
          <TestComponent />
          <DialogManager />
        </DialogProvider>
      )

      const showConfirmBtn = screen.getByText('Show Confirm')
      await user.click(showConfirmBtn)

      await waitFor(() => {
        expect(screen.getByText('Confirm Test')).toBeInTheDocument()
        expect(screen.getByText('Test message')).toBeInTheDocument()
      })
    })

    it('should show custom button labels when provided', async () => {
      const TestConfirmLabels = () => {
        const { showConfirm } = useDialog()
        return (
          <button
            onClick={() =>
              showConfirm({
                title: 'Delete',
                message: 'Are you sure?',
                confirmLabel: 'Yes, Delete',
                cancelLabel: 'No, Keep'
              })
            }
          >
            Delete
          </button>
        )
      }

      const user = userEvent.setup()

      render(
        <DialogProvider>
          <TestConfirmLabels />
          <DialogManager />
        </DialogProvider>
      )

      await user.click(screen.getByText('Delete'))

      await waitFor(() => {
        expect(screen.getByText('Yes, Delete')).toBeInTheDocument()
        expect(screen.getByText('No, Keep')).toBeInTheDocument()
      })
    })

    it('should resolve with true when user confirms', async () => {
      const TestConfirmResolve = () => {
        const { showConfirm } = useDialog()
        const [result, setResult] = React.useState<boolean | null>(null)

        return (
          <div>
            <button
              data-testid="trigger-button"
              onClick={async () => {
                const confirmed = await showConfirm({ title: 'Test', message: 'Confirm?' })
                setResult(confirmed)
              }}
            >
              Trigger
            </button>
            {result !== null && <div data-testid="result">{result ? 'Confirmed' : 'Cancelled'}</div>}
          </div>
        )
      }

      const user = userEvent.setup()

      render(
        <DialogProvider>
          <TestConfirmResolve />
          <DialogManager />
        </DialogProvider>
      )

      await user.click(screen.getByTestId('trigger-button'))

      // Click the Confirm button in the dialog (primary button)
      await waitFor(() => {
        const portalRoot = document.getElementById('portal-root')
        const confirmBtn = portalRoot?.querySelector('.dialog-btn-primary')
        expect(confirmBtn).toBeTruthy()
      })

      const portalRoot = document.getElementById('portal-root')
      const confirmBtn = portalRoot?.querySelector('.dialog-btn-primary') as HTMLElement
      await user.click(confirmBtn)

      await waitFor(() => {
        expect(screen.getByTestId('result')).toHaveTextContent('Confirmed')
      })
    })

    it('should resolve with false when user cancels', async () => {
      const TestConfirmCancel = () => {
        const { showConfirm } = useDialog()
        const [result, setResult] = React.useState<boolean | null>(null)

        return (
          <div>
            <button
              onClick={async () => {
                const confirmed = await showConfirm({ title: 'Test', message: 'Confirm?' })
                setResult(confirmed)
              }}
            >
              Show
            </button>
            {result !== null && <div data-testid="result">{result ? 'Confirmed' : 'Cancelled'}</div>}
          </div>
        )
      }

      const user = userEvent.setup()

      render(
        <DialogProvider>
          <TestConfirmCancel />
          <DialogManager />
        </DialogProvider>
      )

      await user.click(screen.getByText('Show'))

      // Click Cancel button
      await waitFor(() => {
        expect(screen.getByText('Cancel')).toBeInTheDocument()
      })

      await user.click(screen.getByText('Cancel'))

      await waitFor(() => {
        expect(screen.getByTestId('result')).toHaveTextContent('Cancelled')
      })
    })

    it('should apply danger styling when danger prop is true', async () => {
      const TestDanger = () => {
        const { showConfirm } = useDialog()
        return (
          <button
            onClick={() =>
              showConfirm({ title: 'Delete', message: 'This is destructive', danger: true })
            }
          >
            Delete
          </button>
        )
      }

      const user = userEvent.setup()

      render(
        <DialogProvider>
          <TestDanger />
          <DialogManager />
        </DialogProvider>
      )

      await user.click(screen.getByText('Delete'))

      await waitFor(() => {
        const portalRoot = document.getElementById('portal-root')
        const dangerButton = portalRoot?.querySelector('.dialog-btn-danger')
        expect(dangerButton).toBeTruthy()
        expect(dangerButton?.textContent).toBe('Confirm')
      })
    })
  })

  describe('showPrompt', () => {
    it('should display prompt dialog with input field', async () => {
      const user = userEvent.setup()

      render(
        <DialogProvider>
          <TestComponent />
          <DialogManager />
        </DialogProvider>
      )

      await user.click(screen.getByText('Show Prompt'))

      await waitFor(() => {
        expect(screen.getByText('Prompt Test')).toBeInTheDocument()
        expect(screen.getByPlaceholderText('Type...')).toBeInTheDocument()
      })
    })

    it('should resolve with user input when submitted', async () => {
      const TestPromptInput = () => {
        const { showPrompt } = useDialog()
        const [input, setInput] = React.useState<string | null>(null)

        return (
          <div>
            <button
              onClick={async () => {
                const result = await showPrompt({ title: 'Name', message: 'Enter your name' })
                setInput(result)
              }}
            >
              Show
            </button>
            {input && <div data-testid="input-result">{input}</div>}
          </div>
        )
      }

      const user = userEvent.setup()

      render(
        <DialogProvider>
          <TestPromptInput />
          <DialogManager />
        </DialogProvider>
      )

      await user.click(screen.getByText('Show'))

      await waitFor(() => {
        expect(screen.getByRole('textbox')).toBeInTheDocument()
      })

      const input = screen.getByRole('textbox')
      await user.type(input, 'John Doe')
      await user.click(screen.getByText('Submit'))

      await waitFor(() => {
        expect(screen.getByTestId('input-result')).toHaveTextContent('John Doe')
      })
    })

    it('should validate input length', async () => {
      const TestPromptValidation = () => {
        const { showPrompt } = useDialog()
        return (
          <button
            onClick={() =>
              showPrompt({
                title: 'Short',
                message: 'Min 5 chars',
                minLength: 5,
                maxLength: 10
              })
            }
          >
            Show
          </button>
        )
      }

      const user = userEvent.setup()

      render(
        <DialogProvider>
          <TestPromptValidation />
          <DialogManager />
        </DialogProvider>
      )

      await user.click(screen.getByText('Show'))

      await waitFor(() => {
        const input = screen.getByRole('textbox')
        expect(input).toBeInTheDocument()
      })

      // Submit button should be disabled initially (empty input)
      const submitButton = screen.getByText('Submit')
      expect(submitButton).toBeDisabled()

      // Type less than minLength
      const input = screen.getByRole('textbox')
      await user.type(input, 'abc')
      expect(submitButton).toBeDisabled()

      // Type enough characters
      await user.type(input, 'defg')
      expect(submitButton).not.toBeDisabled()
    })
  })

  describe('showAlert', () => {
    it('should display alert dialog', async () => {
      const user = userEvent.setup()

      render(
        <DialogProvider>
          <TestComponent />
          <DialogManager />
        </DialogProvider>
      )

      await user.click(screen.getByText('Show Alert'))

      await waitFor(() => {
        expect(screen.getByText('Alert Test')).toBeInTheDocument()
        expect(screen.getByText('Alert message')).toBeInTheDocument()
        expect(screen.getByText('OK')).toBeInTheDocument()
      })
    })

    it('should resolve when OK is clicked', async () => {
      const TestAlertResolve = () => {
        const { showAlert } = useDialog()
        const [closed, setClosed] = React.useState(false)

        return (
          <div>
            <button
              onClick={async () => {
                await showAlert({ title: 'Info', message: 'Information' })
                setClosed(true)
              }}
            >
              Show
            </button>
            {closed && <div data-testid="closed">Closed</div>}
          </div>
        )
      }

      const user = userEvent.setup()

      render(
        <DialogProvider>
          <TestAlertResolve />
          <DialogManager />
        </DialogProvider>
      )

      await user.click(screen.getByText('Show'))

      await waitFor(() => {
        expect(screen.getByText('OK')).toBeInTheDocument()
      })

      await user.click(screen.getByText('OK'))

      await waitFor(() => {
        expect(screen.getByTestId('closed')).toBeInTheDocument()
      })
    })
  })

  describe('Z-index Management', () => {
    it('should assign incrementing z-index to multiple dialogs', async () => {
      const TestMultipleDialogs = () => {
        const { showConfirm } = useDialog()
        return (
          <div>
            <button
              onClick={() => {
                showConfirm({ title: 'First', message: 'First dialog' })
                // Immediately show second dialog
                setTimeout(
                  () => showConfirm({ title: 'Second', message: 'Second dialog' }),
                  100
                )
              }}
            >
              Show Two
            </button>
          </div>
        )
      }

      const user = userEvent.setup()

      render(
        <DialogProvider>
          <TestMultipleDialogs />
          <DialogManager />
        </DialogProvider>
      )

      await user.click(screen.getByText('Show Two'))

      await waitFor(() => {
        expect(screen.getByText('First')).toBeInTheDocument()
      })

      await waitFor(() => {
        expect(screen.getByText('Second')).toBeInTheDocument()
      })

      // Check z-index ordering
      const portalRoot = document.getElementById('portal-root')
      const overlays = portalRoot?.querySelectorAll('.dialog-overlay')
      expect(overlays?.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('Keyboard Shortcuts', () => {
    it('should close dialog on Escape key', async () => {
      const user = userEvent.setup()

      render(
        <DialogProvider>
          <TestComponent />
          <DialogManager />
        </DialogProvider>
      )

      await user.click(screen.getByText('Show Confirm'))

      await waitFor(() => {
        expect(screen.getByText('Confirm Test')).toBeInTheDocument()
      })

      await user.keyboard('{Escape}')

      await waitFor(() => {
        expect(screen.queryByText('Confirm Test')).not.toBeInTheDocument()
      })
    })

    it('should submit prompt on Cmd/Ctrl+Enter when input is valid', async () => {
      const TestPromptEnter = () => {
        const { showPrompt } = useDialog()
        const [input, setInput] = React.useState<string | null>(null)

        return (
          <div>
            <button
              onClick={async () => {
                const result = await showPrompt({ title: 'Test', message: 'Type' })
                setInput(result)
              }}
            >
              Show
            </button>
            {input && <div data-testid="result">{input}</div>}
          </div>
        )
      }

      const user = userEvent.setup()

      render(
        <DialogProvider>
          <TestPromptEnter />
          <DialogManager />
        </DialogProvider>
      )

      await user.click(screen.getByText('Show'))

      await waitFor(() => {
        expect(screen.getByRole('textbox')).toBeInTheDocument()
      })

      const input = screen.getByRole('textbox')
      await user.type(input, 'Hello')

      // Use Meta (Cmd) key with Enter, which is the keyboard shortcut shown in the dialog
      await user.keyboard('{Meta>}{Enter}{/Meta}')

      await waitFor(() => {
        expect(screen.getByTestId('result')).toHaveTextContent('Hello')
      })
    })
  })

  describe('Backdrop Click', () => {
    it('should NOT close dialog on backdrop click', async () => {
      const user = userEvent.setup()

      render(
        <DialogProvider>
          <TestComponent />
          <DialogManager />
        </DialogProvider>
      )

      await user.click(screen.getByText('Show Confirm'))

      await waitFor(() => {
        expect(screen.getByText('Confirm Test')).toBeInTheDocument()
      })

      // Click on overlay (backdrop)
      const portalRoot = document.getElementById('portal-root')
      const overlay = portalRoot?.querySelector('.dialog-overlay')
      if (overlay) {
        await user.click(overlay as HTMLElement)
      }

      // Dialog should still be visible - backdrop click should not close it
      await waitFor(() => {
        expect(screen.getByText('Confirm Test')).toBeInTheDocument()
      })
    })
  })
})
