// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Reading a file for comments (docs/designs/html-preview-comments.md §7.6
 * steps 1–5; M-014) and the refusal → ErrorCode table (§8). Main reads the
 * bytes; the parse is the comment file jobs' (`commentJobDocs.ts`), checked
 * here on the bytes the loader returned.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readdir, stat, symlink } from 'node:fs/promises'
import { ErrorCode } from '../../../../shared/errors'
import { serializeBlock } from '../../../../shared/htmlComments'
import { PREVIEW_LIMITS } from '../../../../shared/preview-limits'
import { fixedId, makeComment } from '../../../../shared/htmlComments/__fixtures__/commentTestData'
import { fileIdOf, sha256Hex } from '../../../utils/atomicWriteBytesStrict'
import { PAGE, makeProject, snapshot, type TempProject } from './__test-helpers__/commentWriterHarness'
import { confineCommentFile, loadCommentBytes } from './commentFileAccess'
import { freshDocumentOf, writableRefusal } from './commentJobDocs'
import { jobFailureRefusal, refusalCode, refused, type CommentRefusal } from './commentRefusals'

let project: TempProject

beforeEach(async () => {
  project = await makeProject()
})

afterEach(async () => {
  await project.dispose()
})

function block(n: number, tag = 'button'): string {
  const result = serializeBlock(makeComment({ id: fixedId('c-', n), anchor: { tag, path: '' } }), {
    indent: '',
    eol: '\n'
  })
  if (!result.ok) throw new Error('fixture block')
  return result.block
}

describe('loadCommentBytes', () => {
  it('M-014 loading a file with attached, orphaned and damaged blocks never writes: bytes, mtime and folder unchanged', async () => {
    const page = PAGE.replace(
      '    <button',
      `    ${block(1)}${block(2, 'table')}${block(3).replace('@data {', '@data {{')}<button`
    )
    const path = await project.write('index.html', page)
    const before = await snapshot(path)

    const loaded = await loadCommentBytes(project.target('index.html'))

    if (!loaded.ok) throw new Error(`load: ${loaded.reason}`)
    const document = freshDocumentOf(loaded.bytes)
    if (!document.ok) throw new Error(`parse: ${document.refusal}`)
    const { blocks } = document.doc.state
    expect(blocks.map(b => (b.kind === 'ok' ? b.target.state : b.kind))).toEqual(['attached', 'orphaned', 'damaged'])
    expect(loaded.realPath).toBe(path)
    expect(document.hash).toBe(sha256Hex(before.bytes))
    expect(loaded.bytes.equals(before.bytes)).toBe(true)
    expect(await snapshot(path)).toEqual(before)
    expect(await readdir(project.root)).toEqual(['index.html'])
  })

  it('M-014 a read-only file still loads for listing; writableRefusal names why it may not be written', async () => {
    const conflicted = PAGE.replace('<main>', '<main>\n<<<<<<< HEAD\na\n=======\nb\n>>>>>>> x')
    await project.write('index.html', conflicted)

    const loaded = await loadCommentBytes(project.target('index.html'))

    if (!loaded.ok) throw new Error(`load: ${loaded.reason}`)
    const document = freshDocumentOf(loaded.bytes)
    expect(document.ok && writableRefusal(document.doc.state)).toBe('conflict-markers')
  })

  it('refuses what it cannot read losslessly or at all', async () => {
    await project.write('utf16.html', Buffer.from([0xff, 0xfe, 0x3c, 0x00]))
    await project.write('big.html', Buffer.alloc(PREVIEW_LIMITS.COMMENT_FILE_MAX_BYTES + 1, 0x61))

    const utf16 = await loadCommentBytes(project.target('utf16.html'))
    expect(utf16.ok && freshDocumentOf(utf16.bytes)).toMatchObject({ ok: false, refusal: 'encoding' })
    expect(await loadCommentBytes(project.target('big.html'))).toEqual(refused('too-large'))
    expect(await loadCommentBytes(project.target('gone.html'))).toEqual(refused('missing'))
    expect(await loadCommentBytes(project.target('notes.txt'))).toEqual(refused('not-html'))
  })

  it('§19 Rev 4 reads a file of exactly 25 MB whole; one byte more is too-large', async () => {
    const limit = PREVIEW_LIMITS.COMMENT_FILE_MAX_BYTES
    expect(limit).toBe(25 * 1024 * 1024)
    await project.write('at-limit.html', Buffer.alloc(limit, 0x61))
    await project.write('over.html', Buffer.alloc(limit + 1, 0x61))

    const atLimit = await loadCommentBytes(project.target('at-limit.html'))
    expect(atLimit.ok && atLimit.bytes.length).toBe(limit)
    expect(await loadCommentBytes(project.target('over.html'))).toEqual(refused('too-large'))
  })

  it('§19 Rev 4 a lower maxBytes (the comment list budget) refuses a longer file; a higher one never lifts the limit', async () => {
    await project.write('index.html', PAGE)
    const size = Buffer.byteLength(PAGE)
    expect(await loadCommentBytes(project.target('index.html'), { maxBytes: size - 1 })).toEqual(refused('too-large'))
    const exact = await loadCommentBytes(project.target('index.html'), { maxBytes: size })
    expect(exact.ok && exact.bytes.length).toBe(size)
    await project.write('over.html', Buffer.alloc(PREVIEW_LIMITS.COMMENT_FILE_MAX_BYTES + 1, 0x61))
    const lifted = await loadCommentBytes(project.target('over.html'), { maxBytes: 2 * PREVIEW_LIMITS.COMMENT_FILE_MAX_BYTES })
    expect(lifted).toEqual(refused('too-large'))
  })

  it('returns the dev/ino of the file it confined and read – the lock key and the write precondition', async () => {
    const path = await project.write('index.html', PAGE)
    const id = fileIdOf(await stat(path, { bigint: true }))

    const confined = await confineCommentFile(project.target('index.html'))
    const loaded = await loadCommentBytes(project.target('index.html'))

    expect(confined).toEqual({ ok: true, realPath: path, id })
    expect(loaded.ok && loaded.id).toEqual(id)
  })

  it('F1 resolves the root itself: a root given through a link still confines to the real files', async () => {
    const path = await project.write('index.html', PAGE)
    const linked = await makeProject('erfana-comments-link-')
    try {
      await symlink(project.root, linked.path('root'), 'junction')

      const confined = await confineCommentFile({
        realRoot: linked.path('root'),
        filePath: linked.path('root', 'index.html')
      })

      expect(confined).toMatchObject({ ok: true, realPath: path })
    } finally {
      await linked.dispose()
    }
  })

  it('F1 a project root that is gone is a missing file, refused before the file is looked at', async () => {
    expect(
      await confineCommentFile({ realRoot: project.path('gone'), filePath: project.path('gone', 'index.html') })
    ).toEqual(refused('missing', 'ENOENT'))
  })
})

describe('writableRefusal', () => {
  it('is null for a writable file and names every read-only reason', () => {
    expect(writableRefusal({ blocks: [], writable: true })).toBeNull()
    for (const reason of ['conflict-markers', 'unterminated-block', 'too-many-blocks', 'too-large', 'encoding'] as const) {
      expect(writableRefusal({ blocks: [], writable: false, readOnlyReason: reason })).toBe(reason)
    }
    expect(writableRefusal({ blocks: [], writable: false })).toBe('read-only')
  })
})

describe('refusalCode', () => {
  const ALL: readonly CommentRefusal[] = [
    'not-absolute', 'outside-project', 'excluded', 'not-html', 'alternate-stream', 'short-name',
    'missing', 'link', 'too-large', 'encoding', 'conflict-markers', 'unterminated-block',
    'too-many-blocks', 'read-only', 'not-owner', 'unsaved-source', 'identity', 'target-moved',
    'block-changed', 'limit', 'meta-charset', 'invalid', 'verify-failed', 'changed',
    'unsupported-fs', 'busy', 'parse-failed', 'io'
  ]

  it('maps every refusal to a COMMENT_* ErrorCode', () => {
    for (const reason of ALL) {
      const code = refusalCode(reason)
      expect(code.startsWith('COMMENT_')).toBe(true)
      expect(Object.values(ErrorCode)).toContain(code)
    }
  })

  it.each<[CommentRefusal, ErrorCode]>([
    ['outside-project', ErrorCode.COMMENT_PATH_REFUSED],
    ['missing', ErrorCode.COMMENT_FILE_GONE],
    ['link', ErrorCode.COMMENT_WRITE_REFUSED_LINK],
    ['too-large', ErrorCode.COMMENT_FILE_TOO_LARGE],
    ['encoding', ErrorCode.COMMENT_ENCODING_UNSUPPORTED],
    ['conflict-markers', ErrorCode.COMMENT_FILE_CONFLICTED],
    ['unsupported-fs', ErrorCode.COMMENT_WRITE_UNSUPPORTED_FS],
    ['changed', ErrorCode.COMMENT_WRITE_FAILED]
  ])('%s → %s', (reason, code) => {
    expect(refusalCode(reason)).toBe(code)
  })

  it('a parse the worker did not answer: a full queue is busy, anything else parse-failed – both a failed write', () => {
    expect(jobFailureRefusal('busy')).toEqual(refused('busy'))
    for (const failure of ['timeout', 'crashed', 'error', 'unavailable'] as const) {
      expect(jobFailureRefusal(failure)).toEqual(refused('parse-failed'))
    }
    expect(refusalCode('parse-failed')).toBe(ErrorCode.COMMENT_WRITE_FAILED)
  })

  it('keeps an errno code only when there is one', () => {
    expect(refused('io')).toEqual({ ok: false, reason: 'io' })
    expect(refused('io', 'EIO')).toEqual({ ok: false, reason: 'io', errno: 'EIO' })
  })
})
