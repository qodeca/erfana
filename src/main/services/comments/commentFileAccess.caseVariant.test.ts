// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A comment file path that names the project root in another letter case
 * (docs/designs/comments/html-preview-comments.md §19 Rev 4 "case-only path
 * differences on macOS"; M-009). On Windows and macOS rules it passes the
 * lexical check, and the realpath step – not the lexical one – then decides:
 * the same folder on disk is accepted under its on-disk spelling, another
 * folder is outside the project.
 *
 * The disk is real; only `realpath` and `lstat` see one more spelling of a
 * folder, as a case-insensitive disk would, so every row runs with the
 * Windows and the macOS rules on every host – Linux CI included. Split from
 * `commentFileAccess.test.ts` because the module-scope `node:fs/promises` mock
 * hoists (docs/windows/contributing.md, test-file split policy). The real-disk
 * rows are in `CommentWriter.confinement.test.ts`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { PathLike } from 'node:fs'

const disk = vi.hoisted(() => {
  /** Another spelling of a folder → where the "disk" finds it. */
  const aliases = new Map<string, string>()
  return {
    aliases,
    /** The path the real file system is asked for. */
    onDisk(path: PathLike): PathLike {
      if (typeof path !== 'string') return path
      for (const [spelling, real] of aliases) {
        const below = path.slice(spelling.length)
        if (path.startsWith(spelling) && (below === '' || below.startsWith('/') || below.startsWith('\\'))) {
          return real + below
        }
      }
      return path
    }
  }
})

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    realpath: ((path: PathLike, options?: never) => actual.realpath(disk.onDisk(path), options)) as typeof actual.realpath,
    lstat: ((path: PathLike, options?: never) => actual.lstat(disk.onDisk(path), options)) as typeof actual.lstat
  }
})

import { mkdir, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileIdOf } from '../../utils/atomicWriteBytesStrict'
import { PAGE, makeProject, snapshot, type TempProject } from '../preview/comments/__test-helpers__/commentWriterHarness'
import { confineCommentFile, loadCommentBytes } from './commentFileAccess'
import { refused } from './commentRefusals'

/** The rules that fold case – the ones a case-only spelling gets past lexically. */
const FOLDING_PLATFORMS = ['darwin', 'win32'] as const

let project: TempProject
let outside: TempProject
/** The project root spelled in upper case – the same folder, as the "disk" sees it. */
let variantRoot: string

beforeEach(async () => {
  project = await makeProject()
  outside = await makeProject('erfana-comments-outside-')
  variantRoot = join(dirname(project.root), basename(project.root).toUpperCase())
  disk.aliases.clear()
  disk.aliases.set(variantRoot, project.root)
})

afterEach(async () => {
  disk.aliases.clear()
  await project.dispose()
  await outside.dispose()
})

describe('§19 Rev 4 a path naming the project root in another letter case', () => {
  it.for(FOLDING_PLATFORMS)('%s rules: accepted, and confined to the on-disk spelling', async platform => {
    const page = await project.write('index.html', PAGE)
    const id = fileIdOf(await stat(page, { bigint: true }))

    const result = await confineCommentFile({ realRoot: project.root, filePath: join(variantRoot, 'index.html') }, { platform })

    expect(result).toEqual({ ok: true, realPath: page, id })
  })

  it.for(FOLDING_PLATFORMS)('%s rules: the root given in the other case works the same', async platform => {
    const page = await project.write('index.html', PAGE)

    const result = await confineCommentFile({ realRoot: variantRoot, filePath: page }, { platform })

    expect(result).toMatchObject({ ok: true, realPath: page })
  })

  it.for(FOLDING_PLATFORMS)('%s rules: the bytes load from the on-disk file', async platform => {
    const page = await project.write('index.html', PAGE)

    const loaded = await loadCommentBytes({ realRoot: project.root, filePath: join(variantRoot, 'index.html') }, { platform })

    expect(loaded).toMatchObject({ ok: true, realPath: page })
    expect(loaded.ok && loaded.bytes.toString('utf8')).toBe(PAGE)
  })

  it('exact rules (Linux): another folder, refused before the disk is asked', async () => {
    await project.write('index.html', PAGE)

    const result = await confineCommentFile(
      { realRoot: project.root, filePath: join(variantRoot, 'index.html') },
      { platform: 'linux' }
    )

    expect(result).toEqual(refused('outside-project'))
  })

  // Changed expectation under OD-07 (was "the never-served rules still hold below the root", refused as excluded).
  it.for(FOLDING_PLATFORMS)('OD-07 %s rules: a dot-folder or dependency folder below the root is no refusal', async platform => {
    await mkdir(project.path('node_modules'))
    await mkdir(project.path('.hidden'))
    const pages = {
      node_modules: await project.write(join('node_modules', 'x.html'), PAGE),
      '.hidden': await project.write(join('.hidden', 'x.html'), PAGE)
    }

    for (const [folder, page] of Object.entries(pages)) {
      const result = await confineCommentFile({ realRoot: project.root, filePath: join(variantRoot, folder, 'x.html') }, { platform })
      expect(result, folder).toMatchObject({ ok: true, realPath: page })
    }
  })

  it('win32 rules: an 8.3 short-name segment below the root is still refused', async () => {
    const result = await confineCommentFile(
      { realRoot: project.root, filePath: join(variantRoot, 'PROGRA~1', 'index.html') },
      { platform: 'win32' }
    )

    expect(result).toEqual(refused('short-name'))
  })

  it.for(FOLDING_PLATFORMS)(
    '%s rules: a spelling that folds to the root but that the disk resolves elsewhere is outside the project, untouched',
    async platform => {
      // Lexically the root; on disk another folder (a case-sensitive volume, or a link)
      const elsewhere = await outside.write('index.html', PAGE)
      const before = await snapshot(elsewhere)
      disk.aliases.set(variantRoot, outside.root)

      const result = await confineCommentFile({ realRoot: project.root, filePath: join(variantRoot, 'index.html') }, { platform })

      expect(result).toEqual(refused('outside-project'))
      expect(await snapshot(elsewhere)).toEqual(before)
    }
  )
})
