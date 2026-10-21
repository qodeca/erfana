// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import nodePath from 'path'
import {
  ExternalSourceGrants,
  MAX_GRANTS_PER_SENDER,
  SOURCE_GRANT_TTL_MS
} from './ExternalSourceGrants'

/** A tiny disk: path -> inode. A path that is not listed does not exist. */
function make(flavour: 'posix' | 'win32' = 'posix') {
  const clock = { now: 1_000 }
  const inodes = new Map<string, bigint>()
  const path = flavour === 'win32' ? nodePath.win32 : nodePath.posix
  const grants = new ExternalSourceGrants({
    now: () => clock.now,
    path,
    lstat: async (target) => {
      const ino = inodes.get(target)
      if (ino === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      return { dev: 1n, ino }
    }
  })
  const add = (...paths: string[]): void => {
    paths.forEach((p, i) => inodes.set(path.resolve(p), BigInt(inodes.size + i + 1)))
  }
  return { grants, clock, inodes, add, path }
}

describe('ExternalSourceGrants', () => {
  it('answers null for a path nobody picked', async () => {
    const { grants } = make()
    expect(await grants.batchOf(1, '/in/notes.md')).toBeNull()
  })

  it('answers with the pick a file came from', async () => {
    const { grants, add } = make()
    add('/in/a.md', '/in/b.md')
    await grants.issue(1, ['/in/a.md', '/in/b.md'])

    expect(await grants.batchOf(1, '/in/b.md')).toEqual(['/in/a.md', '/in/b.md'])
  })

  it('keeps the records of one window from another', async () => {
    const { grants, add } = make()
    add('/in/notes.md')
    await grants.issue(1, ['/in/notes.md'])

    expect(await grants.batchOf(2, '/in/notes.md')).toBeNull()
    expect(await grants.batchOf(null, '/in/notes.md')).toBeNull()
    expect(await grants.batchOf(1, '/in/notes.md')).not.toBeNull()
  })

  it('records nothing for a file that cannot be read', async () => {
    const { grants } = make()
    await grants.issue(1, ['/in/missing.md'])

    expect(await grants.batchOf(1, '/in/missing.md')).toBeNull()
  })

  it('does not match when the path now points at a different file', async () => {
    const { grants, add, inodes } = make()
    add('/in/notes.md')
    await grants.issue(1, ['/in/notes.md'])
    inodes.set('/in/notes.md', 999n)

    expect(await grants.batchOf(1, '/in/notes.md')).toBeNull()
  })

  it('does not match a different path, or the same name in other letter case', async () => {
    const { grants, add } = make()
    add('/in/Notes.md', '/in/notes.md')
    await grants.issue(1, ['/in/Notes.md'])

    expect(await grants.batchOf(1, '/in/notes.md')).toBeNull()
    expect(await grants.batchOf(1, '/in/sub/../Notes.md')).not.toBeNull()
  })

  it('lapses after the time limit', async () => {
    const { grants, clock, add } = make()
    add('/in/notes.md')
    await grants.issue(1, ['/in/notes.md'])

    clock.now += SOURCE_GRANT_TTL_MS - 1
    expect(await grants.batchOf(1, '/in/notes.md')).not.toBeNull()
    clock.now += 1
    expect(await grants.batchOf(1, '/in/notes.md')).toBeNull()
  })

  it('is used once: forgetting a file ends its record', async () => {
    const { grants, add } = make()
    add('/in/notes.md')
    await grants.issue(1, ['/in/notes.md'])
    grants.forget(1, '/in/notes.md')

    expect(await grants.batchOf(1, '/in/notes.md')).toBeNull()
  })

  it('drops the oldest records past the cap', async () => {
    const { grants, add } = make()
    const paths = Array.from({ length: MAX_GRANTS_PER_SENDER + 1 }, (_, i) => `/in/${i}.md`)
    add(...paths)
    await grants.issue(1, paths)

    expect(await grants.batchOf(1, '/in/0.md')).toBeNull()
    expect(await grants.batchOf(1, `/in/${MAX_GRANTS_PER_SENDER}.md`)).not.toBeNull()
  })

  it('forgets everything on clear', async () => {
    const { grants, add } = make()
    add('/in/notes.md')
    await grants.issue(1, ['/in/notes.md'])
    grants.clear()

    expect(await grants.batchOf(1, '/in/notes.md')).toBeNull()
  })

  it('treats Windows paths by their resolved spelling', async () => {
    const { grants, add } = make('win32')
    add('C:\\In\\Notes.md')
    await grants.issue(1, ['C:\\In\\Notes.md'])

    expect(await grants.batchOf(1, 'C:/In/Notes.md')).not.toBeNull()
  })
})
