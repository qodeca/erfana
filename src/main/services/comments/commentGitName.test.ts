// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it, vi } from 'vitest'
import { PREVIEW_LIMITS } from '../../../shared/preview-limits'
import { suggestedGitName } from './commentGitName'

const git = async (): Promise<string | null> => '/usr/bin/git'

describe('suggestedGitName', () => {
  it('P-F33 reads user.name through the hardened arguments, in the project', async () => {
    const read = vi.fn(async () => 'global\tGrace Hopper\n')
    expect(await suggestedGitName('/project', read, git)).toBe('Grace Hopper')
    const [gitPath, args] = read.mock.calls[0] as unknown as [string, string[]]
    expect(gitPath).toBe('/usr/bin/git')
    expect(args.slice(-4)).toEqual(['config', '--show-scope', '--get-all', 'user.name'])
    expect(args).toContain('core.fsmonitor=false')
    expect(args.slice(args.indexOf('-C'), args.indexOf('-C') + 2)).toEqual(['-C', '/project'])
  })

  it.each([
    ['nothing set', ''],
    ['blank', 'global\t   \n'],
    ['a name past the cap', `global\t${'x'.repeat(PREVIEW_LIMITS.COMMENT_AUTHOR_NAME_MAX_CHARS + 1)}\n`],
    ['a line with no scope', 'Grace Hopper\n'],
    ['a bidi control', 'global\tGrace‮Hopper\n']
  ])('P-F33 suggests nothing for %s', async (_case, printed) => {
    expect(await suggestedGitName('/project', async () => printed, git)).toBeUndefined()
  })

  it.each([
    ['local', 'local\tMallory\n'],
    ['worktree', 'worktree\tMallory\n'],
    ['command', 'command\tMallory\n']
  ])('L-3 a name from the project (%s) is never suggested: it can pre-fill a stranger’s name', async (_scope, printed) => {
    expect(await suggestedGitName('/project', async () => printed, git)).toBeUndefined()
  })

  it('L-3 the reader’s global name wins over a project’s own, and over the system’s', async () => {
    const printed = 'system\tThe Machine\nglobal\tGrace Hopper\nlocal\tMallory\n'
    expect(await suggestedGitName('/project', async () => printed, git)).toBe('Grace Hopper')
  })

  it('L-3 the last global value counts, as git reads it; the system name stands in when there is none', async () => {
    expect(await suggestedGitName('/project', async () => 'global\tOld\nglobal\tNew\n', git)).toBe('New')
    expect(await suggestedGitName('/project', async () => 'system\tThe Machine\nlocal\tMallory\n', git)).toBe('The Machine')
  })

  it('P-F33 no git, or a git that fails, is no suggestion', async () => {
    expect(await suggestedGitName('/project', async () => 'Grace', async () => null)).toBeUndefined()
    expect(await suggestedGitName('/project', () => Promise.reject(Object.assign(new Error('exit'), { code: 1 })), git)).toBeUndefined()
  })
})
