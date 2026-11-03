// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react'

const gateway = vi.hoisted(() => ({
  suggest: vi.fn(),
  history: vi.fn(async () => undefined),
  certificate: vi.fn(async () => undefined)
}))
vi.mock('../../../services/browserTabGateway', () => ({ browserTabGateway: gateway }))
vi.mock('../../../utils/platform', () => ({ isMacOS: () => false, isWindows: () => true }))
vi.mock('../../../utils/logger', () => ({ logger: { warn: vi.fn() } }))

import {
  CertificatePage,
  CrashedPage,
  EMPTY_TAB_RECENT_ROWS,
  EmptyTabPage,
  LoadErrorPage,
  rowAddress
} from './ErfanaPages'
import { browserState } from './__test__/browserState'
import { logger } from '../../../utils/logger'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('rowAddress', () => {
  it('formats web addresses and leaves others as they are', () => {
    expect(rowAddress('https://example.test/a?b')).toBe('example.test/a?b')
    expect(rowAddress('http://localhost:5173/')).toBe('http://localhost:5173')
    expect(rowAddress('file:///p/a.html')).toBe('file:///p/a.html')
    expect(rowAddress('nonsense')).toBe('nonsense')
  })
})

describe('EmptyTabPage', () => {
  it('shows the first-run line and the pick hint when there is nothing to list', async () => {
    gateway.suggest.mockResolvedValue({ rows: [] })
    render(<EmptyTabPage localAddresses={[]} onOpen={vi.fn()} />)
    await act(async () => undefined)
    expect(gateway.suggest).toHaveBeenCalledWith('')
    expect(
      screen.getByText('Type an address such as localhost:5173 in the address bar.')
    ).toBeInTheDocument()
    const hint = screen.getByText(/Load your app, then click/)
    expect(hint).toHaveTextContent(
      'Load your app, then click Pick element (Ctrl+E) to pick an element'
    )
    expect(hint.querySelector('strong')).toHaveTextContent('Pick element')
  })

  it('lists at most 8 recent addresses and the local servers, and opens a row', async () => {
    const rows = Array.from({ length: 12 }, (_, n) => ({ url: `https://site${n}.test/` }))
    gateway.suggest.mockResolvedValue({ rows })
    const onOpen = vi.fn()
    render(<EmptyTabPage localAddresses={['http://localhost:4100/']} onOpen={onOpen} />)
    const recent = await screen.findByRole('list', { name: 'Recent addresses' })
    expect(recent.querySelectorAll('li')).toHaveLength(EMPTY_TAB_RECENT_ROWS)
    expect(
      screen.getByRole('heading', { name: 'Local servers seen in your terminals' })
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'http://localhost:4100' }))
    expect(onOpen).toHaveBeenCalledWith('http://localhost:4100/')
    expect(screen.queryByText(/Type an address such as/)).not.toBeInTheDocument()
  })

  it('logs history it cannot read, and ignores an answer after unmount', async () => {
    gateway.suggest.mockRejectedValueOnce(new Error('gone'))
    render(<EmptyTabPage localAddresses={[]} onOpen={vi.fn()} />)
    await vi.waitFor(() => expect(logger.warn).toHaveBeenCalled())
    let answer: (value: unknown) => void = () => {}
    gateway.suggest.mockReturnValueOnce(new Promise(resolve => (answer = resolve)))
    const { unmount } = render(<EmptyTabPage localAddresses={[]} onOpen={vi.fn()} />)
    unmount()
    await act(async () => answer({ rows: [{ url: 'https://late.test/' }] }))
  })
})

describe('LoadErrorPage', () => {
  it('names the error and the address, and focuses Reload after a load the user started', () => {
    const state = browserState({
      erfanaPage: 'loadError',
      loadError: { code: -102, focus: 'reload' },
      committedUrl: 'http://localhost:9/',
      origin: { kind: 'web', scheme: 'http', subdomain: '', registrableDomain: 'localhost', port: '9', punycode: false }
    })
    render(<LoadErrorPage tabId="browser-tab-1" state={state} mayTakeFocus={() => true} />)
    // Commit 18: the per-code title and the loopback hint in place of the next step.
    expect(screen.getByRole('heading', { name: 'localhost refused to connect' })).toBeInTheDocument()
    expect(screen.getByText(/Is your dev server running\?/)).toBeInTheDocument()
    expect(screen.getByText(/ERR_CONNECTION_REFUSED \(-102\)/)).toHaveTextContent(
      'http://localhost:9 · '
    )
    const reload = screen.getByRole('button', { name: 'Reload' })
    expect(reload).toHaveFocus()
    fireEvent.click(reload)
    expect(gateway.history).toHaveBeenCalledWith('browser-tab-1', 'reload')
  })

  it('focuses the heading after a page-started load, and nothing when focus is elsewhere', () => {
    const state = browserState({
      erfanaPage: 'loadError',
      loadError: { code: -105, focus: 'heading' }
    })
    const { unmount } = render(
      <LoadErrorPage tabId="browser-tab-1" state={state} mayTakeFocus={() => true} />
    )
    expect(screen.getByRole('heading')).toHaveFocus()
    unmount()
    render(<LoadErrorPage tabId="browser-tab-1" state={state} mayTakeFocus={() => false} />)
    expect(document.body).toHaveFocus()
  })

  it('renders nothing without load-error parts', () => {
    const { container } = render(
      <LoadErrorPage tabId="browser-tab-1" state={browserState()} mayTakeFocus={() => true} />
    )
    expect(container).toBeEmptyDOMElement()
  })
})

describe('CrashedPage', () => {
  it('says the page crashed and reloads it, logging a failed reload', async () => {
    gateway.history.mockRejectedValueOnce(new Error('gone'))
    render(
      <CrashedPage
        tabId="browser-tab-1"
        state={browserState({ erfanaPage: 'crashed' })}
        mayTakeFocus={() => true}
      />
    )
    expect(screen.getByRole('heading', { name: 'This page crashed' })).toBeInTheDocument()
    const reload = screen.getByRole('button', { name: 'Reload' })
    expect(reload).toHaveFocus()
    fireEvent.click(reload)
    await vi.waitFor(() => expect(logger.warn).toHaveBeenCalled())
  })
})

describe('CertificatePage', () => {
  const certificate = { decisionId: 'd-1', host: 'staging.test', code: -202, shownAt: 0 }

  it('names the host and goes Back to safety, never proceeding', async () => {
    render(
      <CertificatePage
        tabId="browser-tab-1"
        state={browserState({ erfanaPage: 'certificate', certificate })}
        mayTakeFocus={() => true}
      />
    )
    expect(screen.getByRole('heading')).toHaveTextContent(
      "staging.test has a certificate Erfana can't trust"
    )
    const back = screen.getByRole('button', { name: 'Back to safety' })
    expect(back).toHaveFocus()
    // Commit 18: Proceed anyway shows at once, in its guard look just after the page appears.
    expect(screen.getByRole('button', { name: 'Proceed anyway to staging.test' })).toHaveAttribute('aria-disabled', 'true')
    gateway.certificate.mockRejectedValueOnce(new Error('gone'))
    fireEvent.click(back)
    expect(gateway.certificate).toHaveBeenCalledWith({
      tabId: 'browser-tab-1',
      decisionId: 'd-1',
      proceed: false
    })
    await vi.waitFor(() => expect(logger.warn).toHaveBeenCalled())
  })

  it('blocks Proceed anyway for 500 ms and ignores a press begun before the page, then proceeds', () => {
    vi.useFakeTimers()
    let now = 5000
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
    try {
      render(
        <CertificatePage
          tabId="browser-tab-1"
          state={browserState({ erfanaPage: 'certificate', certificate })}
          mayTakeFocus={() => false}
        />
      )
      const proceed = screen.getByRole('button', { name: 'Proceed anyway to staging.test' })
      expect(proceed).toHaveAccessibleDescription(/for staging\.test for 7 days/)
      const downAt = (at: number): void => {
        const event = createEvent.pointerDown(proceed)
        Object.defineProperty(event, 'timeStamp', { value: at })
        fireEvent(proceed, event)
      }
      downAt(now)
      fireEvent.click(proceed)
      expect(gateway.certificate).not.toHaveBeenCalled()
      downAt(now - 1)
      now += 500
      act(() => {
        vi.advanceTimersByTime(500)
      })
      expect(proceed).not.toHaveAttribute('aria-disabled')
      fireEvent.click(proceed)
      expect(gateway.certificate).not.toHaveBeenCalled()
      downAt(now)
      fireEvent.click(proceed)
      expect(gateway.certificate).toHaveBeenCalledWith({ tabId: 'browser-tab-1', decisionId: 'd-1', proceed: true })
      expect(screen.getByText('More about this error')).toBeInTheDocument()
      expect(screen.getByText('ERR_CERT_AUTHORITY_INVALID (-202)')).toBeInTheDocument()
    } finally {
      clock.mockRestore()
      vi.useRealTimers()
    }
  })

  it('renders nothing without the warning parts', () => {
    const { container } = render(
      <CertificatePage tabId="browser-tab-1" state={browserState()} mayTakeFocus={() => true} />
    )
    expect(container).toBeEmptyDOMElement()
  })
})
