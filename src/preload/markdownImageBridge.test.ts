// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The Markdown image bridge (#71) is a plain pipe: one request object, passed
 * through as it is on the one channel, and exposed as `window.api.markdownImage`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const exposed = vi.hoisted(() => new Map<string, unknown>())
const invoke = vi.hoisted(() => vi.fn(async () => ({ status: 'refused', reason: 'not-found' })))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (key: string, value: unknown) => exposed.set(key, value) },
  ipcRenderer: { invoke, on: vi.fn(), removeListener: vi.fn(), send: vi.fn() },
  webUtils: { getPathForFile: vi.fn() }
}))

describe('markdownImage bridge', () => {
  beforeEach(() => {
    invoke.mockClear()
  })

  it('invokes markdown-image:read with the request object unchanged', async () => {
    const { markdownImageBridge } = await import('./markdownImageBridge')
    const request = { filePath: '/p/a.png', knownVersion: '1:2:3' }
    await expect(markdownImageBridge.read(request)).resolves.toEqual({ status: 'refused', reason: 'not-found' })
    expect(invoke).toHaveBeenCalledWith('markdown-image:read', request)
  })

  it('is exposed on window.api as markdownImage', async () => {
    ;(process as unknown as { contextIsolated: boolean }).contextIsolated = true
    vi.resetModules()
    await import('./index')
    const api = exposed.get('api') as { markdownImage: { read: unknown } }
    expect(Object.keys(api.markdownImage)).toEqual(['read'])
  })
})
