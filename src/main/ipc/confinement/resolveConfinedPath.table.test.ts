// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Table test for the path checker, rows 1-29.
 *
 * - POSIX rows run on a real temp tree with real links.
 * - Windows rows run the same function with `path.win32` and an in-memory file
 *   system built from output recorded on a Windows 11 host, so they run on every
 *   host.
 * - A `runIf(win32)` block repeats the drive, UNC, `subst`, 8.3 and junction rows
 *   on real disks (the advisory Windows job).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  isInsideRoot,
  resolveConfinedPath,
  type ConfinementContext,
  type ConfinementDeps,
  type ConfinementSession,
  type PathPolicy
} from './resolveConfinedPath'
import type { ConfinementErrorCode } from './ConfinementError'
import { createFakeConfinementFs, type FakeEntry } from '../__test-helpers__/fakeConfinementFs'

const project: PathPolicy = { mode: 'project' }
const entry: PathPolicy = { mode: 'project-entry' }

/** Resolves to the code the checker refused with, or 'ACCEPTED'. */
async function outcome(
  input: unknown,
  ctx: ConfinementContext,
  policy: PathPolicy,
  deps?: ConfinementDeps
): Promise<ConfinementErrorCode | 'ACCEPTED'> {
  try {
    await resolveConfinedPath(input, ctx, policy, deps)
    return 'ACCEPTED'
  } catch (error) {
    return (error as { code?: ConfinementErrorCode }).code ?? (String(error) as never)
  }
}

const sessionOf = (
  root: string,
  realRoot: string,
  over: Partial<ConfinementSession> = {}
): ConfinementSession => ({
  root,
  realRoot,
  caseSensitive: false,
  ownerWebContentsId: null,
  ...over
})

// ---------------------------------------------------------------------------
// Rows 1-10, 13, 14, 25: a real tree
// ---------------------------------------------------------------------------
describe.skipIf(process.platform === 'win32')('resolveConfinedPath – POSIX tree', () => {
  let base: string
  let root: string
  let outside: string
  let ctx: ConfinementContext

  beforeAll(() => {
    // Deliberately not realpath'd: on macOS the temp folder is reached through /var -> /private/var
    base = mkdtempSync(path.join(tmpdir(), 'erfana-table-'))
    root = path.join(base, 'proj')
    outside = path.join(base, 'outside')
    mkdirSync(path.join(root, 'sub'), { recursive: true })
    mkdirSync(path.join(base, 'proj-other'))
    mkdirSync(outside)
    writeFileSync(path.join(root, 'x.md'), 'x')
    writeFileSync(path.join(root, 'file.md'), 'x')
    writeFileSync(path.join(base, 'proj-other', 'x.md'), 'x')
    writeFileSync(path.join(outside, 'hosts'), 'secret')
    symlinkSync(path.join(outside, 'hosts'), path.join(root, 'link'))
    symlinkSync(outside, path.join(root, 'dirlink'))
    symlinkSync(path.join(root, 'sub'), path.join(base, 'alias'))
    ctx = {
      session: sessionOf(root, realpathSync.native(root), { caseSensitive: process.platform === 'linux' }),
      senderId: 1
    }
  })

  afterAll(() => {
    rmSync(base, { recursive: true, force: true })
  })

  const realRoot = (): string => ctx.session!.realRoot

  it('row 1: a file inside the project is accepted and acted on at its canonical path', async () => {
    const resolved = await resolveConfinedPath(path.join(root, 'x.md'), ctx, project)
    expect(resolved.real).toBe(path.join(realRoot(), 'x.md'))
    expect(resolved.requested).toBe(path.join(root, 'x.md'))
    expect(resolved.existed).toBe(true)
    expect(resolved.tail).toEqual([])
  })

  it('row 2: a sibling that only shares the name prefix is outside', async () => {
    expect(await outcome(path.join(base, 'proj-other', 'x.md'), ctx, project)).toBe('OUTSIDE_PROJECT')
  })

  it('row 3: a dot-dot segment that lands in the sibling is outside', async () => {
    expect(await outcome(`${root}/../proj-other/x`, ctx, project)).toBe('OUTSIDE_PROJECT')
  })

  it('row 4: the root is accepted, and refused where the root is forbidden', async () => {
    expect(await outcome(root, ctx, project)).toBe('ACCEPTED')
    expect(await outcome(root, ctx, { mode: 'project', allowRoot: false })).toBe('ROOT_FORBIDDEN')
    expect(await outcome(root, ctx, entry)).toBe('ROOT_FORBIDDEN')
    expect(await outcome(realRoot(), ctx, entry)).toBe('ROOT_FORBIDDEN')
  })

  it('row 5: a link inside the project that points outside is refused, for a file and a folder', async () => {
    expect(await outcome(path.join(root, 'link'), ctx, project)).toBe('OUTSIDE_PROJECT')
    expect(await outcome(path.join(root, 'dirlink'), ctx, project)).toBe('OUTSIDE_PROJECT')
  })

  it('row 6: for an entry, the link itself is the target and nothing outside is touched', async () => {
    const resolved = await resolveConfinedPath(path.join(root, 'link'), ctx, entry)
    expect(resolved.real).toBe(path.join(realRoot(), 'link'))
    expect(resolved.existed).toBe(true)
  })

  it('row 7: a missing file under a link that points outside is refused via the nearest ancestor', async () => {
    expect(await outcome(path.join(root, 'dirlink', 'new.md'), ctx, project)).toBe('OUTSIDE_PROJECT')
    expect(await outcome(path.join(root, 'dirlink', 'a', 'b', 'new.md'), ctx, project)).toBe('OUTSIDE_PROJECT')
  })

  it('row 8: a missing tail below an existing folder is accepted and reported', async () => {
    const missing = path.join(root, 'gone', 'deeper', 'new.md')
    const resolved = await resolveConfinedPath(missing, ctx, { mode: 'project', mustExist: false })
    expect(resolved.tail).toEqual(['gone', 'deeper', 'new.md'])
    expect(resolved.existed).toBe(false)
    expect(resolved.real).toBe(path.join(realRoot(), 'gone', 'deeper', 'new.md'))
    expect(await outcome(missing, ctx, { mode: 'project', mustExist: true })).toBe('NOT_FOUND')
  })

  it('row 9: a path below a file is not found', async () => {
    expect(await outcome(path.join(root, 'file.md', 'child'), ctx, project)).toBe('NOT_FOUND')
    expect(await outcome(path.join(root, 'file.md', 'a', 'b'), ctx, project)).toBe('NOT_FOUND')
  })

  it('row 10: a root reached through an alias keeps the spelling the caller used', async () => {
    const aliasCtx: ContextWithRoot = {
      session: sessionOf(path.join(base, 'alias'), realpathSync.native(path.join(root, 'sub')), {
        caseSensitive: process.platform === 'linux'
      }),
      senderId: 1
    }
    // Asked through the alias: requested keeps it, real is canonical
    const viaAlias = await resolveConfinedPath(path.join(base, 'alias', 'x'), aliasCtx, project)
    expect(viaAlias.requested).toBe(path.join(base, 'alias', 'x'))
    expect(viaAlias.real).toBe(path.join(realpathSync.native(path.join(root, 'sub')), 'x'))
    // Asked through the canonical spelling: also inside
    expect(await outcome(path.join(realpathSync.native(root), 'sub', 'x'), aliasCtx, project)).toBe('ACCEPTED')
    // A folder opened by its raw temp path (/var vs /private/var on macOS) still contains it
    const rawCtx: ContextWithRoot = { session: sessionOf(root, realpathSync.native(root)), senderId: 1 }
    expect(await outcome(path.join(realpathSync.native(root), 'x.md'), rawCtx, project)).toBe('ACCEPTED')
  })

  it('row 13: values that are not absolute paths are invalid, in every mode', async () => {
    const values = ['x.md', '', '\0', `${root}/a\0b`, `/${'a'.repeat(40_000)}`, 42, null, undefined, {}]
    for (const value of values) {
      for (const policy of [project, entry, { mode: 'external' } as PathPolicy]) {
        expect(await outcome(value, ctx, policy), String(value).slice(0, 20)).toBe('INVALID_PATH')
      }
    }
  })

  it('row 14: without a project, the project modes refuse; external does not need one', async () => {
    const none: ContextWithRoot = { session: null, senderId: 1 }
    expect(await outcome(path.join(root, 'x.md'), none, project)).toBe('NO_PROJECT')
    expect(await outcome(path.join(root, 'x.md'), none, entry)).toBe('NO_PROJECT')
    expect(await outcome(path.join(root, 'x.md'), none, { mode: 'external' })).toBe('ACCEPTED')
  })

  it('row 25: a window that does not own the project is refused', async () => {
    const owned: ContextWithRoot = { session: { ...ctx.session!, ownerWebContentsId: 7 }, senderId: 8 }
    expect(await outcome(path.join(root, 'x.md'), owned, project)).toBe('NOT_SESSION_OWNER')
    expect(await outcome(path.join(root, 'x.md'), { ...owned, senderId: 7 }, project)).toBe('ACCEPTED')
    // A project opened without a window has no owner to compare with
    expect(await outcome(path.join(root, 'x.md'), { session: ctx.session, senderId: 99 }, project)).toBe(
      'ACCEPTED'
    )
  })

  it('a link whose target is missing is not acted on (project) but can be removed (entry)', async () => {
    const dangling = path.join(root, 'dangling')
    symlinkSync(path.join(outside, 'not-there'), dangling)
    expect(await outcome(dangling, ctx, project)).toBe('UNVERIFIABLE')
    expect(await outcome(dangling, ctx, entry)).toBe('ACCEPTED')
  })

  it('kind and existence policies', async () => {
    expect(await outcome(path.join(root, 'sub'), ctx, { mode: 'project', kind: 'directory' })).toBe('ACCEPTED')
    expect(await outcome(path.join(root, 'x.md'), ctx, { mode: 'project', kind: 'directory' })).toBe('WRONG_KIND')
    expect(await outcome(path.join(root, 'sub'), ctx, { mode: 'project', kind: 'file' })).toBe('WRONG_KIND')
    expect(await outcome(path.join(root, 'nope'), ctx, { mode: 'project', kind: 'file' })).toBe('ACCEPTED')
    expect(await outcome(path.join(root, 'nope'), ctx, { mode: 'project', mustExist: true })).toBe('NOT_FOUND')
    expect(await outcome(path.join(root, 'nope'), ctx, { mode: 'project-entry', mustExist: true })).toBe(
      'NOT_FOUND'
    )
  })

  it('the external escape check refuses only a path that looks inside and resolves out', async () => {
    const escape: PathPolicy = { mode: 'external', check: 'escape' }
    expect(await outcome(path.join(root, 'link'), ctx, escape)).toBe('OUTSIDE_PROJECT')
    expect(await outcome(path.join(root, 'x.md'), ctx, escape)).toBe('ACCEPTED')
    expect(await outcome(path.join(root, 'missing.md'), ctx, escape)).toBe('ACCEPTED')
    expect(await outcome(path.join(outside, 'hosts'), ctx, escape)).toBe('ACCEPTED')
    expect(await outcome(path.join(root, 'link'), { session: null }, escape)).toBe('ACCEPTED')
  })

  it('the project folder being gone is named as such, not as "outside"', async () => {
    const gone = path.join(realpathSync.native(base), 'vanished')
    const goneCtx: ContextWithRoot = { session: sessionOf(gone, gone), senderId: 1 }
    try {
      await resolveConfinedPath(path.join(gone, 'docs', 'a.md'), goneCtx, project)
      expect.unreachable()
    } catch (error) {
      expect((error as { code: string }).code).toBe('NOT_FOUND')
      expect((error as Error).message).toBe('The project folder no longer exists')
    }
  })

  it('does not read the outside path: refusals do not depend on whether it exists', async () => {
    const existing = await outcome(path.join(outside, 'hosts'), ctx, project)
    const missing = await outcome(path.join(outside, 'no-such-file'), ctx, project)
    expect(existing).toBe('OUTSIDE_PROJECT')
    expect(missing).toBe(existing)
  })
})

type ContextWithRoot = ConfinementContext

// ---------------------------------------------------------------------------
// Rows 11, 12: letter case, on a fake file system
// ---------------------------------------------------------------------------
describe('resolveConfinedPath – letter case (POSIX path flavour)', () => {
  const entries: Record<string, FakeEntry> = {
    '/': 'dir',
    '/A': 'dir',
    '/A/Proj': 'dir',
    '/A/Proj/x': 'file'
  }

  it('row 11: a case-insensitive volume matches the root in another case', async () => {
    const deps: ConfinementDeps = {
      fs: createFakeConfinementFs(path.posix, entries, true),
      path: path.posix,
      platform: 'darwin'
    }
    const ctx = { session: sessionOf('/A/Proj', '/A/Proj', { caseSensitive: false }), senderId: 1 }
    const resolved = await resolveConfinedPath('/a/proj/x', ctx, project, deps)
    expect(resolved.real).toBe('/A/Proj/x')
    expect(resolved.requested).toBe('/a/proj/x')
  })

  it('row 12: a case-sensitive probe treats the other case as another folder', async () => {
    const deps: ConfinementDeps = {
      fs: createFakeConfinementFs(path.posix, entries, false),
      path: path.posix,
      platform: 'linux'
    }
    const ctx = { session: sessionOf('/A/Proj', '/A/Proj', { caseSensitive: true }), senderId: 1 }
    expect(await outcome('/a/proj/x', ctx, project, deps)).toBe('OUTSIDE_PROJECT')
  })

  it('on macOS a decomposed and a composed spelling of a name compare equal', () => {
    const deps: ConfinementDeps = {
      fs: createFakeConfinementFs(path.posix, {}, true),
      path: path.posix,
      platform: 'darwin'
    }
    expect(isInsideRoot('/A/cafe\u0301/x', '/A/caf\u00e9', false, deps)).toBe(true)
    expect(isInsideRoot('/A/cafe\u0301/x', '/A/caf\u00e9', true, deps)).toBe(true)
    expect(isInsideRoot('/A/cafe\u0301/x', '/A/caf\u00e9', true, { ...deps, platform: 'linux' })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Rows 15-23, 26-29: Windows, on a fake file system built from recorded output
// ---------------------------------------------------------------------------
describe('resolveConfinedPath – Windows', () => {
  const win = (entries: Record<string, FakeEntry>): ConfinementDeps => ({
    fs: createFakeConfinementFs(path.win32, entries, true),
    path: path.win32,
    platform: 'win32'
  })
  const ctxFor = (root: string, realRoot: string = root, over: Partial<ConfinementSession> = {}) => ({
    session: sessionOf(root, realRoot, over),
    senderId: 1
  })

  const cDrive = win({
    'C:\\': 'dir',
    'C:\\p': 'dir',
    'C:\\p\\x.md': 'file',
    'C:\\p-other': 'dir',
    'C:\\p-other\\x': 'file',
    'D:\\': 'dir',
    'D:\\x': 'file'
  })

  it('row 15: the drive letter and folder names compare without regard to case', async () => {
    const resolved = await resolveConfinedPath('c:\\P\\x.md', ctxFor('C:\\p'), project, cDrive)
    expect(resolved.real).toBe('C:\\p\\x.md')
    expect(resolved.requested).toBe('c:\\P\\x.md')
  })

  it('row 16: a sibling that shares the name prefix is outside', async () => {
    expect(await outcome('C:\\p-other\\x', ctxFor('C:\\p'), project, cDrive)).toBe('OUTSIDE_PROJECT')
  })

  it('row 17: device and namespace prefixes are invalid, with either separator', async () => {
    const values = [
      '\\\\?\\C:\\p\\x',
      '\\\\.\\C:\\p\\x',
      '\\??\\C:\\p\\x',
      '//?/C:/p/x',
      '//./C:/p/x',
      '/??/C:/p/x',
      '\\\\?\\UNC\\srv\\share\\p'
    ]
    for (const value of values) {
      for (const policy of [project, entry, { mode: 'external' } as PathPolicy]) {
        expect(await outcome(value, ctxFor('C:\\p'), policy, cDrive), value).toBe('INVALID_PATH')
      }
    }
  })

  it('row 18: drive-relative paths, alternate streams and trailing dots or spaces are invalid', async () => {
    const values = [
      'C:p\\x',
      'C:',
      '\\p\\x',
      'C:\\p\\x.md:stream',
      'C:\\p\\a:b\\c',
      'C:\\p\\x.',
      'C:\\p\\x ',
      'C:\\p\\sub.\\x',
      'C:\\p\\sub \\x'
    ]
    for (const value of values) {
      for (const policy of [project, entry, { mode: 'external' } as PathPolicy]) {
        expect(await outcome(value, ctxFor('C:\\p'), policy, cDrive), value).toBe('INVALID_PATH')
      }
    }
    // Dot segments themselves are collapsed, not refused
    expect(await outcome('C:\\p\\.\\x.md', ctxFor('C:\\p'), project, cDrive)).toBe('ACCEPTED')
    expect(await outcome('C:\\p\\sub\\..\\x.md', ctxFor('C:\\p'), project, cDrive)).toBe('ACCEPTED')
  })

  it('row 19: forward slashes are the same path', async () => {
    const resolved = await resolveConfinedPath('C:/p/x.md', ctxFor('C:\\p'), project, cDrive)
    expect(resolved.requested).toBe('C:\\p\\x.md')
    expect(resolved.real).toBe('C:\\p\\x.md')
  })

  describe('row 20: a UNC share', () => {
    const unc = win({
      '\\\\srv\\share\\': 'dir',
      '\\\\srv\\share\\p': 'dir',
      '\\\\srv\\share\\p\\x': 'file',
      '\\\\srv\\share\\q': 'dir',
      '\\\\srv\\other\\': 'dir',
      '\\\\srv\\other\\p': 'dir'
    })
    const ctx = ctxFor('\\\\srv\\share\\p')

    it('accepts inside, refuses another folder and another share', async () => {
      expect(await outcome('\\\\srv\\share\\p\\x', ctx, project, unc)).toBe('ACCEPTED')
      expect(await outcome('\\\\srv\\share\\q', ctx, project, unc)).toBe('OUTSIDE_PROJECT')
      expect(await outcome('\\\\srv\\other\\p', ctx, project, unc)).toBe('OUTSIDE_PROJECT')
    })

    it('refuses a UNC path without a share', async () => {
      expect(await outcome('\\\\srv', ctx, project, unc)).toBe('INVALID_PATH')
      expect(await outcome('\\\\srv\\', ctx, project, unc)).toBe('INVALID_PATH')
    })
  })

  it('row 21: a subst drive keeps its spelling in requested and resolves to its target in real', async () => {
    const subst = win({
      'D:\\': 'dir',
      'D:\\real': 'dir',
      'D:\\real\\p': 'dir',
      'D:\\real\\p\\x': 'file',
      'Z:\\': { alias: 'D:\\real' }
    })
    const ctx = ctxFor('Z:\\p', 'D:\\real\\p')
    const resolved = await resolveConfinedPath('Z:\\p\\x', ctx, project, subst)
    expect(resolved.requested).toBe('Z:\\p\\x')
    expect(resolved.real).toBe('D:\\real\\p\\x')
    // The canonical spelling of the same folder is inside as well
    expect(await outcome('D:\\real\\p\\x', ctx, project, subst)).toBe('ACCEPTED')
  })

  it('row 22: a drive root as the project has no doubled separator and excludes other drives', async () => {
    const ctx = ctxFor('C:\\')
    expect(await outcome('C:\\x', ctx, project, win({ 'C:\\': 'dir', 'C:\\x': 'file', 'D:\\': 'dir', 'D:\\x': 'file' }))).toBe(
      'ACCEPTED'
    )
    expect(await outcome('D:\\x', ctx, project, cDrive)).toBe('OUTSIDE_PROJECT')
  })

  it('row 23: a name that cannot be created on Windows is invalid below a missing folder', async () => {
    const ctx = ctxFor('C:\\p')
    for (const name of ['CON', 'aux.md', 'NUL.txt', 'COM1', 'lpt9.md', 'a<b', 'a|b', 'a?b']) {
      expect(await outcome(`C:\\p\\gone\\${name}`, ctx, project, cDrive), name).toBe('INVALID_PATH')
    }
    expect(await outcome('C:\\p\\gone\\ok.md', ctx, project, cDrive)).toBe('ACCEPTED')
  })

  it('row 26: a project opened by its short 8.3 name accepts the long-name spelling', async () => {
    const shortName = win({
      'C:\\': 'dir',
      'C:\\Users': 'dir',
      'C:\\Users\\Name': 'dir',
      'C:\\Users\\Name\\p': 'dir',
      'C:\\Users\\Name\\p\\x': 'file',
      'C:\\Users\\NAME~1': { alias: 'C:\\Users\\Name' }
    })
    const ctx = ctxFor('C:\\Users\\NAME~1\\p', 'C:\\Users\\Name\\p')
    expect(await outcome('C:\\Users\\Name\\p\\x', ctx, project, shortName)).toBe('ACCEPTED')
    const viaShort = await resolveConfinedPath('C:\\Users\\NAME~1\\p\\x', ctx, project, shortName)
    expect(viaShort.requested).toBe('C:\\Users\\NAME~1\\p\\x')
    expect(viaShort.real).toBe('C:\\Users\\Name\\p\\x')
  })

  it('row 27: a mapped network drive resolves to its UNC form and requested keeps the drive', async () => {
    const mapped = win({
      '\\\\host\\share\\': 'dir',
      '\\\\host\\share\\p': 'dir',
      '\\\\host\\share\\p\\x': 'file',
      'Z:\\': { alias: '\\\\host\\share\\' }
    })
    const ctx = ctxFor('Z:\\p', '\\\\host\\share\\p')
    const resolved = await resolveConfinedPath('Z:\\p\\x', ctx, project, mapped)
    expect(resolved.requested).toBe('Z:\\p\\x')
    expect(resolved.real).toBe('\\\\host\\share\\p\\x')
  })

  it('row 28: a junction inside the project that leads outside is refused, and is itself an entry', async () => {
    const junction = win({
      'C:\\': 'dir',
      'C:\\p': 'dir',
      'C:\\p\\jn': { link: 'C:\\outside' },
      'C:\\outside': 'dir',
      'C:\\outside\\secret.txt': 'file'
    })
    const ctx = ctxFor('C:\\p')
    expect(await outcome('C:\\p\\jn\\new.txt', ctx, project, junction)).toBe('OUTSIDE_PROJECT')
    expect(await outcome('C:\\p\\jn\\secret.txt', ctx, project, junction)).toBe('OUTSIDE_PROJECT')
    expect(await outcome('C:\\p\\jn', ctx, project, junction)).toBe('OUTSIDE_PROJECT')
    const asEntry = await resolveConfinedPath('C:\\p\\jn', ctx, entry, junction)
    expect(asEntry.real).toBe('C:\\p\\jn')
    expect(asEntry.existed).toBe(true)
  })

  it('row 29: the host and share of a UNC path keep the typed case, and still compare equal', async () => {
    const localhost = win({
      '\\\\localhost\\C$\\': 'dir',
      '\\\\localhost\\C$\\p': 'dir',
      '\\\\localhost\\C$\\p\\x': 'file'
    })
    const ctx = ctxFor('\\\\localhost\\C$\\p')
    const resolved = await resolveConfinedPath('\\\\LOCALHOST\\c$\\p\\x', ctx, project, localhost)
    expect(resolved.requested).toBe('\\\\LOCALHOST\\c$\\p\\x')
    expect(resolved.real).toBe('\\\\LOCALHOST\\c$\\p\\x')
  })

  it('a missing path on the walk up to the drive root is outside, never inside', async () => {
    expect(await outcome('C:\\nowhere\\at\\all.md', ctxFor('C:\\p'), project, win({ 'C:\\': 'dir' }))).toBe(
      'OUTSIDE_PROJECT'
    )
  })

  it('extended-length prefixes in realpath output are stripped before the compare', async () => {
    const base = win({ 'C:\\': 'dir', 'C:\\p': 'dir', 'C:\\p\\x': 'file' })
    const prefixed: ConfinementDeps = {
      ...base,
      fs: { ...base.fs, realpath: async (target) => `\\\\?\\${await base.fs.realpath(target)}` }
    }
    expect(await outcome('C:\\p\\x', ctxFor('C:\\p'), project, prefixed)).toBe('ACCEPTED')
    const prefixedUnc: ConfinementDeps = {
      ...base,
      fs: { ...base.fs, realpath: async () => '\\\\?\\UNC\\srv\\share\\p\\x' }
    }
    expect(await outcome('C:\\p\\x', ctxFor('\\\\srv\\share\\p'), project, prefixedUnc)).toBe('ACCEPTED')
  })
})

// ---------------------------------------------------------------------------
// Real disks on Windows: drive, UNC, subst, 8.3, junction (advisory Windows job)
// ---------------------------------------------------------------------------
describe.runIf(process.platform === 'win32')('resolveConfinedPath – Windows real disks', () => {
  let base: string
  let root: string
  let outside: string
  let substLetter = ''

  beforeAll(() => {
    base = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'erfana-table-win-')))
    root = path.join(base, 'Proj')
    outside = path.join(base, 'outside')
    mkdirSync(path.join(root, 'Sub'), { recursive: true })
    mkdirSync(outside)
    writeFileSync(path.join(root, 'Sub', 'x.md'), 'x')
    writeFileSync(path.join(outside, 'secret.txt'), 'secret')
  })

  afterAll(() => {
    // Always drop the mapping, even when the test failed half-way
    if (substLetter) {
      try {
        execFileSync('subst', [substLetter, '/d'], { stdio: 'ignore' })
      } catch {
        // already removed
      }
    }
    rmSync(base, { recursive: true, force: true })
  })

  const ctx = (): ConfinementContext => ({ session: sessionOf(root, root), senderId: 1 })

  it('drive: letter case of the drive and folders does not matter', async () => {
    const swapped = root.replace(/^[A-Za-z]/, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()))
    const upper = path.join(swapped.toUpperCase(), 'SUB', 'X.MD')
    expect(await outcome(upper, ctx(), project)).toBe('ACCEPTED')
    expect(await outcome(path.join(base, 'Proj-other', 'x'), ctx(), project)).toBe('OUTSIDE_PROJECT')
  })

  it('drive: forward slashes and device prefixes', async () => {
    expect(await outcome(path.join(root, 'Sub', 'x.md').replace(/\\/g, '/'), ctx(), project)).toBe('ACCEPTED')
    expect(await outcome(`\\\\?\\${path.join(root, 'Sub', 'x.md')}`, ctx(), project)).toBe('INVALID_PATH')
  })

  it('UNC: a project opened on the administrative share keeps that form, and a drive root does not contain it', async (testContext) => {
    const unc = `\\\\localhost\\${root[0]}$${root.slice(2)}`
    let uncReal = ''
    try {
      uncReal = await realpath(unc)
    } catch {
      testContext.skip()
    }
    // Node keeps the UNC form (host and share as typed); it does not map back to the drive
    const uncCtx: ConfinementContext = { session: sessionOf(unc, uncReal), senderId: 1 }
    expect(await outcome(path.join(unc, 'Sub', 'x.md'), uncCtx, project)).toBe('ACCEPTED')
    expect(await outcome(path.join(unc.replace('localhost', 'LOCALHOST'), 'Sub'), uncCtx, project)).toBe('ACCEPTED')
    // A project on the drive form does not contain the same folder spelled as UNC
    expect(await outcome(path.join(unc, 'Sub', 'x.md'), ctx(), project)).toBe('OUTSIDE_PROJECT')
  })

  it('subst: a substituted drive resolves to its target and requested keeps the drive', async () => {
    // First drive letter that is not in use; there is no skip, a host with none free fails
    const free = 'ZYXWVUTSRQPONMLKJIHGFED'.split('').find((l) => !existsSync(`${l}:\\`))
    expect(free, 'no free drive letter for subst').toBeDefined()
    const letter = `${free}:`
    execFileSync('subst', [letter, base], { stdio: 'ignore' })
    substLetter = letter
    const substRoot = `${letter}\\Proj`
    const substCtx: ConfinementContext = {
      session: sessionOf(substRoot, await realpath(substRoot)),
      senderId: 1
    }
    const resolved = await resolveConfinedPath(`${substRoot}\\Sub\\x.md`, substCtx, project)
    expect(resolved.requested).toBe(`${substRoot}\\Sub\\x.md`)
    expect(resolved.real).toBe(path.join(root, 'Sub', 'x.md'))
  })

  it('8.3: a project opened by its short name accepts the long spelling', async (testContext) => {
    // The runner's temp folder is usually reached through a short name (RUNNER~1)
    if (!tmpdir().includes('~')) testContext.skip()
    const shortRoot = mkdtempSync(path.join(tmpdir(), 'erfana-83-folder-'))
    try {
      mkdirSync(path.join(shortRoot, 'Sub'))
      writeFileSync(path.join(shortRoot, 'Sub', 'x.md'), 'x')
      const longRoot = await realpath(shortRoot)
      expect(longRoot.includes('~')).toBe(false)
      const shortCtx: ConfinementContext = { session: sessionOf(shortRoot, longRoot), senderId: 1 }
      expect(await outcome(path.join(longRoot, 'Sub', 'x.md'), shortCtx, project)).toBe('ACCEPTED')
      expect(await outcome(path.join(shortRoot, 'Sub', 'x.md'), shortCtx, project)).toBe('ACCEPTED')
    } finally {
      rmSync(shortRoot, { recursive: true, force: true })
    }
  })

  it('junction: a junction to a folder outside is refused for content and kept literal for an entry', async (testContext) => {
    const junction = path.join(root, 'jn')
    try {
      symlinkSync(outside, junction, 'junction')
    } catch {
      testContext.skip()
    }
    expect(await outcome(path.join(junction, 'new.txt'), ctx(), project)).toBe('OUTSIDE_PROJECT')
    expect(await outcome(path.join(junction, 'secret.txt'), ctx(), project)).toBe('OUTSIDE_PROJECT')
    const asEntry = await resolveConfinedPath(junction, ctx(), entry)
    expect(asEntry.real).toBe(junction)
  })

  it('names that Win32 would trim or reinterpret are refused before any disk access', async () => {
    for (const name of ['t.', 'u ', 'CON', 'aux.md', 'x.md:stream']) {
      expect(await outcome(path.join(root, 'Sub', name), ctx(), project), name).toBe('INVALID_PATH')
    }
  })
})
