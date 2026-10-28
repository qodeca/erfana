// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Where a comment may be written (docs/designs/comments/html-preview-comments.md §7.6
 * step 1, decision 35, threats S8, S11, S12; M-009, M-010, M-063, SEC-10;
 * security review F1, F7 and its path-form gaps).
 * Every refusal leaves every byte of every file involved unchanged.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { link, mkdir, readdir, stat, symlink } from 'node:fs/promises'
import { basename, dirname, join, sep } from 'node:path'
import { ErrorCode } from '../../../../shared/errors'
import { fileIdKey, fileIdOf } from '../../../utils/atomicWriteBytesStrict'
import {
  PAGE,
  VIEW,
  blocksOf,
  byId,
  draftFor,
  isCaseInsensitive,
  makeProject,
  makeWriter,
  snapshot,
  tempDiskIsCaseInsensitive,
  type TempProject
} from './__test-helpers__/commentWriterHarness'
import { commentFileLock } from './commentFileLock'
import type { CommentWriter, CommentWriteResult, CommentWriterDeps } from './CommentWriter'

const isWindows = process.platform === 'win32'
const CASE_INSENSITIVE = await tempDiskIsCaseInsensitive()
/** U+212A KELVIN SIGN: `toLowerCase` folds it to `k`; NTFS and ext4 keep it apart, APFS folds it too. */
const KELVIN = String.fromCharCode(0x212a)

let project: TempProject
let outside: TempProject

beforeEach(async () => {
  project = await makeProject()
  outside = await makeProject('erfana-comments-outside-')
})

afterEach(async () => {
  await project.dispose()
  await outside.dispose()
})

const DRAFT = draftFor(Buffer.from(PAGE), byId('buy'))

function addAt(filePath: string, deps: Partial<CommentWriterDeps> = {}, writer?: CommentWriter): Promise<CommentWriteResult> {
  return (writer ?? makeWriter(deps).writer).add({
    file: { realRoot: project.root, filePath },
    draft: DRAFT,
    view: VIEW,
    text: 'x'
  })
}

const refusedPath = (reason: string): CommentWriteResult => ({
  ok: false,
  code: ErrorCode.COMMENT_PATH_REFUSED,
  reason: reason as never
})

describe('M-009 confinement', () => {
  it('M-009 a file outside the project, and a `..` climb out of it, are refused before anything is read', async () => {
    const elsewhere = await outside.write('page.html', PAGE)
    const before = await snapshot(elsewhere)
    const climb = `${project.root}${sep}sub${sep}..${sep}..${sep}${basename(outside.root)}${sep}page.html`

    expect(await addAt(elsewhere)).toEqual(refusedPath('outside-project'))
    expect(await addAt(climb)).toEqual(refusedPath('outside-project'))
    expect(await snapshot(elsewhere)).toEqual(before)
  })

  it('M-009 a folder link that leads out of the project is refused; the file behind it is untouched', async () => {
    const elsewhere = await outside.write('page.html', PAGE)
    const before = await snapshot(elsewhere)
    await symlink(outside.root, project.path('linkdir'), 'junction')

    expect(await addAt(project.path('linkdir', 'page.html'))).toEqual(refusedPath('outside-project'))
    expect(await snapshot(elsewhere)).toEqual(before)
  })

  it('M-009 an 8.3 short-name segment and a UNC path are refused (Windows rules, any host)', async () => {
    const shortName = await addAt(project.path('PROGRA~1', 'index.html'), { platform: 'win32' })
    const unc = await addAt('\\\\attacker.example\\share\\index.html', { platform: 'win32' })

    expect(shortName).toEqual(refusedPath('short-name'))
    // A UNC path is absolute only to the Windows path module; elsewhere it is not even a path
    expect(unc).toEqual(refusedPath(isWindows ? 'outside-project' : 'not-absolute'))
  })

  it('M-009 the Windows device prefixes \\\\?\\ and \\\\.\\ never reach the project, nothing is read', async () => {
    await project.write('index.html', PAGE)
    const before = await snapshot(project.path('index.html'))

    for (const prefix of ['\\\\?\\', '\\\\.\\']) {
      const result = await addAt(`${prefix}${project.path('index.html')}`, { platform: 'win32' })
      expect(result).toEqual(refusedPath(isWindows ? 'outside-project' : 'not-absolute'))
    }
    expect(await snapshot(project.path('index.html'))).toEqual(before)
  })

  it('M-009 a Windows path rooted without a drive (\\proj\\a.html) is not absolute, though it would land on the project', async () => {
    await project.write('index.html', PAGE)
    const before = await snapshot(project.path('index.html'))
    // On Windows: the project's own file, minus its drive – resolved against the current drive it IS the file
    const rooted = isWindows ? project.path('index.html').slice(2) : '\\proj\\index.html'

    expect(await addAt(rooted, { platform: 'win32' })).toEqual(refusedPath('not-absolute'))
    expect(await snapshot(project.path('index.html'))).toEqual(before)
  })

  it('M-009 `node_modules.` never reaches the real `node_modules` file', async () => {
    await mkdir(project.path('node_modules'))
    const real = await project.write(join('node_modules', 'x.html'), PAGE)
    const before = await snapshot(real)

    const result = await addAt(project.path('node_modules.', 'x.html'), { platform: 'win32' })

    // Win32 path rules would drop the trailing dot, but Node's file calls pass the name through as
    // written (realpath, lstat and stat all answer ENOENT on Windows), so it is another, missing folder
    expect(result).toEqual({ ok: false, code: ErrorCode.COMMENT_FILE_GONE, reason: 'missing' })
    expect(await snapshot(real)).toEqual(before)
  })

  it('M-009 `index.html::$DATA` names a stream, and is refused as one (Windows rule, any host)', async () => {
    const main = await project.write('index.html', PAGE)
    const before = await snapshot(main)

    expect(await addAt(`${main}::$DATA`, { platform: 'win32' })).toEqual(refusedPath('alternate-stream'))
    expect(await snapshot(main)).toEqual(before)
  })

  // APFS case-folds U+212A to `k`, so there the two folders below are one
  it.skipIf(process.platform === 'darwin')(
    'M-009 a sibling folder that only case-folds to the root (proj + KELVIN SIGN vs projk) is outside the project',
    async () => {
      const root = outside.path('projk')
      const sibling = outside.path(`proj${KELVIN}`)
      await mkdir(root)
      await mkdir(sibling)
      const page = await outside.write(join(`proj${KELVIN}`, 'page.html'), PAGE)
      const before = await snapshot(page)
      const job = { file: { realRoot: root, filePath: page }, draft: DRAFT, view: VIEW, text: 'x' }

      // Windows and macOS rules fold case as JavaScript does, so on every host `proj` + KELVIN passes
      // their lexical root check for `projk`, and its part below the root is `page.html` (§19 Rev 4:
      // cut under the same rule, never by the host's `path.relative`). The disk keeps the two folders
      // apart, so the realpath steps (rule 4) refuse it as outside the project. Exact rules (Linux)
      // refuse it at the lexical check. Rule 4's exact compare alone, on every host:
      // commentFileAccess.containment.test.ts.
      for (const platform of ['win32', 'darwin', 'linux'] as const) {
        expect(await makeWriter({ platform }).writer.add(job), platform).toEqual(refusedPath('outside-project'))
      }
      expect(await snapshot(page)).toEqual(before)
      expect(await readdir(sibling)).toEqual(['page.html'])
    }
  )

  it('F7 a path no file-system call accepts is refused as an I/O failure, never thrown', async () => {
    const result = await addAt(42 as unknown as string)

    expect(result).toEqual({ ok: false, code: ErrorCode.COMMENT_WRITE_FAILED, reason: 'io' })
  })

  it('M-009 the lexical root check compares exactly on Linux and ignores case on Windows and macOS', async () => {
    const variantRoot = join(dirname(project.root), basename(project.root).toUpperCase())
    await project.write('linux.html', PAGE)

    expect(await addAt(join(variantRoot, 'linux.html'), { platform: 'linux' })).toEqual(refusedPath('outside-project'))
    // Windows and macOS rules pass it lexically and leave the verdict to the realpath step: on a
    // case-insensitive disk the root's own folder, written under its on-disk spelling; on a
    // case-sensitive one a folder that does not exist. Never excluded (§19 Rev 4) and never outside.
    // The same rows on a simulated case-insensitive disk, every host: commentFileAccess.caseVariant.test.ts
    for (const platform of ['darwin', 'win32'] as const) {
      // One file per rule set: each writer starts its id source afresh, so a second save on one
      // file would repeat the first thread id
      const name = `${platform}.html`
      await project.write(name, PAGE)

      const result = await addAt(join(variantRoot, name), { platform })

      if (CASE_INSENSITIVE) {
        expect(result, platform).toMatchObject({ ok: true, realPath: project.path(name) })
      } else {
        expect(result, platform).toEqual({ ok: false, code: ErrorCode.COMMENT_FILE_GONE, reason: 'missing' })
      }
      expect(blocksOf(await project.read(name)), platform).toHaveLength(CASE_INSENSITIVE ? 1 : 0)
    }
    expect((await readdir(project.root)).sort()).toEqual(['darwin.html', 'linux.html', 'win32.html'])
    expect((await project.read('linux.html')).toString('utf8')).toBe(PAGE)
  })

  it('§19 Rev 4 a path naming the project root in another letter case is written under the on-disk spelling (real case-insensitive disk, host rules)', async ctx => {
    ctx.skip(!CASE_INSENSITIVE, 'the temp folder is on a case-sensitive disk: a case variant of the root is another, missing folder')
    await project.write('index.html', PAGE)

    const result = await addAt(join(dirname(project.root), basename(project.root).toUpperCase(), 'index.html'))

    expect(result).toMatchObject({ ok: true, realPath: project.path('index.html') })
    expect(await readdir(project.root)).toEqual(['index.html'])
    expect(blocksOf(await project.read('index.html'))).toHaveLength(1)
  })

  it('M-009 a case variant of a project file: written under the on-disk spelling (Windows, macOS), a missing file on a case-sensitive disk', async () => {
    await project.write('index.html', PAGE)
    const insensitive = await isCaseInsensitive(project.root)

    const result = await addAt(project.path('INDEX.HTML'))

    if (insensitive) {
      expect(result).toMatchObject({ ok: true, realPath: project.path('index.html') })
      expect(await readdir(project.root)).toEqual(['index.html'])
      expect(blocksOf(await project.read('index.html'))).toHaveLength(1)
    } else {
      expect(result).toEqual({ ok: false, code: ErrorCode.COMMENT_FILE_GONE, reason: 'missing' })
      expect((await project.read('index.html')).toString('utf8')).toBe(PAGE)
    }
  })
})

describe('M-010 frames whose content is not a project file', () => {
  it.each([
    'about:srcdoc',
    'about:blank',
    'https://example.com/page.html',
    'data:text/html,<p>x</p>',
    'blob:erfana-preview://token/0b7c5e3a',
    'erfana-preview://token/index.html',
    'index.html'
  ])('M-010 %s is not a file path and is refused main-side', async filePath => {
    expect(await addAt(filePath)).toEqual(refusedPath('not-absolute'))
  })
})

describe('M-063 case-sensitive disks', () => {
  // One file on Windows and macOS; the KeyedAsyncLock tests cover the keys there
  it.skipIf(CASE_INSENSITIVE)('M-063 Index.html and index.html are two files with two locks: a held save on one does not block the other', async () => {
    await project.write('Index.html', PAGE)
    await project.write('index.html', PAGE)
    let release!: () => void
    const held = new Promise<void>(resolve => {
      release = resolve
    })
    const { writer } = makeWriter({
      hasUnsavedSource: async realPath => {
        if (basename(realPath) === 'Index.html') await held
        return false
      }
    })

    const upper = addAt(project.path('Index.html'), {}, writer)
    await vi.waitFor(() => expect(commentFileLock.queued(project.path('Index.html'))).toBe(1))
    const lower = await addAt(project.path('index.html'), {}, writer)

    expect(lower).toMatchObject({ ok: true, realPath: project.path('index.html') })
    expect((await project.read('Index.html')).toString('utf8')).toBe(PAGE)
    release()
    expect(await upper).toMatchObject({ ok: true, realPath: project.path('Index.html') })
  })
})

describe('F6 lock keys', () => {
  it("F6 a save holds the lock for the file's real path and for its dev:ino, and frees both", async () => {
    const path = await project.write('index.html', PAGE)
    const idKey = fileIdKey(fileIdOf(await stat(path, { bigint: true })))
    let release!: () => void
    const held = new Promise<void>(resolve => {
      release = resolve
    })
    const { writer } = makeWriter({
      hasUnsavedSource: async () => {
        await held
        return false
      }
    })

    const save = addAt(path, {}, writer)
    await vi.waitFor(() => expect([commentFileLock.queued(path), commentFileLock.queued(idKey)]).toEqual([1, 1]))
    release()

    expect(await save).toMatchObject({ ok: true, realPath: path })
    expect([commentFileLock.queued(path), commentFileLock.queued(idKey)]).toEqual([0, 0])
  })
})

describe('SEC-10 refused targets keep every byte', () => {
  it('SEC-10 a symlink inside the project, and one leading out of it', async () => {
    const real = await project.write('real.html', PAGE)
    const elsewhere = await outside.write('real.html', PAGE)
    await symlink(real, project.path('in.html'), 'file')
    await symlink(elsewhere, project.path('out.html'), 'file')
    const before = [await snapshot(real), await snapshot(elsewhere)]

    expect(await addAt(project.path('in.html'))).toEqual({
      ok: false,
      code: ErrorCode.COMMENT_WRITE_REFUSED_LINK,
      reason: 'link'
    })
    expect(await addAt(project.path('out.html'))).toEqual(refusedPath('outside-project'))
    expect([await snapshot(real), await snapshot(elsewhere)]).toEqual(before)
  })

  it('SEC-10 a hard-linked file, under either of its names', async () => {
    const a = await project.write('a.html', PAGE)
    await link(a, project.path('b.html'))
    const before = await snapshot(a)

    for (const name of ['a.html', 'b.html']) {
      expect(await addAt(project.path(name))).toEqual({
        ok: false,
        code: ErrorCode.COMMENT_WRITE_REFUSED_LINK,
        reason: 'link'
      })
    }
    expect(await snapshot(a)).toEqual(before)
  })

  it('SEC-10 an NTFS alternate data stream name (Windows rule, any host)', async () => {
    const main = await project.write('index.html', PAGE)
    const before = await snapshot(main)

    const result = await addAt(`${main}:hidden.html`, { platform: 'win32' })

    expect(result).toEqual(refusedPath('alternate-stream'))
    expect(await snapshot(main)).toEqual(before)
  })

  it.each([
    ['node_modules', ['node_modules', 'pkg', 'page.html']],
    ['dist', ['dist', 'page.html']],
    ['a dot-folder', ['.hidden', 'page.html']],
    ['a dot-file', ['.page.html']],
    ['.git', ['.git', 'page.html']]
  ])('SEC-10 a never-served path (%s) is never written', async (_name, segments) => {
    await mkdir(project.path(...segments.slice(0, -1)), { recursive: true })
    const path = await project.write(join(...segments), PAGE)
    const before = await snapshot(path)

    expect(await addAt(path)).toEqual(refusedPath('excluded'))
    expect(await snapshot(path)).toEqual(before)
  })

  it('SEC-10 a link `page.html` → `run.sh`, and a file that is not HTML at all', async () => {
    const script = await project.write('run.sh', PAGE)
    await symlink(script, project.path('page.html'), 'file')
    const before = await snapshot(script)

    expect(await addAt(project.path('page.html'))).toEqual(refusedPath('not-html'))
    expect(await addAt(script)).toEqual(refusedPath('not-html'))
    expect(await snapshot(script)).toEqual(before)
  })

  it('SEC-10 a gitignored page IS commentable – decision 35: gitignore is not a write rule', async () => {
    await project.write('.gitignore', 'drafts/\n')
    await mkdir(project.path('drafts'))
    const path = await project.write('drafts/page.html', PAGE)

    expect(await addAt(path)).toMatchObject({ ok: true, realPath: path })
    expect(blocksOf(await project.read('drafts/page.html'))).toHaveLength(1)
  })
})
