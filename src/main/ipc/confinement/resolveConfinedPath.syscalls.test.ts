// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * File-system calls one confined path check makes, on a UNC project (the
 * volume where each call is a network round trip). The counts are pinned so a
 * new call in the hot path is a visible change; the outcomes of the same rows
 * are covered by `resolveConfinedPath.table.test.ts`.
 *
 * Before the shortcut for paths that must exist (lstat + realpath [+ stat]):
 * readDirectory 2 calls, readFile 2 (3 through a link), entry change 3.
 * After: 1, 2 (2 through a link), 2. A path about to be created is unchanged.
 */
import { describe, expect, it } from 'vitest'
import path from 'node:path'
import {
  resolveConfinedPath,
  type ConfinementDeps,
  type ConfinementFs,
  type ConfinementSession,
  type PathPolicy
} from './resolveConfinedPath'
import { createFakeConfinementFs, type FakeEntry } from '../__test-helpers__/fakeConfinementFs'

const ROOT = '\\\\srv\\share\\Proj'
const session: ConfinementSession = {
  root: ROOT,
  realRoot: ROOT,
  caseSensitive: false,
  ownerWebContentsId: null
}

const entries: Record<string, FakeEntry> = {
  '\\\\srv\\share\\': 'dir',
  [ROOT]: 'dir',
  [`${ROOT}\\a`]: 'dir',
  [`${ROOT}\\a\\b`]: 'dir',
  [`${ROOT}\\a\\b\\c.md`]: 'file',
  [`${ROOT}\\folder-link`]: { link: `${ROOT}\\a` },
  [`${ROOT}\\file-link.md`]: { link: `${ROOT}\\a\\b\\c.md` }
}

type Tally = { lstat: number; stat: number; realpath: number }

function counted(): { deps: ConfinementDeps; calls: () => Tally } {
  const fake = createFakeConfinementFs(path.win32, entries, true)
  const tally: Tally = { lstat: 0, stat: 0, realpath: 0 }
  const fs: ConfinementFs = {
    lstat: (t) => {
      tally.lstat++
      return fake.lstat(t)
    },
    stat: (t) => {
      tally.stat++
      return fake.stat(t)
    },
    realpath: (t) => {
      tally.realpath++
      return fake.realpath(t)
    }
  }
  return { deps: { fs, path: path.win32, platform: 'win32' }, calls: () => ({ ...tally }) }
}

async function callsFor(input: string, policy: PathPolicy): Promise<Tally> {
  const { deps, calls } = counted()
  await resolveConfinedPath(input, { session, senderId: 1 }, policy, deps)
  return calls()
}

describe('resolveConfinedPath – file-system calls on a UNC project', () => {
  it('file:readDirectory (nested folder, must exist)', async () => {
    const c = await callsFor(`${ROOT}\\a\\b`, { mode: 'project', mustExist: true })
    expect(c).toEqual({ lstat: 0, stat: 0, realpath: 1 })
  })

  it('file:readFile (nested file)', async () => {
    const c = await callsFor(`${ROOT}\\a\\b\\c.md`, { mode: 'project', kind: 'file' })
    expect(c).toEqual({ lstat: 0, stat: 1, realpath: 1 })
  })

  it('file:readFile through a file link', async () => {
    const c = await callsFor(`${ROOT}\\file-link.md`, { mode: 'project', kind: 'file' })
    expect(c).toEqual({ lstat: 0, stat: 1, realpath: 1 })
  })

  it('a rename or delete of an entry (parent checked, then the entry)', async () => {
    const c = await callsFor(`${ROOT}\\a\\b\\c.md`, { mode: 'project-entry', mustExist: true })
    expect(c).toEqual({ lstat: 1, stat: 0, realpath: 1 })
  })

  it('a path that does not exist yet still climbs to the nearest folder', async () => {
    const c = await callsFor(`${ROOT}\\a\\new\\x.md`, { mode: 'project' })
    expect(c).toEqual({ lstat: 3, stat: 0, realpath: 1 })
  })
})
