// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const logger = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
vi.mock('../../LoggingService', () => ({ logger }))

import { isSearchLoad, logLoadFailure } from './loadFailureLog'

describe('isSearchLoad', () => {
  it.each([
    ['https://duckduckgo.com/?q=secret+words', true],
    ['https://html.duckduckgo.com/html?q=x', true],
    ['https://DuckDuckGo.com/', true],
    ['https://notduckduckgo.com/?q=x', false],
    ['https://duckduckgo.com.evil.test/', false],
    ['http://localhost:5173/', false],
    ['not a url', false]
  ])('%s → %s', (url, expected) => {
    expect(isSearchLoad(url)).toBe(expected)
  })
})

describe('logLoadFailure (025-FR-042, 025-AC-042)', () => {
  beforeEach(() => logger.info.mockClear())

  it('logs the full URL with its path and query, dropping userinfo and the fragment', () => {
    logLoadFailure(-105, 'https://user:pw@app.test:8443/admin/list?page=2&sort=name#row-4')
    expect(logger.info).toHaveBeenCalledWith('A browser tab page failed to load', {
      code: -105,
      url: 'https://app.test:8443/admin/list?page=2&sort=name'
    })
    expect(JSON.stringify(logger.info.mock.calls)).not.toMatch(/user|pw|row-4/)
  })

  it('logs a failed search load as an event with no URL, so the typed search text never reaches the log', () => {
    logLoadFailure(-105, 'https://duckduckgo.com/?q=my+secret+search')
    expect(logger.info).toHaveBeenCalledWith('search load failed', { code: -105 })
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('secret')
  })

  it('keeps an unparseable address as text, cut to its bound', () => {
    logLoadFailure(-300, 'x'.repeat(5000))
    const [, fields] = logger.info.mock.calls[0] as [string, { url: string }]
    expect(fields.url.length).toBeLessThan(5000)
  })
})
