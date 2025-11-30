import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { showGlobalToast, subscribeGlobalToasts } from './toastService'
import { ToastNotification } from './ToastNotification'
import { ToastProvider } from './ToastContext'

describe('ToastNotification', () => {
  it('dispatches and receives global toast events', () => {
    const handler = vi.fn()
    const unsubscribe = subscribeGlobalToasts(handler)

    const payload = { title: 'Hello', message: 'World', type: 'info' as const, duration: 500 }
    showGlobalToast(payload)

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(payload)

    // Unsubscribe and ensure no more calls
    unsubscribe()
    showGlobalToast(payload)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  describe('Close Button Functionality', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.restoreAllMocks()
      vi.useRealTimers()
    })

    it('dismisses toast when close button is clicked', async () => {
      const user = userEvent.setup({ delay: null })

      render(
        <ToastProvider>
          <ToastNotification />
        </ToastProvider>
      )

      // Show a toast
      showGlobalToast({ title: 'Test', message: 'Click to close', type: 'info', duration: 5000 })

      // Wait for toast to appear
      await waitFor(() => {
        expect(screen.getByText('Test')).toBeInTheDocument()
      })

      // Click close button
      const closeButton = screen.getByRole('button', { name: 'Close' })
      await user.click(closeButton)

      // Toast should be removed
      await waitFor(() => {
        expect(screen.queryByText('Test')).not.toBeInTheDocument()
      })
    })

    it('dismisses toast when Enter key is pressed on close button', async () => {
      const user = userEvent.setup({ delay: null })

      render(
        <ToastProvider>
          <ToastNotification />
        </ToastProvider>
      )

      showGlobalToast({ title: 'Test', message: 'Press Enter', type: 'info', duration: 5000 })

      await waitFor(() => {
        expect(screen.getByText('Test')).toBeInTheDocument()
      })

      const closeButton = screen.getByRole('button', { name: 'Close' })
      closeButton.focus()
      await user.keyboard('{Enter}')

      await waitFor(() => {
        expect(screen.queryByText('Test')).not.toBeInTheDocument()
      })
    })

    it('dismisses toast when Space key is pressed on close button', async () => {
      const user = userEvent.setup({ delay: null })

      render(
        <ToastProvider>
          <ToastNotification />
        </ToastProvider>
      )

      showGlobalToast({ title: 'Test', message: 'Press Space', type: 'info', duration: 5000 })

      await waitFor(() => {
        expect(screen.getByText('Test')).toBeInTheDocument()
      })

      const closeButton = screen.getByRole('button', { name: 'Close' })
      closeButton.focus()
      await user.keyboard('{ }')

      await waitFor(() => {
        expect(screen.queryByText('Test')).not.toBeInTheDocument()
      })
    })

    it('close button is keyboard focusable with tabIndex', async () => {
      render(
        <ToastProvider>
          <ToastNotification />
        </ToastProvider>
      )

      showGlobalToast({ title: 'Test', message: 'Tab to focus', type: 'info', duration: 5000 })

      await waitFor(() => {
        expect(screen.getByText('Test')).toBeInTheDocument()
      })

      const closeButton = screen.getByRole('button', { name: 'Close' })
      expect(closeButton).toHaveAttribute('tabIndex', '0')
    })

    it('toast auto-dismisses after timeout if not manually closed', async () => {
      render(
        <ToastProvider>
          <ToastNotification />
        </ToastProvider>
      )

      showGlobalToast({ title: 'Test', message: 'Auto dismiss', type: 'info', duration: 1000 })

      await waitFor(() => {
        expect(screen.getByText('Test')).toBeInTheDocument()
      })

      // Fast-forward time to trigger auto-dismiss
      vi.advanceTimersByTime(1000)

      await waitFor(() => {
        expect(screen.queryByText('Test')).not.toBeInTheDocument()
      })
    })

    it('close button has aria-label for screen readers', async () => {
      render(
        <ToastProvider>
          <ToastNotification />
        </ToastProvider>
      )

      showGlobalToast({ title: 'Test', message: 'ARIA test', type: 'info', duration: 5000 })

      await waitFor(() => {
        expect(screen.getByText('Test')).toBeInTheDocument()
      })

      const closeButton = screen.getByRole('button', { name: 'Close' })
      expect(closeButton).toHaveAttribute('aria-label', 'Close')
    })

    it('can close multiple toasts individually', async () => {
      const user = userEvent.setup({ delay: null })

      render(
        <ToastProvider>
          <ToastNotification />
        </ToastProvider>
      )

      // Show two toasts
      showGlobalToast({ title: 'Toast 1', message: 'Message 1', type: 'info', duration: 5000 })
      showGlobalToast({ title: 'Toast 2', message: 'Message 2', type: 'success', duration: 5000 })

      await waitFor(() => {
        expect(screen.getByText('Toast 1')).toBeInTheDocument()
        expect(screen.getByText('Toast 2')).toBeInTheDocument()
      })

      // Close first toast
      const closeButtons = screen.getAllByRole('button', { name: 'Close' })
      await user.click(closeButtons[0])

      await waitFor(() => {
        expect(screen.queryByText('Toast 1')).not.toBeInTheDocument()
        expect(screen.getByText('Toast 2')).toBeInTheDocument()
      })
    })
  })
})
