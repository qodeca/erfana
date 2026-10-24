// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * PromptDialog validates its default value as it opens. The check moved from
 * a mount effect into the error state's initializer (plan item 19); these pin
 * that the message is there on the first paint, that a valid or empty default
 * shows none, and that typing still clears it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PromptDialog } from './PromptDialog'

function renderPrompt(defaultValue: string, validation?: (value: string) => boolean | string) {
  return render(
    <PromptDialog
      config={{ id: 'p1', title: 'Test', message: 'Type', defaultValue, validation }}
      zIndex={1000}
      onSubmit={vi.fn()}
      onCancel={vi.fn()}
    />
  )
}

const errorText = (): string | null =>
  document.querySelector('.dialog-validation-error')?.textContent ?? null

describe('PromptDialog default-value validation', () => {
  beforeEach(() => {
    if (!document.getElementById('portal-root')) {
      const portalRoot = document.createElement('div')
      portalRoot.id = 'portal-root'
      document.body.appendChild(portalRoot)
    }
  })

  it('shows the error for an invalid default on the first render', () => {
    renderPrompt('abcd', (v) => v.includes('x') || 'Must contain x')
    expect(errorText()).toBe('Must contain x')
  })

  it('shows no error for a valid default', () => {
    renderPrompt('abcx', (v) => v.includes('x') || 'Must contain x')
    expect(errorText()).toBeNull()
  })

  it('shows no error for an empty or blank default', () => {
    renderPrompt('   ', () => 'never shown')
    expect(errorText()).toBeNull()
  })

  it('clears the seeded error once the user types', () => {
    renderPrompt('abcd', (v) => v.includes('x') || 'Must contain x')
    expect(errorText()).toBe('Must contain x')
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'abcdx' } })
    expect(errorText()).toBeNull()
  })
})
