// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * PromptDialog's keyboard-shortcut hint per platform (#143): "⌘Enter to
 * submit" on macOS, "Ctrl+Enter to submit" on Windows and Linux.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PromptDialog } from './PromptDialog'
import { isMacOS } from '../../utils/platform'

vi.mock('../../utils/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/platform')>()),
  isMacOS: vi.fn(() => true)
}))

const mockIsMacOS = vi.mocked(isMacOS)

function renderPrompt(): void {
  render(
    <PromptDialog
      config={{ title: 'Test', message: 'Type' }}
      zIndex={1000}
      onSubmit={vi.fn()}
      onCancel={vi.fn()}
    />
  )
}

describe('PromptDialog shortcut hint (#143)', () => {
  beforeEach(() => {
    // BaseDialog portals into #portal-root, which index.html provides.
    if (!document.getElementById('portal-root')) {
      const portalRoot = document.createElement('div')
      portalRoot.id = 'portal-root'
      document.body.appendChild(portalRoot)
    }
  })

  it('shows Ctrl+Enter, not ⌘ or "Cmd", on Windows', () => {
    mockIsMacOS.mockReturnValue(false)
    renderPrompt()

    const tooltip = screen.getByRole('tooltip', { hidden: true })
    expect(tooltip).toHaveTextContent('Ctrl+Enter to submit')
    expect(tooltip.textContent).not.toMatch(/[⌘⌥⇧⌃]|Cmd/)
  })

  it('shows ⌘Enter on macOS', () => {
    mockIsMacOS.mockReturnValue(true)
    renderPrompt()

    expect(screen.getByRole('tooltip', { hidden: true })).toHaveTextContent('⌘Enter to submit')
  })
})
