// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A file the user may not read (Windows "Deny Read": `realpath` fails with
 * EPERM while `lstat` works) is still refused, but with PERMISSION_DENIED
 * instead of UNVERIFIABLE – and only when it is a regular file in a folder
 * that verifiably lies in the project. A link, an outside path or any other
 * failure keeps the "cannot verify" refusal.
 *
 * Recorded on Windows with plain Node: on a denied-read file, `readFileSync`
 * and `realpathSync.native` both give EPERM; `lstat` and `stat` work.
 */
import { describe, expect, it } from 'vitest'
import path from 'node:path'
import {
  resolveConfinedPath,
  type ConfinementDeps,
  type ConfinementSession,
  type PathPolicy
} from './resolveConfinedPath'
import { ConfinementError } from './ConfinementError'
import { isPermissionDeniedFile } from './permissionDeniedFile'
import { createFakeConfinementFs, type FakeEntry } from '../__test-helpers__/fakeConfinementFs'

const ROOT = 'C:\\proj'
const session: ConfinementSession = {
  root: ROOT,
  realRoot: ROOT,
  caseSensitive: false,
  ownerWebContentsId: null
}

const entries: Record<string, FakeEntry> = {
  'C:\\': 'dir',
  [ROOT]: 'dir',
  [`${ROOT}\\docs`]: 'dir',
  [`${ROOT}\\docs\\locked.md`]: 'file',
  [`${ROOT}\\docs\\open.md`]: 'file',
  [`${ROOT}\\docs\\link.md`]: { link: `${ROOT}\\docs\\locked.md` },
  'C:\\outside': 'dir',
  'C:\\outside\\locked.md': 'file'
}

const errno = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code })

/**
 * The fake Windows file system, with `realpath` refused for every path in
 * `denied` (compared case-insensitively) with `code`.
 */
function depsDenying(denied: readonly string[], code = 'EPERM'): ConfinementDeps {
  const fake = createFakeConfinementFs(path.win32, entries, true)
  const refused = new Set(denied.map((p) => p.toLowerCase()))
  return {
    fs: {
      lstat: (t) => fake.lstat(t),
      stat: (t) => fake.stat(t),
      realpath: async (t) => {
        if (refused.has(path.win32.resolve(t).toLowerCase())) throw errno(code)
        return fake.realpath(t)
      }
    },
    path: path.win32,
    platform: 'win32'
  }
}

const readFile: PathPolicy = { mode: 'project', kind: 'file' }

async function refusal(input: string, deps: ConfinementDeps, policy = readFile): Promise<string> {
  try {
    await resolveConfinedPath(input, { session, senderId: 1 }, policy, deps)
    return 'accepted'
  } catch (error) {
    return error instanceof ConfinementError ? error.code : `other: ${String(error)}`
  }
}

describe('resolveConfinedPath – a file the user may not read', () => {
  it.each(['EPERM', 'EACCES'])(
    'refuses a regular in-project file whose realpath fails with %s as PERMISSION_DENIED',
    async (code) => {
      const deps = depsDenying([`${ROOT}\\docs\\locked.md`], code)
      expect(await refusal(`${ROOT}\\docs\\locked.md`, deps)).toBe('PERMISSION_DENIED')
    }
  )

  it('the refusal says "permission denied", the phrase the renderer classifies', async () => {
    const deps = depsDenying([`${ROOT}\\docs\\locked.md`])
    await expect(
      resolveConfinedPath(`${ROOT}\\docs\\locked.md`, { session, senderId: 1 }, readFile, deps)
    ).rejects.toThrow('Cannot open this file: permission denied')
  })

  it('keeps "cannot verify" for a link, even to an in-project file (it may lead outside)', async () => {
    const deps = depsDenying([`${ROOT}\\docs\\link.md`, `${ROOT}\\docs\\locked.md`])
    expect(await refusal(`${ROOT}\\docs\\link.md`, deps)).toBe('UNVERIFIABLE')
  })

  it('keeps "cannot verify" when the folder cannot be resolved either', async () => {
    const deps = depsDenying([`${ROOT}\\docs\\locked.md`, `${ROOT}\\docs`])
    expect(await refusal(`${ROOT}\\docs\\locked.md`, deps)).toBe('UNVERIFIABLE')
  })

  it('keeps "cannot verify" for any other realpath failure', async () => {
    const deps = depsDenying([`${ROOT}\\docs\\locked.md`], 'EIO')
    expect(await refusal(`${ROOT}\\docs\\locked.md`, deps)).toBe('UNVERIFIABLE')
  })

  it('leaves a readable file, and an entry action on the locked one, as before', async () => {
    const deps = depsDenying([`${ROOT}\\docs\\locked.md`])
    expect(await refusal(`${ROOT}\\docs\\open.md`, deps)).toBe('accepted')
    // a rename or delete checks the folder, which resolves: accepted as before
    expect(await refusal(`${ROOT}\\docs\\locked.md`, deps, { mode: 'project-entry', mustExist: true })).toBe(
      'accepted'
    )
  })
})

describe('isPermissionDeniedFile', () => {
  it('is false for a path outside the project, without asking the file system', async () => {
    const calls: string[] = []
    const deps = depsDenying(['C:\\outside\\locked.md'])
    const spied: ConfinementDeps = {
      ...deps,
      fs: {
        lstat: (t) => (calls.push(`lstat ${t}`), deps.fs.lstat(t)),
        stat: (t) => (calls.push(`stat ${t}`), deps.fs.stat(t)),
        realpath: (t) => (calls.push(`realpath ${t}`), deps.fs.realpath(t))
      }
    }

    expect(await isPermissionDeniedFile('C:\\outside\\locked.md', session, spied)).toBe(false)
    expect(calls).toEqual([])
  })

  it('is false when the file resolves after all', async () => {
    expect(await isPermissionDeniedFile(`${ROOT}\\docs\\open.md`, session, depsDenying([]))).toBe(false)
  })

  it('is false for a folder', async () => {
    expect(await isPermissionDeniedFile(`${ROOT}\\docs`, session, depsDenying([`${ROOT}\\docs`]))).toBe(false)
  })
})
