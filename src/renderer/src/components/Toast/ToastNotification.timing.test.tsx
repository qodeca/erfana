// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Toast timing for people who need more time (WCAG 2.2.1 Timing Adjustable).
 *
 * - An error toast stays until it is dismissed, whatever duration it was given.
 * - Success, info and warning keep their timing, but pause while hovered or
 *   focused and resume with the time left.
 * - A toast that holds keyboard focus is never removed under the user.
 * - Escape on a focused toast dismisses it and hands focus back.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { showGlobalToast } from './toastService'
import { ToastNotification } from './ToastNotification'
import { ToastProvider } from './ToastContext'

function mount(): void {
  render(
    <ToastProvider>
      <button data-testid="opener">opener</button>
      <ToastNotification />
    </ToastProvider>
  )
}

function show(type: 'info' | 'success' | 'warning' | 'error', duration?: number): void {
  act(() => {
    showGlobalToast({ title: 'Title', message: `a ${type} toast`, type, duration })
  })
}

const advance = (ms: number): void => {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

const toastOf = (type: string): HTMLElement | null => screen.queryByTestId(`toast-${type}`)

describe('Toast timing', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mount()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps an error toast until it is dismissed, even with a duration', () => {
    show('error', 8000)
    advance(10 * 60_000)
    expect(toastOf('error')).not.toBeNull()

    fireEvent.click(screen.getByTestId('toast-btn-dismiss'))
    expect(toastOf('error')).toBeNull()
  })

  it('keeps the 3 s default for success, info and warning', () => {
    show('success')
    show('info')
    show('warning')
    advance(2999)
    expect(toastOf('success')).not.toBeNull()
    advance(1)
    expect(toastOf('success')).toBeNull()
    expect(toastOf('info')).toBeNull()
    expect(toastOf('warning')).toBeNull()
  })

  it('pauses while hovered and resumes with the time left', () => {
    show('info', 3000)
    advance(1000)
    fireEvent.mouseEnter(toastOf('info')!)
    advance(60_000)
    expect(toastOf('info')).not.toBeNull()

    fireEvent.mouseLeave(toastOf('info')!)
    advance(1999)
    expect(toastOf('info')).not.toBeNull()
    advance(1)
    expect(toastOf('info')).toBeNull()
  })

  it('pauses while focus is inside and resumes when focus leaves', () => {
    show('success', 3000)
    advance(2000)
    const close = screen.getByTestId('toast-btn-dismiss')
    act(() => close.focus())
    advance(60_000)
    expect(toastOf('success')).not.toBeNull()

    act(() => screen.getByTestId('opener').focus())
    advance(999)
    expect(toastOf('success')).not.toBeNull()
    advance(1)
    expect(toastOf('success')).toBeNull()
  })

  it('stays paused while both hover and focus hold, until both end', () => {
    show('info', 3000)
    const item = toastOf('info')!
    fireEvent.mouseEnter(item)
    act(() => screen.getByTestId('toast-btn-dismiss').focus())
    fireEvent.mouseLeave(item)
    advance(60_000)
    expect(toastOf('info')).not.toBeNull()

    act(() => screen.getByTestId('opener').focus())
    advance(3000)
    expect(toastOf('info')).toBeNull()
  })

  it('never removes a toast that holds focus when its time runs out', () => {
    show('info', 3000)
    // Focus arrives without a focus event reaching the toast's handlers, so the
    // timer is still running when it expires: the expiry itself must hold off.
    const close = screen.getByTestId('toast-btn-dismiss')
    const spy = vi.spyOn(document, 'activeElement', 'get').mockReturnValue(close)
    advance(3000)
    expect(toastOf('info')).not.toBeNull()
    spy.mockRestore()

    // Leaving it lets it go
    act(() => close.focus())
    act(() => screen.getByTestId('opener').focus())
    advance(0)
    expect(toastOf('info')).toBeNull()
  })

  it('dismisses a focused toast on Escape and gives focus back to where it came from', () => {
    show('error')
    const opener = screen.getByTestId('opener')
    act(() => opener.focus())
    const close = screen.getByTestId('toast-btn-dismiss')
    act(() => close.focus())
    expect(document.activeElement).toBe(close)

    fireEvent.keyDown(close, { key: 'Escape' })
    expect(toastOf('error')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('ignores other keys', () => {
    show('error')
    const close = screen.getByTestId('toast-btn-dismiss')
    act(() => close.focus())
    fireEvent.keyDown(close, { key: 'a' })
    expect(toastOf('error')).not.toBeNull()
  })
})
