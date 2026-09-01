// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the shell IPC handler (sd-074b §7, phase 0).
 *
 * Covers: allowed protocols open, the normalised href is what is opened,
 * disallowed and unparseable URLs are refused, embedded credentials are
 * refused, oversize and non-string payloads are refused, and the full URL never
 * reaches a log line.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { captured, mockIpcMain, mockShell, mockLogger } = vi.hoisted(() => {
  const capturedListeners = new Map<string, (...args: never[]) => unknown>()
  return {
    captured: capturedListeners,
    mockIpcMain: {
      handle: (channel: string, listener: (...args: never[]) => unknown): undefined => {
        capturedListeners.set(channel, listener)
        return undefined
      }
    },
    mockShell: { openExternal: vi.fn() },
    mockLogger: {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn()
    }
  }
})

vi.mock('electron', () => ({ ipcMain: mockIpcMain, shell: mockShell }))
vi.mock('../services/LoggingService', () => ({ logger: mockLogger }))

import { registerShellHandlers } from './shell-handlers'

/** Invoke the registered handler with an arbitrary payload. */
async function openExternal(url: unknown): Promise<void> {
  const handler = captured.get('shell:openExternal') as (
    event: unknown,
    url: unknown
  ) => Promise<void>
  await handler({}, url)
}

describe('shell:openExternal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    captured.clear()
    mockShell.openExternal.mockResolvedValue(undefined)
    registerShellHandlers()
  })

  describe('allowed', () => {
    it.each([
      'https://example.com/docs',
      'http://example.com/',
      'mailto:someone@example.com',
      'tel:+48123456789',
      'ftp://files.example.com/x'
    ])('opens %s', async (url) => {
      await openExternal(url)
      expect(mockShell.openExternal).toHaveBeenCalledTimes(1)
    })

    it('opens the normalised href, not the raw string', async () => {
      await openExternal('https://example.com')
      expect(mockShell.openExternal).toHaveBeenCalledWith('https://example.com/')
    })
  })

  describe('refused', () => {
    it.each([
      ['javascript:alert(1)', 'javascript'],
      ['data:text/html,<script>alert(1)</script>', 'data'],
      ['file:///etc/passwd', 'file'],
      ['vbscript:msgbox(1)', 'vbscript'],
      ['smb://host/share', 'smb'],
      ['ms-msdt:/id', 'ms-msdt'],
      ['search-ms:query=x', 'search-ms'],
      ['intent://scan/#Intent;end', 'intent']
    ])('refuses %s', async (url) => {
      await expect(openExternal(url)).rejects.toThrow('Refused to open external URL')
      expect(mockShell.openExternal).not.toHaveBeenCalled()
    })

    it('refuses a URL that only looks safe by prefix', async () => {
      // The old prefix check (`startsWith('https:')`) would have passed this;
      // parsing yields protocol `javascript:`.
      await expect(openExternal('javascript:void("https://example.com")')).rejects.toThrow()
      expect(mockShell.openExternal).not.toHaveBeenCalled()
    })

    it('refuses embedded credentials', async () => {
      await expect(openExternal('https://user:pass@example.com/')).rejects.toThrow()
      expect(mockShell.openExternal).not.toHaveBeenCalled()
    })

    it('refuses an unparseable string', async () => {
      await expect(openExternal('not a url')).rejects.toThrow()
      expect(mockShell.openExternal).not.toHaveBeenCalled()
    })

    it.each([[42], [null], [undefined], [{}], ['']])(
      'refuses a non-string or empty payload (%s)',
      async (payload) => {
        await expect(openExternal(payload)).rejects.toThrow()
        expect(mockShell.openExternal).not.toHaveBeenCalled()
      }
    )

    it('refuses an oversize URL', async () => {
      await expect(openExternal(`https://example.com/${'a'.repeat(2100)}`)).rejects.toThrow()
      expect(mockShell.openExternal).not.toHaveBeenCalled()
    })
  })

  describe('logging', () => {
    it('never writes the full URL to a log line', async () => {
      await openExternal('https://example.com/secret-path?token=abc123')

      const logged = JSON.stringify(mockLogger.info.mock.calls)
      expect(logged).not.toContain('secret-path')
      expect(logged).not.toContain('abc123')
      expect(logged).toContain('https://example.com')
    })

    it('reports the refused protocol without the rest of the URL', async () => {
      await expect(openExternal('javascript:steal(document.cookie)')).rejects.toThrow()

      const logged = JSON.stringify(mockLogger.warn.mock.calls)
      expect(logged).toContain('javascript:')
      expect(logged).not.toContain('document.cookie')
    })
  })

  it('propagates a failure from the OS handler', async () => {
    mockShell.openExternal.mockRejectedValue(new Error('no handler'))
    await expect(openExternal('https://example.com/')).rejects.toThrow('no handler')
  })
})
