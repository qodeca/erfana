// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for {@link UnsavedChangesDialog} (issue #124, part 3 §3.6, RU1, RU9).
 *
 * The focus rules are the point: `BaseDialog` would otherwise focus the first
 * control – Don't save – and Enter would throw the edits away.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { UnsavedChangesDialog } from './UnsavedChangesDialog'
import type { UnsavedChangesDialogConfig } from './types'

/** BaseDialog's FOCUS_DELAY_MS (10 ms), with headroom. */
const PAST_FOCUS_DELAY_MS = 20

function renderDialog(variant: UnsavedChangesDialogConfig['variant']) {
  const onSelect = vi.fn()
  const onCancel = vi.fn()
  render(
    <UnsavedChangesDialog
      config={{ id: 'u1', fileName: 'pricing.html', variant }}
      zIndex={10001}
      onSelect={onSelect}
      onCancel={onCancel}
    />
  )
  return { onSelect, onCancel }
}

/** Lets BaseDialog's initial-focus timer fire. */
async function settleFocus(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, PAST_FOCUS_DELAY_MS))
  })
}

describe('UnsavedChangesDialog', () => {
  beforeEach(() => {
    const portalRoot = document.createElement('div')
    portalRoot.id = 'portal-root'
    document.body.appendChild(portalRoot)
  })

  afterEach(() => {
    document.getElementById('portal-root')?.remove()
  })

  describe('save variant', () => {
    it('asks to save, names the file and explains what closes', () => {
      renderDialog('save')

      const dialog = screen.getByRole('dialog', { name: 'Save changes to pricing.html?' })
      expect(dialog).toHaveAccessibleDescription(
        "pricing.html is open in another tab with unsaved changes. Showing it here closes that tab – if you don't save, the changes are lost."
      )
    })

    it("orders Don't save apart, then Cancel, then Save", () => {
      renderDialog('save')

      const names = screen.getAllByRole('button').map((button) => button.textContent)
      expect(names).toEqual(["Don't save", 'Cancel', 'Save'])
      const dontSave = screen.getByRole('button', { name: "Don't save" })
      expect(dontSave.parentElement).toHaveClass('dialog-actions-left')
      expect(dontSave).toHaveClass('dialog-btn-danger')
      expect(screen.getByRole('button', { name: 'Save' })).toHaveClass('dialog-btn-primary')
    })

    it('puts first focus on Save after FOCUS_DELAY_MS, not on the first control', async () => {
      renderDialog('save')

      await settleFocus()

      expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus()
    })

    it('Enter runs the focused button – Save by default, Cancel once focused', async () => {
      const user = userEvent.setup()
      const { onSelect, onCancel } = renderDialog('save')
      await settleFocus()

      await user.keyboard('{Enter}')
      expect(onSelect).toHaveBeenCalledWith('save')

      screen.getByRole('button', { name: 'Cancel' }).focus()
      await user.keyboard('{Enter}')
      expect(onCancel).toHaveBeenCalledTimes(1)
      expect(onSelect).toHaveBeenCalledTimes(1)
    })

    it("Don't save answers discard", async () => {
      const user = userEvent.setup()
      const { onSelect } = renderDialog('save')

      await user.click(screen.getByRole('button', { name: "Don't save" }))

      expect(onSelect).toHaveBeenCalledWith('discard')
    })

    it('Escape is Cancel', async () => {
      const user = userEvent.setup()
      const { onCancel, onSelect } = renderDialog('save')
      await settleFocus()

      await user.keyboard('{Escape}')

      expect(onCancel).toHaveBeenCalledTimes(1)
      expect(onSelect).not.toHaveBeenCalled()
    })

    it('a click outside does nothing', async () => {
      const user = userEvent.setup()
      const { onCancel, onSelect } = renderDialog('save')

      const overlay = document.querySelector('.dialog-overlay') as HTMLElement
      await user.click(overlay)

      expect(onCancel).not.toHaveBeenCalled()
      expect(onSelect).not.toHaveBeenCalled()
    })

    it('keeps Tab inside the dialog', async () => {
      const user = userEvent.setup()
      renderDialog('save')
      await settleFocus()

      await user.tab()

      expect(screen.getByRole('button', { name: "Don't save" })).toHaveFocus()
    })
  })

  describe('conflict variant', () => {
    it('has its own title and body, and never offers Save', () => {
      renderDialog('conflict')

      const dialog = screen.getByRole('dialog', {
        name: 'Discard your changes to pricing.html?'
      })
      expect(dialog).toHaveAccessibleDescription(
        'pricing.html changed on disk while another tab had unsaved changes to it. Showing it here closes that tab and keeps the version on disk.'
      )
      expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
        'Discard my changes',
        'Cancel'
      ])
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    })

    it('puts first focus on Cancel', async () => {
      renderDialog('conflict')

      await settleFocus()

      expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    })

    it('Enter on the focused Cancel cancels; Discard my changes answers discard', async () => {
      const user = userEvent.setup()
      const { onSelect, onCancel } = renderDialog('conflict')
      await settleFocus()

      await user.keyboard('{Enter}')
      expect(onCancel).toHaveBeenCalledTimes(1)

      await user.click(screen.getByRole('button', { name: 'Discard my changes' }))
      expect(onSelect).toHaveBeenCalledWith('discard')
    })
  })
})
