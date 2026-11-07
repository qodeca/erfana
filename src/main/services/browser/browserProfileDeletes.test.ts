// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Guarded deletes, set-aside and Windows pending deletes (ADR 0009 decisions 3
 * and 11; panel finding S4) on a real temporary folder. The Windows busy case
 * is produced by mocking `rm` only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { existsSync } from 'node:fs'
import * as fsPromises from 'node:fs/promises'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { rmControl } = vi.hoisted(() => ({ rmControl: { failWith: null as string | null } }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rm: vi.fn(async (...args: Parameters<typeof actual.rm>) => {
      if (rmControl.failWith !== null) {
        throw Object.assign(new Error(rmControl.failWith), { code: rmControl.failWith })
      }
      return actual.rm(...args)
    })
  }
})
vi.mock('../LoggingService', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

import {
  PENDING_DELETES_FILE,
  deleteUnderBrowser,
  recordPendingDelete,
  runPendingDeletes,
  setAsideStamp,
  setProfileAside,
  type BrowserDeleteDeps
} from './browserProfileDeletes'
import { canonicalProjectPath, ensureBrowserFolder, ensureProfileTree } from './browserProfileGuards'
import type { PurposeSigner } from './browserProfileMarker'

const itPosix = process.platform === 'win32' ? it.skip : it

function fakeSigner(keyed: boolean, secret = 'k'): PurposeSigner {
  const digest = (purpose: string, body: string): string =>
    createHmac('sha256', `${secret}:${purpose}`).update(body).digest('hex')
  return {
    hasKey: () => keyed,
    sign: (purpose, body) => (keyed ? digest(purpose, body) : undefined),
    verify: (purpose, body, value) => {
      if (!value) return 'missing'
      if (!keyed) return 'no-key'
      return value === digest(purpose, body) ? 'valid' : 'invalid'
    }
  }
}

let base: string
let project: string
let home: string

const pendingFile = (): string => join(home, '.erfana', PENDING_DELETES_FILE)
const windowsDeps = (signer = fakeSigner(true)): BrowserDeleteDeps => ({ homeDir: home, platform: 'win32', signer })

beforeEach(async () => {
  rmControl.failWith = null
  base = await canonicalProjectPath(await mkdtemp(join(tmpdir(), 'erfana-deletes-')))
  project = join(base, 'project')
  home = join(base, 'home')
  await mkdir(project)
  await mkdir(home)
  await ensureBrowserFolder(project)
  await ensureProfileTree(project)
})

afterEach(async () => {
  rmControl.failWith = null
  await rm(base, { recursive: true, force: true })
})

describe('deleteUnderBrowser', () => {
  it('deletes a file, then reports it absent', async () => {
    await writeFile(join(project, '.erfana', 'browser', 'captures', 'a.png'), 'x')
    expect(await deleteUnderBrowser(project, ['captures', 'a.png'], windowsDeps())).toBe('deleted')
    expect(await deleteUnderBrowser(project, ['captures', 'a.png'], windowsDeps())).toBe('absent')
  })

  it('deletes the whole browser folder for Forget and leaves the rest of .erfana', async () => {
    await writeFile(join(project, '.erfana', 'settings.json'), '{}')
    expect(await deleteUnderBrowser(project, [], windowsDeps())).toBe('deleted')
    expect(await readdir(join(project, '.erfana'))).toEqual(['settings.json'])
  })

  itPosix('re-guards before deleting: a captures folder swapped for a link is refused and the outside survives', async () => {
    const outside = join(base, 'outside')
    await mkdir(outside)
    await writeFile(join(outside, 'old.png'), 'keep')
    await rm(join(project, '.erfana', 'browser', 'captures'), { recursive: true })
    await symlink(outside, join(project, '.erfana', 'browser', 'captures'), 'dir')
    await expect(deleteUnderBrowser(project, ['captures', 'old.png'], windowsDeps())).rejects.toMatchObject({
      code: 'link',
      relPath: '.erfana/browser/captures'
    })
    expect(await readFile(join(outside, 'old.png'), 'utf8')).toBe('keep')
  })

  it.each([[['..', 'x']], [['captures', '..', '..', '..', 'src']], [['a\0']]])(
    'refuses an unsafe path %j',
    async (rel) => {
      await expect(deleteUnderBrowser(project, rel, windowsDeps())).rejects.toMatchObject({ code: 'invalid-path' })
    }
  )

  it.each(['EBUSY', 'EPERM', 'ENOTEMPTY'])(
    'on Windows stores a delete the session blocks (%s), signed, as project + relative path',
    async (code) => {
      rmControl.failWith = code
      expect(await deleteUnderBrowser(project, ['profile'], windowsDeps())).toBe('pending')
      const stored = JSON.parse(await readFile(pendingFile(), 'utf8'))
      expect(stored).toEqual({
        version: 1,
        entries: [{ project, rel: '.erfana/browser/profile', hmac: expect.stringMatching(/^[0-9a-f]{64}$/) }]
      })
    }
  )

  it('does not store a blocked delete outside Windows', async () => {
    rmControl.failWith = 'EBUSY'
    await expect(
      deleteUnderBrowser(project, ['profile'], { ...windowsDeps(), platform: 'darwin' })
    ).rejects.toMatchObject({ code: 'delete-failed', relPath: '.erfana/browser/profile' })
    expect(existsSync(pendingFile())).toBe(false)
  })

  it('reports a blocked delete as failed when there is no key to sign it', async () => {
    rmControl.failWith = 'EBUSY'
    await expect(deleteUnderBrowser(project, ['profile'], windowsDeps(fakeSigner(false)))).rejects.toMatchObject({
      code: 'delete-failed'
    })
    expect(existsSync(pendingFile())).toBe(false)
  })

  it('reports any other failure as failed', async () => {
    rmControl.failWith = 'EIO'
    await expect(deleteUnderBrowser(project, ['profile'], windowsDeps())).rejects.toMatchObject({
      code: 'delete-failed'
    })
  })
})

describe('recordPendingDelete', () => {
  it('stores one entry per path', async () => {
    await recordPendingDelete(project, '.erfana/browser/profile', windowsDeps())
    await recordPendingDelete(project, '.erfana/browser/profile', windowsDeps())
    await recordPendingDelete(project, '.erfana/browser', windowsDeps())
    const stored = JSON.parse(await readFile(pendingFile(), 'utf8'))
    expect(stored.entries.map((e: { rel: string }) => e.rel)).toEqual(['.erfana/browser/profile', '.erfana/browser'])
  })

  it('stops at 256 entries (boundary)', async () => {
    const signer = fakeSigner(true)
    const entries = Array.from({ length: 256 }, (_, i) => ({
      project,
      rel: `.erfana/browser/captures/f${i}.png`,
      hmac: signer.sign('browser-pending-delete', JSON.stringify({ project, rel: `.erfana/browser/captures/f${i}.png` }))!
    }))
    await mkdir(join(home, '.erfana'), { recursive: true })
    await writeFile(pendingFile(), JSON.stringify({ version: 1, entries: entries.slice(0, 255) }))
    expect(await recordPendingDelete(project, '.erfana/browser/one-more', windowsDeps())).toBe(true)
    expect(await recordPendingDelete(project, '.erfana/browser/too-many', windowsDeps())).toBe(false)
  })
})

describe('runPendingDeletes (at start)', () => {
  it('runs a stored delete after re-guarding, and empties the file', async () => {
    await writeFile(join(project, '.erfana', 'browser', 'profile', 'Cookies'), 'x')
    await recordPendingDelete(project, '.erfana/browser/profile', windowsDeps())
    await runPendingDeletes(windowsDeps())
    expect(existsSync(join(project, '.erfana', 'browser', 'profile'))).toBe(false)
    expect(existsSync(pendingFile())).toBe(false)
  })

  it('keeps an entry the session still blocks', async () => {
    await recordPendingDelete(project, '.erfana/browser/profile', windowsDeps())
    rmControl.failWith = 'EBUSY'
    await runPendingDeletes(windowsDeps())
    expect(JSON.parse(await readFile(pendingFile(), 'utf8')).entries).toHaveLength(1)
  })

  it('drops an entry whose signature does not verify, without deleting', async () => {
    await recordPendingDelete(project, '.erfana/browser/profile', windowsDeps(fakeSigner(true, 'planted')))
    await runPendingDeletes(windowsDeps(fakeSigner(true, 'real')))
    expect(existsSync(join(project, '.erfana', 'browser', 'profile'))).toBe(true)
    expect(existsSync(pendingFile())).toBe(false)
  })

  it('drops an entry whose path was edited after signing', async () => {
    await recordPendingDelete(project, '.erfana/browser/profile', windowsDeps())
    const stored = JSON.parse(await readFile(pendingFile(), 'utf8'))
    stored.entries[0].rel = '.erfana/browser'
    await writeFile(pendingFile(), JSON.stringify(stored))
    await runPendingDeletes(windowsDeps())
    expect(existsSync(join(project, '.erfana', 'browser'))).toBe(true)
  })

  it('drops a signed entry that names a path outside .erfana/browser, without deleting', async () => {
    await writeFile(join(project, 'keep.md'), 'x')
    await recordPendingDelete(project, 'keep.md', windowsDeps())
    await runPendingDeletes(windowsDeps())
    expect(existsSync(join(project, 'keep.md'))).toBe(true)
    expect(existsSync(pendingFile())).toBe(false)
  })

  it('drops an entry whose project is no longer at that canonical path', async () => {
    await recordPendingDelete(join(base, 'moved-away'), '.erfana/browser', windowsDeps())
    await runPendingDeletes(windowsDeps())
    expect(existsSync(pendingFile())).toBe(false)
  })

  it('drops an entry whose target is already gone', async () => {
    await recordPendingDelete(project, '.erfana/browser/profile.untrusted-x', windowsDeps())
    await runPendingDeletes(windowsDeps())
    expect(existsSync(pendingFile())).toBe(false)
  })

  it('ignores a file that is not valid', async () => {
    await mkdir(join(home, '.erfana'), { recursive: true })
    await writeFile(pendingFile(), '{"version":2}')
    await expect(runPendingDeletes(windowsDeps())).resolves.toBeUndefined()
    await writeFile(pendingFile(), 'not json')
    await expect(runPendingDeletes(windowsDeps())).resolves.toBeUndefined()
  })

  it('does nothing when no file exists', async () => {
    await expect(runPendingDeletes(windowsDeps())).resolves.toBeUndefined()
    expect(existsSync(pendingFile())).toBe(false)
  })
})

describe('setProfileAside', () => {
  it('renames the profile to profile.untrusted-<UTC time>', async () => {
    const at = Date.UTC(2026, 10, 2, 23, 59, 59, 999)
    expect(await setProfileAside(project, at)).toBe('profile.untrusted-2026-11-02T23-59-59-999Z')
    expect(existsSync(join(project, '.erfana', 'browser', 'profile'))).toBe(false)
  })

  it('returns null when there is no profile', async () => {
    await rm(join(project, '.erfana', 'browser', 'profile'), { recursive: true })
    expect(await setProfileAside(project, 0)).toBeNull()
  })

  it('gives up after ten taken names (boundary)', async () => {
    const stamp = setAsideStamp(0)
    await mkdir(join(project, '.erfana', 'browser', `profile.untrusted-${stamp}`))
    for (let i = 1; i < 9; i++) await mkdir(join(project, '.erfana', 'browser', `profile.untrusted-${stamp}-${i}`))
    expect(await setProfileAside(project, 0)).toBe(`profile.untrusted-${stamp}-9`)
    await mkdir(join(project, '.erfana', 'browser', 'profile'))
    await expect(setProfileAside(project, 0)).rejects.toMatchObject({ code: 'write-failed' })
  })

  it('reports a failed rename', async () => {
    const renameSpy = vi.spyOn(fsPromises, 'rename').mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'EBUSY' }))
    await expect(setProfileAside(project, 0)).rejects.toMatchObject({ code: 'write-failed' })
    renameSpy.mockRestore()
  })

  it('names a stamp legal in a Windows file name', () => {
    expect(setAsideStamp(0)).toBe('1970-01-01T00-00-00-000Z')
    expect(setAsideStamp(0)).not.toMatch(/[:.]/)
  })
})
