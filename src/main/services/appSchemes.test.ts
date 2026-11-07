// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const registerSchemesAsPrivileged = vi.fn()

vi.mock('electron', () => ({
  protocol: {
    registerSchemesAsPrivileged: (...args: unknown[]) => registerSchemesAsPrivileged(...args)
  }
}))
vi.mock('./LoggingService', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

import { APP_PRIVILEGED_SCHEMES, registerAppSchemes } from './appSchemes'

type Entry = { scheme: string; privileges: Record<string, boolean> }

function registeredEntries(): Entry[] {
  expect(registerSchemesAsPrivileged).toHaveBeenCalledTimes(1)
  return registerSchemesAsPrivileged.mock.calls[0][0] as Entry[]
}

describe('registerAppSchemes (spec 025 ADR 0012 decision 2)', () => {
  beforeEach(() => {
    registerSchemesAsPrivileged.mockClear()
  })

  it('registers every privileged scheme in one call, pinned to the exact privilege sets', () => {
    registerAppSchemes()
    expect(registeredEntries()).toEqual([
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
      },
      { scheme: 'erfana-local', privileges: { standard: true, secure: true } }
    ])
  })

  it('gives erfana-local no script-read, service-worker, CSP-bypass or stream privilege', () => {
    registerAppSchemes()
    const local = registeredEntries().find((entry) => entry.scheme === 'erfana-local')
    expect(Object.keys(local?.privileges ?? {}).sort()).toEqual(['secure', 'standard'])
  })

  it('never grants bypassCSP to any scheme', () => {
    registerAppSchemes()
    for (const entry of registeredEntries()) {
      expect(entry.privileges.bypassCSP ?? false).toBe(false)
    }
  })

  it('hands Electron copies, so the frozen record cannot be changed through the call', () => {
    registerAppSchemes()
    const [first] = registeredEntries()
    first.privileges.bypassCSP = true
    expect(APP_PRIVILEGED_SCHEMES[0].privileges).toMatchObject({ bypassCSP: false })
    expect(Object.isFrozen(APP_PRIVILEGED_SCHEMES)).toBe(true)
    expect(Object.isFrozen(APP_PRIVILEGED_SCHEMES[1].privileges)).toBe(true)
  })
})
