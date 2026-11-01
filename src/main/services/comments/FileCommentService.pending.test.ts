// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * W-10 in the file-comment family (I-29, D-62): a save past its time limit
 * answers "still saving", as the HTML family's does, and main says how it ended
 * once it has. The draft stays in flight until then: no second write can start.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../shared/errors'
import type { CommentFileJobRunner } from './commentFileJobs'
import { createInProcessKindJobs } from './kindCommentJobs'
import { createParagraphKind } from './__test-helpers__/paragraphKind'
import { fileCommentHarness, PANEL, VIEW, pickOn, seededRandom, type FileCommentHarness } from './__test-helpers__/fileCommentHarness'

const DOC = 'Intro paragraph one.\n\nSecond paragraph here.\n'
const TIME_LIMIT_MS = 10

/** A runner whose write jobs wait until `release` is called. */
function gatedJobs(): { readonly jobs: CommentFileJobRunner; readonly release: () => void } {
  const inner = createInProcessKindJobs(createParagraphKind(), { random: seededRandom() })
  let open: () => void = () => {}
  const gate = new Promise<void>(resolve => (open = resolve))
  return {
    release: () => open(),
    jobs: {
      runJob: async (bytes, job) => {
        if (job.kind === 'write' || job.kind === 'bulkWrite') await gate
        return inner.runJob(bytes, job)
      }
    }
  }
}

describe('W-10 a slow file-comment save (I-29)', () => {
  let h: FileCommentHarness
  const settled = vi.fn()

  async function slowHarness(saveTimeoutMs = TIME_LIMIT_MS): Promise<() => void> {
    settled.mockClear()
    const { jobs, release } = gatedJobs()
    h = await fileCommentHarness({ jobs, service: { saveTimeoutMs, sendSettled: settled } })
    await h.project.write('notes.txt', DOC)
    await h.listOk('notes.txt')
    return release
  }

  afterEach(async () => {
    await h.service.clear()
    await h.project.dispose()
  })

  it('I-29 past the limit it answers pending, and reports the landing to the sender\'s window by the draft token', async () => {
    const release = await slowHarness()
    const filePath = h.project.path('notes.txt')
    const draft = await h.service.openDraft(h.caller(), { panelId: PANEL, filePath })
    if (!draft.ok) throw new Error('no draft')
    const add = { panelId: PANEL, filePath, op: 'add' as const, draftToken: draft.draftToken, target: pickOn(1), text: 'Slow.', view: VIEW }
    expect(await h.service.save(h.caller(), add)).toEqual({ ok: false, code: ErrorCode.COMMENT_SAVE_PENDING })
    expect(settled).not.toHaveBeenCalled()
    // The draft is in flight: a second Save cannot write the same text twice.
    expect(await h.service.save(h.caller(), add)).toMatchObject({ ok: false })
    release()
    await vi.waitFor(() => expect(settled).toHaveBeenCalledTimes(1))
    expect(settled).toHaveBeenCalledWith(1, { panelId: PANEL, op: 'add', draftToken: draft.draftToken, ok: true })
    expect(String(await h.project.read('notes.txt'))).toContain('Slow.')
    expect(String(await h.project.read('notes.txt')).split('Slow.').length).toBe(3)
  })

  it('L-2 a bulk file past the limit answers pending, then reports how it ended to the sender\'s window', async () => {
    const release = await slowHarness(5_000)
    const bulkSettled = vi.fn()
    release()
    await h.add('notes.txt', 1, 'First.')
    const { jobs, release: open } = gatedJobs()
    const slow = await fileCommentHarness({ jobs, service: { saveTimeoutMs: TIME_LIMIT_MS, sendBulkSettled: bulkSettled } })
    await slow.project.write('notes.txt', String(await h.project.read('notes.txt')))
    const { file } = await slow.listOk('notes.txt')
    const [thread] = file.threads
    const request = { panelId: PANEL, change: 'resolve' as const, files: [{ fileKey: file.fileKey, threads: [{ threadKey: thread.threadKey, rawHash: thread.rawHash }] }] }
    expect(await slow.service.bulk(slow.caller(), request)).toEqual({ ok: true, files: [{ fileKey: file.fileKey, ok: false, code: ErrorCode.COMMENT_SAVE_PENDING }] })
    expect(bulkSettled).not.toHaveBeenCalled()
    open()
    await vi.waitFor(() => expect(bulkSettled).toHaveBeenCalledExactlyOnceWith(1, { panelId: PANEL, fileKey: file.fileKey, ok: true }))
    await slow.service.clear()
    await slow.project.dispose()
  })

  it('I-29 a thread write past the limit reports by its thread key; one that is refused names its code and reason', async () => {
    const release = await slowHarness(5_000)
    release()
    await h.add('notes.txt', 1, 'First.')
    const late = gatedJobs()
    const again = await fileCommentHarness({ jobs: late.jobs, service: { saveTimeoutMs: TIME_LIMIT_MS, sendSettled: settled } })
    await again.project.write('notes.txt', String(await h.project.read('notes.txt')))
    const view = (await again.listOk('notes.txt')).file
    const request = { panelId: PANEL, op: 'setStatus' as const, status: 'resolved' as const, fileKey: view.fileKey, threadKey: view.threads[0].threadKey, rawHash: view.threads[0].rawHash }
    expect(await again.service.save(again.caller(), request)).toEqual({ ok: false, code: ErrorCode.COMMENT_SAVE_PENDING })
    await again.project.write('notes.txt', DOC)
    late.release()
    await vi.waitFor(() => expect(settled).toHaveBeenCalledTimes(1))
    expect(settled).toHaveBeenCalledWith(1, expect.objectContaining({ panelId: PANEL, op: 'setStatus', threadKey: request.threadKey, ok: false, code: expect.any(String), reason: expect.any(String) }))
    await again.service.clear()
    await again.project.dispose()
  })

  it('I-29 a save inside the limit is answered as ever, and nothing is sent afterwards', async () => {
    const release = await slowHarness(5_000)
    release()
    const answer = await h.add('notes.txt', 1, 'Quick.')
    expect(answer).toMatchObject({ ok: true })
    expect(settled).not.toHaveBeenCalled()
  })
})
