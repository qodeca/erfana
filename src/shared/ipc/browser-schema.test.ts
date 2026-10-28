// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The `browser:openFile` wire contract (issue #124, part 4 §4.1): a path in, a
 * flag or a code plus its message out – and nothing else in either direction.
 */
import { describe, expect, it } from 'vitest'
import { ErrorCode, ERROR_MESSAGES } from '../errors'
import { BROWSER_CHANNELS } from './browser-channels'
import {
  BROWSER_OPEN_ERROR_CODES,
  BrowserOpenFileRequestSchema,
  BrowserOpenFileResponseSchema,
  MAX_BROWSER_OPEN_PATH_LENGTH
} from './browser-schema'

describe('BROWSER_CHANNELS', () => {
  it('names one channel in its own browser: domain', () => {
    expect(BROWSER_CHANNELS).toEqual({ OPEN_FILE: 'browser:openFile' })
  })
})

describe('BrowserOpenFileRequestSchema', () => {
  it.each([
    ['a POSIX path', '/Users/a/site/index.html'],
    ['a Windows drive path', 'C:\\Users\\a\\site\\index.HTM'],
    ['a UNC path', '\\\\server\\share\\site\\index.html'],
    ['spaces and non-ASCII', '/Users/a/My Site/zażółć.html'],
    ['a name that is not HTML (checked main-side, not here)', '/Users/a/site/run.sh']
  ])('accepts %s', (_label, filePath) => {
    expect(BrowserOpenFileRequestSchema.safeParse({ filePath }).success).toBe(true)
  })

  it('accepts a path of exactly the maximum length', () => {
    const filePath = '/' + 'a'.repeat(MAX_BROWSER_OPEN_PATH_LENGTH - 1)
    expect(BrowserOpenFileRequestSchema.safeParse({ filePath }).success).toBe(true)
  })

  it.each([
    ['an empty path', { filePath: '' }],
    ['a path over the maximum length', { filePath: '/' + 'a'.repeat(MAX_BROWSER_OPEN_PATH_LENGTH) }],
    ['a missing path', {}],
    ['a non-string path', { filePath: 42 }],
    ['an extra key (an address)', { filePath: '/p/a.html', url: 'https://example.com' }],
    ['an extra key (a fragment)', { filePath: '/p/a.html', hash: '#top' }],
    ['a bare string', '/p/a.html'],
    ['null', null],
    ['undefined', undefined]
  ])('rejects %s', (_label, payload) => {
    expect(BrowserOpenFileRequestSchema.safeParse(payload).success).toBe(false)
  })
})

describe('BrowserOpenFileResponseSchema', () => {
  it.each([true, false])('accepts a success with usedFallback %s', usedFallback => {
    expect(BrowserOpenFileResponseSchema.safeParse({ success: true, usedFallback }).success).toBe(
      true
    )
  })

  it.each(BROWSER_OPEN_ERROR_CODES)('accepts a %s failure carrying its message', code => {
    const response = { success: false, errorCode: code, error: ERROR_MESSAGES[code] }
    expect(BrowserOpenFileResponseSchema.safeParse(response).success).toBe(true)
  })

  it.each([
    ['a success without usedFallback', { success: true }],
    ['a success with a path riding along', { success: true, usedFallback: false, filePath: '/p' }],
    [
      'a failure with a code from another domain',
      { success: false, errorCode: ErrorCode.IMAGE_EXPORT_FAILED, error: 'x' }
    ],
    [
      'a failure with an empty message',
      { success: false, errorCode: ErrorCode.OPEN_IN_BROWSER_MISSING, error: '' }
    ],
    [
      'a failure carrying a raw stack',
      {
        success: false,
        errorCode: ErrorCode.OPEN_IN_BROWSER_LAUNCH_FAILED,
        error: 'x',
        stack: "Error: spawn /Users/a/x ENOENT"
      }
    ]
  ])('rejects %s', (_label, response) => {
    expect(BrowserOpenFileResponseSchema.safeParse(response).success).toBe(false)
  })
})

describe('BROWSER_OPEN_ERROR_CODES', () => {
  it('lists exactly the six OPEN_IN_BROWSER_* codes', () => {
    const domain = Object.values(ErrorCode).filter(code => code.startsWith('OPEN_IN_BROWSER_'))
    expect([...BROWSER_OPEN_ERROR_CODES].sort()).toEqual([...domain].sort())
    expect(BROWSER_OPEN_ERROR_CODES).toHaveLength(6)
  })

  it.each(BROWSER_OPEN_ERROR_CODES)('%s has a message that names no file', code => {
    const message = ERROR_MESSAGES[code]
    expect(message.length).toBeGreaterThan(0)
    // The renderer adds the file name to its toast; the wire text stays generic.
    expect(message).not.toMatch(/[\\/]/)
  })
})
