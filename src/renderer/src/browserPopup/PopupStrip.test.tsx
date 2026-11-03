// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { BrowserPopupBridge } from '../../../shared/ipc/browser-popup-bridge-types'
import type { PopupStripResponse } from '../../../shared/ipc/browser-tab-popup-schema'
import { PopupStrip, popupAddress } from './PopupStrip'
import { fakeOriginLayout } from '../components/Panels/BrowserPanel/__test__/originFitLayout'

const WEB: PopupStripResponse = {
  committedUrl: 'http://login.example.test/sso?x=1',
  origin: { kind: 'web', scheme: 'http', subdomain: 'login.', registrableDomain: 'example.test', port: null, punycode: false },
  security: 'notSecureHttp',
  openedBy: 'app.test'
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
    expect(popupAddress(WEB)).toMatch(/login\.example\.test\/sso/)
    expect(popupAddress({ committedUrl: 'mailto:a@b.c', origin: { kind: 'nonWeb', scheme: 'mailto' }, security: 'secure', openedBy: 'app.test' })).toBe('mailto:')
    expect(popupAddress({ committedUrl: 'file:///x/a.html', origin: { kind: 'file' }, security: 'file', openedBy: 'app.test' })).toBe('file:///x/a.html')
  })

  it('F4: a popup with no address of its own names its opener, not "Loading…" (attacker pass, issue #448)', () => {
    expect(popupAddress({ ...WEB, committedUrl: null, origin: null })).toBe('about:blank – opened by app.test')
    expect(popupAddress({ committedUrl: 'about:blank', origin: { kind: 'nonWeb', scheme: 'about' }, security: 'secure', openedBy: 'a page' })).toBe(
      'about:blank – opened by a page'
    )
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
    expect(field).toHaveValue('about:blank – opened by app.test')
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

describe('PopupStrip – a long host (attacker pass F1, issue #448)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('fits the origin at rest so the registrable domain shows, and holds the whole address while focused', async () => {
    fakeOriginLayout(8 * 25)
    const long: PopupStripResponse = {
      committedUrl: 'https://accounts.google.com.secure-login.evil.test/sso',
      origin: { kind: 'web', scheme: null, subdomain: 'accounts.google.com.secure-login.', registrableDomain: 'evil.test', port: null, punycode: false },
      security: 'secure',
      openedBy: 'app.test'
    }
    render(<PopupStrip api={bridge([long])} />)
    await act(async () => {
      await Promise.resolve()
    })
    const field = screen.getByRole('textbox', { name: 'Pop-up window address' })
    expect(field).toHaveValue('….secure-login.evil.test/sso')
    fireEvent.focus(field)
    expect(field).toHaveValue('accounts.google.com.secure-login.evil.test/sso')
    fireEvent.blur(field)
    expect(field).toHaveValue('….secure-login.evil.test/sso')
  })
})
