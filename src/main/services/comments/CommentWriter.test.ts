// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * CommentWriter on real files in a temp project (docs/designs/comments/html-preview-comments.md
 * §7.6, §7.7; M-001–M-003, M-007, M-008, M-011–M-013, M-015–M-019, M-056).
 * Byte identity and damaged blocks: `CommentWriter.bytes.test.ts`; path
 * rules: `CommentWriter.confinement.test.ts`; races and fs failures (mocked
 * fs): `CommentWriter.race.test.ts`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { chmod, lstat, mkdir, readlink, rm, stat, symlink, unlink } from 'node:fs/promises'
import { ErrorCode } from '../../../shared/errors'
import { PREVIEW_LIMITS } from '../../../shared/preview-limits'
import { serializeBlock, type CommentData } from '../../../shared/htmlComments'
import {
  ch,
  fixedId,
  makeComment,
  makeReply,
  RLO,
  seededRandom,
  unit
} from '../../../shared/comments/__fixtures__/commentTestData'
import { stablePathDigest } from '../../../shared/stablePathDigest'
import { sha256Hex } from '../../utils/atomicWriteBytesStrict'
import {
  PAGE,
  VIEW,
  blocksOf,
  byId,
  draftFor,
  makeProject,
  makeWriter,
  okBlock,
  snapshot,
  type TempProject
} from '../preview/comments/__test-helpers__/commentWriterHarness'
import type { CommentFileJob, CommentFileJobRunner, CommentJobOutcome } from './commentFileJobs'
import { createInProcessCommentFileJobs } from '../preview/comments/htmlCommentJobs'
import { commentFileLock } from './commentFileLock'
import { CommentWriter, type CommentWriteResult } from './CommentWriter'

const posixOnly = process.platform === 'win32' ? it.skip : it
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0

let project: TempProject

beforeEach(async () => {
  project = await makeProject()
})

afterEach(async () => {
  await project.dispose()
})

/** Add a comment on the element `id` of `rel`, drafting from `draftBytes` (default: the file now). */
async function addOn(
  writer: CommentWriter,
  rel: string,
  id: string,
  text = 'Make it blue.',
  draftBytes?: Uint8Array
): Promise<CommentWriteResult> {
  const bytes = draftBytes ?? (await project.read(rel))
  return writer.add({ file: project.target(rel), draft: draftFor(bytes, byId(id)), view: VIEW, text })
}

function threadIdOf(result: CommentWriteResult): string {
  if (!result.ok || result.threadId === null) throw new Error(`write failed: ${JSON.stringify(result)}`)
  return result.threadId
}

/** The file's text with the block `id` removed, by its parsed range. */
function withoutBlock(bytes: Buffer, id: string): string {
  const { range } = okBlock(bytes, id)
  const text = bytes.toString('utf8')
  return text.slice(0, range[0]) + text.slice(range[1])
}

describe('CommentWriter.add', () => {
  it('M-001 re-reads the file, writes one block before the element and returns the thread id', async () => {
    await project.write('index.html', PAGE)
    const { writer } = makeWriter()

    const result = await addOn(writer, 'index.html', 'buy')

    const after = await project.read('index.html')
    expect(result).toEqual({
      ok: true,
      realPath: project.path('index.html'),
      fileHash: sha256Hex(after),
      threadId: expect.stringMatching(/^c-[a-z2-7]{16}$/)
    })
    const block = okBlock(after, threadIdOf(result))
    expect(block.target).toMatchObject({ state: 'attached', via: 'position' })
    expect(block.data.anchor).toMatchObject({ tag: 'button', id: 'buy', cls: ['cta'] })
    expect(block.data.msgs).toEqual([
      {
        id: expect.stringMatching(/^m-/),
        by: { name: 'Ada Lovelace', email: 'ada@example.com', role: 'human' },
        at: '2026-10-25T14:03:00Z',
        text: 'Make it blue.'
      }
    ])
    // Only the block was inserted, on its own lines: the target line is unchanged
    expect(withoutBlock(after, threadIdOf(result))).toBe(PAGE)
    expect(after.toString('utf8')).toContain('-->\n    <button id="buy" class="cta">Buy now</button>\n')
  })

  it('§19 Rev 4 bytes lent to the worker: the splice goes into the bytes it handed back, and the write is the same', async () => {
    await project.write('index.html', PAGE)
    await project.write('copy.html', PAGE)
    const inner = createInProcessCommentFileJobs({ random: seededRandom(7) })
    let lentView: Uint8Array | undefined
    const lending: CommentFileJobRunner = {
      async runJob(bytes, job) {
        lentView = bytes
        // The transfer empties the writer's own view; the worker hands the same memory back.
        const raw = structuredClone(bytes, { transfer: [bytes.buffer as ArrayBuffer] })
        return { ...(await inner.runJob(raw, job)), raw }
      }
    }

    const lent = await addOn(makeWriter({ jobs: lending }).writer, 'index.html', 'buy')
    const copied = await addOn(makeWriter().writer, 'copy.html', 'buy')

    expect(lent.ok).toBe(true)
    expect(lentView?.length).toBe(0)
    expect((await project.read('index.html')).equals(await project.read('copy.html'))).toBe(true)
    expect(lent.ok && copied.ok && lent.fileHash === copied.fileHash).toBe(true)
  })

  it('M-002 the file changed meanwhile and the element is still found: written at its new offset, the outside edit kept', async () => {
    await project.write('index.html', PAGE)
    const draftBytes = await project.read('index.html')
    const agentEdit = PAGE.replace(
      '    <p>Pricing <em>today</em></p>',
      '    <h1>Shop</h1>\n    <p>Pricing <em>today</em> and tomorrow</p>'
    )
    await project.write('index.html', agentEdit)
    const { writer } = makeWriter()

    const result = await addOn(writer, 'index.html', 'buy', 'Bigger.', draftBytes)

    const after = await project.read('index.html')
    expect(withoutBlock(after, threadIdOf(result))).toBe(agentEdit)
    expect(okBlock(after, threadIdOf(result)).target).toMatchObject({ state: 'attached', via: 'position' })
  })

  it('M-003 the element is gone from the file: COMMENT_TARGET_MOVED, nothing written', async () => {
    await project.write('index.html', PAGE)
    const draftBytes = await project.read('index.html')
    await project.write('index.html', PAGE.replace('    <button id="buy" class="cta">Buy now</button>\n', ''))
    const before = await snapshot(project.path('index.html'))
    const { writer } = makeWriter()

    const result = await addOn(writer, 'index.html', 'buy', 'Bigger.', draftBytes)

    expect(result).toEqual({ ok: false, code: ErrorCode.COMMENT_TARGET_MOVED, reason: 'target-moved' })
    expect(await snapshot(project.path('index.html'))).toEqual(before)
  })

  it('M-003 an unchanged file whose draft offset names another element is refused, not guessed', async () => {
    await project.write('index.html', PAGE)
    const bytes = await project.read('index.html')
    const draft = draftFor(bytes, byId('buy'))
    const { writer } = makeWriter()

    const shifted = await writer.add({
      file: project.target('index.html'),
      draft: { ...draft, offset: draft.offset + 1 },
      view: VIEW,
      text: 'x'
    })
    const faq = draftFor(bytes, byId('faq'))
    const wrongTag = await writer.add({
      file: project.target('index.html'),
      draft: { ...draft, offset: faq.offset },
      view: VIEW,
      text: 'x'
    })

    expect(shifted).toMatchObject({ ok: false, code: ErrorCode.COMMENT_TARGET_MOVED })
    expect(wrongTag).toMatchObject({ ok: false, code: ErrorCode.COMMENT_TARGET_MOVED })
    expect((await project.read('index.html')).equals(bytes)).toBe(true)
  })

  // root writes through the missing permission
  it.skipIf(isRoot)('M-007 a read-only file is refused with COMMENT_FILE_READ_ONLY and keeps its bytes', async () => {
    const path = await project.write('index.html', PAGE)
    await chmod(path, 0o444)
    try {
      const before = await snapshot(path)

      const result = await addOn(makeWriter().writer, 'index.html', 'buy')

      expect(result).toEqual({ ok: false, code: ErrorCode.COMMENT_FILE_READ_ONLY, reason: 'read-only' })
      expect(await snapshot(path)).toEqual(before)
    } finally {
      await chmod(path, 0o666)
    }
  })

  posixOnly('M-007 the file keeps its permission bits', async () => {
    const path = await project.write('index.html', PAGE)
    await chmod(path, 0o640)

    expect((await addOn(makeWriter().writer, 'index.html', 'buy')).ok).toBe(true)

    expect((await stat(path)).mode & 0o777).toBe(0o640)
  })

  it('M-008 a file that is a symlink is refused with COMMENT_WRITE_REFUSED_LINK; link and target untouched', async () => {
    const real = await project.write('real.html', PAGE)
    await symlink(real, project.path('link.html'), 'file')
    const before = await snapshot(real)

    const result = await addOn(makeWriter().writer, 'link.html', 'buy')

    expect(result).toEqual({ ok: false, code: ErrorCode.COMMENT_WRITE_REFUSED_LINK, reason: 'link' })
    expect((await lstat(project.path('link.html'))).isSymbolicLink()).toBe(true)
    expect(await readlink(project.path('link.html'))).toBe(real)
    expect(await snapshot(real)).toEqual(before)
  })

  it('M-011 an editor with unsaved changes for the file blocks the save (COMMENT_UNSAVED_SOURCE); a clean one does not', async () => {
    await project.write('index.html', PAGE)
    const asked: string[] = []
    const dirty = makeWriter({
      hasUnsavedSource: realPath => {
        asked.push(realPath)
        return true
      }
    })

    const refusedResult = await addOn(dirty.writer, 'index.html', 'buy')

    expect(refusedResult).toEqual({ ok: false, code: ErrorCode.COMMENT_UNSAVED_SOURCE, reason: 'unsaved-source' })
    expect(asked).toEqual([project.path('index.html')])
    expect((await project.read('index.html')).toString('utf8')).toBe(PAGE)

    const clean = makeWriter({ hasUnsavedSource: async () => false })
    expect((await addOn(clean.writer, 'index.html', 'buy')).ok).toBe(true)
  })

  it('M-012 two saves on one file at once are serialised, and both blocks land', async () => {
    await project.write('index.html', PAGE)
    const draftBytes = await project.read('index.html')
    let release!: () => void
    const held = new Promise<void>(resolve => {
      release = resolve
    })
    let entered = 0
    const { writer } = makeWriter({
      hasUnsavedSource: async () => {
        entered += 1
        if (entered === 1) await held
        return false
      }
    })

    const first = addOn(writer, 'index.html', 'buy', 'First', draftBytes)
    const second = addOn(writer, 'index.html', 'faq', 'Second', draftBytes)
    await vi.waitFor(() => expect(commentFileLock.queued(project.path('index.html'))).toBe(2))

    expect(entered).toBe(1) // the second save waits for the first, it does not run beside it
    release()
    const [a, b] = await Promise.all([first, second])
    const after = await project.read('index.html')
    expect(blocksOf(after).map(block => block.kind)).toEqual(['ok', 'ok'])
    expect(okBlock(after, threadIdOf(a)).data.msgs[0].text).toBe('First')
    expect(okBlock(after, threadIdOf(b)).data.anchor.id).toBe('faq')
  })

  it('runs with the production defaults: the real clock, the crypto id source and the app logger', async () => {
    await project.write('index.html', PAGE)
    const writer = new CommentWriter({ identity: () => ({ name: 'Ada Lovelace' }), jobs: createInProcessCommentFileJobs() })
    const startedAt = Date.now()

    const result = await addOn(writer, 'index.html', 'buy')

    const at = Date.parse(okBlock(await project.read('index.html'), threadIdOf(result)).data.msgs[0].at)
    expect(at).toBeGreaterThanOrEqual(Math.floor(startedAt / 1000) * 1000)
    expect(at).toBeLessThanOrEqual(Date.now())
  })

  it('R3-12 by default the parse runs in the comment parse worker: with no worker bundle the save is refused and nothing is written', async () => {
    const path = await project.write('index.html', PAGE)
    const before = await snapshot(path)
    const writer = new CommentWriter({ identity: () => ({ name: 'Ada Lovelace' }) })

    const result = await addOn(writer, 'index.html', 'buy')

    expect(result).toEqual({ ok: false, code: ErrorCode.COMMENT_WRITE_FAILED, reason: 'parse-failed' })
    expect(await snapshot(path)).toEqual(before)
  })

  it('R3-12 a parse the worker could not run refuses the save – busy, or parse-failed – and writes nothing', async () => {
    const path = await project.write('index.html', PAGE)
    const before = await snapshot(path)
    for (const [failure, reason] of [['busy', 'busy'], ['timeout', 'parse-failed'], ['crashed', 'parse-failed']] as const) {
      const jobs = { runJob: vi.fn(async () => ({ kind: 'failed' as const, failure })) }
      const { writer } = makeWriter({ jobs: jobs as unknown as CommentFileJobRunner })

      expect(await addOn(writer, 'index.html', 'buy')).toEqual({ ok: false, code: ErrorCode.COMMENT_WRITE_FAILED, reason })
    }
    expect(await snapshot(path)).toEqual(before)
  })

  it('R3-12 main rebuilds the file from its own bytes: an answer naming a range outside them writes nothing', async () => {
    const path = await project.write('index.html', PAGE)
    const before = await snapshot(path)
    const real = createInProcessCommentFileJobs()
    const jobs: CommentFileJobRunner = {
      runJob: async (bytes, job) => {
        const answer = await real.runJob(bytes, job)
        const result: CommentJobOutcome<CommentFileJob> = answer
        return (result.kind === 'write' && result.ok ? { ...result, byteEnd: bytes.length + 1 } : answer) as typeof answer
      }
    }
    const { writer } = makeWriter({ jobs })

    expect(await addOn(writer, 'index.html', 'buy')).toEqual({ ok: false, code: ErrorCode.COMMENT_WRITE_FAILED, reason: 'verify-failed' })
    expect(await snapshot(path)).toEqual(before)
  })

  it('S-L-C main checks the bytes it inserts: an answer whose block could leave its comment writes nothing', async () => {
    const path = await project.write('index.html', PAGE)
    const before = await snapshot(path)
    const real = createInProcessCommentFileJobs()
    for (const hostile of ['<!-- a --><script>x()</script><!-- b -->', '<!-- note -- more -->', '<!-->', '\uFEFF<!-- note -->']) {
      const jobs: CommentFileJobRunner = {
        runJob: async (bytes, job) => {
          const answer = await real.runJob(bytes, job)
          const result: CommentJobOutcome<CommentFileJob> = answer
          return (result.kind === 'write' && result.ok ? { ...result, insert: new TextEncoder().encode(hostile) } : answer) as typeof answer
        }
      }
      const { writer } = makeWriter({ jobs })
      expect(await addOn(writer, 'index.html', 'buy'), hostile).toEqual({ ok: false, code: ErrorCode.COMMENT_WRITE_FAILED, reason: 'verify-failed' })
    }
    expect(await snapshot(path)).toEqual(before)
  })

  it('M-013 one save is one write, and its result carries the hash of the bytes now on disk for the echo filter', async () => {
    await project.write('index.html', PAGE)

    const result = await addOn(makeWriter().writer, 'index.html', 'buy')

    const after = await project.read('index.html')
    expect(result.ok && result.fileHash).toBe(sha256Hex(after))
    expect(blocksOf(after)).toHaveLength(1)
  })
})

describe('CommentWriter limits (M-015)', () => {
  it('M-015 a file over the 25 MB file limit is refused with COMMENT_FILE_TOO_LARGE', async () => {
    const big = PAGE.replace('</body>', `<!-- ${'x'.repeat(PREVIEW_LIMITS.COMMENT_FILE_MAX_BYTES)} -->\n</body>`)
    await project.write('index.html', big)
    const before = await snapshot(project.path('index.html'))

    const result = await addOn(makeWriter().writer, 'index.html', 'buy', 'x', Buffer.from(PAGE))

    expect(result).toEqual({ ok: false, code: ErrorCode.COMMENT_FILE_TOO_LARGE, reason: 'too-large' })
    // Buffer.equals, not toEqual: a deep compare of 25 MB element by element takes seconds
    const after = await snapshot(project.path('index.html'))
    expect(after.bytes.equals(before.bytes)).toBe(true)
    expect(after.mtimeMs).toBe(before.mtimeMs)
  })

  it('M-015 a file already holding the most blocks takes no new one (COMMENT_LIMIT)', async () => {
    const blocks: string[] = []
    for (let n = 1; n <= PREVIEW_LIMITS.COMMENT_MAX_BLOCKS_PER_FILE; n += 1) {
      const block = serializeBlock(makeComment({ id: fixedId('c-', n) }), { indent: '', eol: '\n' })
      if (!block.ok) throw new Error('fixture block')
      blocks.push(block.block)
    }
    await project.write('index.html', PAGE.replace('<section', `${blocks.join('')}<section`))

    const result = await addOn(makeWriter().writer, 'index.html', 'buy')

    expect(result).toEqual({ ok: false, code: ErrorCode.COMMENT_LIMIT, reason: 'limit' })
  })

  it('M-015 a reply past the most replies, and a message past 4,000 characters, are refused (COMMENT_LIMIT)', async () => {
    const replies = Array.from({ length: PREVIEW_LIMITS.COMMENT_MAX_REPLIES }, (_, i) => makeReply(i, `r${i}`))
    const full: CommentData = makeComment({ msgs: [...makeComment().msgs, ...replies] })
    const block = serializeBlock(full, { indent: '', eol: '\n' })
    if (!block.ok) throw new Error('fixture block')
    await project.write('index.html', PAGE.replace('<section', `${block.block}<section`))
    const before = await snapshot(project.path('index.html'))
    const { writer } = makeWriter()

    const reply = await writer.changeThread({
      file: project.target('index.html'),
      threadId: full.id,
      rawHash: okBlock(before.bytes, full.id).rawHash,
      change: { op: 'reply', text: 'one too many' }
    })
    const long = await addOn(writer, 'index.html', 'buy', 'x'.repeat(PREVIEW_LIMITS.COMMENT_MESSAGE_MAX_CHARS + 1))

    expect(reply).toEqual({ ok: false, code: ErrorCode.COMMENT_LIMIT, reason: 'limit' })
    expect(long).toEqual({ ok: false, code: ErrorCode.COMMENT_LIMIT, reason: 'limit' })
    expect(await snapshot(project.path('index.html'))).toEqual(before)
  })

  it('an empty message is invalid and is not written', async () => {
    await project.write('index.html', PAGE)

    const result = await addOn(makeWriter().writer, 'index.html', 'buy', '')

    expect(result).toEqual({ ok: false, code: ErrorCode.COMMENT_WRITE_FAILED, reason: 'invalid' })
  })
})

describe('CommentWriter identity (M-016, M-017)', () => {
  it('M-016 log lines hold no comment text, author, email, file name or absolute path', async () => {
    await project.write('marker-file-z1.html', PAGE)
    const { writer, log } = makeWriter({
      identity: () => ({ name: 'MARKER-NAME-q9', email: 'marker-mail@example.com' })
    })

    const added = await addOn(writer, 'marker-file-z1.html', 'buy', 'MARKER-TEXT-7f3a')
    const rawHash = okBlock(await project.read('marker-file-z1.html'), threadIdOf(added)).rawHash
    await writer.changeThread({
      file: project.target('marker-file-z1.html'),
      threadId: threadIdOf(added),
      rawHash: 'stale',
      change: { op: 'reply', text: 'MARKER-TEXT-7f3a' }
    })
    await writer.changeThread({
      file: project.target('marker-file-z1.html'),
      threadId: threadIdOf(added),
      rawHash,
      change: { op: 'deleteThread' }
    })

    const logged = JSON.stringify([...log.info.mock.calls, ...log.warn.mock.calls])
    expect(log.info).toHaveBeenCalledTimes(2)
    expect(log.warn).toHaveBeenCalledTimes(1)
    // The root as typed and as JSON escapes it (Windows backslashes)
    const roots = [project.root, JSON.stringify(project.root).slice(1, -1)]
    for (const secret of ['MARKER-TEXT', 'MARKER-NAME', 'marker-mail', 'marker-file-z1', ...roots]) {
      expect(logged).not.toContain(secret)
    }
    expect(logged).toContain(stablePathDigest(project.path('marker-file-z1.html')))
  })

  it.each<[string, () => { name: string; email?: string } | undefined]>([
    ['no identity', () => undefined],
    ['a blank name', () => ({ name: '   ' })],
    ['a name over 100 characters', () => ({ name: 'n'.repeat(PREVIEW_LIMITS.COMMENT_AUTHOR_NAME_MAX_CHARS + 1) })],
    ['a bidi override in the name', () => ({ name: `Ada${RLO}evil` })],
    ['a control character in the email', () => ({ name: 'Ada', email: `ada${unit(0x0a)}@example.com` })],
    ['an email over 254 characters', () => ({ name: 'Ada', email: `${'e'.repeat(250)}@x.io` })],
    // Security review F5: refused by Unicode property, not by a hand list
    ['tag characters in the name', () => ({ name: `Ada${ch(0xe0072)}${ch(0xe006d)}` })],
    ['a word joiner in the name', () => ({ name: `Ada${unit(0x2060)}Lovelace` })],
    ['a soft hyphen in the name', () => ({ name: `Ada${unit(0xad)}Lovelace` })],
    ['a Hangul filler as the name', () => ({ name: unit(0x3164) })],
    ['a variation selector in the name', () => ({ name: `Ada${unit(0xfe00)}` })],
    ['a private-use character in the email', () => ({ name: 'Ada', email: `ada${unit(0xe000)}@example.com` })],
    ['an unassigned code point in the name', () => ({ name: `Ada${unit(0xfdd0)}` })],
    ['a lone surrogate in the name', () => ({ name: `Ada${unit(0xd800)}` })]
  ])('M-017 %s → COMMENT_IDENTITY_REQUIRED, nothing written', async (_name, identity) => {
    await project.write('index.html', PAGE)
    const before = await snapshot(project.path('index.html'))

    const result = await addOn(makeWriter({ identity }).writer, 'index.html', 'buy')

    expect(result).toEqual({ ok: false, code: ErrorCode.COMMENT_IDENTITY_REQUIRED, reason: 'identity' })
    expect(await snapshot(project.path('index.html'))).toEqual(before)
  })

  it('M-017 a reply and a status change need an identity; an edit or a delete, which write no author, do not', async () => {
    await project.write('index.html', PAGE)
    const threadId = threadIdOf(await addOn(makeWriter().writer, 'index.html', 'buy'))
    const anonymous = makeWriter({ identity: () => undefined }).writer
    const change = async (c: Parameters<CommentWriter['changeThread']>[0]['change']) => {
      const bytes = await project.read('index.html')
      return anonymous.changeThread({
        file: project.target('index.html'),
        threadId,
        rawHash: okBlock(bytes, threadId).rawHash,
        change: c
      })
    }
    const messageId = okBlock(await project.read('index.html'), threadId).data.msgs[0].id

    expect(await change({ op: 'reply', text: 'x' })).toMatchObject({ code: ErrorCode.COMMENT_IDENTITY_REQUIRED })
    expect(await change({ op: 'setStatus', status: 'resolved' })).toMatchObject({ code: ErrorCode.COMMENT_IDENTITY_REQUIRED })
    expect(await change({ op: 'editMessage', messageId, text: 'Edited.' })).toMatchObject({ ok: true })
    expect(await change({ op: 'deleteThread' })).toMatchObject({ ok: true, threadId: null })
  })

  it('trims the name and leaves out an empty email', async () => {
    await project.write('index.html', PAGE)
    const { writer } = makeWriter({ identity: async () => ({ name: '  Grace Hopper ', email: '  ' }) })

    const result = await addOn(writer, 'index.html', 'buy')

    expect(okBlock(await project.read('index.html'), threadIdOf(result)).data.msgs[0].by).toEqual({
      name: 'Grace Hopper',
      role: 'human'
    })
  })
})

describe('CommentWriter.changeThread', () => {
  async function seeded(): Promise<{ writer: CommentWriter; threadId: string }> {
    await project.write('index.html', PAGE)
    const { writer } = makeWriter()
    return { writer, threadId: threadIdOf(await addOn(writer, 'index.html', 'buy', 'First.')) }
  }

  async function change(
    writer: CommentWriter,
    threadId: string,
    c: Parameters<CommentWriter['changeThread']>[0]['change']
  ): Promise<CommentWriteResult> {
    const bytes = await project.read('index.html')
    return writer.changeThread({
      file: project.target('index.html'),
      threadId,
      rawHash: okBlock(bytes, threadId).rawHash,
      change: c
    })
  }

  it('M-018 anyone may edit or delete any comment: another reviewer edits, replies to and deletes messages', async () => {
    const { threadId } = await seeded()
    const grace = makeWriter({ identity: () => ({ name: 'Grace Hopper' }) }).writer
    const adaMessage = okBlock(await project.read('index.html'), threadId).data.msgs[0].id

    expect(await change(grace, threadId, { op: 'editMessage', messageId: adaMessage, text: 'Edited by Grace.' })).toMatchObject({ ok: true, threadId })
    expect(await change(grace, threadId, { op: 'reply', text: 'Agreed.' })).toMatchObject({ ok: true })
    const data = okBlock(await project.read('index.html'), threadId).data
    expect(data.msgs[0]).toMatchObject({ by: { name: 'Ada Lovelace' }, text: 'Edited by Grace.', edited: '2026-10-25T14:03:00Z' })
    expect(data.msgs[1]).toMatchObject({ by: { name: 'Grace Hopper', role: 'human' }, text: 'Agreed.' })

    const ada = makeWriter().writer
    expect(await change(ada, threadId, { op: 'deleteMessage', messageId: data.msgs[1].id })).toMatchObject({ ok: true, threadId })
    expect(okBlock(await project.read('index.html'), threadId).data.msgs).toHaveLength(1)
  })

  it('add → reply → edit → resolve → re-open → delete the first message gives back the original bytes', async () => {
    const { writer, threadId } = await seeded()

    expect(await change(writer, threadId, { op: 'reply', text: 'Reply.' })).toMatchObject({ ok: true })
    const [first, second] = okBlock(await project.read('index.html'), threadId).data.msgs
    expect(await change(writer, threadId, { op: 'editMessage', messageId: second.id, text: 'Edited.' })).toMatchObject({ ok: true })
    expect(await change(writer, threadId, { op: 'setStatus', status: 'resolved' })).toMatchObject({ ok: true })
    expect(okBlock(await project.read('index.html'), threadId).data).toMatchObject({
      status: 'resolved',
      resolved: { by: { name: 'Ada Lovelace' }, at: '2026-10-25T14:03:00Z' }
    })
    expect(await change(writer, threadId, { op: 'setStatus', status: 'open' })).toMatchObject({ ok: true })
    expect(okBlock(await project.read('index.html'), threadId).data.resolved).toBeUndefined()

    // Deleting the first message deletes the thread (§7.7)
    expect(await change(writer, threadId, { op: 'deleteMessage', messageId: first.id })).toMatchObject({ ok: true, threadId: null })
    expect((await project.read('index.html')).toString('utf8')).toBe(PAGE)
  })

  it('M-019 a block that changed since the window read it is refused with COMMENT_BLOCK_CHANGED', async () => {
    const { writer, threadId } = await seeded()
    const staleHash = okBlock(await project.read('index.html'), threadId).rawHash
    expect(await change(writer, threadId, { op: 'reply', text: 'Someone else replied.' })).toMatchObject({ ok: true })
    const before = await snapshot(project.path('index.html'))

    const result = await writer.changeThread({
      file: project.target('index.html'),
      threadId,
      rawHash: staleHash,
      change: { op: 'editMessage', messageId: 'm-aaaaaaaaaaaaaaaa', text: 'x' }
    })

    expect(result).toEqual({ ok: false, code: ErrorCode.COMMENT_BLOCK_CHANGED, reason: 'block-changed' })
    expect(await snapshot(project.path('index.html'))).toEqual(before)
  })

  it('M-019 an unknown thread or message is refused with COMMENT_BLOCK_CHANGED', async () => {
    const { writer, threadId } = await seeded()
    const rawHash = okBlock(await project.read('index.html'), threadId).rawHash

    const noThread = await writer.changeThread({
      file: project.target('index.html'),
      threadId: 'c-aaaaaaaaaaaaaaaa',
      rawHash,
      change: { op: 'deleteThread' }
    })
    const noMessage = await change(writer, threadId, { op: 'editMessage', messageId: 'm-aaaaaaaaaaaaaaaa', text: 'x' })
    const noMessageToDelete = await change(writer, threadId, { op: 'deleteMessage', messageId: 'm-aaaaaaaaaaaaaaaa' })

    for (const result of [noThread, noMessage, noMessageToDelete]) {
      expect(result).toEqual({ ok: false, code: ErrorCode.COMMENT_BLOCK_CHANGED, reason: 'block-changed' })
    }
  })
})

describe('CommentWriter – file gone (M-056)', () => {
  it('M-056 a file deleted while the window was open: COMMENT_FILE_GONE, and the file is not re-created', async () => {
    await project.write('index.html', PAGE)
    const draftBytes = await project.read('index.html')
    await unlink(project.path('index.html'))

    const result = await addOn(makeWriter().writer, 'index.html', 'buy', 'x', draftBytes)

    expect(result).toEqual({ ok: false, code: ErrorCode.COMMENT_FILE_GONE, reason: 'missing' })
    await expect(stat(project.path('index.html'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('M-056 a folder deleted, and a file replaced by a folder, are both COMMENT_FILE_GONE', async () => {
    await mkdir(project.path('pages'))
    await project.write('pages/a.html', PAGE)
    await project.write('b.html', PAGE)
    const draftBytes = Buffer.from(PAGE)
    await rm(project.path('pages'), { recursive: true })
    await unlink(project.path('b.html'))
    await mkdir(project.path('b.html'))
    const { writer } = makeWriter()

    expect(await addOn(writer, 'pages/a.html', 'buy', 'x', draftBytes)).toMatchObject({ code: ErrorCode.COMMENT_FILE_GONE })
    expect(await addOn(writer, 'b.html', 'buy', 'x', draftBytes)).toMatchObject({ code: ErrorCode.COMMENT_FILE_GONE })
  })
})
