// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
const gateway = vi.hoisted(() => ({
  suggest: vi.fn(async (_prefix: string): Promise<{ rows: Array<{ url: string }> }> => ({ rows: [] }))
}))
vi.mock('../../../services/browserTabGateway', () => ({ browserTabGateway: gateway }))

import { AddressBar, type AddressBarProps } from './AddressBar'
import { browserState } from './__test__/browserState'

function setup(
  patch: Partial<AddressBarProps> = {}
): AddressBarProps & { field: HTMLInputElement } {
  const props: AddressBarProps = {
    state: browserState(),
    onSubmit: vi.fn(async () => true),
    onEscape: vi.fn(),
    onEdit: vi.fn(),
    errorId: null,
    ...patch
  }
  const { container } = render(<AddressBar {...props} />)
  const field = screen.getByRole('combobox', { name: 'Address and search' }) as HTMLInputElement
  return Object.assign(props, { field, container })
}

afterEach(cleanup)

describe('AddressBar', () => {
  it('shows the placeholder on an empty tab', () => {
    const { field } = setup({ state: null })
    expect(field).toHaveValue('')
    expect(field).toHaveAttribute('placeholder', 'Search DuckDuckGo or type an address')
  })

  it('draws the formatted origin at rest with the registrable domain emphasised', () => {
    const { field } = setup({
      state: browserState({
        committedUrl: 'http://app.example.test:8080/a',
        origin: {
          kind: 'web',
          scheme: 'http',
          subdomain: 'app.',
          registrableDomain: 'example.test',
          port: '8080',
          punycode: false
        },
        security: 'notSecureHttp'
      })
    })
    expect(field).toHaveValue('http://app.example.test:8080/a')
    expect(field.className).toContain('erf-brw-address__input--rest')
    const domain = document.querySelector('.erf-brw-address__domain')
    expect(domain).toHaveTextContent('example.test')
    expect(document.querySelector('.erf-brw-address__display')).toHaveTextContent(
      'http://app.example.test:8080/a'
    )
    expect(field).toHaveAccessibleDescription(/this page isn't encrypted/)
    expect(screen.getByText('Not secure')).toBeInTheDocument()
  })

  it.each([
    ['file', 'File'],
    ['warningUp', 'Not secure'],
    ['proceeded', 'Not secure']
  ] as const)('shows the %s badge', (security, word) => {
    setup({ state: browserState({ security }) })
    expect(screen.getByText(word)).toBeInTheDocument()
  })

  it('shows a non-web address as its scheme', () => {
    setup({ state: browserState({ origin: { kind: 'nonWeb', scheme: 'about' } }) })
    expect(document.querySelector('.erf-brw-address__display')).toHaveTextContent('about:')
  })

  it('selects the full address on focus and drops the rest display', () => {
    const { field } = setup()
    act(() => field.focus())
    expect(field.className).not.toContain('--rest')
    expect(field.selectionStart).toBe(0)
    expect(field.selectionEnd).toBe(field.value.length)
  })

  it('submits trimmed text on Enter and ends the draft once the load started', async () => {
    const { field, onSubmit, onEdit } = setup()
    act(() => field.focus())
    fireEvent.change(field, { target: { value: '  localhost:5173  ' } })
    expect(onEdit).toHaveBeenCalled()
    await act(async () => fireEvent.keyDown(field, { key: 'Enter' }))
    expect(onSubmit).toHaveBeenCalledWith('localhost:5173', 'address')
    expect(field).toHaveValue('https://www.example.test/docs')
  })

  it('keeps the draft when the load is refused, and sends nothing for blank text', async () => {
    const onSubmit = vi.fn(async () => false)
    const { field } = setup({ onSubmit, errorId: 'err' })
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field.closest('.erf-brw-address')?.className).toContain('--invalid')
    fireEvent.change(field, { target: { value: 'javascript:x' } })
    await act(async () => fireEvent.keyDown(field, { key: 'Enter' }))
    expect(field).toHaveValue('javascript:x')
    fireEvent.change(field, { target: { value: '   ' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('restores the address on Esc and hands focus back', () => {
    const { field, onEscape } = setup()
    fireEvent.change(field, { target: { value: 'typed' } })
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(field).toHaveValue('https://www.example.test/docs')
    expect(onEscape).toHaveBeenCalledOnce()
  })

  it('leaves Enter and Esc to an input method that is composing', () => {
    const { field, onSubmit, onEscape } = setup()
    fireEvent.keyDown(field, { key: 'Enter', isComposing: true })
    fireEvent.keyDown(field, { key: 'Escape', isComposing: true })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(onEscape).not.toHaveBeenCalled()
  })

  it('drops an unchanged draft on blur but keeps typed text', () => {
    const { field } = setup()
    act(() => field.focus())
    fireEvent.change(field, { target: { value: 'https://www.example.test/docs' } })
    act(() => field.blur())
    expect(field.className).toContain('--rest')
    act(() => field.focus())
    fireEvent.change(field, { target: { value: 'half typed' } })
    act(() => field.blur())
    expect(field).toHaveValue('half typed')
    expect(field.className).not.toContain('--rest')
  })

  describe('suggestions (025-FR-063)', () => {
    it('lists history and search rows while typing, moves with the arrows and loads the row reached', async () => {
      gateway.suggest.mockResolvedValueOnce({ rows: [{ url: 'https://docs.test/' }] })
      const { field, onSubmit } = setup()
      act(() => field.focus())
      fireEvent.change(field, { target: { value: 'docs test' } })
      const list = await screen.findByRole('listbox', { name: 'Suggestions' })
      expect(field).toHaveAttribute('aria-expanded', 'true')
      expect(field).toHaveAttribute('aria-controls', list.id)
      expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['https://docs.test/', 'Search DuckDuckGo for "docs test"'])
      fireEvent.keyDown(field, { key: 'ArrowDown' })
      expect(field).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[0].id)
      fireEvent.keyDown(field, { key: 'ArrowUp' })
      expect(field).not.toHaveAttribute('aria-activedescendant')
      fireEvent.keyDown(field, { key: 'ArrowUp' })
      expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')
      fireEvent.keyDown(field, { key: 'ArrowDown' })
      fireEvent.keyDown(field, { key: 'ArrowDown' })
      await act(async () => fireEvent.keyDown(field, { key: 'Enter' }))
      expect(onSubmit).toHaveBeenCalledWith('https://docs.test/', 'history')
    })

    it('closes the list on the first Esc and restores the address on the next, and loads a clicked search row', async () => {
      gateway.suggest.mockResolvedValue({ rows: [] })
      const { field, onSubmit, onEscape } = setup()
      act(() => field.focus())
      fireEvent.change(field, { target: { value: 'how to' } })
      await screen.findByRole('listbox')
      fireEvent.keyDown(field, { key: 'Escape' })
      expect(screen.queryByRole('listbox')).toBeNull()
      expect(field).toHaveValue('how to')
      fireEvent.keyDown(field, { key: 'Escape' })
      expect(onEscape).toHaveBeenCalled()
      act(() => field.focus())
      fireEvent.change(field, { target: { value: 'how to fix' } })
      const search = await screen.findByRole('option', { name: 'Search DuckDuckGo for "how to fix"' })
      await act(async () => fireEvent.click(search))
      expect(onSubmit).toHaveBeenCalledWith('how to fix', 'address')
    })
  })
})
