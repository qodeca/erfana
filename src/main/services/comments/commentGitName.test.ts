// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it, vi } from 'vitest'
import { PREVIEW_LIMITS } from '../../../shared/preview-limits'
import { suggestedGitName } from './commentGitName'

const git = async (): Promise<string | null> => '/usr/bin/git'

describe('suggestedGitName', () => {
  it('P-F33 reads user.name through the hardened arguments, in the project', async () => {
    const read = vi.fn(async () => 'Grace Hopper\n')
    expect(await suggestedGitName('/project', read, git)).toBe('Grace Hopper')
    const [gitPath, args] = read.mock.calls[0] as unknown as [string, string[]]
    expect(gitPath).toBe('/usr/bin/git')
    expect(args.slice(-3)).toEqual(['config', '--get', 'user.name'])
    expect(args).toContain('core.fsmonitor=false')
    expect(args.slice(args.indexOf('-C'), args.indexOf('-C') + 2)).toEqual(['-C', '/project'])
  })

  it.each([
    ['nothing set', ''],
    ['blank', '   \n'],
    ['a name past the cap', `${'x'.repeat(PREVIEW_LIMITS.COMMENT_AUTHOR_NAME_MAX_CHARS + 1)}\n`],
    ['two lines', 'Grace\nHopper\n'],
    ['a bidi control', 'Grace‮Hopper\n']
  ])('P-F33 suggests nothing for %s', async (_case, printed) => {
    expect(await suggestedGitName('/project', async () => printed, git)).toBeUndefined()
  })

  it('P-F33 no git, or a git that fails, is no suggestion', async () => {
    expect(await suggestedGitName('/project', async () => 'Grace', async () => null)).toBeUndefined()
    expect(await suggestedGitName('/project', () => Promise.reject(Object.assign(new Error('exit'), { code: 1 })), git)).toBeUndefined()
  })
})
