// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The private-network rule (S-16, 025-FR-005) and the session request hooks
 * that apply it and report finished requests for sign-in saving.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../LoggingService', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { refusedByPrivateNetworkRule } from './browserPrivateNetwork'
import { installSiteRequestHooks } from './siteRequestHooks'

const refused = (url: string, topUrl: string | null, resourceType = 'xhr', initiatorOrigin?: string): boolean =>
  refusedByPrivateNetworkRule({ url, resourceType, topUrl, initiatorOrigin })

describe('refusedByPrivateNetworkRule', () => {
  it('refuses a public page\'s subresources and frames to loopback, private and other local addresses', () => {
    for (const target of ['http://localhost:3000/api', 'http://127.0.0.1/', 'http://192.168.1.1/admin', 'http://10.0.0.5/', 'http://[::1]/', 'http://0.0.0.0:8080/']) {
      expect(refused(target, 'https://evil.example/')).toBe(true)
    }
    expect(refused('http://192.168.1.1/', 'https://evil.example/', 'subFrame')).toBe(true)
  })

  it('allows a main-frame navigation, a public target, and a local or private page', () => {
    expect(refused('http://localhost:3000/', 'https://evil.example/', 'mainFrame')).toBe(false)
    expect(refused('https://api.example/', 'https://app.example/')).toBe(false)
    expect(refused('http://192.168.1.5/api', 'http://localhost:5173/')).toBe(false)
    expect(refused('http://localhost:8080/api', 'http://10.0.0.2/')).toBe(false)
    expect(refused('http://localhost:8080/api', 'erfana-local://folder/index.html')).toBe(false)
  })

  it('falls back to the initiator when the page says nothing, and allows a request with no page', () => {
    expect(refused('http://localhost/', 'about:blank', 'xhr', 'https://evil.example')).toBe(true)
    expect(refused('http://localhost/', null, 'xhr', 'https://evil.example')).toBe(true)
    expect(refused('http://localhost/', null, 'xhr', 'http://localhost:3000')).toBe(false)
    expect(refused('http://localhost/', null)).toBe(false)
    expect(refused('http://localhost/', '', 'xhr', 'not a url')).toBe(false)
    expect(refused('not a url', 'https://evil.example/')).toBe(false)
  })
})

describe('installSiteRequestHooks', () => {
  function fakeSession() {
    const handlers: Record<string, (...args: never[]) => void> = {}
    const webRequest = {
      onBeforeSendHeaders: vi.fn((h) => (handlers.send = h)),
      onCompleted: vi.fn((h) => (handlers.completed = h)),
      onErrorOccurred: vi.fn((h) => (handlers.error = h))
    }
    return { session: { webRequest } as never, webRequest, handlers: handlers as Record<string, (...args: unknown[]) => void> }
  }

  it('installs once per session, cancels refused requests and keeps the headers of the others', () => {
    const { session, webRequest, handlers } = fakeSession()
    const sink = { requestCompleted: vi.fn() }
    installSiteRequestHooks(session, sink)
    installSiteRequestHooks(session, sink)
    expect(webRequest.onBeforeSendHeaders).toHaveBeenCalledTimes(1)
    const page = { getURL: () => 'https://evil.example/', isDestroyed: () => false }
    const answers: unknown[] = []
    handlers.send({ url: 'http://localhost/', resourceType: 'xhr', webContents: page, requestHeaders: { A: '1' } }, (r: unknown) => answers.push(r))
    handlers.send({ url: 'https://ok.example/', resourceType: 'xhr', webContents: page, requestHeaders: { A: '1' } }, (r: unknown) => answers.push(r))
    const gone = { getURL: () => 'https://evil.example/', isDestroyed: () => true }
    handlers.send({ url: 'http://localhost/', resourceType: 'xhr', webContents: gone, requestHeaders: {} }, (r: unknown) => answers.push(r))
    expect(answers).toEqual([{ cancel: true }, { requestHeaders: { A: '1' } }, { requestHeaders: {} }])
  })

  it('reports how a page\'s request ended, and ignores requests with no page', () => {
    const { session, handlers } = fakeSession()
    const sink = { requestCompleted: vi.fn() }
    installSiteRequestHooks(session, sink)
    handlers.completed({ webContentsId: 4, url: 'https://a.test/basic', statusCode: 200 })
    handlers.error({ webContentsId: 4, url: 'https://a.test/x' })
    handlers.completed({ url: 'https://a.test/', statusCode: 200 })
    handlers.error({ url: 'https://a.test/' })
    expect(sink.requestCompleted.mock.calls).toEqual([
      [4, 'https://a.test/basic', 200],
      [4, 'https://a.test/x', null]
    ])
  })
})
