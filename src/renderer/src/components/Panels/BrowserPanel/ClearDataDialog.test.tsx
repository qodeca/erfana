// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const { gateway, toast } = vi.hoisted(() => ({
  gateway: { clearData: vi.fn() },
  toast: { showErrorToast: vi.fn(), showSuccessToast: vi.fn() }
}))
vi.mock('../../../services/browserTabGateway', () => ({ browserTabGateway: gateway }))
vi.mock('../../../utils/toastHelpers', () => toast)
vi.mock('../../../utils/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }))

import { ClearDataDialog, reportClearData } from './ClearDataDialog'

let portalRoot: HTMLDivElement
beforeEach(() => {
  portalRoot = document.createElement('div')
  portalRoot.id = 'portal-root'
  document.body.appendChild(portalRoot)
})

afterEach(() => {
  cleanup()
  portalRoot.remove()
  vi.clearAllMocks()
})

describe('reportClearData', () => {
  it('says all done once, one error per failed step, or the transport error', () => {
    reportClearData({ failed: [] })
    expect(toast.showSuccessToast).toHaveBeenCalledWith('Browsing data cleared', 'Browsing data cleared for this project.')
    reportClearData({ failed: [{ category: 'cache', reason: 'timeout' }, { category: 'captures', reason: 'failed' }] })
    expect(toast.showErrorToast).toHaveBeenCalledWith('Some data wasn’t cleared', "Couldn't clear cached files – it took longer than 10 seconds. Data you didn't tick wasn't touched.")
    expect(toast.showErrorToast).toHaveBeenCalledWith('Some data wasn’t cleared', "Couldn't clear captures – the step failed. Data you didn't tick wasn't touched.")
    reportClearData({ error: 'Busy' })
    expect(toast.showErrorToast).toHaveBeenLastCalledWith('Some data wasn’t cleared', "Busy. Data you didn't tick wasn't touched.")
  })
})

describe('ClearDataDialog', () => {
  it('opens with the defaults ticked and focus on Cancel; blocks Clear with none ticked', async () => {
    render(<ClearDataDialog onClose={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: 'Clear browsing data' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus())
    const boxes = screen.getAllByRole('checkbox')
    expect(boxes.map(b => (b as HTMLInputElement).checked)).toEqual([true, true, false, false, true])
    for (const box of boxes) if ((box as HTMLInputElement).checked) fireEvent.click(box)
    expect(screen.getByRole('button', { name: 'Clear' })).toHaveAccessibleDescription('Tick at least one kind of data.')
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(gateway.clearData).not.toHaveBeenCalled()
  })

  it('clears what is ticked, shows Clearing…, reports and closes', async () => {
    let resolve: (value: { failed: never[] }) => void = () => undefined
    gateway.clearData.mockReturnValueOnce(new Promise(r => (resolve = r)))
    const onClose = vi.fn()
    render(<ClearDataDialog onClose={onClose} />)
    fireEvent.click(screen.getByRole('checkbox', { name: /Saved sign-in credentials/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(gateway.clearData).toHaveBeenCalledWith({ cookies: true, cache: true, permissions: false, credentials: true, captures: true })
    expect(screen.getByRole('button', { name: 'Clearing…' })).toHaveAttribute('aria-disabled', 'true')
    await act(async () => {
      resolve({ failed: [] })
      await Promise.resolve()
    })
    expect(toast.showSuccessToast).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('reports an unreachable browser', async () => {
    gateway.clearData.mockRejectedValueOnce(new Error('gone'))
    const onClose = vi.fn()
    render(<ClearDataDialog onClose={onClose} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
      await Promise.resolve()
    })
    expect(toast.showErrorToast).toHaveBeenCalledWith('Some data wasn’t cleared', "Erfana couldn't reach the browser. Data you didn't tick wasn't touched.")
    expect(onClose).toHaveBeenCalled()
  })
})
