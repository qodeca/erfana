// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Lens review finding [26]: error toasts closed after 3 s and no toast paused
 * while it was being read or held focus (WCAG 2.2.1 Timing Adjustable).
 *
 * The policy half (`resolveToastDuration`) is pure; the timer half is driven
 * through the real provider and notification stack with fake timers, so a
 * regression in the wiring – not just in the hook – fails here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { ToastProvider, useToast, type Toast } from './ToastContext'
import { ToastNotification } from './ToastNotification'
import {
  DEFAULT_DWELL_MS,
  PERSIST,
  WARNING_MIN_DWELL_MS,
  resolveToastDuration
} from './toastDwell'
import { TEST_IDS } from '../../constants/testids'

describe('resolveToastDuration', () => {
  it('makes every error persist, whatever the caller asked for', () => {
    expect(resolveToastDuration({ type: 'error' })).toBe(PERSIST)
    expect(resolveToastDuration({ type: 'error', duration: 3000 })).toBe(PERSIST)
    expect(resolveToastDuration({ type: 'error', duration: 8000 })).toBe(PERSIST)
  })

  it('makes an actionable toast persist regardless of type', () => {
    const action = { label: 'Approve', onClick: () => {} }
    expect(resolveToastDuration({ type: 'success', duration: 1000, action })).toBe(PERSIST)
    expect(resolveToastDuration({ type: 'warning', action })).toBe(PERSIST)
  })

  it('floors a warning at the minimum dwell and defaults to it', () => {
    expect(resolveToastDuration({ type: 'warning' })).toBe(WARNING_MIN_DWELL_MS)
    expect(resolveToastDuration({ type: 'warning', duration: 3000 })).toBe(WARNING_MIN_DWELL_MS)
    expect(resolveToastDuration({ type: 'warning', duration: 20000 })).toBe(20000)
  })

  it('lets a warning ask to persist', () => {
    expect(resolveToastDuration({ type: 'warning', duration: 0 })).toBe(PERSIST)
  })

  it('keeps the caller duration for info and success, with a 3 s default', () => {
    expect(resolveToastDuration({ type: 'success' })).toBe(DEFAULT_DWELL_MS)
    expect(resolveToastDuration({ type: 'info', duration: 1500 })).toBe(1500)
    expect(resolveToastDuration({ type: 'success', duration: 0 })).toBe(PERSIST)
  })

  it('ignores a non-finite or negative request instead of firing at once', () => {
    expect(resolveToastDuration({ type: 'info', duration: Number.NaN })).toBe(DEFAULT_DWELL_MS)
    expect(resolveToastDuration({ type: 'info', duration: -5 })).toBe(DEFAULT_DWELL_MS)
    expect(resolveToastDuration({ type: 'warning', duration: Infinity })).toBe(WARNING_MIN_DWELL_MS)
  })
})

/** Renders a button that shows `toast` via the context on click. */
function Trigger({ toast }: { toast: Omit<Toast, 'id'> }): JSX.Element {
  const { showToast } = useToast()
  return (
    <button data-testid="trigger" onClick={() => showToast(toast)}>
      show
    </button>
  )
}

function setup(toast: Omit<Toast, 'id'>): HTMLElement {
  render(
    <ToastProvider>
      <Trigger toast={toast} />
      <ToastNotification />
    </ToastProvider>
  )
  fireEvent.click(screen.getByTestId('trigger'))
  return screen.getByTestId(`${TEST_IDS.TOAST}-${toast.type}`)
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

describe('toast dwell timer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps an error toast until it is dismissed (the 3 s default is gone)', () => {
    setup({ title: 'Could not save', message: 'Disk full', type: 'error', duration: 3000 })
    advance(10 * 60 * 1000)
    expect(screen.getByText('Could not save')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByText('Could not save')).not.toBeInTheDocument()
  })

  it('shows a warning for the minimum dwell even when 3 s was requested', () => {
    setup({ title: 'Link', message: 'Outside the project', type: 'warning', duration: 3000 })
    advance(WARNING_MIN_DWELL_MS - 1)
    expect(screen.getByText('Link')).toBeInTheDocument()
    advance(1)
    expect(screen.queryByText('Link')).not.toBeInTheDocument()
  })

  it('pauses while the pointer is over the toast and resumes with the time left', () => {
    const toast = setup({ title: 'Saved', message: 'ok', type: 'success', duration: 3000 })

    advance(2000)
    fireEvent.mouseEnter(toast)
    expect(toast).toHaveAttribute('data-paused', 'true')

    // Far past the original deadline: hovering holds it.
    advance(60000)
    expect(screen.getByText('Saved')).toBeInTheDocument()

    fireEvent.mouseLeave(toast)
    expect(toast).not.toHaveAttribute('data-paused')
    // 1000 ms were owed when the pointer arrived – not a fresh 3000.
    advance(999)
    expect(screen.getByText('Saved')).toBeInTheDocument()
    advance(1)
    expect(screen.queryByText('Saved')).not.toBeInTheDocument()
  })

  it('pauses while focus is inside the toast', () => {
    const toast = setup({ title: 'Saved', message: 'ok', type: 'success', duration: 3000 })
    const close = screen.getByRole('button', { name: 'Close' })

    act(() => {
      close.focus()
    })
    expect(toast).toHaveAttribute('data-paused', 'true')
    advance(60000)
    expect(screen.getByText('Saved')).toBeInTheDocument()

    act(() => {
      close.blur()
    })
    advance(3000)
    expect(screen.queryByText('Saved')).not.toBeInTheDocument()
  })

  it('stays paused while focus moves between the toast’s own buttons', () => {
    // A blur whose relatedTarget is still inside the toast is focus moving
    // between its own Close and action buttons; it must not resume the timer.
    const toast = setup({ title: 'Saved', message: 'ok', type: 'success', duration: 3000 })
    const close = screen.getByRole('button', { name: 'Close' })
    act(() => {
      close.focus()
    })
    fireEvent.blur(close, { relatedTarget: toast })
    expect(toast).toHaveAttribute('data-paused', 'true')
    advance(60000)
    expect(screen.getByText('Saved')).toBeInTheDocument()
  })

  it('pointer and focus pause independently: leaving with the mouse keeps a focused toast', () => {
    const toast = setup({ title: 'Saved', message: 'ok', type: 'success', duration: 3000 })
    fireEvent.mouseEnter(toast)
    act(() => {
      screen.getByRole('button', { name: 'Close' }).focus()
    })
    fireEvent.mouseLeave(toast)
    expect(toast).toHaveAttribute('data-paused', 'true')
    advance(60000)
    expect(screen.getByText('Saved')).toBeInTheDocument()
  })

  it('never removes a toast that holds focus, even if no focus event was seen', () => {
    const toast = setup({ title: 'Saved', message: 'ok', type: 'success', duration: 3000 })
    const close = screen.getByRole('button', { name: 'Close' })
    // Simulate focus landing without the React handler running (the bypass
    // the expiry guard exists for): stub activeElement rather than focusing.
    const spy = vi.spyOn(document, 'activeElement', 'get').mockReturnValue(close)
    advance(3000)
    expect(toast).toBeInTheDocument()
    spy.mockRestore()
    // Once focus has gone, the re-armed countdown completes.
    advance(3000)
    expect(screen.queryByText('Saved')).not.toBeInTheDocument()
  })

  it('still announces an error through the assertive live region', () => {
    setup({ title: 'Could not save', message: 'Disk full', type: 'error' })
    expect(screen.getByTestId(TEST_IDS.TOAST_LIVE_ALERT)).toHaveTextContent('Could not save: Disk full')
    expect(screen.getByTestId(TEST_IDS.TOAST_LIVE_POLITE)).toHaveTextContent('')
  })
})
