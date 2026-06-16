// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, afterEach } from 'vitest'
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
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('dismisses toast when close button is clicked', async () => {
      const user = userEvent.setup()

      render(
        <ToastProvider>
          <ToastNotification />
        </ToastProvider>
      )

      // Show a toast with long duration to prevent auto-dismiss
      showGlobalToast({ title: 'Test', message: 'Click to close', type: 'info', duration: 60000 })

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
      const user = userEvent.setup()

      render(
        <ToastProvider>
          <ToastNotification />
        </ToastProvider>
      )

      showGlobalToast({ title: 'Test', message: 'Press Enter', type: 'info', duration: 60000 })

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
      const user = userEvent.setup()

      render(
        <ToastProvider>
          <ToastNotification />
        </ToastProvider>
      )

      showGlobalToast({ title: 'Test', message: 'Press Space', type: 'info', duration: 60000 })

      await waitFor(() => {
        expect(screen.getByText('Test')).toBeInTheDocument()
      })

      const closeButton = screen.getByRole('button', { name: 'Close' })
      closeButton.focus()
      await user.keyboard(' ')

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

      showGlobalToast({ title: 'Test', message: 'Tab to focus', type: 'info', duration: 60000 })

      await waitFor(() => {
        expect(screen.getByText('Test')).toBeInTheDocument()
      })

      const closeButton = screen.getByRole('button', { name: 'Close' })
      expect(closeButton).toHaveAttribute('tabIndex', '0')
    })

    it('toast auto-dismisses after timeout if not manually closed', async () => {
      vi.useFakeTimers()

      render(
        <ToastProvider>
          <ToastNotification />
        </ToastProvider>
      )

      showGlobalToast({ title: 'Test', message: 'Auto dismiss', type: 'info', duration: 1000 })

      // Wait for toast to appear (use act for state updates with fake timers)
      await vi.waitFor(() => {
        expect(screen.getByText('Test')).toBeInTheDocument()
      })

      // Fast-forward time to trigger auto-dismiss
      await vi.advanceTimersByTimeAsync(1000)

      await vi.waitFor(() => {
        expect(screen.queryByText('Test')).not.toBeInTheDocument()
      })

      vi.useRealTimers()
    })

    it('close button has aria-label for screen readers', async () => {
      render(
        <ToastProvider>
          <ToastNotification />
        </ToastProvider>
      )

      showGlobalToast({ title: 'Test', message: 'ARIA test', type: 'info', duration: 60000 })

      await waitFor(() => {
        expect(screen.getByText('Test')).toBeInTheDocument()
      })

      const closeButton = screen.getByRole('button', { name: 'Close' })
      expect(closeButton).toHaveAttribute('aria-label', 'Close')
    })

    it('mounts the two persistent, empty live regions before any toast (UX-003)', () => {
      // Decoupled live-region pattern: TWO always-mounted, visually-hidden live
      // regions exist in the DOM even with zero toasts so assistive tech can
      // observe later text injections (MDN: a region mounted together with its
      // text is unreliable). They start empty; the visual container carries NO
      // live role (no nested live regions).
      render(
        <ToastProvider>
          <ToastNotification />
        </ToastProvider>
      )

      const polite = screen.getByTestId('toast-live-polite')
      expect(polite).toBeInTheDocument()
      expect(polite).toHaveAttribute('role', 'status')
      expect(polite).toHaveTextContent('')

      const alert = screen.getByTestId('toast-live-alert')
      expect(alert).toBeInTheDocument()
      expect(alert).toHaveAttribute('role', 'alert')
      expect(alert).toHaveTextContent('')

      // The visual container is no longer a live region.
      const container = screen.getByTestId('toast-container')
      expect(container).not.toHaveAttribute('role')
      expect(container).not.toHaveAttribute('aria-live')

      // No toast items yet.
      expect(screen.queryByTestId('toast-success')).not.toBeInTheDocument()
    })

    it('role=alert implies assertive and carries no redundant aria-live (UX-003)', () => {
      render(
        <ToastProvider>
          <ToastNotification />
        </ToastProvider>
      )

      const alert = screen.getByTestId('toast-live-alert')
      expect(alert).toHaveAttribute('role', 'alert')
      // role="alert" already implies assertive — do NOT add aria-live.
      expect(alert).not.toHaveAttribute('aria-live')
    })

    it('routes error toast text to the alert region, not the polite region (UX-003)', async () => {
      render(
        <ToastProvider>
          <ToastNotification />
        </ToastProvider>
      )

      showGlobalToast({ title: 'Clipboard error', message: 'Boom', type: 'error', duration: 60000 })

      await waitFor(() => {
        expect(screen.getByTestId('toast-live-alert')).toHaveTextContent('Clipboard error')
      })
      expect(screen.getByTestId('toast-live-alert')).toHaveTextContent('Boom')
      // The polite region stays empty for an error.
      expect(screen.getByTestId('toast-live-polite')).toHaveTextContent('')
    })

    it('routes non-error toast text to the polite region, not the alert region (UX-003)', async () => {
      render(
        <ToastProvider>
          <ToastNotification />
        </ToastProvider>
      )

      showGlobalToast({ title: 'Saved', message: 'OK', type: 'success', duration: 60000 })

      await waitFor(() => {
        expect(screen.getByTestId('toast-live-polite')).toHaveTextContent('Saved')
      })
      expect(screen.getByTestId('toast-live-polite')).toHaveTextContent('OK')
      // The alert region stays empty for a non-error.
      expect(screen.getByTestId('toast-live-alert')).toHaveTextContent('')
    })

    it('visual toast items carry no live role; Close button stays focusable (UX-003)', async () => {
      render(
        <ToastProvider>
          <ToastNotification />
        </ToastProvider>
      )

      showGlobalToast({ title: 'Saved', message: 'OK', type: 'success', duration: 60000 })

      const item = await screen.findByTestId('toast-success')
      // No live role on the visual item — announcements are owned by the hidden
      // regions. The item must NOT be aria-hidden so the Close button stays
      // reachable by assistive tech.
      expect(item).not.toHaveAttribute('role')
      expect(item).not.toHaveAttribute('aria-live')
      expect(item).not.toHaveAttribute('aria-hidden')

      const closeButton = screen.getByRole('button', { name: 'Close' })
      expect(closeButton).toBeInTheDocument()
      expect(closeButton).toHaveAttribute('tabIndex', '0')
    })

    it('can close multiple toasts individually', async () => {
      const user = userEvent.setup()

      render(
        <ToastProvider>
          <ToastNotification />
        </ToastProvider>
      )

      // Show two toasts with long duration
      showGlobalToast({ title: 'Toast 1', message: 'Message 1', type: 'info', duration: 60000 })
      showGlobalToast({ title: 'Toast 2', message: 'Message 2', type: 'success', duration: 60000 })

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
