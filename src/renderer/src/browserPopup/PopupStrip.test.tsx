// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { BrowserPopupBridge } from '../../../shared/ipc/browser-popup-bridge-types'
import type { PopupStripResponse } from '../../../shared/ipc/browser-tab-popup-schema'
import { PopupStrip, popupAddress } from './PopupStrip'

const WEB: PopupStripResponse = {
  committedUrl: 'http://login.example.test/sso?x=1',
  origin: { kind: 'web', scheme: 'http', subdomain: 'login.', registrableDomain: 'example.test', port: null, punycode: false },
  security: 'notSecureHttp'
}

function bridge(answers: Array<PopupStripResponse | null | Error>): BrowserPopupBridge & { fire: () => void; off: ReturnType<typeof vi.fn> } {
  let listener: () => void = () => undefined
  const off = vi.fn()
  return {
    strip: vi.fn(async () => {
      const next = answers.shift() ?? null
      if (next instanceof Error) throw next
      return next
    }),
    close: vi.fn(async () => undefined),
    onChanged: vi.fn((cb: () => void) => {
      listener = cb
      return off
    }),
    fire: () => listener(),
    off
  }
}

afterEach(cleanup)

describe('popupAddress', () => {
  it('formats the committed address, a non-web scheme, a file, or says it is loading', () => {
    expect(popupAddress(null)).toBe('Loading…')
    expect(popupAddress({ ...WEB, committedUrl: null })).toBe('Loading…')
    expect(popupAddress(WEB)).toMatch(/login\.example\.test\/sso/)
    expect(popupAddress({ committedUrl: 'about:blank', origin: { kind: 'nonWeb', scheme: 'about' }, security: 'secure' })).toBe('about:')
    expect(popupAddress({ committedUrl: 'file:///x/a.html', origin: { kind: 'file' }, security: 'file' })).toBe('file:///x/a.html')
  })
})

describe('PopupStrip', () => {
  it('shows the read-only address with the badge, re-reads on change, and unsubscribes', async () => {
    const api = bridge([WEB, { ...WEB, committedUrl: null }])
    const { unmount } = render(<PopupStrip api={api} />)
    const field = screen.getByRole('textbox', { name: 'Pop-up window address' })
    expect(field).toHaveValue('Loading…')
    await act(async () => {
      await Promise.resolve()
    })
    expect(field).toHaveValue(popupAddress(WEB))
    expect(field).toHaveAttribute('readonly')
    expect(screen.getByTestId('browser-popup-strip').querySelector('.erf-popup-strip__badge')).not.toBeNull()
    await act(async () => {
      api.fire()
      await Promise.resolve()
    })
    expect(field).toHaveValue('Loading…')
    unmount()
    expect(api.off).toHaveBeenCalledTimes(1)
  })

  it('falls back to loading when the read fails, and closes on Ctrl or Cmd+W only', async () => {
    const api = bridge([new Error('gone')])
    render(<PopupStrip api={api} />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByRole('textbox')).toHaveValue('Loading…')
    fireEvent.keyDown(window, { key: 'w' })
    fireEvent.keyDown(window, { key: 'W', ctrlKey: true, shiftKey: true })
    expect(api.close).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: 'w', metaKey: true })
    fireEvent.keyDown(window, { key: 'W', ctrlKey: true })
    expect(api.close).toHaveBeenCalledTimes(2)
  })
})
