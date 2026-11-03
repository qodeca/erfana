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

  it('installs once per session', () => {
    const fake = fakeSession()
    installAppRequestFilter(fake.session as never, () => app)
    installAppRequestFilter(fake.session as never, () => app)
    expect(fake.session.webRequest.onBeforeRequest).toHaveBeenCalledTimes(1)
  })
})
