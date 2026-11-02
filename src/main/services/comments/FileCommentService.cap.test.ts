// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A file at the comment cap (spec 024 state table F-04, menu matrix § 2,
 * § 3, M-15): "At exactly 500 comments, replies, edits and resolves still
 * work; only new comments are refused." The list says so (`addRefusal`), so
 * the host turns comment mode and the add item off with the reason, and
 * `openDraft` mints no token for a new comment.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fixedId, makeComment } from '../../../shared/comments/__fixtures__/commentTestData'
import { serializeBlock } from '../../../shared/comments/format'
import { ErrorCode } from '../../../shared/errors'
import { PREVIEW_LIMITS } from '../../../shared/preview-limits'
import { fileCommentHarness, PANEL, type FileCommentHarness } from './__test-helpers__/fileCommentHarness'

const LIMIT = PREVIEW_LIMITS.COMMENT_MAX_BLOCKS_PER_FILE

/** A text file of `count` blocks, each on its own line before a paragraph. */
function fileWith(count: number): string {
  const parts: string[] = []
  for (let n = 1; n <= count; n += 1) {
    const block = serializeBlock(makeComment({ id: fixedId('c-', n) }), { indent: '', eol: '\n' })
    if (!block.ok) throw new Error('fixture block')
    parts.push(`${block.block}\nParagraph ${n}.\n`)
  }
  return parts.join('\n')
}

let h: FileCommentHarness

beforeEach(async () => {
  h = await fileCommentHarness()
})

afterEach(async () => {
  await h.service.clear()
  await h.project.dispose()
})

const openDraft = () => h.service.openDraft(h.caller(), { panelId: PANEL, filePath: h.project.path('notes.txt') })

describe('024-AC-035 F-04 a file at the comment cap takes no new comment, and keeps its threads writable', () => {
  it('024-AC-035 F-04 at exactly 500 comments the list stays writable and reports no new comment, with its reason', async () => {
    await h.project.write('notes.txt', fileWith(LIMIT))
    const { file } = await h.listOk('notes.txt')
    expect(file.threads).toHaveLength(LIMIT)
    expect(file).toMatchObject({ writable: true, addRefusal: 'too-many-blocks' })
    expect(file.readOnlyReason).toBeUndefined()
  })

  it('024-AC-035 F-04 at exactly 500 comments openDraft mints no token for a new comment', async () => {
    await h.project.write('notes.txt', fileWith(LIMIT))
    await h.listOk('notes.txt')
    expect(await openDraft()).toEqual({ ok: false, code: ErrorCode.COMMENT_LIMIT, reason: 'too-many-blocks' })
  })

  it('024-AC-035 F-04 at exactly 500 comments a reply and a resolve still work', async () => {
    await h.project.write('notes.txt', fileWith(LIMIT))
    const save = async (op: Record<string, unknown>) => {
      const { file } = await h.listOk('notes.txt')
      const [thread] = file.threads
      return h.service.save(h.caller(), { panelId: PANEL, fileKey: file.fileKey, threadKey: thread.threadKey, rawHash: thread.rawHash, ...op } as never)
    }
    expect(await save({ op: 'reply', text: 'Still answerable.' })).toMatchObject({ ok: true })
    expect(await save({ op: 'setStatus', status: 'resolved' })).toMatchObject({ ok: true })
  })

  it('024-AC-035 F-04 one below the cap a new comment is still offered', async () => {
    await h.project.write('notes.txt', fileWith(LIMIT - 1))
    const { file } = await h.listOk('notes.txt')
    expect(file.addRefusal).toBeUndefined()
    expect(await openDraft()).toMatchObject({ ok: true })
  })
})
