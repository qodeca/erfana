// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SignInRow } from '../../../../../shared/ipc/browser-tab-site-schema'
import { SignInBox } from './SignInBox'

const SIGN_IN: SignInRow = { username: '', savedPassword: false, insecure: false, rejected: null, remember: 'available' }

function renderBox(signIn: SignInRow = SIGN_IN): void {
  render(
    <SignInBox signIn={signIn} requestId="r1" takesFocus={false} busy={false} guarded={false} onSubmit={vi.fn()} onCancel={vi.fn()} />
  )
}

describe('SignInBox (025-FR-022)', () => {
  it('names Remember by its label only and keeps the storage note as its description', () => {
    renderBox()
    const remember = screen.getByRole('checkbox', { name: 'Remember for this project' })
    expect(remember).toHaveAccessibleName('Remember for this project')
    expect(remember).toHaveAccessibleDescription("Saved encrypted in this project's browser data")
  })

  it('without a keyring names it the same and describes the reason', () => {
    renderBox({ ...SIGN_IN, remember: 'noKeyring' })
    const remember = screen.getByRole('checkbox', { name: 'Remember for this project' })
    expect(remember).toBeDisabled()
    expect(remember).toHaveAccessibleDescription('No keyring – cannot store passwords safely')
  })
})
