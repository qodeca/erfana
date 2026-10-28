// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The request filter's frame guard (issue #124, WI-12; design part 2 §2.4,
 * RX9): a remote subframe is refused as `frame-remote` whatever the allowlist
 * says, a subframe on another token as `frame-escape` – a stale token on a
 * recycled partition included – and neither reaches the permission band.
 * Split from `PreviewRequestFilter.test.ts` by topic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { logger } from '../LoggingService'
import { attach } from './PreviewRequestFilter'
import {
  FILTER_DEPS,
  OTHER_TOKEN,
  OWN_TOKEN,
  details,
  makeContext,
  makeSession,
  type OnBeforeListener
} from './__test-helpers__/previewRequestFilterMocks'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('PreviewRequestFilter frames (#124, WI-12)', () => {
  function attachWith(allowed: string[], ownToken = OWN_TOKEN) {
    const s = makeSession()
    const context = makeContext(allowed, ownToken)
    attach(s.session, context.ctx, FILTER_DEPS)
    const listener = s.onBeforeRequest.mock.calls[0][0] as OnBeforeListener
    return { ...context, listener, session: s }
  }

  it.each([
    ['an approved host', ['https://cdn.example'], 'https://cdn.example/embed.html'],
    ['an unapproved host', [], 'https://evil.example/frame.html'],
    ['plain http', [], 'http://example.com/'],
    ['another scheme', [], 'file:///etc/passwd']
  ])(
    'cancels a remote subframe on %s and lists it as frame-remote, never on the band',
    (_label, allowed, url) => {
      const { listener, recordFrameRefusal, onBlocked, onRequestStarted } = attachWith(allowed)
      const callback = vi.fn()
      listener(details(1, url, 'subFrame'), callback)

      // Approved hosts load as subresources, never as frames (part 2 §2.4).
      expect(callback).toHaveBeenCalledWith({ cancel: true })
      expect(callback).toHaveBeenCalledTimes(1)
      expect(recordFrameRefusal).toHaveBeenCalledWith('frame-remote', url)
      expect(onBlocked).not.toHaveBeenCalled()
      expect(onRequestStarted).not.toHaveBeenCalled()
    }
  )

  it('lists only the scheme of a data: or blob: frame, so an inline URL never enters the log', () => {
    const { listener, recordFrameRefusal } = attachWith([])
    const dataCallback = vi.fn()
    listener(details(1, `data:text/html,${'<p>x</p>'.repeat(10_000)}`, 'subFrame'), dataCallback)
    const blobCallback = vi.fn()
    listener(details(2, 'blob:erfana-preview://x/1234-5678', 'subFrame'), blobCallback)

    expect(dataCallback).toHaveBeenCalledWith({ cancel: true })
    expect(blobCallback).toHaveBeenCalledWith({ cancel: true })
    expect(recordFrameRefusal.mock.calls).toEqual([
      ['frame-remote', 'data:'],
      ['frame-remote', 'blob:']
    ])
  })

  it('cancels a subframe on another token and lists it as frame-escape', () => {
    const { listener, recordFrameRefusal, onBlocked, onRequestStarted, ledger } = attachWith([])
    const url = `erfana-preview://${OTHER_TOKEN}/secret.html`
    const callback = vi.fn()
    listener(details(3, url, 'subFrame'), callback)

    expect(callback).toHaveBeenCalledWith({ cancel: true })
    expect(recordFrameRefusal).toHaveBeenCalledWith('frame-escape', url)
    expect(onBlocked).not.toHaveBeenCalled()
    expect(onRequestStarted).not.toHaveBeenCalled()
    // Refused here, so it never reaches the handler: nothing left for it to take.
    expect(ledger.take(url)).toBeUndefined()
  })

  it('lets a subframe on its own token through and notes it as a frame for the handler', () => {
    const { listener, recordFrameRefusal, onRequestStarted, ledger } = attachWith([])
    const url = `erfana-preview://${OWN_TOKEN}/child.html`
    const callback = vi.fn()
    listener(details(4, url, 'subFrame'), callback)

    expect(callback).toHaveBeenCalledWith({ cancel: false })
    expect(onRequestStarted).toHaveBeenCalledWith(4)
    expect(recordFrameRefusal).not.toHaveBeenCalled()
    expect(ledger.take(url)).toBe('subFrame')
  })

  it.each([['about:blank'], ['about:srcdoc']])('lets an %s frame through', (url) => {
    const { listener, recordFrameRefusal } = attachWith([])
    const callback = vi.fn()
    listener(details(5, url, 'subFrame'), callback)

    expect(callback).toHaveBeenCalledWith({ cancel: false })
    expect(recordFrameRefusal).not.toHaveBeenCalled()
  })

  it.each([
    ['an upper-case spelling of its own token', `erfana-preview://${OWN_TOKEN.toUpperCase()}/a.html`],
    ['no token at all', 'erfana-preview:///a.html'],
    ['a URL that does not parse', 'erfana-preview://[/a.html']
  ])('fails closed on %s', (_label, url) => {
    const { listener, recordFrameRefusal } = attachWith([])
    const callback = vi.fn()
    listener(details(6, url, 'subFrame'), callback)

    expect(callback).toHaveBeenCalledWith({ cancel: true })
    expect(recordFrameRefusal).toHaveBeenCalledTimes(1)
  })

  it('refuses every preview-scheme frame when its own token is empty (fail closed)', () => {
    const { listener, recordFrameRefusal } = attachWith([], '')
    const callback = vi.fn()
    listener(details(7, 'erfana-preview:///a.html', 'subFrame'), callback)

    expect(callback).toHaveBeenCalledWith({ cancel: true })
    expect(recordFrameRefusal).toHaveBeenCalledWith('frame-escape', 'erfana-preview:///a.html')
  })

  it('still cancels when listing the refusal throws', () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined)
    const { listener, recordFrameRefusal } = attachWith([])
    recordFrameRefusal.mockImplementation(() => {
      throw new Error('scope gone')
    })
    const callback = vi.fn()
    listener(details(8, 'https://evil.example/', 'subFrame'), callback)

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith({ cancel: true })
    expect(error).toHaveBeenCalledTimes(1)
    error.mockRestore()
  })

  it('a recycled partition with a stale token cancels the subframe and records frame-escape (RX9)', () => {
    // Partition names are recycled (src/main/services/CLAUDE.md): the next view
    // on this session gets a new token, a new context and a new listener. The
    // previous view's token must then fail closed, not keep framing.
    const s = makeSession()
    const first = makeContext([], OTHER_TOKEN)
    const detach = attach(s.session, first.ctx, FILTER_DEPS)
    detach()
    const second = makeContext([])
    attach(s.session, second.ctx, FILTER_DEPS)

    const listeners = s.onBeforeRequest.mock.calls.filter((call) => typeof call[0] === 'function')
    expect(listeners).toHaveLength(2)
    const current = listeners[1][0] as OnBeforeListener

    const stale = `erfana-preview://${OTHER_TOKEN}/index.html`
    const staleCallback = vi.fn()
    current(details(9, stale, 'subFrame'), staleCallback)
    const ownCallback = vi.fn()
    current(details(10, `erfana-preview://${OWN_TOKEN}/index.html`, 'subFrame'), ownCallback)

    expect(staleCallback).toHaveBeenCalledWith({ cancel: true })
    expect(second.recordFrameRefusal).toHaveBeenCalledWith('frame-escape', stale)
    expect(ownCallback).toHaveBeenCalledWith({ cancel: false })
    // Nothing reaches the previous view's page scopes or ledger.
    expect(first.recordFrameRefusal).not.toHaveBeenCalled()
    expect(first.ledger.take(`erfana-preview://${OWN_TOKEN}/index.html`)).toBeUndefined()
  })

  it('leaves non-frame requests to the existing rules', () => {
    const { listener, recordFrameRefusal, onBlocked } = attachWith(['https://cdn.example'])
    const allowed = vi.fn()
    listener(details(11, 'https://cdn.example/lib.js', 'script'), allowed)
    const blocked = vi.fn()
    listener(details(12, 'https://evil.example/pixel.png', 'image'), blocked)

    expect(allowed).toHaveBeenCalledWith({ cancel: false })
    expect(blocked).toHaveBeenCalledWith({ cancel: true })
    expect(onBlocked).toHaveBeenCalledTimes(1)
    expect(recordFrameRefusal).not.toHaveBeenCalled()
  })
})
