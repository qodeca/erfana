// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for renderer platform detection (utils/platform.ts).
 *
 * Covers:
 * - getRendererPlatform(): bridge-present path, navigator fallback + one-time warn
 * - isMacOS()/isWindows(): pure (explicit arg) and bridge-backed (no arg) paths
 *
 * The module keeps a one-time "fallback" warning latch, so tests that exercise
 * the warning path re-import a fresh module instance via vi.resetModules().
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/** Replace navigator.platform for the duration of a test. */
const setNavigatorPlatform = (value: string): void => {
  Object.defineProperty(navigator, 'platform', {
    value,
    writable: true,
    configurable: true
  })
}

describe('platform', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // Fresh module each test so the warn-once latch resets between cases.
    vi.resetModules()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
    // Remove any bridge stub so it doesn't leak across tests.
    delete (window as unknown as { api?: unknown }).api
  })

  describe('getRendererPlatform()', () => {
    it('returns the value from the preload bridge without warning', async () => {
      ;(window as unknown as { api: unknown }).api = {
        utils: { getPlatform: vi.fn().mockReturnValue('win32') }
      }

      const { getRendererPlatform } = await import('./platform')

      expect(getRendererPlatform()).toBe('win32')
      expect(warnSpy).not.toHaveBeenCalled()
    })

    it('falls back to navigator.platform and warns when the bridge is unavailable', async () => {
      delete (window as unknown as { api?: unknown }).api
      setNavigatorPlatform('MacIntel')

      const { getRendererPlatform } = await import('./platform')

      expect(getRendererPlatform()).toBe('darwin')
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy).toHaveBeenCalledWith(
        '[platform] preload getPlatform bridge unavailable; falling back to navigator.platform'
      )
    })

    it('maps a Win32 navigator.platform to win32 in fallback', async () => {
      delete (window as unknown as { api?: unknown }).api
      setNavigatorPlatform('Win32')

      const { getRendererPlatform } = await import('./platform')

      expect(getRendererPlatform()).toBe('win32')
    })

    it('maps an unknown navigator.platform to linux in fallback', async () => {
      delete (window as unknown as { api?: unknown }).api
      setNavigatorPlatform('FreeBSD')

      const { getRendererPlatform } = await import('./platform')

      expect(getRendererPlatform()).toBe('linux')
    })

    it('warns only once across multiple fallback calls', async () => {
      delete (window as unknown as { api?: unknown }).api
      setNavigatorPlatform('Linux x86_64')

      const { getRendererPlatform } = await import('./platform')

      getRendererPlatform()
      getRendererPlatform()
      getRendererPlatform()

      expect(warnSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe('isMacOS() / isWindows() with explicit args (pure)', () => {
    it('isMacOS is true only for darwin and never touches the bridge', async () => {
      const { isMacOS } = await import('./platform')

      expect(isMacOS('darwin')).toBe(true)
      expect(isMacOS('win32')).toBe(false)
      expect(isMacOS('linux')).toBe(false)
      expect(warnSpy).not.toHaveBeenCalled()
    })

    it('isWindows is true only for win32 and never touches the bridge', async () => {
      const { isWindows } = await import('./platform')

      expect(isWindows('win32')).toBe(true)
      expect(isWindows('darwin')).toBe(false)
      expect(isWindows('linux')).toBe(false)
      expect(warnSpy).not.toHaveBeenCalled()
    })
  })

  describe('isMacOS() / isWindows() reading the bridge (no arg)', () => {
    it('isMacOS resolves the platform via the bridge', async () => {
      ;(window as unknown as { api: unknown }).api = {
        utils: { getPlatform: vi.fn().mockReturnValue('darwin') }
      }

      const { isMacOS } = await import('./platform')

      expect(isMacOS()).toBe(true)
      expect(warnSpy).not.toHaveBeenCalled()
    })

    it('isWindows resolves the platform via the bridge', async () => {
      ;(window as unknown as { api: unknown }).api = {
        utils: { getPlatform: vi.fn().mockReturnValue('win32') }
      }

      const { isWindows } = await import('./platform')

      expect(isWindows()).toBe(true)
      expect(warnSpy).not.toHaveBeenCalled()
    })
  })
})
