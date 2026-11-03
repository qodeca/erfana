// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * isTrustedPreviewSender tests (Issue #74, work item 42).
 *
 * Covers sub-frame rejection, the dev-origin path (only under `is.dev` with
 * `ELECTRON_RENDERER_URL`), the exact production file-URL pin, and the
 * `webContents` identity requirement (spec 025 commit 1, 025-NFR-001).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { createFakeWebContents, type FakeWebContents } from '../__test-helpers__/appSender'
import { RENDERER_FILE_URL } from '../senderValidation'

// The predicate delegates to the shared senderValidation, which the global
// setup stubs to `true`; this suite needs the real one.
vi.unmock('../senderValidation')

// electron-vite declares ELECTRON_RENDERER_URL read-only; this file sets and clears it.
const writableEnv: Record<string, string | undefined> = process.env

// Controllable `is.dev`, mirroring index.ts / clipboard-handlers.test.ts.
const mockIs = vi.hoisted(() => ({ dev: false }))
vi.mock('@electron-toolkit/utils', () => ({ is: mockIs }))

// The predicate pins production trust to the exact bundled renderer file URL.
// Taken from the shared module that now owns the pin: it resolves relative to
// its own __dirname (src/main/ipc in tests; one bundle, one __dirname at run time).
const DEV_URL = 'http://localhost:5173'

/**
 * The registered app window for the current test. `load()` registers it
 * through the SAME fresh `appWebContents` module the predicate gets after
 * `vi.resetModules()` – a static import would be bound to a stale copy.
 */
let appSender: FakeWebContents

/** Build a mock event with a given sender frame shape, from the app window by default. */
function makeEvent(
  frame: { url: string; parent: unknown } | null,
  sender: FakeWebContents = appSender
): IpcMainInvokeEvent {
  return { sender, senderFrame: frame } as unknown as IpcMainInvokeEvent
}

async function load(): Promise<
  (event: IpcMainInvokeEvent) => boolean
> {
  const mod = await import('./isTrustedPreviewSender')
  const { registerAppWebContents } = await import('../appWebContents')
  appSender = createFakeWebContents()
  registerAppWebContents(appSender, 'main')
  return mod.isTrustedPreviewSender
}

describe('isTrustedPreviewSender', () => {
  beforeEach(() => {
    mockIs.dev = false
    delete writableEnv.ELECTRON_RENDERER_URL
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

    it('rejects the exact renderer URL from an unregistered webContents', async () => {
      const isTrusted = await load()
      const browserTab = createFakeWebContents()
      expect(isTrusted(makeEvent({ url: RENDERER_FILE_URL, parent: null }, browserTab))).toBe(false)
    })

    it('rejects the app window once its webContents is destroyed', async () => {
      const isTrusted = await load()
      appSender.destroy()
      expect(isTrusted(makeEvent({ url: RENDERER_FILE_URL, parent: null }))).toBe(false)
    })

    it('rejects our own entry on a route hash (exact pin, unlike the app gate)', async () => {
      const isTrusted = await load()
      expect(isTrusted(makeEvent({ url: `${RENDERER_FILE_URL}#/overlay`, parent: null }))).toBe(
        false
      )
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
      writableEnv.ELECTRON_RENDERER_URL = DEV_URL
      const isTrusted = await load()
      expect(isTrusted(makeEvent({ url: `${DEV_URL}/index.html`, parent: null }))).toBe(true)
    })

    it('rejects the dev origin from an unregistered webContents', async () => {
      mockIs.dev = true
      writableEnv.ELECTRON_RENDERER_URL = DEV_URL
      const isTrusted = await load()
      const browserTab = createFakeWebContents()
      expect(
        isTrusted(makeEvent({ url: `${DEV_URL}/index.html`, parent: null }, browserTab))
      ).toBe(false)
    })

    it('rejects a mismatched dev origin', async () => {
      mockIs.dev = true
      writableEnv.ELECTRON_RENDERER_URL = DEV_URL
      const isTrusted = await load()
      expect(isTrusted(makeEvent({ url: 'http://evil.example/index.html', parent: null }))).toBe(
        false
      )
    })

    it('does not use the dev origin when is.dev is false', async () => {
      mockIs.dev = false
      writableEnv.ELECTRON_RENDERER_URL = DEV_URL
      const isTrusted = await load()
      // Falls through to the prod pin, which the dev URL does not match.
      expect(isTrusted(makeEvent({ url: `${DEV_URL}/index.html`, parent: null }))).toBe(false)
    })
  })
})
