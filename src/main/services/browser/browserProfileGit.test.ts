// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it, vi } from 'vitest'

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('../LoggingService', () => ({ logger: mockLogger }))

import { isBrowserFolderTrackedByGit, type GitRunner } from './browserProfileGit'

function runner(result: { stdout?: string; error?: unknown }, gitPath: string | null = '/usr/bin/git'): GitRunner & { run: ReturnType<typeof vi.fn> } {
  return {
    resolveGit: async () => gitPath,
    run: vi.fn(async () => {
      if (result.error !== undefined) throw result.error
      return { stdout: result.stdout ?? '' }
    })
  }
}

describe('isBrowserFolderTrackedByGit (ADR 0009 decision 3)', () => {
  it('runs a hardened ls-files on .erfana/browser only', async () => {
    const r = runner({ stdout: '' })
    await isBrowserFolderTrackedByGit('/p', r)
    const args = r.run.mock.calls[0][1] as string[]
    expect(args.slice(0, 4)).toEqual(['--no-pager', '--no-optional-locks', '-C', '/p'])
    expect(args).toContain('core.fsmonitor=false')
    expect(args.slice(-4)).toEqual(['ls-files', '-z', '--', '.erfana/browser'])
  })

  it('is tracked when git lists a file', async () => {
    expect(await isBrowserFolderTrackedByGit('/p', runner({ stdout: '.erfana/browser/profile/Cookies\0' }))).toBe(true)
  })

  it('is not tracked when git lists nothing', async () => {
    expect(await isBrowserFolderTrackedByGit('/p', runner({ stdout: '' }))).toBe(false)
  })

  it('is not tracked when git is not installed', async () => {
    const r = runner({ stdout: 'x' }, null)
    expect(await isBrowserFolderTrackedByGit('/p', r)).toBe(false)
    expect(r.run).not.toHaveBeenCalled()
  })

  it('is not tracked outside a repository (exit 128)', async () => {
    expect(await isBrowserFolderTrackedByGit('/p', runner({ error: Object.assign(new Error('fatal'), { code: 128 }) }))).toBe(false)
  })

  it('fails closed on any other failure, logging no command line', async () => {
    const error = Object.assign(new Error('Command failed: git -C /Users/alice/secret ls-files'), {
      code: null,
      signal: 'SIGTERM'
    })
    expect(await isBrowserFolderTrackedByGit('/p', runner({ error }))).toBe(true)
    expect(JSON.stringify(mockLogger.warn.mock.calls)).not.toContain('alice')
  })
})
