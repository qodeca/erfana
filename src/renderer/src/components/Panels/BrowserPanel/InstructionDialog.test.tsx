// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../utils/platform', () => ({ isMacOS: () => true, isWindows: () => false }))

import { InstructionDialog, type InstructionDialogProps } from './InstructionDialog'

function renderDialog(overrides: Partial<InstructionDialogProps> = {}) {
  const props: InstructionDialogProps = {
    action: 'ask',
    text: '',
    onText: vi.fn(),
    busy: false,
    banner: null,
    pageReloaded: false,
    frozen: false,
    onSend: vi.fn(),
    onCancel: vi.fn(),
    onBack: vi.fn(),
    onBannerAction: vi.fn(),
    target: <button type="button">Target</button>,
    sheet: false,
    ...overrides
  }
  return { props, ...render(<InstructionDialog {...props} />) }
}

describe('InstructionDialog (025-FR-031)', () => {
  it('titles each action, focuses the field and passes typing on', () => {
    const { props, rerender } = renderDialog()
    // Not modal: nothing traps Tab and the terminal stays reachable (design § Instruction dialog, M-46).
    expect(screen.getByRole('dialog', { name: 'Ask about this element' })).toHaveAttribute('aria-modal', 'false')
    const field = screen.getByRole('textbox', { name: 'Your question' })
    expect(field).toHaveFocus()
    fireEvent.change(field, { target: { value: 'why?' } })
    expect(props.onText).toHaveBeenCalledWith('why?')
    rerender(<InstructionDialog {...props} action="change" />)
    expect(screen.getByRole('dialog', { name: 'Change this element' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'What to change' })).toBeInTheDocument()
  })

  it('keeps a blank instruction with an inline error tied to the field', () => {
    const { props, rerender } = renderDialog({ text: '   ', action: 'prompt' })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(props.onSend).not.toHaveBeenCalled()
    const field = screen.getByRole('textbox', { name: 'Your prompt' })
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Type your prompt before sending.')
    // The Form card's error contract: red edge, icon, message.
    expect(alert.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveAccessibleDescription(/Type your prompt before sending\./)
    fireEvent.change(field, { target: { value: 'go' } })
    rerender(<InstructionDialog {...props} text="go" />)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('sends on Cmd+Enter and the Send button, never while busy or composing', () => {
    const { props, rerender } = renderDialog({ text: 'Make it blue' })
    const dialog = screen.getByRole('dialog')
    fireEvent.keyDown(dialog, { key: 'Enter' })
    expect(props.onSend).not.toHaveBeenCalled()
    fireEvent.keyDown(dialog, { key: 'Enter', metaKey: true, isComposing: true })
    expect(props.onSend).not.toHaveBeenCalled()
    fireEvent.keyDown(dialog, { key: 'Enter', metaKey: true })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(props.onSend).toHaveBeenCalledTimes(2)
    rerender(<InstructionDialog {...props} busy />)
    expect(screen.getByRole('button', { name: 'Sending…' })).toHaveAttribute('aria-busy', 'true')
    // While the prompt waits for Enter the text cannot change, and Cancel says why it does nothing (round-3 UX review).
    expect(screen.getByRole('textbox')).toHaveAttribute('readonly')
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveAttribute('title', 'Already sending – the prompt is in the terminal')
    fireEvent.click(screen.getByRole('button', { name: 'Sending…' }))
    expect(props.onSend).toHaveBeenCalledTimes(2)
  })

  it('cancels on Esc and Cancel, and goes back to the actions', () => {
    const { props } = renderDialog()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(props.onCancel).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: 'Back to actions' }))
    expect(props.onBack).toHaveBeenCalledOnce()
  })

  it('says the page reloaded, the page is paused, and focuses a guard button', () => {
    const { props } = renderDialog({
      pageReloaded: true,
      frozen: true,
      banner: { kind: 'guardNoTerminal', text: 'No terminal is open.', action: 'openTerminal' }
    })
    expect(screen.getByRole('status')).toHaveTextContent('The page reloaded – the capture shows the page as you picked it.')
    expect(screen.getByText('Page paused')).toBeInTheDocument()
    const open = screen.getByRole('button', { name: 'Open terminal' })
    expect(open).toHaveFocus()
    fireEvent.click(open)
    expect(props.onBannerAction).toHaveBeenCalledWith('openTerminal')
    expect(screen.getByText('Sends to')).toBeInTheDocument()
  })
})
