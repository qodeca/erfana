// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const exposed = vi.hoisted(() => new Map<string, unknown>())
const invoke = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, value: unknown) => exposed.set(key, value)
  },
  ipcRenderer: { invoke, on: vi.fn(), removeListener: vi.fn(), send: vi.fn() },
  webUtils: { getPathForFile: vi.fn() }
}))

describe('preload surface', () => {
  beforeEach(async () => {
    exposed.clear()
    ;(process as unknown as { contextIsolated: boolean }).contextIsolated = true
    vi.resetModules()
    await import('./index')
  })

  it('exposes only the api and electron globals', () => {
    expect([...exposed.keys()].sort()).toEqual(['api', 'electron'])
  })

  it('window.electron carries openExternal and nothing generic', async () => {
    const electron = exposed.get('electron') as Record<string, unknown>
    expect(Object.keys(electron)).toEqual(['shell'])
    expect(Object.keys(electron.shell as object)).toEqual(['openExternal'])
    for (const generic of ['ipcRenderer', 'webFrame', 'process', 'webUtils']) {
      expect(electron).not.toHaveProperty(generic)
    }

    await (electron.shell as { openExternal: (u: string) => Promise<void> }).openExternal(
      'https://example.com'
    )
    expect(invoke).toHaveBeenCalledWith('shell:openExternal', 'https://example.com')
  })

  it('window.api has the expected top-level groups', () => {
    const api = exposed.get('api') as Record<string, unknown>
    expect(Object.keys(api).sort()).toMatchSnapshot()
  })
})
