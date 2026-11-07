// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The per-project Chromium folder under `<sessionData>/browser-profiles/`
 * (025-FR-015; ADR 0009 decision 1): the naming rule, collisions, links,
 * set-aside and Forget, on a real temporary folder.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('../LoggingService', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

import { canonicalProjectPath } from './browserProfileGuards'
import {
  MAX_FOLDER_CANDIDATES,
  NAME_PREFIX_MAX,
  candidateFolderName,
  clearProfileFolder,
  ensureChromiumDir,
  finishPendingClear,
  profileFolderBaseName,
  resolveProfileFolder,
  setChromiumAside
} from './browserProfileFolders'

const itPosix = process.platform === 'win32' ? it.skip : it
const sha8 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 8)

describe('profileFolderBaseName – the Claude Code projects-folder rule', () => {
  it.each([
    ['/Users/marcinobel/Projects/erfana/erfana', '-Users-marcinobel-Projects-erfana-erfana'],
    ['/Users/x/.claude', '-Users-x--claude'],
    ['/home/u/my_app v2', '-home-u-my-app-v2'],
    ['/a/b-c', '-a-b-c'],
    ['/a-b/c', '-a-b-c'],
    ['/', '-']
  ])('%s → %s', (canonical, name) => {
    expect(profileFolderBaseName(canonical, 'darwin')).toBe(name)
    expect(profileFolderBaseName(canonical, 'linux')).toBe(name)
  })

  it('folds a Windows path the same way', () => {
    expect(profileFolderBaseName('C:\\Users\\x\\proj', 'win32')).toBe('C--Users-x-proj')
    expect(profileFolderBaseName('\\\\server\\share\\proj', 'win32')).toBe('--server-share-proj')
  })

  it('folds every non-ASCII UTF-16 code unit: an accent is one dash, an emoji two', () => {
    expect(profileFolderBaseName('/Users/zoë/🚀', 'darwin')).toBe('-Users-zo----')
  })

  it('keeps a name exactly at the limit, and cuts one past it, appending the first 8 hex of the path SHA-256', () => {
    const atLimit = `/${'a'.repeat(NAME_PREFIX_MAX.posix - 1)}`
    expect(profileFolderBaseName(atLimit, 'darwin')).toBe(`-${'a'.repeat(NAME_PREFIX_MAX.posix - 1)}`)
    const past = `${atLimit}b`
    expect(profileFolderBaseName(past, 'darwin')).toBe(`-${'a'.repeat(NAME_PREFIX_MAX.posix - 1)}-${sha8(past)}`)
  })

  it('cuts much shorter on Windows, for MAX_PATH', () => {
    const long = `C:\\Users\\someone\\${'Deep\\'.repeat(20)}project`
    const name = profileFolderBaseName(long, 'win32')
    expect(name).toBe(`${long.replace(/[^A-Za-z0-9]/g, '-').slice(0, NAME_PREFIX_MAX.win32)}-${sha8(long)}`)
    expect(name.length).toBe(NAME_PREFIX_MAX.win32 + 9)
  })

  it('gives two long paths with the same start different names', () => {
    const start = `/${'x'.repeat(300)}`
    expect(profileFolderBaseName(`${start}/one`, 'linux')).not.toBe(profileFolderBaseName(`${start}/two`, 'linux'))
    expect(profileFolderBaseName(`${start}/one`, 'linux').length).toBeLessThanOrEqual(143 - 4)
  })

  it('numbers later candidates from 2', () => {
    expect(candidateFolderName('-a', 1)).toBe('-a')
    expect(candidateFolderName('-a', 2)).toBe('-a-2')
  })
})

describe('resolveProfileFolder', () => {
  let base: string
  let data: string
  const profiles = (): string => join(data, 'browser-profiles')
  const identity = async (name: string): Promise<unknown> =>
    JSON.parse(await readFile(join(profiles(), name, 'project.json'), 'utf8'))

  beforeEach(async () => {
    base = await canonicalProjectPath(await mkdtemp(join(tmpdir(), 'erfana-folders-')))
    data = join(base, 'session-data')
  })

  afterEach(async () => {
    await rm(base, { recursive: true, force: true })
  })

  it('claims the base name for a new project, recording its canonical path', async () => {
    const folder = await resolveProfileFolder(data, '/a/b-c', 'darwin')
    expect(folder).toEqual({ dataRoot: data, name: '-a-b-c', chromiumDir: join(profiles(), '-a-b-c', 'chromium') })
    expect(await identity('-a-b-c')).toEqual({ version: 1, projectPath: '/a/b-c' })
    // Claiming does not create the Chromium folder yet
    expect(await readdir(join(profiles(), '-a-b-c'))).toEqual(['project.json'])
  })

  it('reuses the folder for the same path', async () => {
    const first = await resolveProfileFolder(data, '/a/b-c', 'darwin')
    expect(await resolveProfileFolder(data, '/a/b-c', 'darwin')).toEqual(first)
    expect(await readdir(profiles())).toEqual(['-a-b-c'])
  })

  it('gives a colliding path the next free name, and each path keeps its own on later runs', async () => {
    const one = await resolveProfileFolder(data, '/a/b-c', 'darwin')
    const two = await resolveProfileFolder(data, '/a-b/c', 'darwin')
    expect(two.name).toBe('-a-b-c-2')
    expect(await identity('-a-b-c-2')).toEqual({ version: 1, projectPath: '/a-b/c' })
    expect(await resolveProfileFolder(data, '/a-b/c', 'darwin')).toEqual(two)
    expect(await resolveProfileFolder(data, '/a/b-c', 'darwin')).toEqual(one)
  })

  it('finds its own -2 folder even after the base folder was removed', async () => {
    await resolveProfileFolder(data, '/a/b-c', 'darwin')
    await resolveProfileFolder(data, '/a-b/c', 'darwin')
    await rm(join(profiles(), '-a-b-c'), { recursive: true })
    expect((await resolveProfileFolder(data, '/a-b/c', 'darwin')).name).toBe('-a-b-c-2')
  })

  it('never reuses a folder with a missing, unreadable or foreign project.json', async () => {
    await mkdir(join(profiles(), '-p'), { recursive: true })
    await mkdir(join(profiles(), '-p-2'))
    await writeFile(join(profiles(), '-p-2', 'project.json'), '{not json')
    await mkdir(join(profiles(), '-p-3'))
    await writeFile(join(profiles(), '-p-3', 'project.json'), JSON.stringify({ version: 1, projectPath: '/p', extra: 1 }))
    await writeFile(join(profiles(), '-p-4'), 'a file, not a folder')
    expect((await resolveProfileFolder(data, '/p', 'darwin')).name).toBe('-p-5')
  })

  it('folds case when looking for its folder (one folder on a case-insensitive volume)', async () => {
    const lower = await resolveProfileFolder(data, '/a/proj', 'darwin')
    const upper = await resolveProfileFolder(data, '/a/Proj', 'darwin')
    expect(lower.name).toBe('-a-proj')
    // A case-insensitive volume: `-a-Proj` is the taken `-a-proj`; a case-sensitive one: a new folder
    expect(['-a-Proj', '-a-Proj-2']).toContain(upper.name)
    expect(await identity(upper.name)).toEqual({ version: 1, projectPath: '/a/Proj' })
  })

  itPosix('skips a candidate that is a link, and never writes through it', async () => {
    await mkdir(profiles(), { recursive: true })
    await mkdir(join(base, 'outside'))
    await writeFile(join(base, 'outside', 'project.json'), JSON.stringify({ version: 1, projectPath: '/p' }))
    await symlink(join(base, 'outside'), join(profiles(), '-p'), 'dir')
    expect((await resolveProfileFolder(data, '/p', 'darwin')).name).toBe('-p-2')
    expect(await readdir(join(base, 'outside'))).toEqual(['project.json'])
  })

  itPosix('refuses when browser-profiles itself is a link', async () => {
    await mkdir(data)
    await mkdir(join(base, 'outside'))
    await symlink(join(base, 'outside'), profiles(), 'dir')
    await expect(resolveProfileFolder(data, '/p', 'darwin')).rejects.toMatchObject({ code: 'link', relPath: 'browser-profiles' })
  })

  it('refuses when Erfana\'s data folder cannot be used', async () => {
    await writeFile(data, 'a file where the data folder belongs')
    await expect(resolveProfileFolder(data, '/p', 'darwin')).rejects.toMatchObject({ code: 'write-failed', relPath: 'browser-profiles' })
  })

  itPosix('refuses when a new folder cannot be created, naming it', async () => {
    await mkdir(profiles(), { recursive: true })
    await chmod(profiles(), 0o500)
    try {
      await expect(resolveProfileFolder(data, '/p', 'darwin')).rejects.toMatchObject({ code: 'write-failed', relPath: 'browser-profiles/-p' })
    } finally {
      await chmod(profiles(), 0o700)
    }
  })

  it('refuses when every candidate is taken', async () => {
    for (let n = 1; n <= MAX_FOLDER_CANDIDATES; n++) {
      await mkdir(join(profiles(), candidateFolderName('-p', n)), { recursive: true })
    }
    await expect(resolveProfileFolder(data, '/p', 'darwin')).rejects.toMatchObject({ code: 'write-failed' })
  })
})

describe('the Chromium folder: create, set aside, Forget', () => {
  let base: string
  let data: string

  beforeEach(async () => {
    base = await canonicalProjectPath(await mkdtemp(join(tmpdir(), 'erfana-folders-')))
    data = join(base, 'session-data')
  })

  afterEach(async () => {
    await rm(base, { recursive: true, force: true })
  })

  it('creates chromium/, and refuses a link there', async () => {
    const folder = await resolveProfileFolder(data, '/p', 'darwin')
    await ensureChromiumDir(folder)
    expect(existsSync(folder.chromiumDir)).toBe(true)
    if (process.platform === 'win32') return
    await rm(folder.chromiumDir, { recursive: true })
    await mkdir(join(base, 'outside'))
    await symlink(join(base, 'outside'), folder.chromiumDir, 'dir')
    await expect(ensureChromiumDir(folder)).rejects.toMatchObject({ code: 'link', relPath: 'browser-profiles/-p/chromium' })
  })

  it('sets chromium/ aside under the given time, picking a free name', async () => {
    const folder = await resolveProfileFolder(data, '/p', 'darwin')
    expect(await setChromiumAside(folder, 'T')).toBeNull()
    await ensureChromiumDir(folder)
    await writeFile(join(folder.chromiumDir, 'Cookies'), 'old')
    await mkdir(join(data, 'browser-profiles', '-p', 'chromium.untrusted-T'))
    expect(await setChromiumAside(folder, 'T')).toBe('chromium.untrusted-T-1')
    expect(await readFile(join(data, 'browser-profiles', '-p', 'chromium.untrusted-T-1', 'Cookies'), 'utf8')).toBe('old')
    expect(existsSync(folder.chromiumDir)).toBe(false)
  })

  it('gives up setting aside when every name of that time is taken', async () => {
    const folder = await resolveProfileFolder(data, '/p', 'darwin')
    await ensureChromiumDir(folder)
    for (let n = 0; n < 10; n++) {
      await mkdir(join(data, 'browser-profiles', '-p', `chromium.untrusted-T${n === 0 ? '' : `-${n}`}`))
    }
    await expect(setChromiumAside(folder, 'T')).rejects.toMatchObject({ code: 'write-failed', relPath: 'browser-profiles/-p/chromium' })
  })

  itPosix('reports a set-aside rename that fails', async () => {
    const folder = await resolveProfileFolder(data, '/p', 'darwin')
    await ensureChromiumDir(folder)
    const dir = join(data, 'browser-profiles', '-p')
    await chmod(dir, 0o500)
    try {
      await expect(setChromiumAside(folder, 'T')).rejects.toMatchObject({ code: 'write-failed' })
    } finally {
      await chmod(dir, 0o700)
    }
  })

  itPosix('Forget reports an entry it cannot delete, naming it', async () => {
    const folder = await resolveProfileFolder(data, '/p', 'darwin')
    await ensureChromiumDir(folder)
    await writeFile(join(folder.chromiumDir, 'Cookies'), 'x')
    await chmod(folder.chromiumDir, 0o500)
    try {
      await expect(clearProfileFolder(folder, 'darwin')).rejects.toMatchObject({
        code: 'delete-failed',
        relPath: 'browser-profiles/-p/chromium'
      })
    } finally {
      await chmod(folder.chromiumDir, 0o700)
    }
  })

  it('Forget deletes everything but project.json; with nothing to delete it is absent', async () => {
    const folder = await resolveProfileFolder(data, '/p', 'darwin')
    expect(await clearProfileFolder(folder, 'darwin')).toBe('absent')
    await ensureChromiumDir(folder)
    await writeFile(join(folder.chromiumDir, 'Cookies'), 'x')
    await mkdir(join(data, 'browser-profiles', '-p', 'chromium.untrusted-T'))
    expect(await clearProfileFolder(folder, 'darwin')).toBe('deleted')
    expect(await readdir(join(data, 'browser-profiles', '-p'))).toEqual(['project.json'])
    expect((await resolveProfileFolder(data, '/p', 'darwin')).name).toBe('-p')
  })

  it('Forget of a folder that is gone is absent', async () => {
    const folder = await resolveProfileFolder(data, '/p', 'darwin')
    await rm(join(data, 'browser-profiles', '-p'), { recursive: true })
    expect(await clearProfileFolder(folder, 'darwin')).toBe('absent')
  })

  itPosix('Forget removes a link inside the folder, never what it points to', async () => {
    const folder = await resolveProfileFolder(data, '/p', 'darwin')
    await mkdir(join(base, 'outside'))
    await writeFile(join(base, 'outside', 'keep.txt'), 'keep')
    await symlink(join(base, 'outside'), folder.chromiumDir, 'dir')
    expect(await clearProfileFolder(folder, 'darwin')).toBe('deleted')
    expect(await readFile(join(base, 'outside', 'keep.txt'), 'utf8')).toBe('keep')
  })

  it('a pending Forget is finished at the next open, and nothing happens when none is pending', async () => {
    const folder = await resolveProfileFolder(data, '/p', 'win32')
    await finishPendingClear(folder, 'win32')
    await ensureChromiumDir(folder)
    await writeFile(join(folder.chromiumDir, 'Cookies'), 'x')
    expect(await readdir(join(data, 'browser-profiles', '-p'))).toEqual(['chromium', 'project.json'])
    await writeFile(join(data, 'browser-profiles', '-p', 'forget-pending'), '')
    await finishPendingClear(folder, 'win32')
    expect(await readdir(join(data, 'browser-profiles', '-p'))).toEqual(['project.json'])
  })
})
