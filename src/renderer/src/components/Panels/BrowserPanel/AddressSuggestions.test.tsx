// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const gateway = vi.hoisted(() => ({ suggest: vi.fn() }))
const logger = vi.hoisted(() => ({ warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock('../../../services/browserTabGateway', () => ({ browserTabGateway: gateway }))
vi.mock('../../../utils/logger', () => ({ logger }))

import { AddressSuggestions, suggestionId, useAddressSuggestions } from './AddressSuggestions'
import type { StillSurface } from './useStillSurface'

const flush = async (): Promise<void> => {
  await act(async () => undefined)
}

describe('useAddressSuggestions (025-FR-063)', () => {
  beforeEach(() => {
    gateway.suggest.mockReset()
    logger.warn.mockReset()
  })

  it('asks nothing for blank or idle text', () => {
    const { result, rerender } = renderHook(({ text }) => useAddressSuggestions({ text }), { initialProps: { text: null as string | null } })
    expect(result.current).toEqual([])
    rerender({ text: '  ' })
    expect(gateway.suggest).not.toHaveBeenCalled()
  })

  it('shows main history rows for the typed text, and drops an older answer', async () => {
    let older: (value: unknown) => void = () => undefined
    gateway.suggest
      .mockReturnValueOnce(new Promise(resolve => (older = resolve)))
      .mockResolvedValueOnce({ rows: [{ url: 'https://local.test/' }] })
    const { result, rerender } = renderHook(({ text }) => useAddressSuggestions({ text }), { initialProps: { text: 'lo' as string | null } })
    rerender({ text: 'local.test' })
    await flush()
    expect(gateway.suggest).toHaveBeenLastCalledWith('local.test')
    expect(result.current).toEqual([{ kind: 'history', url: 'https://local.test/' }])
    await act(async () => older({ rows: [{ url: 'https://stale.test/' }] }))
    expect(result.current).toEqual([{ kind: 'history', url: 'https://local.test/' }])
    rerender({ text: null })
    expect(result.current).toEqual([])
  })

  it('still offers the search row when history fails', async () => {
    gateway.suggest.mockRejectedValue(new Error('down'))
    const { result } = renderHook(() => useAddressSuggestions({ text: 'how to' }))
    await flush()
    expect(logger.warn).toHaveBeenCalledWith('Browser address suggestions failed', { error: 'down' })
    expect(result.current).toEqual([{ kind: 'search', text: 'how to' }])
  })

  it('waits for the still image before showing rows, and lets it go when they go', async () => {
    gateway.suggest.mockResolvedValue({ rows: [] })
    let show: () => void = () => undefined
    const still: StillSurface = { open: vi.fn(fn => (show = fn)), close: vi.fn() }
    const { result, rerender } = renderHook(({ text }) => useAddressSuggestions({ text, still }), { initialProps: { text: 'how to' as string | null } })
    await flush()
    expect(still.open).toHaveBeenCalledOnce()
    expect(result.current).toEqual([])
    act(() => show())
    expect(result.current).toEqual([{ kind: 'search', text: 'how to' }])
    rerender({ text: null })
    expect(still.close).toHaveBeenCalledOnce()
    expect(result.current).toEqual([])
  })
})

describe('AddressSuggestions', () => {
  it('draws nothing without rows', () => {
    const { container } = render(<AddressSuggestions id="list" options={[]} active={-1} onChoose={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('lists history and search rows, marks the active row and chooses on click', () => {
    const onChoose = vi.fn()
    render(
      <AddressSuggestions
        id="list"
        options={[
          { kind: 'history', url: 'https://a.test/' },
          { kind: 'search', text: 'cats' }
        ]}
        active={1}
        onChoose={onChoose}
      />
    )
    expect(screen.getByRole('listbox', { name: 'Suggestions' })).toBeInTheDocument()
    const rows = screen.getAllByRole('option')
    expect(rows.map(row => row.textContent)).toEqual(['https://a.test/', 'Search DuckDuckGo for "cats"'])
    expect(rows[1]).toHaveAttribute('aria-selected', 'true')
    expect(rows[1].id).toBe(suggestionId('list', 1))
    expect(fireEvent.mouseDown(rows[0])).toBe(false)
    fireEvent.click(rows[0])
    expect(onChoose).toHaveBeenCalledWith({ kind: 'history', url: 'https://a.test/' })
  })
})
