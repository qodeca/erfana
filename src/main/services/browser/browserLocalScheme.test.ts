// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it, vi } from 'vitest'

vi.mock('../LoggingService', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

import { BROWSER_LOCAL_SCHEME, BROWSER_LOCAL_SCHEME_PRIVILEGES, refuseLocalScheme } from './browserLocalScheme'

describe('browserLocalScheme (ADR 0012)', () => {
  it('names the scheme erfana-local, lowercase', () => {
    expect(BROWSER_LOCAL_SCHEME).toBe('erfana-local')
  })

  it('declares standard and secure only, frozen', () => {
    expect(BROWSER_LOCAL_SCHEME_PRIVILEGES).toEqual({ standard: true, secure: true })
    expect(Object.isFrozen(BROWSER_LOCAL_SCHEME_PRIVILEGES)).toBe(true)
  })

  it('a refused session answers every erfana-local request with 403 and an empty body', async () => {
    const handle = vi.fn()
    refuseLocalScheme({ protocol: { handle } })
    expect(handle).toHaveBeenCalledWith('erfana-local', expect.any(Function))
    const handler = handle.mock.calls[0][1] as (request: Request) => Response
    for (const url of ['erfana-local://0123abcd/index.html', 'erfana-local://x/../../etc/passwd']) {
      const response = handler(new Request(url))
      expect(response.status).toBe(403)
      expect(await response.text()).toBe('')
    }
  })
})
