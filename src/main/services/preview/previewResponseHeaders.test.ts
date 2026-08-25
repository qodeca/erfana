// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the preview response-header builder (Issue #74, work item 13;
 * design §2.5, §2.6, §7 row 6).
 */

import { describe, it, expect } from 'vitest'
import {
  buildResponseHeaders,
  isKnownAssetType,
  mimeForExtension
} from './previewResponseHeaders'
import { AppError, ErrorCode } from '../../../shared/errors'

const VALID_CSP = "default-src 'none'; script-src erfana-preview:; sandbox allow-scripts"

describe('mimeForExtension', () => {
  it.each([
    ['.html', 'text/html; charset=utf-8'],
    ['.htm', 'text/html; charset=utf-8'],
    ['.css', 'text/css; charset=utf-8'],
    ['.js', 'text/javascript; charset=utf-8'],
    ['.mjs', 'text/javascript; charset=utf-8'],
    ['.json', 'application/json; charset=utf-8'],
    ['.svg', 'image/svg+xml'],
    ['.png', 'image/png'],
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.gif', 'image/gif'],
    ['.webp', 'image/webp'],
    ['.woff2', 'font/woff2'],
    ['.mp4', 'video/mp4']
  ])('maps %s to %s', (ext, mime) => {
    expect(mimeForExtension(ext)).toBe(mime)
  })

  it('is case-insensitive and tolerates a missing leading dot', () => {
    expect(mimeForExtension('.PNG')).toBe('image/png')
    expect(mimeForExtension('css')).toBe('text/css; charset=utf-8')
  })

  it('returns octet-stream for an unknown extension', () => {
    expect(mimeForExtension('.xyz')).toBe('application/octet-stream')
  })

  it('returns octet-stream for inherited-key lookups (null-prototype table)', () => {
    expect(mimeForExtension('.constructor')).toBe('application/octet-stream')
    expect(mimeForExtension('.__proto__')).toBe('application/octet-stream')
    expect(mimeForExtension('.toString')).toBe('application/octet-stream')
    expect(mimeForExtension('constructor')).toBe('application/octet-stream')
  })
})

describe('isKnownAssetType', () => {
  it('is true for the recognised asset extensions', () => {
    for (const ext of ['.css', '.js', '.mjs', '.png', '.woff2', '.svg', '.json']) {
      expect(isKnownAssetType(ext)).toBe(true)
    }
  })

  it('is false for unknown and inherited keys', () => {
    expect(isKnownAssetType('.tsx')).toBe(false)
    expect(isKnownAssetType('.constructor')).toBe(false)
    expect(isKnownAssetType('.__proto__')).toBe(false)
  })
})

describe('buildResponseHeaders', () => {
  it('returns the full static security header set for a served asset', () => {
    const headers = buildResponseHeaders('text/css; charset=utf-8', VALID_CSP)
    expect(headers).toEqual({
      'Content-Type': 'text/css; charset=utf-8',
      'Content-Security-Policy': VALID_CSP,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Referrer-Policy': 'no-referrer',
      'X-DNS-Prefetch-Control': 'off'
    })
  })

  it('carries the exact MIME through for common asset types', () => {
    expect(buildResponseHeaders(mimeForExtension('.js'), VALID_CSP)['Content-Type']).toBe(
      'text/javascript; charset=utf-8'
    )
    expect(buildResponseHeaders(mimeForExtension('.png'), VALID_CSP)['Content-Type']).toBe(
      'image/png'
    )
  })

  it('throws PREVIEW_CSP_INVALID for an empty CSP', () => {
    try {
      buildResponseHeaders('text/css', '')
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(AppError)
      expect((err as AppError).code).toBe(ErrorCode.PREVIEW_CSP_INVALID)
    }
  })

  it("throws when the CSP is missing sandbox allow-scripts", () => {
    expect(() => buildResponseHeaders('text/css', "default-src 'none'")).toThrow(AppError)
  })

  it("throws when the CSP is missing default-src 'none'", () => {
    expect(() => buildResponseHeaders('text/css', 'sandbox allow-scripts')).toThrow(AppError)
  })
})
