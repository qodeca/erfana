// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ForgetDataDialog } from './ForgetDataDialog'

let portalRoot: HTMLDivElement
beforeEach(() => {
  portalRoot = document.createElement('div')
  portalRoot.id = 'portal-root'
  document.body.appendChild(portalRoot)
})
afterEach(() => {
  cleanup()
  portalRoot.remove()
})

describe('ForgetDataDialog (025-FR-023)', () => {
  it('asks with the deck words and focuses Cancel', async () => {
    render(<ForgetDataDialog onClose={vi.fn()} forget={vi.fn(async () => undefined)} />)
    const dialog = screen.getByRole('dialog', { name: "Forget this project's browser data?" })
    expect(dialog).toHaveAccessibleDescription(/deletes its browser data.*from the \.erfana\/browser folder and from Erfana's own data folder/)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus())
  })

  it('shows Forgetting… until main answers, ignores a second press and Esc meanwhile, then closes', async () => {
    let finish: () => void = () => undefined
    const forget = vi.fn(() => new Promise<void>(resolve => (finish = resolve)))
    const onClose = vi.fn()
    render(<ForgetDataDialog onClose={onClose} forget={forget} />)
    fireEvent.click(screen.getByRole('button', { name: 'Forget browser data' }))
    const busy = screen.getByRole('button', { name: 'Forgetting…' })
    expect(busy).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    fireEvent.click(busy)
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(forget).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => {
      finish()
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes without forgetting on Esc while idle', () => {
    const forget = vi.fn(async () => undefined)
    const onClose = vi.fn()
    render(<ForgetDataDialog onClose={onClose} forget={forget} />)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(forget).not.toHaveBeenCalled()
  })

  it('closes without forgetting on Cancel', () => {
    const forget = vi.fn(async () => undefined)
    const onClose = vi.fn()
    render(<ForgetDataDialog onClose={onClose} forget={forget} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(forget).not.toHaveBeenCalled()
  })
})
