// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * CommentWriter under races and file-system failures
 * (docs/designs/comments/html-preview-comments.md §7.6 steps 8–9, threats S10/S11;
 * M-004, M-013, M-056, M-061, SEC-11).
 *
 * Split from `CommentWriter.test.ts` because the module-scope `fs/promises`
 * and format-core mocks hoist (docs/windows/contributing.md, test-file split
 * policy). The mocks pass through to the real implementations; a test arms
 * one hook to act at an exact step – when the temp file is created, which is
 * after the writer read and spliced the file and before it re-hashes and
 * renames. The comment file limit is lowered to {@link TEST_FILE_LIMIT}, so a
 * file at the limit is built and parsed without 25 MB of parse (§19 Rev 4).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/** The comment file limit in this suite. */
const TEST_FILE_LIMIT = vi.hoisted(() => 512 * 1024)

vi.mock('../../../../shared/preview-limits', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../../shared/preview-limits')>()
  return { ...actual, PREVIEW_LIMITS: { ...actual.PREVIEW_LIMITS, COMMENT_FILE_MAX_BYTES: TEST_FILE_LIMIT } }
})

const hooks = vi.hoisted(() => ({
  rename: vi.fn(),
  open: vi.fn(),
  lstat: vi.fn(),
  verifyCommentSplice: vi.fn(),
  /** Runs once per temp-file creation, before the temp file is opened. */
  onTempOpen: null as null | ((count: number) => Promise<void>),
  tempOpens: 0
}))

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, rename: hooks.rename, open: hooks.open, lstat: hooks.lstat }
})

vi.mock('../../../../shared/htmlComments', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../../shared/htmlComments')>()
  return { ...actual, verifyCommentSplice: hooks.verifyCommentSplice }
})

import { ErrorCode } from '../../../../shared/errors'
import * as htmlComments from '../../../../shared/htmlComments'
import { ATOMIC_TEMP_PREFIX } from '../../../utils/atomicWrite'
import {
  PAGE,
  VIEW,
  byId,
  draftFor,
  makeProject,
  makeWriter,
  okBlock,
  snapshot,
  type TempProject
} from './__test-helpers__/commentWriterHarness'
import type { CommentWriteResult, CommentWriterDeps } from './CommentWriter'

type FsPromises = typeof import('node:fs/promises')

let project: TempProject
let fs: FsPromises
let realVerify: typeof htmlComments.verifyCommentSplice

beforeEach(async () => {
  fs = await vi.importActual<FsPromises>('node:fs/promises')
  realVerify = (await vi.importActual<typeof htmlComments>('../../../../shared/htmlComments')).verifyCommentSplice
  project = await makeProject()
  hooks.tempOpens = 0
  hooks.onTempOpen = null
  hooks.rename.mockReset()
  hooks.rename.mockImplementation(fs.rename)
  hooks.open.mockReset()
  hooks.open.mockImplementation(async (...args: Parameters<FsPromises['open']>) => {
    if (String(args[0]).includes(ATOMIC_TEMP_PREFIX)) {
      hooks.tempOpens += 1
      await hooks.onTempOpen?.(hooks.tempOpens)
    }
    return fs.open(...args)
  })
  hooks.verifyCommentSplice.mockReset()
  hooks.verifyCommentSplice.mockImplementation(realVerify)
  hooks.lstat.mockReset()
  hooks.lstat.mockImplementation(fs.lstat)
})

afterEach(async () => {
  await project.dispose()
})

const AGENT_EDIT = PAGE.replace('    <p>Pricing', '    <h1>Agent heading</h1>\n    <p>Pricing')

async function addOnBuy(deps: Partial<CommentWriterDeps> = {}): Promise<CommentWriteResult> {
  return makeWriter(deps).writer.add({
    file: project.target('index.html'),
    draft: draftFor(Buffer.from(PAGE), byId('buy')),
    view: VIEW,
    text: 'Bigger.'
  })
}

async function onlyIndex(): Promise<void> {
  expect(await fs.readdir(project.root)).toEqual(['index.html'])
}

describe('a file that changes under the write (M-004, SEC-11)', () => {
  it('M-004 a change between the read and the rename is detected; one re-read re-locates the element and keeps the outside edit', async () => {
    await project.write('index.html', PAGE)
    hooks.onTempOpen = async count => {
      if (count === 1) await fs.writeFile(project.path('index.html'), AGENT_EDIT)
    }

    const result = await addOnBuy()

    if (!result.ok || !result.threadId) throw new Error(JSON.stringify(result))
    const after = await project.read('index.html')
    const { range } = okBlock(after, result.threadId)
    const text = after.toString('utf8')
    expect(text.slice(0, range[0]) + text.slice(range[1])).toBe(AGENT_EDIT)
    expect(hooks.tempOpens).toBe(2)
    expect(hooks.rename).toHaveBeenCalledTimes(1)
    await onlyIndex()
  })

  it('M-004 a file that keeps changing fails cleanly after the one retry: COMMENT_WRITE_FAILED, the outside bytes kept', async () => {
    await project.write('index.html', PAGE)
    hooks.onTempOpen = async count => {
      await fs.writeFile(project.path('index.html'), `${AGENT_EDIT}<!-- edit ${count} -->`)
    }

    const result = await addOnBuy()

    expect(result).toEqual({ ok: false, code: ErrorCode.COMMENT_WRITE_FAILED, reason: 'changed' })
    expect(hooks.tempOpens).toBe(2)
    expect(hooks.rename).not.toHaveBeenCalled()
    expect((await project.read('index.html')).toString('utf8')).toBe(`${AGENT_EDIT}<!-- edit 2 -->`)
    await onlyIndex()
  })

  it('SEC-11 a file swapped for a symlink just before the rename is refused; neither the link nor its target is written', async () => {
    const other = await project.write('other.html', PAGE)
    await project.write('index.html', PAGE)
    hooks.onTempOpen = async () => {
      await fs.unlink(project.path('index.html'))
      await fs.symlink(other, project.path('index.html'), 'file')
    }

    const result = await addOnBuy()

    expect(result).toEqual({ ok: false, code: ErrorCode.COMMENT_WRITE_REFUSED_LINK, reason: 'link' })
    expect((await fs.lstat(project.path('index.html'))).isSymbolicLink()).toBe(true)
    expect((await fs.readFile(other, 'utf8'))).toBe(PAGE)
    expect((await fs.readdir(project.root)).sort()).toEqual(['index.html', 'other.html'])
  })

  it('SEC-11 a file given a second hard link just before the rename is refused', async () => {
    await project.write('index.html', PAGE)
    hooks.onTempOpen = async () => {
      await fs.link(project.path('index.html'), project.path('alias.html'))
    }

    const result = await addOnBuy()

    expect(result).toEqual({ ok: false, code: ErrorCode.COMMENT_WRITE_REFUSED_LINK, reason: 'link' })
    expect((await fs.readFile(project.path('alias.html'), 'utf8'))).toBe(PAGE)
  })

  it('SEC-11 a folder on the path replaced by a link while the save waited is refused, never written through', async () => {
    await fs.mkdir(project.path('pages'))
    await project.write('pages/index.html', PAGE)
    const target = project.target('pages', 'index.html')
    const draft = draftFor(Buffer.from(PAGE), byId('buy'))
    const { writer } = makeWriter({
      // Runs under the lock, after the key was taken from the first confinement
      hasUnsavedSource: async () => {
        await fs.rename(project.path('pages'), project.path('moved'))
        await fs.symlink(project.path('moved'), project.path('pages'), 'junction')
        return false
      }
    })

    const result = await writer.add({ file: target, draft, view: VIEW, text: 'x' })

    expect(result).toEqual({ ok: false, code: ErrorCode.COMMENT_WRITE_FAILED, reason: 'changed' })
    expect((await fs.readFile(project.path('moved', 'index.html'), 'utf8'))).toBe(PAGE)
  })

  it('SEC-11 a folder moved out of the project and replaced by a link AFTER the re-confine is refused before the rename', async () => {
    // Security review F4: the same file and bytes, so only the folder re-check can tell
    const outside = await makeProject('erfana-comments-outside-')
    try {
      await fs.mkdir(project.path('pages'))
      await project.write('pages/index.html', PAGE)
      hooks.onTempOpen = async count => {
        if (count !== 1) return
        await fs.rename(project.path('pages'), outside.path('pages'))
        await fs.symlink(outside.path('pages'), project.path('pages'), 'junction')
      }

      const result = await makeWriter().writer.add({
        file: project.target('pages', 'index.html'),
        draft: draftFor(Buffer.from(PAGE), byId('buy')),
        view: VIEW,
        text: 'x'
      })

      // The first attempt stops at the folder check; the retry's confinement sees the file outside
      expect(result).toEqual({ ok: false, code: ErrorCode.COMMENT_PATH_REFUSED, reason: 'outside-project' })
      expect(hooks.tempOpens).toBe(1)
      expect(hooks.rename).not.toHaveBeenCalled()
      expect(await fs.readFile(outside.path('pages', 'index.html'), 'utf8')).toBe(PAGE)
      expect(await fs.readdir(outside.path('pages'))).toEqual(['index.html'])
    } finally {
      await outside.dispose()
    }
  })

  it.each([
    ['ENOENT', ErrorCode.COMMENT_FILE_GONE, 'missing'],
    ['EACCES', ErrorCode.COMMENT_WRITE_FAILED, 'io']
  ])(
    'M-056 the link check of the requested name failing with %s (the file went away after it was resolved) is %s',
    async (code, errorCode, reason) => {
      await project.write('index.html', PAGE)
      let armed = true
      hooks.lstat.mockImplementation(async (...args: Parameters<FsPromises['lstat']>) => {
        // The link check of the first confinement is the first bigint lstat of the requested name
        const bigint = (args[1] as { bigint?: boolean } | undefined)?.bigint === true
        if (armed && args[0] === project.path('index.html') && bigint) {
          armed = false
          throw Object.assign(new Error(code), { code })
        }
        return fs.lstat(...args)
      })

      expect(await addOnBuy()).toEqual({ ok: false, code: errorCode, reason })
      expect((await project.read('index.html')).toString('utf8')).toBe(PAGE)
    }
  )

  it('M-056 a file deleted just before the rename: COMMENT_FILE_GONE, and the rename never re-creates it', async () => {
    await project.write('index.html', PAGE)
    hooks.onTempOpen = async () => {
      await fs.unlink(project.path('index.html'))
    }

    const result = await addOnBuy()

    expect(result).toEqual({ ok: false, code: ErrorCode.COMMENT_FILE_GONE, reason: 'missing' })
    expect(hooks.rename).not.toHaveBeenCalled()
    expect(await fs.readdir(project.root)).toEqual([])
  })
})

describe('file-system failures and fail-closed verification', () => {
  it('M-013 one save is exactly one rename onto the file', async () => {
    await project.write('index.html', PAGE)

    expect((await addOnBuy()).ok).toBe(true)

    expect(hooks.rename).toHaveBeenCalledTimes(1)
    expect(hooks.rename.mock.calls[0][1]).toBe(project.path('index.html'))
  })

  it.each(['EXDEV', 'ENOTSUP'])(
    'M-061 a drive that cannot rename (%s) is COMMENT_WRITE_UNSUPPORTED_FS; the file is never written in place',
    async code => {
      await project.write('index.html', PAGE)
      const before = await snapshot(project.path('index.html'))
      hooks.rename.mockRejectedValue(Object.assign(new Error(`${code}: rename '/secret/x'`), { code }))
      const deps = makeWriter()

      const result = await deps.writer.add({
        file: project.target('index.html'),
        draft: draftFor(Buffer.from(PAGE), byId('buy')),
        view: VIEW,
        text: 'x'
      })

      expect(result).toEqual({ ok: false, code: ErrorCode.COMMENT_WRITE_UNSUPPORTED_FS, reason: 'unsupported-fs' })
      expect(await snapshot(project.path('index.html'))).toEqual(before)
      await onlyIndex()
      expect(deps.log.warn).toHaveBeenCalledWith(
        'htmlComments: comment write refused',
        expect.objectContaining({ errno: code, reason: 'unsupported-fs' })
      )
      expect(JSON.stringify(deps.log.warn.mock.calls)).not.toContain('secret')
    }
  )

  it('a splice that fails its verification is never written (fail closed): COMMENT_WRITE_FAILED', async () => {
    await project.write('index.html', PAGE)
    const before = await snapshot(project.path('index.html'))
    hooks.verifyCommentSplice.mockReturnValue({ ok: false, reason: 'elements' })

    const result = await addOnBuy()

    expect(result).toEqual({ ok: false, code: ErrorCode.COMMENT_WRITE_FAILED, reason: 'verify-failed' })
    expect(hooks.tempOpens).toBe(0)
    expect(await snapshot(project.path('index.html'))).toEqual(before)
  })

  it('a block that would push the file past the file limit is refused before writing (COMMENT_LIMIT)', async () => {
    const nearlyFull = PAGE.replace('</body>', `<!-- ${'x'.repeat(TEST_FILE_LIMIT - PAGE.length - 20)} -->\n</body>`)
    expect(Buffer.byteLength(nearlyFull)).toBeLessThanOrEqual(TEST_FILE_LIMIT)
    await project.write('index.html', nearlyFull)

    const result = await makeWriter().writer.add({
      file: project.target('index.html'),
      draft: draftFor(Buffer.from(nearlyFull), byId('buy')),
      view: VIEW,
      text: 'x'
    })

    expect(result).toEqual({ ok: false, code: ErrorCode.COMMENT_LIMIT, reason: 'limit' })
    expect(hooks.tempOpens).toBe(0)
  })

  it('an unexpected throw is COMMENT_WRITE_FAILED and releases the lock for the next save', async () => {
    await project.write('index.html', PAGE)

    const thrown = await addOnBuy({
      identity: () => {
        throw Object.assign(new Error('settings unreadable'), { code: 'EIO' })
      }
    })
    const next = await addOnBuy()

    expect(thrown).toEqual({ ok: false, code: ErrorCode.COMMENT_WRITE_FAILED, reason: 'io' })
    expect(next.ok).toBe(true)
  })
})
