// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * `FileCommentService` – the `file-comment:*` family's main half (spec 024
 * architecture note 001 § 4, § 5, § 8 C17, C18), driven over a temporary
 * project with the test-only paragraph kind, in-process jobs and fake watches.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ErrorCode } from '../../../shared/errors'
import { PARAGRAPH_AGENT_NOTE } from './__test-helpers__/paragraphKind'
import { fileCommentHarness, PANEL, pickOn, VIEW, type FileCommentHarness } from './__test-helpers__/fileCommentHarness'

const DOC = 'Intro paragraph one.\n\nSecond paragraph here.\n'
const KEY_INVALID = { ok: false, code: ErrorCode.COMMENT_KEY_INVALID, reason: 'key-invalid' }
const NOT_OPEN = { ok: false, code: ErrorCode.COMMENT_KEY_INVALID, reason: 'not-open' }

let h: FileCommentHarness

beforeEach(async () => {
  h = await fileCommentHarness()
  await h.project.write('notes.txt', DOC)
})

afterEach(async () => {
  await h.service.clear()
  await h.project.dispose()
})

describe('list, add, change and delete', () => {
  it('adds a block before the picked paragraph, changing only that range, with the kind\'s note', async () => {
    await h.listOk('notes.txt')
    const added = await h.add('notes.txt', 3, 'Please expand this.')
    expect(added).toMatchObject({ ok: true })
    const after = (await h.project.read('notes.txt')).toString('utf8')
    const at = 'Intro paragraph one.\n\n'.length
    expect(after.slice(0, at)).toBe(DOC.slice(0, at))
    expect(after.endsWith(DOC.slice(at))).toBe(true)
    const block = after.slice(at, after.length - (DOC.length - at))
    expect(block.startsWith('<!-- erfana:comment v1 id=')).toBe(true)
    expect(block).toContain(PARAGRAPH_AGENT_NOTE[0])
    expect(block.endsWith('-->\n')).toBe(true)
  })

  it('lists the thread with main\'s keys and where its target is now', async () => {
    await h.listOk('notes.txt')
    const added = await h.add('notes.txt', 3, 'Please expand this.')
    const listed = await h.listOk('notes.txt')
    expect(listed.file.threads).toHaveLength(1)
    const [thread] = listed.file.threads
    expect(added).toEqual({ ok: true, threadKey: thread.threadKey })
    expect(thread).toMatchObject({ status: 'open', tag: 'p', attached: true })
    expect(listed.file).toMatchObject({ displayPath: 'notes.txt', filePath: h.project.path('notes.txt'), frame: false, writable: true })
    const lines = (await h.project.read('notes.txt')).toString('utf8').split('\n')
    expect(listed.placements).toEqual([{ threadKey: thread.threadKey, line: lines.indexOf('Second paragraph here.') + 1, tag: 'p' }])
  })

  it('replies, resolves and deletes by keys; delete gives back the original bytes', async () => {
    await h.listOk('notes.txt')
    await h.add('notes.txt', 3, 'First.')
    const save = async (op: Record<string, unknown>) => {
      const { file } = await h.listOk('notes.txt')
      const [thread] = file.threads
      return h.service.save(h.caller(), { panelId: PANEL, fileKey: file.fileKey, threadKey: thread.threadKey, rawHash: thread.rawHash, ...op } as never)
    }
    expect(await save({ op: 'reply', text: 'A reply.' })).toMatchObject({ ok: true })
    expect(await save({ op: 'setStatus', status: 'resolved' })).toMatchObject({ ok: true })
    const listed = await h.listOk('notes.txt')
    expect(listed.file.threads[0].messages).toHaveLength(2)
    expect(listed.file.threads[0].status).toBe('resolved')
    expect(await save({ op: 'deleteThread' })).toEqual({ ok: true, threadKey: null })
    expect((await h.project.read('notes.txt')).toString('utf8')).toBe(DOC)
  })

  it('shows the editor\'s unsaved text for display only; a write re-reads the disk', async () => {
    await h.listOk('notes.txt')
    await h.add('notes.txt', 3, 'On disk.')
    const onDisk = await h.project.read('notes.txt')
    const shown = await h.listOk('notes.txt', { bufferText: DOC })
    expect(shown.file.threads).toHaveLength(0)
    expect(await h.project.read('notes.txt')).toEqual(onDisk)
    // The same text as the disk is the disk.
    expect((await h.listOk('notes.txt', { bufferText: onDisk.toString('utf8') })).file.threads).toHaveLength(1)
    // A write is planned on the disk, never on the buffer text.
    const { file } = await h.listOk('notes.txt')
    const [thread] = file.threads
    const replied = await h.service.save(h.caller(), { panelId: PANEL, fileKey: file.fileKey, threadKey: thread.threadKey, rawHash: thread.rawHash, op: 'reply', text: 'Still here.' })
    expect(replied).toMatchObject({ ok: true })
  })

  it('stores valid selected words as anchor.sel and the words hint', async () => {
    await h.listOk('notes.txt')
    await h.add('notes.txt', 3, 'About these words.', { sel: { exact: 'paragraph', prefix: 'Second ', suffix: ' here.' } })
    const text = (await h.project.read('notes.txt')).toString('utf8')
    expect(text).toContain('"sel":{"exact":"paragraph","prefix":"Second ","suffix":" here."}')
    expect(text).toContain('comment is about the words (when commented): "paragraph"')
  })

  it('024-AC-005: the list places a selection thread with its words, so the preview can mark them; a block comment has none', async () => {
    await h.listOk('notes.txt')
    await h.add('notes.txt', 3, 'About these words.', { sel: { exact: 'paragraph', prefix: 'Second ', suffix: ' here.' } })
    await h.add('notes.txt', 1, 'About the intro.')
    const listed = await h.listOk('notes.txt')
    const bySel = listed.placements.map(p => p.sel?.exact ?? null).sort()
    expect(bySel).toEqual(['paragraph', null].sort())
    expect(listed.placements.find(p => p.sel !== undefined)).toMatchObject({ sel: { exact: 'paragraph', prefix: 'Second ', suffix: ' here.' } })
  })
})

describe('024-AC-028 item 4: a draft token is single-use and tied to window, panel and file; thread ops take keys only', () => {
  const draft = async (windowId = 1, panelId = PANEL, rel = 'notes.txt') => {
    const answer = await h.service.openDraft(h.caller(windowId), { panelId, filePath: h.project.path(rel) })
    if (!answer.ok) throw new Error('no draft')
    return answer.draftToken
  }
  const addWith = (token: string, windowId = 1, panelId = PANEL, rel = 'notes.txt') =>
    h.service.save(h.caller(windowId), {
      panelId,
      filePath: h.project.path(rel),
      op: 'add',
      draftToken: token,
      target: pickOn(3),
      text: 'Hello.',
      view: VIEW
    })

  it('a token writes once; the second use is refused and writes nothing', async () => {
    await h.listOk('notes.txt')
    const token = await draft()
    expect(await addWith(token)).toMatchObject({ ok: true })
    const once = await h.project.read('notes.txt')
    expect(await addWith(token)).toEqual(KEY_INVALID)
    expect(await h.project.read('notes.txt')).toEqual(once)
  })

  it('a token minted for one window, panel or file is refused for another', async () => {
    await h.project.write('other.txt', DOC)
    await h.listOk('notes.txt')
    await h.listOk('notes.txt', { windowId: 2 })
    await h.listOk('notes.txt', { panelId: 'editor-panel-2' })
    const token = await draft()
    expect(await addWith(token, 2)).toEqual(KEY_INVALID)
    expect(await addWith(token, 1, 'editor-panel-2')).toEqual(KEY_INVALID)
    // The panel now shows another file: the old file is no longer open there…
    await h.listOk('other.txt')
    expect(await addWith(token)).toEqual(NOT_OPEN)
    // …and the token does not carry over to the new file.
    expect(await addWith(token, 1, PANEL, 'other.txt')).toEqual(KEY_INVALID)
    expect((await h.project.read('notes.txt')).toString('utf8')).toBe(DOC)
    expect((await h.project.read('other.txt')).toString('utf8')).toBe(DOC)
  })

  it('no draft for a panel the sender\'s window never listed, or for a file not open in it', async () => {
    await h.project.write('other.txt', DOC)
    expect(await h.service.openDraft(h.caller(), { panelId: PANEL, filePath: h.project.path('notes.txt') })).toEqual(NOT_OPEN)
    await h.listOk('notes.txt')
    expect(await h.service.openDraft(h.caller(2), { panelId: PANEL, filePath: h.project.path('notes.txt') })).toEqual(NOT_OPEN)
    expect(await h.service.openDraft(h.caller(), { panelId: PANEL, filePath: h.project.path('other.txt') })).toEqual(NOT_OPEN)
  })

  it('a thread key is refused outside the window, panel and file it was listed for', async () => {
    await h.listOk('notes.txt')
    await h.add('notes.txt', 3, 'First.')
    const { file } = await h.listOk('notes.txt')
    const [thread] = file.threads
    const reply = { fileKey: file.fileKey, threadKey: thread.threadKey, rawHash: thread.rawHash, op: 'reply' as const, text: 'x' }
    await h.listOk('notes.txt', { windowId: 2 })
    expect(await h.service.save(h.caller(2), { panelId: PANEL, ...reply })).toEqual(KEY_INVALID)
    expect(await h.service.save(h.caller(3), { panelId: PANEL, ...reply })).toEqual(NOT_OPEN)
    expect(await h.service.save(h.caller(), { panelId: PANEL, ...reply, threadKey: file.fileKey })).toEqual(KEY_INVALID)
  })
})

describe('024-AC-028 item 6: file-comment:changed goes only to the owning window; watches are counted, capped and freed', () => {
  it('a change reaches the windows whose panels listed the file, and no other', async () => {
    await h.project.write('other.txt', DOC)
    await h.listOk('notes.txt', { windowId: 1, panelId: 'a' })
    await h.listOk('notes.txt', { windowId: 2, panelId: 'b' })
    await h.listOk('other.txt', { windowId: 3, panelId: 'c' })
    h.watches.fire(h.project.path('notes.txt'))
    expect(h.sent.mock.calls.map(([windowId, payload]) => [windowId, payload.panelId, payload.filePath])).toEqual([
      [1, 'a', h.project.path('notes.txt')],
      [2, 'b', h.project.path('notes.txt')]
    ])
    const stamps = h.sent.mock.calls.map(([, payload]) => payload.stamp)
    expect(stamps[1]).toBeGreaterThan(stamps[0])
  })

  it('one watch per file, closed with its last panel', async () => {
    await h.project.write('other.txt', DOC)
    await h.listOk('notes.txt', { panelId: 'a' })
    await h.listOk('notes.txt', { panelId: 'b' })
    expect(h.service.watchCount).toBe(1)
    await h.listOk('other.txt', { panelId: 'a' })
    expect(h.watches.closed).toEqual([])
    await h.listOk('other.txt', { panelId: 'b' })
    expect(h.watches.closed).toEqual([h.project.path('notes.txt')])
    h.service.forgetWindow(1)
    expect(h.watches.closed).toEqual([h.project.path('notes.txt'), h.project.path('other.txt')])
    expect(h.service.watchCount).toBe(0)
  })

  it('past the cap a file is listed without a watch, and a freed slot is reused', async () => {
    await h.service.clear()
    h = await fileCommentHarness({ service: { watchMax: 2 } })
    for (const name of ['a.txt', 'b.txt', 'c.txt']) await h.project.write(name, DOC)
    await h.listOk('a.txt', { panelId: 'a' })
    await h.listOk('b.txt', { panelId: 'b' })
    expect((await h.listOk('c.txt', { panelId: 'c' })).ok).toBe(true)
    expect(h.service.watchCount).toBe(2)
    expect([...h.watches.open.keys()]).not.toContain(h.project.path('c.txt'))
    h.service.forgetWindow(1)
    expect(h.service.watchCount).toBe(0)
    await h.listOk('c.txt', { panelId: 'c' })
    expect([...h.watches.open.keys()]).toEqual([h.project.path('c.txt')])
  })

  it('024-AC-036 a released panel is forgotten and its watch freed; another panel on the file keeps the watch', async () => {
    await h.listOk('notes.txt', { panelId: 'a' })
    await h.listOk('notes.txt', { panelId: 'b' })
    expect(h.service.release(h.caller(), 'a')).toBe(true)
    expect(h.watches.closed).toEqual([])
    expect(await h.service.openDraft(h.caller(), { panelId: 'a', filePath: h.project.path('notes.txt') })).toEqual(NOT_OPEN)
    expect(h.service.release(h.caller(), 'b')).toBe(true)
    expect(h.watches.closed).toEqual([h.project.path('notes.txt')])
    expect(h.service.watchCount).toBe(0)
    // A change on disk now reaches no window: no panel shows the file.
    expect(h.service.release(h.caller(), 'b')).toBe(false)
  })

  it('024-AC-028 a release names a panel of the sender\'s window only: the same panel id in another window stays', async () => {
    await h.listOk('notes.txt', { windowId: 1, panelId: PANEL })
    await h.listOk('notes.txt', { windowId: 2, panelId: PANEL })
    expect(h.service.release(h.caller(2), PANEL)).toBe(true)
    expect(h.service.watchCount).toBe(1)
    expect(await h.service.openDraft(h.caller(1), { panelId: PANEL, filePath: h.project.path('notes.txt') })).toMatchObject({ ok: true })
    expect(await h.service.openDraft(h.caller(2), { panelId: PANEL, filePath: h.project.path('notes.txt') })).toEqual(NOT_OPEN)
  })

  it('024-AC-036 freed by releases, the watch cap serves new files again', async () => {
    await h.service.clear()
    h = await fileCommentHarness({ service: { watchMax: 1 } })
    for (const name of ['a.txt', 'b.txt']) await h.project.write(name, DOC)
    await h.listOk('a.txt', { panelId: 'a' })
    await h.listOk('b.txt', { panelId: 'b' })
    expect([...h.watches.open.keys()]).toEqual([h.project.path('a.txt')])
    h.service.release(h.caller(), 'a')
    await h.listOk('b.txt', { panelId: 'b' })
    expect([...h.watches.open.keys()]).toEqual([h.project.path('b.txt')])
  })

  it('a project change closes every watch and forgets every panel', async () => {
    await h.listOk('notes.txt')
    await h.service.clear()
    expect(h.service.watchCount).toBe(0)
    expect(await h.service.openDraft(h.caller(), { panelId: PANEL, filePath: h.project.path('notes.txt') })).toEqual(NOT_OPEN)
  })
})
