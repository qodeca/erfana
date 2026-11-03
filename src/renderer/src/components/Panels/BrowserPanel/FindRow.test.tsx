// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

const { gateway, warn } = vi.hoisted(() => ({
  gateway: { find: vi.fn(async () => ({ ok: true })), stopFind: vi.fn(async () => ({ ok: true })) },
  warn: vi.fn()
}))
vi.mock('../../../services/browserTabGateway', () => ({ browserTabGateway: gateway }))
vi.mock('../../../utils/logger', () => ({ logger: { warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() } }))

import { FindRow } from './FindRow'

const TAB = 'browser-tab-1'
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('FindRow', () => {
  it('focuses the field, blocks Previous and Next while empty', () => {
    render(<FindRow tabId={TAB} result={undefined} onClose={vi.fn()} />)
    expect(screen.getByRole('searchbox', { name: 'Find in page' })).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Next match' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: 'Next match' })).toHaveAttribute('title', 'Type to find')
    fireEvent.click(screen.getByRole('button', { name: 'Previous match' }))
    expect(gateway.find).not.toHaveBeenCalled()
  })

  it('searches as you type, steps with Enter, Shift+Enter and the buttons, and stops when emptied', () => {
    const { rerender } = render(<FindRow tabId={TAB} result={undefined} onClose={vi.fn()} />)
    const field = screen.getByRole('searchbox')
    fireEvent.change(field, { target: { value: 'cat' } })
    expect(gateway.find).toHaveBeenLastCalledWith({ tabId: TAB, text: 'cat', forward: true, findNext: true })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(gateway.find).toHaveBeenLastCalledWith({ tabId: TAB, text: 'cat', forward: true, findNext: false })
    fireEvent.keyDown(field, { key: 'Enter', shiftKey: true })
    expect(gateway.find).toHaveBeenLastCalledWith({ tabId: TAB, text: 'cat', forward: false, findNext: false })
    fireEvent.click(screen.getByRole('button', { name: 'Previous match' }))
    expect(gateway.find).toHaveBeenLastCalledWith({ tabId: TAB, text: 'cat', forward: false, findNext: false })
    fireEvent.click(screen.getByRole('button', { name: 'Next match' }))
    expect(gateway.find).toHaveBeenLastCalledWith({ tabId: TAB, text: 'cat', forward: true, findNext: false })
    rerender(<FindRow tabId={TAB} result={{ tabId: TAB, active: 2, total: 5 }} onClose={vi.fn()} />)
    expect(screen.getByText('2 of 5', { selector: '[aria-hidden="true"]' })).toBeInTheDocument()
    expect(screen.getByText('2 of 5.')).toBeInTheDocument()
    rerender(<FindRow tabId={TAB} result={{ tabId: TAB, active: 0, total: 0 }} onClose={vi.fn()} />)
    expect(screen.getByText('No matches.')).toBeInTheDocument()
    fireEvent.change(field, { target: { value: '' } })
    expect(gateway.stopFind).toHaveBeenCalledWith(TAB)
  })

  it('Esc and Close end the search; a failed call is logged', async () => {
    gateway.stopFind.mockRejectedValueOnce(new Error('gone'))
    const onClose = vi.fn()
    render(<FindRow tabId={TAB} result={undefined} onClose={onClose} />)
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    await act(async () => {
      await Promise.resolve()
    })
    expect(warn).toHaveBeenCalledWith('Browser find failed', { error: 'gone' })
    fireEvent.click(screen.getByRole('button', { name: 'Close find' }))
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(gateway.stopFind).toHaveBeenCalledTimes(2)
  })
})
