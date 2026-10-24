// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Dismissing a focused toast from the keyboard (finding [26]).
 *
 * The first two cases are ported from the Windows session's #340. Escape on a
 * focused toast closes it, and focus goes back to where it came from. The
 * dialog case covers finding [28]: dialogs take Escape in one capture-phase
 * listener on `document`, so Escape on a toast must not also close a dialog
 * that happens to be open.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { showGlobalToast } from './toastService'
import { ToastNotification } from './ToastNotification'
import { ToastProvider, useToast } from './ToastContext'
import { BaseDialog } from '../Dialog/BaseDialog'
import { TEST_IDS } from '../../constants/testids'

function show(type: 'info' | 'success' | 'warning' | 'error'): void {
  act(() => {
    showGlobalToast({ title: 'Title', message: `a ${type} toast`, type })
  })
}

const toastOf = (type: string): HTMLElement | null => screen.queryByTestId(`${TEST_IDS.TOAST}-${type}`)
const closeButton = (): HTMLElement => screen.getByTestId(TEST_IDS.TOAST_BTN_DISMISS)

describe('Toast keyboard dismissal', () => {
  beforeEach(() => {
    const portalRoot = document.createElement('div')
    portalRoot.id = 'portal-root'
    document.body.appendChild(portalRoot)
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  function mount(): void {
    render(
      <ToastProvider>
        <button data-testid="opener">opener</button>
        <ToastNotification />
      </ToastProvider>
    )
  }

  it('dismisses a focused toast on Escape and gives focus back to where it came from', () => {
    mount()
    show('error')
    const opener = screen.getByTestId('opener')
    act(() => opener.focus())
    act(() => closeButton().focus())
    expect(document.activeElement).toBe(closeButton())

    fireEvent.keyDown(closeButton(), { key: 'Escape' })

    expect(toastOf('error')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('ignores other keys', () => {
    mount()
    show('error')
    act(() => closeButton().focus())
    fireEvent.keyDown(closeButton(), { key: 'a' })
    expect(toastOf('error')).not.toBeNull()
  })

  it('gives focus back after a Close click too, when focus was inside the toast', () => {
    mount()
    show('error')
    const opener = screen.getByTestId('opener')
    act(() => opener.focus())
    // A mouse press on a button focuses it before the click lands.
    act(() => closeButton().focus())

    fireEvent.click(closeButton())

    expect(toastOf('error')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('does not move focus when the element it came from is gone', () => {
    mount()
    show('error')
    // Not React-owned, so the test can remove it.
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    act(() => opener.focus())
    act(() => closeButton().focus())
    opener.remove()

    fireEvent.keyDown(closeButton(), { key: 'Escape' })

    expect(toastOf('error')).toBeNull()
    expect(document.activeElement).toBe(document.body)
  })

  it('does not steal focus back when the toast is closed while focus is elsewhere', () => {
    mount()
    show('error')
    const opener = screen.getByTestId('opener')
    act(() => opener.focus())
    act(() => closeButton().focus())
    const elsewhere = document.createElement('input')
    document.body.appendChild(elsewhere)
    act(() => elsewhere.focus())

    // A click that does not focus the button (as in Safari) leaves focus where it is.
    fireEvent.click(closeButton())

    expect(toastOf('error')).toBeNull()
    expect(document.activeElement).toBe(elsewhere)
  })

  it('Escape on a focused toast closes only the toast, not an open dialog', () => {
    const dialogClose = vi.fn()
    render(
      <ToastProvider>
        <BaseDialog isOpen onClose={dialogClose} zIndex={10001} trapFocus={false}>
          <button data-testid="in-dialog">In dialog</button>
        </BaseDialog>
        <ToastNotification />
      </ToastProvider>
    )
    show('error')
    act(() => closeButton().focus())

    fireEvent.keyDown(closeButton(), { key: 'Escape' })

    expect(toastOf('error')).toBeNull()
    expect(dialogClose).not.toHaveBeenCalled()

    // Control: Escape from inside the dialog still closes the dialog.
    act(() => screen.getByTestId('in-dialog').focus())
    fireEvent.keyDown(screen.getByTestId('in-dialog'), { key: 'Escape' })
    expect(dialogClose).toHaveBeenCalledOnce()
  })

  it('with two toasts, Escape closes only the focused one', () => {
    mount()
    act(() => {
      showGlobalToast({ title: 'First', message: 'one', type: 'error' })
      showGlobalToast({ title: 'Second', message: 'two', type: 'error' })
    })
    const [, secondClose] = screen.getAllByTestId(TEST_IDS.TOAST_BTN_DISMISS)
    act(() => secondClose.focus())

    fireEvent.keyDown(secondClose, { key: 'Escape' })

    const left = screen.getAllByTestId(`${TEST_IDS.TOAST}-error`)
    expect(left).toHaveLength(1)
    expect(left[0].textContent).toContain('First')
  })
})

describe('Toast stack: merged repeats, sticky cap, focus on removal', () => {
  beforeEach(() => {
    const portalRoot = document.createElement('div')
    portalRoot.id = 'portal-root'
    document.body.appendChild(portalRoot)
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  let removeToastFromOutside: (id: string) => void = () => {}
  function Remover(): null {
    removeToastFromOutside = useToast().removeToast
    return null
  }

  function mount(): void {
    render(
      <ToastProvider>
        <button data-testid="opener">opener</button>
        <Remover />
        <ToastNotification />
      </ToastProvider>
    )
  }

  it('10 identical errors show as one toast with count 10, announced once', () => {
    mount()
    for (let i = 0; i < 10; i += 1) {
      act(() => showGlobalToast({ title: 'Save failed', message: 'disk full', type: 'error' }))
    }
    expect(screen.getAllByTestId(`${TEST_IDS.TOAST}-error`)).toHaveLength(1)
    expect(screen.getByTestId(TEST_IDS.TOAST_COUNT).textContent).toBe('×10')
    expect(screen.getByTestId(TEST_IDS.TOAST_LIVE_ALERT).textContent).toBe('Save failed: disk full')
  })

  it('7 different errors leave at most 5 on screen, the newest ones', () => {
    mount()
    for (let i = 0; i < 7; i += 1) {
      act(() => showGlobalToast({ title: 'Failed', message: `error ${i}`, type: 'error' }))
    }
    const shown = screen.getAllByTestId(TEST_IDS.TOAST_MESSAGE).map((el) => el.textContent)
    expect(shown).toEqual(['error 2', 'error 3', 'error 4', 'error 5', 'error 6'])
  })

  it('never drops the focused toast when the cap is reached', () => {
    mount()
    for (let i = 0; i < 5; i += 1) {
      act(() => showGlobalToast({ title: 'Failed', message: `error ${i}`, type: 'error' }))
    }
    const oldestClose = screen.getAllByTestId(TEST_IDS.TOAST_BTN_DISMISS)[0]
    act(() => oldestClose.focus())

    act(() => showGlobalToast({ title: 'Failed', message: 'error 5', type: 'error' }))

    const shown = screen.getAllByTestId(TEST_IDS.TOAST_MESSAGE).map((el) => el.textContent)
    expect(shown).toEqual(['error 0', 'error 2', 'error 3', 'error 4', 'error 5'])
    expect(document.activeElement).toBe(oldestClose)
  })

  it('gives focus back when a focused toast is removed from outside the toast', () => {
    mount()
    show('error')
    const opener = screen.getByTestId('opener')
    act(() => opener.focus())
    act(() => closeButton().focus())
    const id = toastOf('error')?.getAttribute('data-toast-id') ?? ''

    act(() => removeToastFromOutside(id))

    expect(toastOf('error')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('does not move focus when an unfocused toast is removed', () => {
    mount()
    show('error')
    const opener = screen.getByTestId('opener')
    const elsewhere = document.createElement('input')
    document.body.appendChild(elsewhere)
    act(() => opener.focus())
    act(() => closeButton().focus())
    act(() => elsewhere.focus())
    const id = toastOf('error')?.getAttribute('data-toast-id') ?? ''

    act(() => removeToastFromOutside(id))

    expect(document.activeElement).toBe(elsewhere)
  })
})
