// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The writer's read-back after the rename (module comment step 7, C12): a
 * read-back that throws counts as the file having changed under the save, so
 * the save answers `changed-during-save` rather than claiming its bytes are
 * on disk. Its own file because the read-back is mocked at module scope
 * (docs/windows/contributing.md "Test-file split policy"); the read before the
 * write stays the real one (`loadCommentBytes` calls it inside its module).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../shared/errors'
import { PAGE, VIEW, blocksOf, byId, draftFor, makeProject, makeWriter, type TempProject } from '../preview/comments/__test-helpers__/commentWriterHarness'

const reread = vi.hoisted(() => ({ fail: false }))

vi.mock('./commentFileAccess', async importOriginal => {
  const actual = await importOriginal<typeof import('./commentFileAccess')>()
  return {
    ...actual,
    readConfinedCommentBytes: vi.fn(async (...args: Parameters<typeof actual.readConfinedCommentBytes>) => {
      if (reread.fail) throw Object.assign(new Error('EIO: i/o error, read'), { code: 'EIO' })
      return actual.readConfinedCommentBytes(...args)
    })
  }
})

let project: TempProject

beforeEach(async () => {
  project = await makeProject()
  reread.fail = false
})

afterEach(async () => {
  await project.dispose()
})

describe('CommentWriter read-back (C12)', () => {
  it('C12 a read-back that throws after the rename is reported as changed-during-save, never as written', async () => {
    await project.write('index.html', PAGE)
    const { writer, log } = makeWriter()
    reread.fail = true

    const result = await writer.add({ file: project.target('index.html'), draft: draftFor(Buffer.from(PAGE), byId('buy')), view: VIEW, text: 'Hi' })

    expect(result).toEqual({ ok: false, code: ErrorCode.COMMENT_WRITE_FAILED, reason: 'changed-during-save' })
    // The rename did happen: the window is told it cannot vouch for it, and the log says why.
    expect(blocksOf(await project.read('index.html'))).toHaveLength(1)
    expect(log.warn).toHaveBeenCalledWith('comments: comment write refused', expect.objectContaining({ reason: 'changed-during-save' }))
  })

  it('a read-back that succeeds reports the write', async () => {
    await project.write('index.html', PAGE)
    const result = await makeWriter().writer.add({ file: project.target('index.html'), draft: draftFor(Buffer.from(PAGE), byId('buy')), view: VIEW, text: 'Hi' })
    expect(result).toMatchObject({ ok: true })
  })
})
