// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const logger = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
vi.mock('../../LoggingService', () => ({ logger }))

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
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

  it('logs a served local file by its redacted path, never its loopback address or folder (ADR 0012 decision 9)', () => {
    const served = 'http://127.0.0.1:41234/0123456789abcdef0123456789abcdef/report.html'
    const file = pathToFileURL(join(tmpdir(), 'Clients', 'Acme', 'report.html')).href
    logLoadFailure(-6, served, (url) => (url === served ? file : null))
    expect(logger.info).toHaveBeenCalledWith('A browser tab local file failed to load', { code: -6, file: '[redacted]/report.html' })
    expect(JSON.stringify(logger.info.mock.calls)).not.toMatch(/127\.0\.0\.1|0123456789abcdef|Acme|Clients/)
    logLoadFailure(-6, 'https://app.test/x', () => null)
    expect(logger.info).toHaveBeenLastCalledWith('A browser tab page failed to load', { code: -6, url: 'https://app.test/x' })
  })

  it('logs a placeholder when the local address cannot be read back as a path', () => {
    logLoadFailure(-6, 'http://127.0.0.1:1/t/x.html', () => 'file://remote-host/share/x.html')
    expect(logger.info).toHaveBeenCalledWith('A browser tab local file failed to load', { code: -6, file: expect.any(String) })
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('127.0.0.1')
  })

  it('keeps an unparseable address as text, cut to its bound', () => {
    logLoadFailure(-300, 'x'.repeat(5000))
    const [, fields] = logger.info.mock.calls[0] as [string, { url: string }]
    expect(fields.url.length).toBeLessThan(5000)
  })
})
