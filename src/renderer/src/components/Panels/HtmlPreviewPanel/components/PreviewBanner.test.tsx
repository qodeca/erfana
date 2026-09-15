// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for {@link PreviewBanner}: the failed and limit-reached message, and
 * the return button a same-tab move adds to the failed one (issue #124, part 3
 * §3.8, RU5 and RU2-2).
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { PreviewBanner, type PreviewBannerProps } from './PreviewBanner'

function renderBanner(props: Partial<PreviewBannerProps> = {}) {
  const onAction = vi.fn()
  const all: PreviewBannerProps = {
    message: 'The preview stopped running.',
    actionLabel: 'Reload',
    onAction,
    ...props
  }
  const utils = render(<PreviewBanner {...all} />)
  const rerender = (next: Partial<PreviewBannerProps>): void =>
    utils.rerender(<PreviewBanner {...all} {...next} />)
  return { ...utils, rerender, onAction }
}

const names = (): string[] =>
  within(screen.getByRole('alert'))
    .getAllByRole('button')
    .map((button) => button.textContent ?? '')

describe('PreviewBanner', () => {
  it('is an alert carrying its message and one action', async () => {
    const user = userEvent.setup()
    const { onAction } = renderBanner()

    expect(screen.getByRole('alert')).toHaveTextContent('The preview stopped running.')
    expect(names()).toEqual(['Reload'])
    await user.click(screen.getByRole('button', { name: 'Reload' }))
    expect(onAction).toHaveBeenCalledTimes(1)
  })

  it('focuses its action on mount only when asked (UX-008)', () => {
    const { unmount } = renderBanner()
    expect(screen.getByRole('button', { name: 'Reload' })).not.toHaveFocus()
    unmount()

    renderBanner({ autoFocusAction: true })
    expect(screen.getByRole('button', { name: 'Reload' })).toHaveFocus()
  })

  it('puts the return button FIRST and focuses it after a move', async () => {
    const user = userEvent.setup()
    const onReturn = vi.fn()
    renderBanner({
      message: 'pricing.html could not be shown – it may have been moved or deleted.',
      autoFocusAction: true,
      returnAction: { label: 'Back to overview.html', onAction: onReturn, leads: true }
    })

    expect(names()).toEqual(['Back to overview.html', 'Reload'])
    const back = screen.getByRole('button', { name: 'Back to overview.html' })
    expect(back).toHaveFocus()
    await user.click(back)
    expect(onReturn).toHaveBeenCalledTimes(1)
  })

  it('puts the return button AFTER the action, unfocused, when no move caused the banner', () => {
    renderBanner({
      autoFocusAction: true,
      returnAction: { label: 'Back to overview.html', onAction: vi.fn(), leads: false }
    })

    expect(names()).toEqual(['Reload', 'Back to overview.html'])
    expect(screen.getByRole('button', { name: 'Reload' })).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Back to overview.html' })).not.toHaveFocus()
  })

  it('moves focus to the return button when it starts to lead after mounting', () => {
    // The banner mounts for the failed load; the `pageChanged` that says a move
    // caused it can arrive a moment later.
    const { rerender } = renderBanner({ autoFocusAction: true })
    expect(screen.getByRole('button', { name: 'Reload' })).toHaveFocus()

    rerender({ returnAction: { label: 'Return to pricing.html', onAction: vi.fn(), leads: true } })
    expect(screen.getByRole('button', { name: 'Return to pricing.html' })).toHaveFocus()
  })

  it('keeps focus on a busy return button: aria-disabled, never disabled, presses ignored', async () => {
    const user = userEvent.setup()
    const onReturn = vi.fn()
    const { rerender } = renderBanner({
      returnAction: { label: 'Back to overview.html', onAction: onReturn, leads: true }
    })
    const back = screen.getByRole('button', { name: 'Back to overview.html' })
    expect(back).toHaveFocus()

    rerender({
      returnAction: { label: 'Back to overview.html', onAction: onReturn, leads: true, isBusy: true }
    })
    expect(back).toHaveAttribute('aria-disabled', 'true')
    expect(back).not.toBeDisabled()
    expect(back).toHaveFocus()

    await user.click(back)
    await user.keyboard('{Enter}')
    expect(onReturn).not.toHaveBeenCalled()
    expect(back).toHaveFocus()
  })

  it('treats a busy primary action the same way', async () => {
    const user = userEvent.setup()
    const { onAction } = renderBanner({ isBusy: true, autoFocusAction: true })
    const reload = screen.getByRole('button', { name: 'Reload' })

    expect(reload).toHaveAttribute('aria-disabled', 'true')
    expect(reload).not.toBeDisabled()
    await user.click(reload)
    expect(onAction).not.toHaveBeenCalled()
    expect(reload).toHaveFocus()
  })

  it('wraps every label in an element, so the busy dim has content to land on', () => {
    // The busy state is drawn by dimming the button's CONTENT
    // (`.html-preview-banner-button[aria-disabled='true'] > *` in
    // HtmlPreviewPanel.css). Dimming the button itself would dim its focus ring
    // too — about 2.3:1, under the 3:1 of WCAG 1.4.11 — on a button that takes
    // focus on mount. Unwrap this label and the CSS silently matches nothing:
    // the busy state disappears with no test failing anywhere else, which is why
    // the markup is pinned here rather than left to review.
    renderBanner({
      isBusy: true,
      returnAction: { label: 'Back to overview.html', onAction: vi.fn(), leads: true }
    })

    for (const name of ['Reload', 'Back to overview.html']) {
      const button = screen.getByRole('button', { name })
      // One element child holding the whole label — and the accessible name is
      // unchanged by it, which is the other half of the contract.
      expect(button.children).toHaveLength(1)
      expect(button.firstElementChild?.textContent).toBe(name)
      expect(button).toHaveAccessibleName(name)
    }
  })
})
