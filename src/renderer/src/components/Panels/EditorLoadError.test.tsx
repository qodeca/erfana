// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for {@link EditorLoadError}: the failed-load state names the reason
 * and offers a retry that works from the keyboard.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditorLoadError } from './EditorLoadError'

describe('EditorLoadError', () => {
  const message = '"a.md" could not be opened: permission denied.'

  it('shows the reason, not "No file open"', () => {
    render(<EditorLoadError message={message} onRetry={vi.fn()} />)

    expect(screen.getByText(message)).toBeInTheDocument()
    expect(screen.queryByText('No file open')).not.toBeInTheDocument()
  })

  it('retries on click', async () => {
    const onRetry = vi.fn()
    render(<EditorLoadError message={message} onRetry={onRetry} />)

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('retries from the keyboard: Tab reaches the button, Enter and Space press it', async () => {
    const onRetry = vi.fn()
    render(<EditorLoadError message={message} onRetry={onRetry} />)

    await userEvent.tab()
    const button = screen.getByRole('button', { name: 'Try again' })
    expect(button).toHaveFocus()
    expect(button).toHaveAttribute('type', 'button')
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard(' ')

    expect(onRetry).toHaveBeenCalledTimes(2)
  })

  it('uses the design-system button, not a one-off style', () => {
    render(<EditorLoadError message={message} onRetry={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Try again' })).toHaveClass('dialog-btn', 'dialog-btn-primary')
  })
})
