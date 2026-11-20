// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it, vi } from 'vitest'
import { QUARANTINE_ATTRIBUTE, markDownloadQuarantined, quarantineValue, type QuarantineDeps } from './downloadQuarantine'

function deps(platform: NodeJS.Platform): QuarantineDeps & { runXattr: ReturnType<typeof vi.fn> } {
  return { platform, runXattr: vi.fn(async () => undefined), now: () => 1_700_000_000_000, newId: () => 'ID-1' }
}

describe('markDownloadQuarantined (S-18, Gatekeeper on downloads)', () => {
  it('writes com.apple.quarantine with xattr on macOS', async () => {
    const d = deps('darwin')
    await markDownloadQuarantined('/Users/a/Downloads/x.dmg', d)
    expect(d.runXattr).toHaveBeenCalledWith(['-w', QUARANTINE_ATTRIBUTE, '0081;6553f100;Erfana;ID-1', '/Users/a/Downloads/x.dmg'])
  })

  it.each(['win32', 'linux'] as const)('does nothing on %s', async (platform) => {
    const d = deps(platform)
    await markDownloadQuarantined('/x', d)
    expect(d.runXattr).not.toHaveBeenCalled()
  })

  it('rejects when xattr fails, so the caller can log it', async () => {
    const d = deps('darwin')
    d.runXattr.mockRejectedValueOnce(Object.assign(new Error('Operation not supported'), { code: 1 }))
    await expect(markDownloadQuarantined('/Volumes/USB/x.dmg', d)).rejects.toThrow()
  })

  it('formats the time as hex seconds', () => {
    expect(quarantineValue(16_000, 'U')).toBe('0081;10;Erfana;U')
  })
})
