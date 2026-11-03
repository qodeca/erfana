// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The `.erfana/browser` guards on a real temporary folder (025-FR-016, ADR 0009
 * decisions 2 and 11). Symlink cases are skipped on Windows, where creating a
 * symlink needs a privilege the CI user may not have.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('../LoggingService', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

import {
  BrowserProfileError,
  canonicalProjectPath,
  createFileExclusive,
  ensureBrowserFolder,
  ensureProfileTree,
  guardDeleteTarget,
  readFileNoFollow
} from './browserProfileGuards'

const itPosix = process.platform === 'win32' ? it.skip : it
const runsAsRoot = typeof process.getuid === 'function' && process.getuid() === 0

let base: string
let project: string
let outside: string

async function expectRefusal(promise: Promise<unknown>, code: string, relPath: string): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e
  )
  expect(error).toBeInstanceOf(BrowserProfileError)
  expect(error).toMatchObject({ code, relPath })
}

beforeEach(async () => {
  base = await canonicalProjectPath(await mkdtemp(join(tmpdir(), 'erfana-guards-')))
  project = join(base, 'project')
  outside = join(base, 'outside')
  await mkdir(project)
  await mkdir(outside)
})

afterEach(async () => {
  await chmod(project, 0o700).catch(() => undefined)
  await rm(base, { recursive: true, force: true })
})

describe('canonicalProjectPath', () => {
  it('returns the real path of the project', async () => {
    const link = join(base, 'link-to-project')
    await symlink(project, link, 'dir')
    expect(await canonicalProjectPath(link)).toBe(project)
  })

  it('refuses a folder that does not exist', async () => {
    await expectRefusal(canonicalProjectPath(join(base, 'missing')), 'no-project', '')
  })
})

describe('ensureBrowserFolder (025-FR-016)', () => {
  it('025-AC-016 writes .gitignore holding exactly * before any other file exists in the folder', async () => {
    await ensureBrowserFolder(project)
    const browserDir = join(project, '.erfana', 'browser')
    expect(await readdir(browserDir)).toEqual(['.gitignore'])
    expect(await readFile(join(browserDir, '.gitignore'), 'utf8')).toBe('*')
  })

  it('two first set-ups at once both succeed: the one that loses the create checks what the other wrote (025-FR-053)', async () => {
    const runs = await Promise.allSettled([ensureBrowserFolder(project), ensureBrowserFolder(project), ensureBrowserFolder(project)])
    expect(runs.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled'])
    const browserDir = join(project, '.erfana', 'browser')
    expect(await readdir(browserDir)).toEqual(['.gitignore'])
    expect(await readFile(join(browserDir, '.gitignore'), 'utf8')).toBe('*')
  })

  itPosix('a .gitignore name taken by a link after the check is still refused, not followed', async () => {
    // Planted where the exclusive create runs: the retry sees a link and refuses, as for any existing level.
    await mkdir(join(project, '.erfana', 'browser'), { recursive: true })
    await writeFile(join(outside, 'target'), 'outside')
    await symlink(join(outside, 'target'), join(project, '.erfana', 'browser', '.gitignore'))
    await expectRefusal(ensureBrowserFolder(project), 'link', '.erfana/browser/.gitignore')
    expect(await readFile(join(outside, 'target'), 'utf8')).toBe('outside')
  })

  it("025-AC-016 never touches the project's own .gitignore", async () => {
    const own = 'node_modules\n# keep\n'
    await writeFile(join(project, '.gitignore'), own)
    await ensureBrowserFolder(project)
    expect(await readFile(join(project, '.gitignore'), 'utf8')).toBe(own)
  })

  it('025-AC-016 writes the file again when it was deleted', async () => {
    await ensureBrowserFolder(project)
    await rm(join(project, '.erfana', 'browser', '.gitignore'))
    await ensureBrowserFolder(project)
    expect(await readFile(join(project, '.erfana', 'browser', '.gitignore'), 'utf8')).toBe('*')
  })

  it('025-AC-016 rewrites a .gitignore with other content to exactly * (spec change S-20)', async () => {
    await mkdir(join(project, '.erfana', 'browser'), { recursive: true })
    await writeFile(join(project, '.erfana', 'browser', '.gitignore'), '!profile\n*.log\n')
    await ensureBrowserFolder(project)
    expect(await readFile(join(project, '.erfana', 'browser', '.gitignore'), 'utf8')).toBe('*')
    // No temp file left behind
    expect(await readdir(join(project, '.erfana', 'browser'))).toEqual(['.gitignore'])
  })

  it('rewrites a .gitignore that only differs by a trailing newline', async () => {
    await mkdir(join(project, '.erfana', 'browser'), { recursive: true })
    await writeFile(join(project, '.erfana', 'browser', '.gitignore'), '*\n')
    await ensureBrowserFolder(project)
    expect(await readFile(join(project, '.erfana', 'browser', '.gitignore'), 'utf8')).toBe('*')
  })

  it('rewrites an oversized .gitignore without reading it whole', async () => {
    await mkdir(join(project, '.erfana', 'browser'), { recursive: true })
    await writeFile(join(project, '.erfana', 'browser', '.gitignore'), 'x'.repeat(64 * 1024 + 1))
    await ensureBrowserFolder(project)
    expect(await readFile(join(project, '.erfana', 'browser', '.gitignore'), 'utf8')).toBe('*')
  })

  it('keeps an existing .erfana folder and its files', async () => {
    await mkdir(join(project, '.erfana'))
    await writeFile(join(project, '.erfana', 'settings.json'), '{}')
    await ensureBrowserFolder(project)
    expect(await readFile(join(project, '.erfana', 'settings.json'), 'utf8')).toBe('{}')
  })

  it('refuses a file where the .erfana folder belongs', async () => {
    await writeFile(join(project, '.erfana'), 'x')
    await expectRefusal(ensureBrowserFolder(project), 'wrong-type', '.erfana')
  })

  it('refuses a folder where .gitignore belongs', async () => {
    await mkdir(join(project, '.erfana', 'browser', '.gitignore'), { recursive: true })
    await expectRefusal(ensureBrowserFolder(project), 'wrong-type', '.erfana/browser/.gitignore')
  })

  itPosix('025-AC-016 refuses the tab with the reason when the folder is read-only', async () => {
    if (runsAsRoot) return // root writes through any mode
    await chmod(project, 0o500)
    const error = await ensureBrowserFolder(project).catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'write-failed', relPath: '.erfana' })
    expect((error as Error).message).toMatch(/EACCES|EPERM|EROFS/)
  })

  itPosix('025-AC-069 refuses a symlinked .erfana', async () => {
    await symlink(outside, join(project, '.erfana'), 'dir')
    await expectRefusal(ensureBrowserFolder(project), 'link', '.erfana')
  })

  itPosix('025-AC-069 refuses a symlinked .erfana/browser', async () => {
    await mkdir(join(project, '.erfana'))
    await symlink(outside, join(project, '.erfana', 'browser'), 'dir')
    await expectRefusal(ensureBrowserFolder(project), 'link', '.erfana/browser')
    expect(await readdir(outside)).toEqual([])
  })

  itPosix('025-AC-069 refuses a symlinked .gitignore and writes nothing through it', async () => {
    const target = join(outside, 'victim')
    await writeFile(target, 'keep')
    await mkdir(join(project, '.erfana', 'browser'), { recursive: true })
    await symlink(target, join(project, '.erfana', 'browser', '.gitignore'), 'file')
    await expectRefusal(ensureBrowserFolder(project), 'link', '.erfana/browser/.gitignore')
    expect(await readFile(target, 'utf8')).toBe('keep')
  })

  itPosix('refuses a dangling .gitignore link instead of creating its target', async () => {
    await mkdir(join(project, '.erfana', 'browser'), { recursive: true })
    await symlink(join(outside, 'created-through-link'), join(project, '.erfana', 'browser', '.gitignore'), 'file')
    await expectRefusal(ensureBrowserFolder(project), 'link', '.erfana/browser/.gitignore')
    expect(await readdir(outside)).toEqual([])
  })

  itPosix('refuses a project whose .erfana is reached through a symlinked ancestor of the level', async () => {
    // The project root itself is canonical, so a link can only sit at a level we check
    await mkdir(join(outside, 'browser'))
    await symlink(outside, join(project, '.erfana'), 'dir')
    await expectRefusal(ensureBrowserFolder(project), 'link', '.erfana')
  })
})

describe('ensureProfileTree', () => {
  it('creates profile, profile/Erfana and captures', async () => {
    await ensureBrowserFolder(project)
    await ensureProfileTree(project)
    const browserDir = join(project, '.erfana', 'browser')
    expect((await readdir(browserDir)).sort()).toEqual(['.gitignore', 'captures', 'profile'])
    expect(await readdir(join(browserDir, 'profile'))).toEqual(['Erfana'])
  })

  itPosix('025-AC-069 refuses a symlinked profile', async () => {
    await ensureBrowserFolder(project)
    await symlink(outside, join(project, '.erfana', 'browser', 'profile'), 'dir')
    await expectRefusal(ensureProfileTree(project), 'link', '.erfana/browser/profile')
  })

  itPosix('025-AC-069 refuses a symlinked captures folder', async () => {
    await ensureBrowserFolder(project)
    await symlink(outside, join(project, '.erfana', 'browser', 'captures'), 'dir')
    await expectRefusal(ensureProfileTree(project), 'link', '.erfana/browser/captures')
  })

  itPosix('refuses a symlinked profile/Erfana', async () => {
    await ensureBrowserFolder(project)
    await mkdir(join(project, '.erfana', 'browser', 'profile'))
    await symlink(outside, join(project, '.erfana', 'browser', 'profile', 'Erfana'), 'dir')
    await expectRefusal(ensureProfileTree(project), 'link', '.erfana/browser/profile/Erfana')
  })
})

describe('createFileExclusive and readFileNoFollow', () => {
  beforeEach(async () => {
    await ensureBrowserFolder(project)
    await ensureProfileTree(project)
  })

  const marker = ['.erfana', 'browser', 'profile', 'Erfana', 'marker.json']

  it('creates a new file and reads it back', async () => {
    await createFileExclusive(project, marker, '{"a":1}')
    expect(await readFileNoFollow(project, marker, 1024)).toBe('{"a":1}')
  })

  it('never replaces an existing file', async () => {
    await createFileExclusive(project, marker, 'first')
    const error = await createFileExclusive(project, marker, 'second').catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'write-failed' })
    expect((error as Error).message).toMatch(/EEXIST/)
    expect(await readFileNoFollow(project, marker, 1024)).toBe('first')
  })

  it('reads a missing file as null', async () => {
    expect(await readFileNoFollow(project, marker, 1024)).toBeNull()
  })

  it('reads a file over the cap as null', async () => {
    await createFileExclusive(project, marker, 'x'.repeat(11))
    expect(await readFileNoFollow(project, marker, 10)).toBeNull()
    expect(await readFileNoFollow(project, marker, 11)).toBe('x'.repeat(11))
  })

  itPosix('refuses to read through a link', async () => {
    await writeFile(join(outside, 'secret'), 'secret')
    await symlink(join(outside, 'secret'), join(project, ...marker), 'file')
    await expectRefusal(readFileNoFollow(project, marker, 1024), 'link', marker.join('/'))
  })
})

describe('guardDeleteTarget (ADR 0009 decision 11)', () => {
  beforeEach(async () => {
    await ensureBrowserFolder(project)
    await ensureProfileTree(project)
  })

  it('returns the path of a target under .erfana/browser', async () => {
    expect(await guardDeleteTarget(project, ['.erfana', 'browser', 'captures'])).toBe(
      join(project, '.erfana', 'browser', 'captures')
    )
    expect(await guardDeleteTarget(project, ['.erfana', 'browser'])).toBe(join(project, '.erfana', 'browser'))
  })

  it('returns null for a target that is gone', async () => {
    expect(await guardDeleteTarget(project, ['.erfana', 'browser', 'captures', 'gone.png'])).toBeNull()
  })

  it.each([
    [['.erfana']],
    [['.erfana', 'settings.json']],
    [['src']],
    [[]],
    [['.erfana', 'browser', '..', '..', 'src']],
    [['.erfana', 'browser', '.']],
    [['.erfana', 'browser', '']],
    [['.erfana', 'browser', 'a/b']],
    [['.erfana', 'browser', 'a\\b']],
    [['.erfana', 'browser', 'a:stream']],
    [['.erfana', 'browser', 'nul\0']],
    [['.erfana', 'browser', 'trailing.']],
    [['.erfana', 'browser', 'trailing ']],
    [['.Erfana', 'browser']]
  ])('refuses %j', async (segments) => {
    await expectRefusal(guardDeleteTarget(project, segments), 'invalid-path', segments.join('/'))
  })

  itPosix('025-AC-069 refuses a target reached through a symlinked captures folder', async () => {
    await rm(join(project, '.erfana', 'browser', 'captures'), { recursive: true })
    await writeFile(join(outside, 'old.png'), 'x')
    await symlink(outside, join(project, '.erfana', 'browser', 'captures'), 'dir')
    await expectRefusal(
      guardDeleteTarget(project, ['.erfana', 'browser', 'captures', 'old.png']),
      'link',
      '.erfana/browser/captures'
    )
    expect(await readdir(outside)).toEqual(['old.png'])
  })

  itPosix('refuses a target that is itself a link (links are left alone)', async () => {
    await symlink(join(outside), join(project, '.erfana', 'browser', 'captures', 'x.png'), 'file')
    await expectRefusal(
      guardDeleteTarget(project, ['.erfana', 'browser', 'captures', 'x.png']),
      'link',
      '.erfana/browser/captures/x.png'
    )
  })
})
