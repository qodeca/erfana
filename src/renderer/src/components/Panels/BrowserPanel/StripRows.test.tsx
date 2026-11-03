// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react'
import type { StripRow as StripRowPayload } from '../../../../../shared/ipc/browser-tab-schema'

const { gateway, warn } = vi.hoisted(() => ({
  gateway: { answerStrip: vi.fn(async (): Promise<string> => 'accepted') },
  warn: vi.fn()
}))
vi.mock('../../../services/browserTabGateway', () => ({ browserTabGateway: gateway }))
vi.mock('../../../utils/logger', () => ({ logger: { warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() } }))

import { StripRows } from './StripRows'
import { STRIP_INPUT_GUARD_MS } from './stripRows.logic'

const TAB = 'browser-tab-1'
const row = (requestId: string, patch: Partial<StripRowPayload> = {}): StripRowPayload => ({
  requestId,
  kind: 'permission',
  text: 'www.a.test wants to use your camera',
  answers: ['block', 'allow', 'dismiss'],
  takesFocus: false,
  ...patch
})

let now = 1000
beforeEach(() => {
  vi.useFakeTimers()
  now = 1000
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  gateway.answerStrip.mockClear()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function pass(ms: number): void {
  now += ms
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

/** Pointer down at `at` on the performance clock (jsdom ignores a `timeStamp` init). */
function pointerDownAt(target: HTMLElement, at: number): void {
  const event = createEvent.pointerDown(target)
  Object.defineProperty(event, 'timeStamp', { value: at })
  fireEvent(target, event)
}

/** A press whose pointer went down now. */
function press(button: HTMLElement): void {
  pointerDownAt(button, now)
  fireEvent.click(button)
}

describe('StripRows', () => {
  it('renders nothing but the announcer with no rows', () => {
    render(<StripRows tabId={TAB} rows={[]} refused={null} refusedId="r" onEmpty={vi.fn()} />)
    expect(screen.queryByRole('group')).toBeNull()
    expect(screen.getByTestId('browser-strip-announcer')).toHaveTextContent('')
  })

  it('shows the refused address first, rows in kind order, and announces an arrival once', () => {
    const rows = [
      { row: row('k', { kind: 'keyring', text: 'Keyring notice', answers: ['dismiss'] }), since: now },
      { row: row('p'), since: now }
    ]
    const { rerender } = render(<StripRows tabId={TAB} rows={rows} refused="Not an address" refusedId="ref" onEmpty={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Error: Not an address')
    const groups = screen.getAllByRole('group')
    expect(groups.map(g => g.getAttribute('data-request-id'))).toEqual(['p', 'k'])
    expect(screen.getByTestId('browser-strip-announcer')).toHaveTextContent('www.a.test wants to use your camera. Press F6 to answer in the prompt above the page.')
    rerender(<StripRows tabId={TAB} rows={rows.slice(1)} refused={null} refusedId="ref" onEmpty={vi.fn()} />)
    expect(screen.getByTestId('browser-strip-announcer')).toHaveTextContent('www.a.test wants to use your camera. Press F6 to answer in the prompt above the page.')
  })

  it('blocks answers for 500 ms, ignores a press begun before the row, then answers', () => {
    render(<StripRows tabId={TAB} rows={[{ row: row('p'), since: now }]} refused={null} refusedId="r" onEmpty={vi.fn()} />)
    const allow = screen.getByRole('button', { name: 'Allow' })
    expect(allow).toHaveAttribute('aria-disabled', 'true')
    press(allow)
    expect(gateway.answerStrip).not.toHaveBeenCalled()
    pointerDownAt(allow, now - 1)
    pass(STRIP_INPUT_GUARD_MS)
    expect(allow).not.toHaveAttribute('aria-disabled')
    fireEvent.click(allow)
    expect(gateway.answerStrip).not.toHaveBeenCalled()
    press(allow)
    expect(gateway.answerStrip).toHaveBeenCalledWith({ tabId: TAB, requestId: 'p', answer: 'allow' })
    press(screen.getByRole('button', { name: 'Dismiss' }))
    expect(gateway.answerStrip).toHaveBeenLastCalledWith({ tabId: TAB, requestId: 'p', answer: 'dismiss' })
  })

  it('ends the guard even when its timer fires a moment before the clock says 500 ms', () => {
    render(<StripRows tabId={TAB} rows={[{ row: row('p'), since: now }]} refused={null} refusedId="r" onEmpty={vi.fn()} />)
    const allow = screen.getByRole('button', { name: 'Allow' })
    // The timer fires at 500 ms of timer time while the coarsened clock still reads 499.
    now += STRIP_INPUT_GUARD_MS - 1
    act(() => {
      vi.advanceTimersByTime(STRIP_INPUT_GUARD_MS)
    })
    expect(allow).toHaveAttribute('aria-disabled', 'true')
    pass(2)
    expect(allow).not.toHaveAttribute('aria-disabled')
  })

    it('logs a failed answer and sends nothing without a tab', async () => {
    gateway.answerStrip.mockRejectedValueOnce(new Error('gone'))
    const { rerender } = render(<StripRows tabId={TAB} rows={[{ row: row('p'), since: now }]} refused={null} refusedId="r" onEmpty={vi.fn()} />)
    pass(STRIP_INPUT_GUARD_MS)
    press(screen.getByRole('button', { name: 'Allow' }))
    await act(async () => {
      await Promise.resolve()
    })
    expect(warn).toHaveBeenCalledWith('Browser strip answer failed', { error: 'gone' })
    rerender(<StripRows tabId={null} rows={[{ row: row('p'), since: now - 1000 }]} refused={null} refusedId="r" onEmpty={vi.fn()} />)
    gateway.answerStrip.mockClear()
    press(screen.getByRole('button', { name: 'Allow' }))
    expect(gateway.answerStrip).not.toHaveBeenCalled()
  })

  it('leave-page: focuses Stay on arrival, Esc answers Stay', () => {
    const leave = row('l', { kind: 'leavePage', text: 'Leave this page? Changes may not be saved.', answers: ['leave', 'stay'], takesFocus: true })
    render(<StripRows tabId={TAB} rows={[{ row: leave, since: now }]} refused={null} refusedId="r" onEmpty={vi.fn()} />)
    expect(screen.getByRole('alertdialog', { name: 'Leave this page? Changes may not be saved.' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stay' })).toHaveFocus()
    pass(STRIP_INPUT_GUARD_MS)
    const stay = screen.getByRole('button', { name: 'Stay' })
    const esc = createEvent.keyDown(stay, { key: 'Escape' })
    Object.defineProperty(esc, 'timeStamp', { value: now })
    fireEvent(stay, esc)
    expect(gateway.answerStrip).toHaveBeenCalledWith({ tabId: TAB, requestId: 'l', answer: 'stay' })
  })

  it('moves focus to the next row as a group when a focused row goes, then to the page', () => {
    const onEmpty = vi.fn()
    const a = { row: row('a'), since: now }
    const b = { row: row('b', { kind: 'download', text: 'Downloading report.pdf', answers: ['cancel', 'dismiss'] }), since: now }
    const { rerender } = render(<StripRows tabId={TAB} rows={[a, b]} refused={null} refusedId="r" onEmpty={onEmpty} />)
    screen.getAllByRole('button', { name: 'Block' })[0]?.focus()
    rerender(<StripRows tabId={TAB} rows={[b]} refused={null} refusedId="r" onEmpty={onEmpty} />)
    const next = document.querySelector('[data-request-id="b"]')
    expect(next).toHaveFocus()
    // Focus restored to the row re-arms its guard.
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveAttribute('aria-disabled', 'true')
    rerender(<StripRows tabId={TAB} rows={[]} refused={null} refusedId="r" onEmpty={onEmpty} />)
    expect(onEmpty).toHaveBeenCalledTimes(1)
  })

  it('draws the hung notice, a page dialog and the queue count', () => {
    const rows = [
      { row: row('h', { kind: 'hung', text: 'This page isn’t responding', answers: ['wait', 'reload'] }), since: now },
      { row: row('d', { kind: 'pageDialog', text: 'Delete it?', answers: ['ok', 'cancel'] }), since: now },
      { row: row('p', { waiting: 2 }), since: now }
    ]
    render(<StripRows tabId={TAB} rows={rows} refused={null} refusedId="r" onEmpty={vi.fn()} />)
    expect(screen.getByText('The page says')).toBeInTheDocument()
    expect(screen.getByText('Delete it?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Decline' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Wait' })).toBeInTheDocument()
    expect(screen.getByLabelText('2 more requests waiting')).toHaveTextContent('+2 waiting')
  })

  it('sign-in: sends the typed fields, keeps a saved password, and shows Signing in…', () => {
    const signIn = row('s', {
      kind: 'signIn',
      text: 'Sign in to www.a.test',
      answers: ['signIn', 'cancel'],
      takesFocus: true,
      signIn: { username: 'ada', savedPassword: true, insecure: true, rejected: 'typed', remember: 'available' }
    })
    render(<StripRows tabId={TAB} rows={[{ row: signIn, since: now }]} refused={null} refusedId="r" onEmpty={vi.fn()} />)
    expect(screen.getByLabelText('Password')).toHaveFocus()
    expect(screen.getByText(/isn't encrypted/)).toBeInTheDocument()
    // A field error (Form card): both fields point at the line, which is no live region; the strip says it.
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByLabelText('Username')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription("Error: That username and password weren't accepted. Check them and sign in again.")
    expect(screen.getByTestId('browser-strip-announcer')).toHaveTextContent(
      "Sign in to www.a.test. That username and password weren't accepted. Check them and sign in again. Press F6 to answer in the prompt above the page."
    )
    pass(STRIP_INPUT_GUARD_MS)
    fireEvent.click(screen.getByRole('checkbox', { name: /Remember for this project/ }))
    const submit = screen.getByRole('button', { name: 'Sign in' })
    pointerDownAt(submit, now)
    fireEvent.submit(submit.closest('form') as HTMLFormElement)
    expect(gateway.answerStrip).toHaveBeenCalledWith({ tabId: TAB, requestId: 's', answer: 'signIn', fields: { username: 'ada', remember: true } })
    expect(screen.getByRole('button', { name: 'Signing in…' })).toHaveAttribute('aria-disabled', 'true')
  })

  it.each([
    ['guarded', () => gateway.answerStrip.mockResolvedValueOnce('guarded')],
    ['unknown', () => gateway.answerStrip.mockResolvedValueOnce('unknown')],
    ['a failed call', () => gateway.answerStrip.mockRejectedValueOnce(new Error('gone'))]
  ])('sign-in: gives the box back when main answers %s', async (_name, arrange) => {
    const signIn = row('s', { kind: 'signIn', text: 'Sign in', answers: ['signIn', 'cancel'], signIn: { username: 'ada', savedPassword: false, insecure: false, rejected: null, remember: 'available' } })
    render(<StripRows tabId={TAB} rows={[{ row: signIn, since: now }]} refused={null} refusedId="r" onEmpty={vi.fn()} />)
    pass(STRIP_INPUT_GUARD_MS)
    arrange()
    const submit = screen.getByRole('button', { name: 'Sign in' })
    pointerDownAt(submit, now)
    fireEvent.submit(submit.closest('form') as HTMLFormElement)
    expect(screen.getByRole('button', { name: 'Signing in…' })).toHaveAttribute('aria-disabled', 'true')
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByRole('button', { name: 'Sign in' })).not.toHaveAttribute('aria-disabled')
  })

  it('sign-in: stays "Signing in…" once main accepted the answer', async () => {
    const signIn = row('s', { kind: 'signIn', text: 'Sign in', answers: ['signIn', 'cancel'], signIn: { username: 'ada', savedPassword: false, insecure: false, rejected: null, remember: 'available' } })
    render(<StripRows tabId={TAB} rows={[{ row: signIn, since: now }]} refused={null} refusedId="r" onEmpty={vi.fn()} />)
    pass(STRIP_INPUT_GUARD_MS)
    const submit = screen.getByRole('button', { name: 'Sign in' })
    pointerDownAt(submit, now)
    fireEvent.submit(submit.closest('form') as HTMLFormElement)
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByRole('button', { name: 'Signing in…' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('announces a row again when it arrives with the same words as the last one', () => {
    const { rerender } = render(<StripRows tabId={TAB} rows={[{ row: row('p1'), since: now }]} refused={null} refusedId="r" onEmpty={vi.fn()} />)
    const first = screen.getByTestId('browser-strip-announcer').textContent
    rerender(<StripRows tabId={TAB} rows={[]} refused={null} refusedId="r" onEmpty={vi.fn()} />)
    rerender(<StripRows tabId={TAB} rows={[{ row: row('p2'), since: now }]} refused={null} refusedId="r" onEmpty={vi.fn()} />)
    const second = screen.getByTestId('browser-strip-announcer').textContent
    expect(second).not.toBe(first)
    expect(second?.trim()).toBe(first?.trim())
    rerender(<StripRows tabId={TAB} rows={[{ row: row('p3'), since: now }]} refused={null} refusedId="r" onEmpty={vi.fn()} />)
    expect(screen.getByTestId('browser-strip-announcer').textContent).toBe(first)
  })

  it('sign-in without a keyring: Remember disabled with its reason; typed password sent; Cancel answers', () => {
    const signIn = row('s', {
      kind: 'signIn',
      text: 'Sign in',
      answers: ['signIn', 'cancel'],
      signIn: { username: '', savedPassword: false, insecure: false, rejected: 'saved', remember: 'noKeyring' }
    })
    render(<StripRows tabId={TAB} rows={[{ row: signIn, since: now }]} refused={null} refusedId="r" onEmpty={vi.fn()} />)
    expect(screen.getByLabelText('Username')).not.toHaveFocus()
    expect(screen.getByRole('checkbox')).toBeDisabled()
    expect(screen.getByRole('checkbox')).toHaveAccessibleDescription('No keyring – cannot store passwords safely')
    pass(STRIP_INPUT_GUARD_MS)
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'bo' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } })
    const submit = screen.getByRole('button', { name: 'Sign in' })
    pointerDownAt(submit, now)
    fireEvent.submit(submit.closest('form') as HTMLFormElement)
    expect(gateway.answerStrip).toHaveBeenCalledWith({ tabId: TAB, requestId: 's', answer: 'signIn', fields: { username: 'bo', password: 'pw', remember: false } })
  })
})
