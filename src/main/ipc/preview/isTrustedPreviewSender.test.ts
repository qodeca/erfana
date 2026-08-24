// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * isTrustedPreviewSender tests (Issue #74, work item 42).
 *
 * Covers sub-frame rejection, the dev-origin path (only under `is.dev` with
 * `ELECTRON_RENDERER_URL`), and the exact production file-URL pin.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'

// Controllable `is.dev`, mirroring index.ts / clipboard-handlers.test.ts.
const mockIs = { dev: false }
vi.mock('@electron-toolkit/utils', () => ({ is: mockIs }))

// The predicate pins production trust to the exact bundled renderer file URL,
// derived the same way the module does (relative to the same __dirname).
const RENDERER_FILE_URL = pathToFileURL(join(__dirname, '../renderer/index.html')).href
const DEV_URL = 'http://localhost:5173'

/** Build a mock event with a given sender frame shape. */
function makeEvent(frame: { url: string; parent: unknown } | null): IpcMainInvokeEvent {
  return { senderFrame: frame } as unknown as IpcMainInvokeEvent
}

async function load(): Promise<
  (event: IpcMainInvokeEvent) => boolean
> {
  const mod = await import('./isTrustedPreviewSender')
  return mod.isTrustedPreviewSender
}

describe('isTrustedPreviewSender', () => {
  beforeEach(() => {
    mockIs.dev = false
    delete process.env['ELECTRON_RENDERER_URL']
  })

  afterEach(() => {
    vi.resetModules()
  })

  describe('sub-frames', () => {
    it('rejects a sub-frame (parent !== null) even at the prod URL', async () => {
      const isTrusted = await load()
      expect(isTrusted(makeEvent({ url: RENDERER_FILE_URL, parent: {} }))).toBe(false)
    })

    it('rejects a missing sender frame', async () => {
      const isTrusted = await load()
      expect(isTrusted(makeEvent(null))).toBe(false)
    })
  })

  describe('production', () => {
    it('accepts the exact bundled renderer file URL on a top-level frame', async () => {
      const isTrusted = await load()
      expect(isTrusted(makeEvent({ url: RENDERER_FILE_URL, parent: null }))).toBe(true)
    })

    it('rejects any other URL', async () => {
      const isTrusted = await load()
      expect(isTrusted(makeEvent({ url: 'file:///etc/passwd', parent: null }))).toBe(false)
      expect(isTrusted(makeEvent({ url: DEV_URL, parent: null }))).toBe(false)
    })
  })

  describe('development', () => {
    it('accepts the dev origin only when is.dev && ELECTRON_RENDERER_URL', async () => {
      mockIs.dev = true
      process.env['ELECTRON_RENDERER_URL'] = DEV_URL
      const isTrusted = await load()
      expect(isTrusted(makeEvent({ url: `${DEV_URL}/index.html`, parent: null }))).toBe(true)
    })

    it('rejects a mismatched dev origin', async () => {
      mockIs.dev = true
      process.env['ELECTRON_RENDERER_URL'] = DEV_URL
      const isTrusted = await load()
      expect(isTrusted(makeEvent({ url: 'http://evil.example/index.html', parent: null }))).toBe(
        false
      )
    })

    it('does not use the dev origin when is.dev is false', async () => {
      mockIs.dev = false
      process.env['ELECTRON_RENDERER_URL'] = DEV_URL
      const isTrusted = await load()
      // Falls through to the prod pin, which the dev URL does not match.
      expect(isTrusted(makeEvent({ url: `${DEV_URL}/index.html`, parent: null }))).toBe(false)
    })
  })
})
