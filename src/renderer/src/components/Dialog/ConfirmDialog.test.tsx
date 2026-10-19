// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for {@link ConfirmDialog}'s keyboard contract.
 *
 * The point is that Enter never answers with a button the user is not on. The
 * dialog used to confirm on every Enter, so a user who tabbed to Cancel on a
 * delete / discard / quit prompt and pressed Enter still ran the destructive
 * action, and a held Enter could auto-repeat into it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ConfirmDialog } from './ConfirmDialog'

/** BaseDialog's FOCUS_DELAY_MS (10 ms), with headroom. */
const PAST_FOCUS_DELAY_MS = 20

function renderDialog(danger: boolean) {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  render(
    <ConfirmDialog
      config={{
        id: 'c1',
        title: 'Delete File',
        message: 'Delete notes.md?',
        confirmLabel: 'Delete',
        danger
      }}
      zIndex={10001}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
  return { onConfirm, onCancel }
}

/** Lets BaseDialog's initial-focus timer fire. */
async function settleFocus(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, PAST_FOCUS_DELAY_MS))
  })
}

const confirmButton = (): HTMLElement => screen.getByRole('button', { name: 'Delete' })
const cancelButton = (): HTMLElement => screen.getByRole('button', { name: 'Cancel' })
/** A non-button element inside the Enter-handling wrapper. */
const message = (): HTMLElement => screen.getByText('Delete notes.md?')

describe('ConfirmDialog', () => {
  beforeEach(() => {
    const portalRoot = document.createElement('div')
    portalRoot.id = 'portal-root'
    document.body.appendChild(portalRoot)
  })

  afterEach(() => {
    document.getElementById('portal-root')?.remove()
  })

  describe('initial focus', () => {
    it('lands on Cancel for a danger prompt', async () => {
      renderDialog(true)

      await settleFocus()

      expect(cancelButton()).toHaveFocus()
    })

    it('lands on Confirm for a non-danger prompt', async () => {
      renderDialog(false)

      await settleFocus()

      expect(confirmButton()).toHaveFocus()
    })
  })

  describe.each([
    { danger: true, kind: 'danger' },
    { danger: false, kind: 'non-danger' }
  ])('Enter on a $kind prompt', ({ danger }) => {
    it('with focus on Cancel cancels and never confirms', async () => {
      const user = userEvent.setup()
      const { onConfirm, onCancel } = renderDialog(danger)
      await settleFocus()

      cancelButton().focus()
      await user.keyboard('{Enter}')

      expect(onCancel).toHaveBeenCalledTimes(1)
      expect(onConfirm).not.toHaveBeenCalled()
    })

    it('with focus on Confirm confirms exactly once', async () => {
      const user = userEvent.setup()
      const { onConfirm, onCancel } = renderDialog(danger)
      await settleFocus()

      confirmButton().focus()
      await user.keyboard('{Enter}')

      expect(onConfirm).toHaveBeenCalledTimes(1)
      expect(onCancel).not.toHaveBeenCalled()
    })

    it(`with focus elsewhere in the dialog ${danger ? 'does nothing' : 'confirms'}`, async () => {
      const { onConfirm, onCancel } = renderDialog(danger)
      await settleFocus()

      fireEvent.keyDown(message(), { key: 'Enter' })

      expect(onConfirm).toHaveBeenCalledTimes(danger ? 0 : 1)
      expect(onCancel).not.toHaveBeenCalled()
    })

    it('with the default initial focus cancels for danger and confirms otherwise', async () => {
      const user = userEvent.setup()
      const { onConfirm, onCancel } = renderDialog(danger)
      await settleFocus()

      await user.keyboard('{Enter}')

      if (danger) {
        expect(onCancel).toHaveBeenCalledTimes(1)
        expect(onConfirm).not.toHaveBeenCalled()
      } else {
        expect(onConfirm).toHaveBeenCalledTimes(1)
        expect(onCancel).not.toHaveBeenCalled()
      }
    })
  })

  describe('auto-repeated Enter', () => {
    // Non-danger: the only case where a single Enter off a button confirms,
    // so it is the case where ignoring the repeat is observable.
    it('is ignored when focus is not on a button', async () => {
      const { onConfirm, onCancel } = renderDialog(false)
      await settleFocus()

      fireEvent.keyDown(message(), { key: 'Enter', repeat: true })

      expect(onConfirm).not.toHaveBeenCalled()
      expect(onCancel).not.toHaveBeenCalled()
    })

    it.each([
      { name: 'Confirm', button: confirmButton },
      { name: 'Cancel', button: cancelButton }
    ])('is swallowed on the $name button so it cannot activate it', async ({ button }) => {
      const { onConfirm, onCancel } = renderDialog(false)
      await settleFocus()

      // fireEvent returns false when a handler called preventDefault(), which
      // is what stops the browser turning the keystroke into a click.
      const notPrevented = fireEvent.keyDown(button(), { key: 'Enter', repeat: true })

      expect(notPrevented).toBe(false)
      expect(onConfirm).not.toHaveBeenCalled()
      expect(onCancel).not.toHaveBeenCalled()
    })
  })

  it('leaves modified Enter alone', async () => {
    const { onConfirm, onCancel } = renderDialog(false)
    await settleFocus()

    fireEvent.keyDown(message(), { key: 'Enter', shiftKey: true })

    expect(onConfirm).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('Escape cancels', async () => {
    const user = userEvent.setup()
    const { onConfirm, onCancel } = renderDialog(true)
    await settleFocus()

    await user.keyboard('{Escape}')

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
