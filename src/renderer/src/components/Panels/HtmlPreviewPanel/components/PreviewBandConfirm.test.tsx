// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for {@link PreviewBandConfirm}'s Confirm button markup.
 *
 * The flow itself (open, confirm, fail, Escape while busy) is covered through
 * the band in PreviewChromeBand.test.tsx. This file pins only what the band's
 * stylesheet depends on and a behaviour test would not notice losing.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { PreviewBandConfirm } from './PreviewBandConfirm'

function renderConfirm(busy: boolean): void {
  render(
    <PreviewBandConfirm
      host="https://a.example.com"
      kinds={['script']}
      busy={busy}
      visible
      onCancel={vi.fn()}
      onConfirm={vi.fn()}
    />
  )
}

describe('PreviewBandConfirm', () => {
  it.each([
    [false, 'Confirm'],
    [true, 'Saving…']
  ] as const)('wraps the label in an element when busy is %s', (busy, name) => {
    // Busy is drawn by dimming the button's CONTENT
    // (`.erf-band__allow[aria-disabled='true'] > *` in PreviewChromeBand.css).
    // Dimming the button itself would dim its focus ring too - about 2.3:1,
    // under the 3:1 of WCAG 1.4.11. Unwrap the label and that rule silently
    // matches nothing: busy stops looking busy and no behaviour test notices.
    renderConfirm(busy)
    const confirm = screen.getByRole('button', { name })

    expect(confirm.children).toHaveLength(1)
    expect(confirm.firstElementChild?.textContent).toBe(name)
    expect(confirm).toHaveAccessibleName(name)
    expect(confirm).toHaveAttribute('aria-disabled', String(busy))
    expect(confirm).not.toBeDisabled()
  })

  describe('Tab trap (Q25)', () => {
    it('keeps focus in the box when Tab leaves a busy Confirm', () => {
      renderConfirm(true)
      const confirm = screen.getByRole('button', { name: 'Saving…' })
      confirm.focus()

      fireEvent.keyDown(confirm, { key: 'Tab' })

      expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    })

    it('wraps Shift+Tab from Cancel to Confirm', () => {
      renderConfirm(false)
      const cancel = screen.getByRole('button', { name: 'Cancel' })
      cancel.focus()

      fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true })

      expect(screen.getByRole('button', { name: 'Confirm' })).toHaveFocus()
    })

    it('sends Tab from a non-stop inside the box to the first stop', () => {
      renderConfirm(false)
      const title = screen.getByText(/Let this page load from/)
      title.tabIndex = -1
      title.focus()

      fireEvent.keyDown(title, { key: 'Tab' })

      expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    })
  })

  it('ignores Cancel while a write is in flight, as Escape does', () => {
    const onCancel = vi.fn()
    render(
      <PreviewBandConfirm
        host="https://a.example.com"
        kinds={['script']}
        busy
        visible
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onCancel).not.toHaveBeenCalled()
  })
})
