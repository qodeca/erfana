// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for {@link PreviewNavControls}: Back and the link-mode toggle that lead
 * the preview toolbar (issue #124, UX spec §1.2, §1.3; part 3 §3.8).
 *
 * @see design/system/components/permission-band/index.html - status="decided"
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import {
  PreviewNavControls,
  backTooltip,
  linkModeTooltip,
  type PreviewNavControlsProps
} from './PreviewNavControls'
import { PREVIEW_BACK_BUTTON_SELECTOR } from '../../../../services/preview/previewTabMove'

const OVERVIEW = { filePath: '/proj/site/overview.html', anchor: null }

function renderControls(props: Partial<PreviewNavControlsProps> = {}) {
  const onBack = vi.fn()
  const onLinkModeChange = vi.fn()
  const all: PreviewNavControlsProps = {
    canGoBack: false,
    backTarget: null,
    linkMode: 'new-tab',
    ready: true,
    platform: 'darwin',
    onBack,
    onLinkModeChange,
    ...props
  }
  const utils = render(<PreviewNavControls {...all} />)
  const rerender = (next: Partial<PreviewNavControlsProps>): void =>
    utils.rerender(<PreviewNavControls {...all} {...next} />)
  return { ...utils, rerender, onBack, onLinkModeChange }
}

describe('PreviewNavControls – Back', () => {
  it('is aria-disabled, never disabled, with no earlier page – and keeps focus when pressed', async () => {
    // Pressing Back onto the first page is exactly when it turns disabled, and
    // Chromium drops focus from a control the moment it gets `disabled`.
    const user = userEvent.setup()
    const { onBack } = renderControls()
    const back = screen.getByRole('button', { name: 'Back' })

    expect(back).toHaveAttribute('aria-disabled', 'true')
    expect(back).not.toBeDisabled()

    await user.tab()
    expect(back).toHaveFocus()
    await user.keyboard('{Enter}')
    await user.click(back)
    expect(onBack).not.toHaveBeenCalled()
    expect(back).toHaveFocus()
  })

  it('stays aria-disabled while no link router exists, even with an earlier page', async () => {
    const user = userEvent.setup()
    const { onBack } = renderControls({ canGoBack: true, backTarget: OVERVIEW, ready: false })
    const back = screen.getByRole('button', { name: 'Back' })

    expect(back).toHaveAttribute('aria-disabled', 'true')
    await user.click(back)
    expect(onBack).not.toHaveBeenCalled()
  })

  it('steps back when there is an earlier page and a router', async () => {
    const user = userEvent.setup()
    const { onBack } = renderControls({ canGoBack: true, backTarget: OVERVIEW })
    const back = screen.getByRole('button', { name: 'Back' })

    expect(back).not.toHaveAttribute('aria-disabled')
    await user.click(back)
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('names the target page in its tooltip, and the Forward key on the second line', () => {
    renderControls({ canGoBack: true, backTarget: OVERVIEW })
    const back = screen.getByRole('button', { name: 'Back' })

    expect(back).toHaveAttribute('title', 'Back to overview.html (Cmd+[)\nForward: Cmd+]')
    expect(back).toHaveAttribute('aria-keyshortcuts', 'Meta+[')
  })

  it('writes the Windows keys the way Windows does', () => {
    renderControls({ canGoBack: true, backTarget: OVERVIEW, platform: 'win32' })
    const back = screen.getByRole('button', { name: 'Back' })

    expect(back).toHaveAttribute(
      'title',
      'Back to overview.html (Alt+Left Arrow)\nForward: Alt+Right Arrow'
    )
    expect(back).toHaveAttribute('aria-keyshortcuts', 'Alt+ArrowLeft')
  })

  it('says why it is disabled, and still names Forward', () => {
    expect(backTooltip(false, null, 'darwin')).toBe(
      'Back (Cmd+[) – no earlier page in this tab\nForward: Cmd+]'
    )
  })

  it('falls back to a plain "Back" when main named no target', () => {
    expect(backTooltip(true, null, 'linux')).toBe(
      'Back (Alt+Left Arrow)\nForward: Alt+Right Arrow'
    )
  })

  it('is the element the move coordinator puts focus on', () => {
    const { container } = renderControls()
    expect(container.querySelector(PREVIEW_BACK_BUTTON_SELECTOR)).toBe(
      screen.getByRole('button', { name: 'Back' })
    )
  })
})

describe('PreviewNavControls – link-mode toggle', () => {
  it('is a toggle button: fixed name, state in aria-pressed', () => {
    const { rerender } = renderControls()
    const toggle = screen.getByRole('button', { name: 'Open links in this tab' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')

    rerender({ linkMode: 'same-tab' })
    // The APG rule: the name never changes with the state.
    expect(screen.getByRole('button', { name: 'Open links in this tab' })).toBe(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
  })

  it('says what a plain link does in its tooltip', () => {
    const { rerender } = renderControls()
    const toggle = screen.getByRole('button', { name: 'Open links in this tab' })
    expect(toggle).toHaveAttribute('title', 'Open links in this tab – off: links open a new tab')

    rerender({ linkMode: 'same-tab' })
    expect(toggle).toHaveAttribute('title', linkModeTooltip('same-tab'))
    expect(linkModeTooltip('same-tab')).toBe('Open links in this tab – on: links replace this page')
  })

  it('switches to the other mode when pressed', async () => {
    const user = userEvent.setup()
    const { rerender, onLinkModeChange } = renderControls()
    const toggle = screen.getByRole('button', { name: 'Open links in this tab' })

    await user.click(toggle)
    expect(onLinkModeChange).toHaveBeenLastCalledWith('same-tab')

    rerender({ linkMode: 'same-tab' })
    await user.click(toggle)
    expect(onLinkModeChange).toHaveBeenLastCalledWith('new-tab')
  })

  it('comes straight after Back in the Tab order', async () => {
    const user = userEvent.setup()
    renderControls({ canGoBack: true, backTarget: OVERVIEW })

    await user.tab()
    expect(screen.getByRole('button', { name: 'Back' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Open links in this tab' })).toHaveFocus()
  })
})
