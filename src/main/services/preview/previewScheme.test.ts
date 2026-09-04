// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const registerSchemesAsPrivileged = vi.fn()

vi.mock('electron', () => ({
  protocol: {
    registerSchemesAsPrivileged: (...args: unknown[]) =>
      registerSchemesAsPrivileged(...args)
  }
}))

import { PREVIEW_SCHEME, registerPreviewScheme } from './previewScheme'

describe('previewScheme', () => {
  beforeEach(() => {
    registerSchemesAsPrivileged.mockClear()
  })

  it('uses the erfana-preview scheme name (lowercase, hex-token host safe)', () => {
    expect(PREVIEW_SCHEME).toBe('erfana-preview')
    expect(PREVIEW_SCHEME).toBe(PREVIEW_SCHEME.toLowerCase())
  })

  it('registers the scheme with the exact design privilege set', () => {
    registerPreviewScheme()

    expect(registerSchemesAsPrivileged).toHaveBeenCalledTimes(1)
    const [entries] = registerSchemesAsPrivileged.mock.calls[0]
    expect(entries).toEqual([
      {
        scheme: 'erfana-preview',
        privileges: {
          standard: true,
          secure: true,
          supportFetchAPI: true,
          corsEnabled: true,
          bypassCSP: false,
          allowServiceWorkers: false,
          stream: false
        }
      }
    ])
  })

  it('never grants bypassCSP', () => {
    registerPreviewScheme()
    const [entries] = registerSchemesAsPrivileged.mock.calls[0] as [
      Array<{ privileges: { bypassCSP: boolean } }>
    ]
    expect(entries[0].privileges.bypassCSP).toBe(false)
  })
})
