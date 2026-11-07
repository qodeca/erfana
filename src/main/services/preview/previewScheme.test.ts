// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { PREVIEW_SCHEME, PREVIEW_SCHEME_PRIVILEGES } from './previewScheme'

// The registration itself (one call, before ready) is pinned in
// src/main/services/appSchemes.test.ts.
describe('previewScheme', () => {
  it('uses the erfana-preview scheme name (lowercase, hex-token host safe)', () => {
    expect(PREVIEW_SCHEME).toBe('erfana-preview')
    expect(PREVIEW_SCHEME).toBe(PREVIEW_SCHEME.toLowerCase())
  })

  it('declares the exact design privilege set', () => {
    expect(PREVIEW_SCHEME_PRIVILEGES).toEqual({
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      bypassCSP: false,
      allowServiceWorkers: false,
      stream: false
    })
  })

  it('never grants bypassCSP', () => {
    expect(PREVIEW_SCHEME_PRIVILEGES.bypassCSP).toBe(false)
  })

  it('cannot be changed at run time', () => {
    expect(Object.isFrozen(PREVIEW_SCHEME_PRIVILEGES)).toBe(true)
  })
})
