// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it, vi } from 'vitest'

vi.mock('../LoggingService', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('./browserNavigationPolicy', () => ({ checkNavigation: () => ({ allowed: true }) }))

import { guardPageNavigation, type TabNavigationGuardDeps } from './tabNavigationGuard'

type Handler = (details: { url: string; isMainFrame?: boolean; preventDefault(): void }) => void

function setup(contentsId: number | undefined): {
  navigate: (event: string, url: string, isMainFrame?: boolean) => boolean
  allowsRequest: ReturnType<typeof vi.fn>
} {
  const handlers = new Map<string, Handler>()
  const contents = { on: (event: string, handler: Handler) => handlers.set(event, handler) }
  const allowsRequest = vi.fn(() => false)
  const deps: TabNavigationGuardDeps = {
    appAddresses: () => ({}) as never,
    local: { isLocalAddress: () => true, allowsRequest },
    committedUrl: () => 'https://example.test/page',
    ...(contentsId === undefined ? {} : { contentsId })
  }
  guardPageNavigation(contents as never, deps)
  return {
    navigate: (event, url, isMainFrame) => {
      let refused = false
      handlers.get(event)?.({ url, isMainFrame, preventDefault: () => (refused = true) })
      return refused
    },
    allowsRequest
  }
}

describe('guardPageNavigation and the served-folder gate (ADR 0012 amendment 2026-11-04)', () => {
  it("passes the tab's webContents id to the gate for a frame, so its pending load's folder can be allowed", () => {
    const { navigate, allowsRequest } = setup(7)
    expect(navigate('will-frame-navigate', 'http://127.0.0.1:5000/t/a.html', false)).toBe(true)
    expect(allowsRequest).toHaveBeenCalledWith({
      url: 'http://127.0.0.1:5000/t/a.html',
      resourceType: 'subFrame',
      topUrl: 'https://example.test/page',
      contentsId: 7
    })
  })

  it('asks without a webContents id when the tab has none, and refuses what the gate refuses', () => {
    const { navigate, allowsRequest } = setup(undefined)
    expect(navigate('will-navigate', 'http://127.0.0.1:5000/t/a.html')).toBe(true)
    expect(allowsRequest).toHaveBeenCalledWith({
      url: 'http://127.0.0.1:5000/t/a.html',
      resourceType: 'mainFrame',
      topUrl: 'https://example.test/page'
    })
  })

  it('lets a navigation the gate allows go ahead', () => {
    const { navigate, allowsRequest } = setup(7)
    allowsRequest.mockReturnValue(true)
    expect(navigate('will-redirect', 'http://127.0.0.1:5000/t/b.html', true)).toBe(false)
  })
})
