// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/** Browser-session requests to Erfana's own addresses (spec 025, 025-FR-005 rule 3). */
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({}))
vi.mock('../LoggingService', () => ({ logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() } }))

import { installAppRequestFilter } from './browserAppRequestFilter'
import type { AppAddresses } from './browserNavigationPolicy'

type Filter = (details: { url: string; resourceType: string }, cb: (r: { cancel: boolean }) => void) => void

function fakeSession(): { session: { webRequest: { onBeforeRequest: ReturnType<typeof vi.fn> } }; filter: () => Filter } {
  const onBeforeRequest = vi.fn()
  return { session: { webRequest: { onBeforeRequest } }, filter: () => onBeforeRequest.mock.calls[0][0] as Filter }
}

describe('installAppRequestFilter', () => {
  const app: AppAddresses = { rendererEntry: 'file:///app/out/renderer/index.html', resourcesDir: '/app', devServerOrigin: null }

  it('cancels requests to the app addresses and lets the rest through, reading the addresses per request', () => {
    const fake = fakeSession()
    installAppRequestFilter(fake.session as never, () => app)
    const answer = (url: string): boolean => {
      let cancel: boolean | undefined
      fake.filter()({ url, resourceType: 'xhr' }, (r) => (cancel = r.cancel))
      return cancel!
    }
    expect(answer('file:///app/out/renderer/index.html')).toBe(true)
    expect(answer('https://example.com/')).toBe(false)
    expect(answer('http://localhost:5173/')).toBe(false)
    app.devServerOrigin = 'http://localhost:5173'
    expect(answer('http://localhost:5173/@vite/client')).toBe(true)
  })

  it('cancels every file: subresource and frame, and a network share even as the main frame (025-FR-005 rules 1 and 2)', () => {
    const fake = fakeSession()
    installAppRequestFilter(fake.session as never, () => app)
    const answer = (url: string, resourceType: string): boolean => {
      let cancel: boolean | undefined
      fake.filter()({ url, resourceType }, (r) => (cancel = r.cancel))
      return cancel!
    }
    for (const url of ['file:///Users/me/site/index.html', 'FILE:///etc/passwd', 'file://host/share/x.png']) {
      expect(answer(url, 'image')).toBe(true)
      expect(answer(url, 'subFrame')).toBe(true)
    }
    expect(answer('file://host/share/x.html', 'mainFrame')).toBe(true)
    expect(answer('file://[bad/x.html', 'mainFrame')).toBe(true)
    // A plain main-frame file: load is the navigation policy's to refuse; the app entry stays refused here.
    expect(answer('file:///Users/me/site/index.html', 'mainFrame')).toBe(false)
    expect(answer('file:///app/out/renderer/index.html', 'mainFrame')).toBe(true)
  })

  it('asks the served local folders about every other request, with the tab\'s top-level address', () => {
    const fake = fakeSession()
    const allowsRequest = vi.fn((request: { url: string }) => !request.url.includes('/refused'))
    installAppRequestFilter(fake.session as never, () => app, { allowsRequest })
    type LocalFilter = (
      details: { url: string; resourceType: string; webContents?: { getURL(): string; isDestroyed(): boolean } },
      cb: (r: { cancel: boolean }) => void
    ) => void
    const filter = fake.filter() as unknown as LocalFilter
    const answers: boolean[] = []
    const page = { getURL: () => 'http://127.0.0.1:1/t/index.html', isDestroyed: () => false }
    filter({ url: 'http://127.0.0.1:1/t/ok.png', resourceType: 'image', webContents: page }, (r) => answers.push(r.cancel))
    filter({ url: 'http://127.0.0.1:1/t/refused.png', resourceType: 'image', webContents: { ...page, isDestroyed: () => true } }, (r) =>
      answers.push(r.cancel)
    )
    filter({ url: 'http://127.0.0.1:1/t/refused.png', resourceType: 'mainFrame' }, (r) => answers.push(r.cancel))
    expect(answers).toEqual([false, true, true])
    expect(allowsRequest.mock.calls.map((c) => c[0])).toEqual([
      { url: 'http://127.0.0.1:1/t/ok.png', resourceType: 'image', topUrl: 'http://127.0.0.1:1/t/index.html' },
      { url: 'http://127.0.0.1:1/t/refused.png', resourceType: 'image', topUrl: null },
      { url: 'http://127.0.0.1:1/t/refused.png', resourceType: 'mainFrame', topUrl: null }
    ])
  })

  it('installs once per session', () => {
    const fake = fakeSession()
    installAppRequestFilter(fake.session as never, () => app)
    installAppRequestFilter(fake.session as never, () => app)
    expect(fake.session.webRequest.onBeforeRequest).toHaveBeenCalledTimes(1)
  })
})
