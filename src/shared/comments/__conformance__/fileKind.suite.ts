// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The shared file-kind suite (spec 024, 024-FR-002, 024-AC-002, 024-FR-012;
 * architecture note 001 § 3 "`.txt` test preview": add, reply, edit,
 * resolve, reopen, delete, byte identity, refused save).
 *
 * A file kind passes when the shared base – writer, list and save flow –
 * serves it unchanged: every action leaves one valid block, changes only the
 * block's own bytes, and delete gives the file back byte for byte, across
 * line-ending styles and a byte order mark; a refused save writes nothing.
 * Each kind runs it behind a {@link FileKindDriver}
 * (`src/main/services/comments/__conformance__/txt/` for the `.txt` kind).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FileKindCase, FileKindDriver, FileKindThread, FileKindThreadOp } from './fileKindDriver'

const BLOCK_HEADER = '<!-- erfana:comment v1 id='
/** U+FEFF: a decoded byte order mark. */
const BOM = String.fromCharCode(0xfeff)

/** The bytes as text, a byte order mark kept as U+FEFF. */
const decode = (bytes: Uint8Array): string => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)

/** The text `after` inserted into `before`, or `null` when `after` is not `before` with one insertion. */
function insertionOf(before: string, after: string): { readonly at: number; readonly text: string } | null {
  let at = 0
  while (at < before.length && before[at] === after[at]) at += 1
  const length = after.length - before.length
  if (length <= 0 || after.slice(0, at) + after.slice(at + length) !== before) return null
  return { at, text: after.slice(at, at + length) }
}

/** `[start, end)` of every block in `text`: `<!--` to its `-->`. */
function blockSpans(text: string): Array<readonly [number, number]> {
  const spans: Array<readonly [number, number]> = []
  for (let at = text.indexOf(BLOCK_HEADER); at !== -1; at = text.indexOf(BLOCK_HEADER, at + 1)) {
    const close = text.indexOf('-->', at)
    spans.push([at, close === -1 ? text.length : close + 3])
  }
  return spans
}

/**
 * Run the file-kind suite against one kind.
 *
 * @param name - The kind, as the describe block names it.
 * @param makeDriver - A fresh driver on an empty project. Called once per test.
 */
export function runFileKindSuite(name: string, makeDriver: () => Promise<FileKindDriver>): void {
  describe(`file kind – ${name}`, () => {
    let d: FileKindDriver

    beforeEach(async () => {
      d = await makeDriver()
    })

    afterEach(async () => {
      await d.dispose()
    })

    const text = async (c: FileKindCase): Promise<string> => decode(await d.read(c.name))
    const only = async (c: FileKindCase): Promise<FileKindThread> => {
      const { threads } = await d.list(c.name)
      expect(threads, c.label).toHaveLength(1)
      return threads[0]
    }
    /** Write `c` and add one comment on its target. */
    const added = async (c: FileKindCase, message = 'Please review this.'): Promise<FileKindThread> => {
      await d.write(c.name, c.text)
      expect(await d.add(c.name, c.target, message), c.label).toMatchObject({ ok: true })
      return only(c)
    }
    /** Run `op` on the one thread and check that only the block's own bytes changed. */
    const changeOnlyBlock = async (c: FileKindCase, op: FileKindThreadOp): Promise<FileKindThread> => {
      const before = await text(c)
      const [[start, end]] = blockSpans(before)
      expect(await d.change(c.name, await only(c), op), `${c.label} ${op.op}`).toMatchObject({ ok: true })
      const after = await text(c)
      const [[newStart, newEnd]] = blockSpans(after)
      expect(newStart, `${c.label} ${op.op}: the block starts where it did`).toBe(start)
      expect(after.slice(0, newStart), `${c.label} ${op.op}: bytes before the block`).toBe(before.slice(0, start))
      expect(after.slice(newEnd), `${c.label} ${op.op}: bytes after the block`).toBe(before.slice(end))
      return only(c)
    }

    it('FK-01 the kind supplies files with LF, CRLF and mixed line endings, a BOM and no final line break', () => {
      const texts = d.cases.map(c => c.text)
      expect(texts.some(t => /[^\r]\n/.test(t) && !t.includes('\r'))).toBe(true)
      expect(texts.some(t => t.includes('\r\n') && !/[^\r]\n/.test(t))).toBe(true)
      expect(texts.some(t => t.includes('\r\n') && /[^\r]\n/.test(t))).toBe(true)
      expect(texts.some(t => t.startsWith(BOM))).toBe(true)
      expect(texts.some(t => !/[\r\n]$/.test(t))).toBe(true)
    })

    it('FK-02 add inserts one block before the target and changes no other byte; the list shows it open and attached', async () => {
      for (const c of d.cases) {
        const thread = await added(c, 'Add a date here.')
        const insertion = insertionOf(c.text, await text(c))
        expect(insertion, `${c.label}: one insertion`).not.toBeNull()
        const block = insertion!.text.trimStart()
        expect(block.startsWith(BLOCK_HEADER), c.label).toBe(true)
        expect(block, c.label).toContain(d.agentNoteFirstLine)
        expect(/-->(\r\n|\r|\n)$/.test(block), `${c.label}: the block ends its own line`).toBe(true)
        expect(c.text.indexOf(c.target), `${c.label}: the block is before the target`).toBeGreaterThanOrEqual(insertion!.at)
        expect(thread).toMatchObject({ status: 'open', attached: true, messages: [{ text: 'Add a date here.' }] })
      }
    })

    it('FK-03 delete gives the file back byte for byte', async () => {
      for (const c of d.cases) {
        const thread = await added(c)
        expect(await d.change(c.name, thread, { op: 'deleteThread' }), c.label).toEqual({ ok: true, threadKey: null })
        expect(await d.read(c.name), c.label).toEqual(new TextEncoder().encode(c.text))
        expect((await d.list(c.name)).threads, c.label).toEqual([])
      }
    })

    it('FK-04 reply, edit, resolve and reopen change only the block, and delete still gives the file back', async () => {
      for (const c of d.cases) {
        await added(c, 'First.')
        let thread = await changeOnlyBlock(c, { op: 'reply', text: 'A reply.' })
        expect(thread.messages.map(m => m.text), c.label).toEqual(['First.', 'A reply.'])
        thread = await changeOnlyBlock(c, { op: 'editMessage', messageId: thread.messages[0].id, text: 'First, edited.' })
        expect(thread.messages.map(m => m.text), c.label).toEqual(['First, edited.', 'A reply.'])
        thread = await changeOnlyBlock(c, { op: 'setStatus', status: 'resolved' })
        expect(thread.status, c.label).toBe('resolved')
        thread = await changeOnlyBlock(c, { op: 'setStatus', status: 'open' })
        expect(thread.status, c.label).toBe('open')
        expect(await d.change(c.name, thread, { op: 'deleteThread' }), c.label).toMatchObject({ ok: true })
        expect(await d.read(c.name), c.label).toEqual(new TextEncoder().encode(c.text))
      }
    })

    it('FK-05 a second comment on the same target is a second block at the same place; both delete back to the file', async () => {
      const [c] = d.cases
      await added(c, 'One.')
      expect(await d.add(c.name, c.target, 'Two.')).toMatchObject({ ok: true })
      const { threads } = await d.list(c.name)
      expect(threads.map(t => t.messages[0].text).sort()).toEqual(['One.', 'Two.'])
      expect(threads.every(t => t.attached && t.status === 'open')).toBe(true)
      const [first, second] = blockSpans(await text(c))
      expect(second[0] - first[1], 'the blocks are on consecutive lines').toBeLessThanOrEqual(2)
      for (const thread of threads) expect(await d.change(c.name, thread, { op: 'deleteThread' })).toMatchObject({ ok: true })
      expect(await d.read(c.name)).toEqual(new TextEncoder().encode(c.text))
    })

    it('FK-06 a comment stays attached when text is added before its target', async () => {
      const [c] = d.cases
      await added(c)
      await d.write(c.name, `An added first paragraph.\n\n${await text(c)}`)
      expect(await only(c)).toMatchObject({ status: 'open', attached: true })
    })

    it('FK-07 refused save: a thread changed since it was listed writes nothing', async () => {
      const [c] = d.cases
      const stale = await added(c, 'First.')
      expect(await d.change(c.name, stale, { op: 'reply', text: 'Fresh.' })).toMatchObject({ ok: true })
      const bytes = await d.read(c.name)
      const refused = await d.change(c.name, stale, { op: 'setStatus', status: 'resolved' })
      expect(refused.ok).toBe(false)
      expect(await d.read(c.name)).toEqual(bytes)
      expect((await only(c)).status).toBe('open')
    })

    it('FK-08 refused save: unsaved edits in an editor write nothing; once saved, the comment is written', async () => {
      const [c] = d.cases
      await d.write(c.name, c.text)
      d.setUnsaved(c.name, true)
      const refused = await d.add(c.name, c.target, 'Not yet.')
      expect(refused.ok).toBe(false)
      expect(await d.read(c.name)).toEqual(new TextEncoder().encode(c.text))
      d.setUnsaved(c.name, false)
      expect(await d.add(c.name, c.target, 'Now.')).toMatchObject({ ok: true })
    })
  })
}
