// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it, vi } from 'vitest'

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('../LoggingService', () => ({ logger: mockLogger }))

import { markIgnoredBySync, type SyncIgnoreDeps } from './browserSyncIgnore'

function deps(platform: NodeJS.Platform, fail = false): SyncIgnoreDeps & {
  runXattr: ReturnType<typeof vi.fn>
  writeStream: ReturnType<typeof vi.fn>
} {
  const outcome = async (): Promise<void> => {
    if (fail) throw Object.assign(new Error('nope'), { code: 'ENOTSUP' })
  }
  return { platform, runXattr: vi.fn(outcome), writeStream: vi.fn(outcome) }
}

describe('markIgnoredBySync (ADR 0009 decision 10, S30)', () => {
  it('sets the Dropbox and File Provider attributes on macOS', async () => {
    const d = deps('darwin')
    await markIgnoredBySync('/p/.erfana/browser', d)
    expect(d.runXattr.mock.calls).toEqual([
      [['-w', 'com.dropbox.ignored', '1', '/p/.erfana/browser']],
      [['-w', 'com.apple.fileprovider.ignore#P', '1', '/p/.erfana/browser']]
    ])
    expect(d.writeStream).not.toHaveBeenCalled()
  })

  it('writes the Dropbox stream on Windows', async () => {
    const d = deps('win32')
    await markIgnoredBySync('C:\\p\\.erfana\\browser', d)
    expect(d.writeStream).toHaveBeenCalledWith('C:\\p\\.erfana\\browser:com.dropbox.ignored', '1')
    expect(d.runXattr).not.toHaveBeenCalled()
  })

  it('does nothing on Linux', async () => {
    const d = deps('linux')
    await markIgnoredBySync('/p/.erfana/browser', d)
    expect(d.runXattr).not.toHaveBeenCalled()
    expect(d.writeStream).not.toHaveBeenCalled()
  })

  it('logs a failure and never throws, trying every attribute', async () => {
    const d = deps('darwin', true)
    await expect(markIgnoredBySync('/p/.erfana/browser', d)).resolves.toBeUndefined()
    expect(d.runXattr).toHaveBeenCalledTimes(2)
    expect(mockLogger.warn).toHaveBeenCalledWith('Browser folder: could not set a sync-ignore attribute', {
      attribute: 'com.dropbox.ignored',
      error: 'ENOTSUP'
    })
  })
})
