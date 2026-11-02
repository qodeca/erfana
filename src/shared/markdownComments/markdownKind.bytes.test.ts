// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * 024-AC-013: byte-exact saves in Markdown files (024-FR-012; design
 * `markdown-format.md` § 1, § 2). For every file of the matrix and every
 * target in it, each action changes ONE contiguous byte range: an add
 * inserts exactly `indent + block + eol` at a line start (spaces only, the
 * line's own line break), a reply, edit, resolve or reopen replaces only
 * `<!--` … `-->`, and delete gives the original bytes back.
 */
import { describe, expect, it } from 'vitest'
import { encodeText } from '../comments/encoding'
import { isSafeCommentText } from '../comments/format'
import { eolAt, verifySpliceBytes, type SplicePlan } from '../comments/splice'
import { addComment, changeThread, mdOf, parseMd, pickOf, written, type ThreadOp } from './__test-helpers__/mdHarness'

const BOM = '\uFEFF'
const NFD_E = 'e\u0301'

/** The 024-FR-012 matrix, plus the list of 024-AC-013. */
const MATRIX: Record<string, string> = {
  lf: '# Plan\n\nFirst paragraph.\n\n- one\n- two\n',
  crlf: '# Plan\r\n\r\nFirst paragraph.\r\n\r\n- one\r\n- two\r\n',
  'cr only': '# Plan\r\rFirst paragraph.\r\r- one\r- two\r',
  mixed: '# Plan\r\n\nFirst paragraph.\r\r\n- one\n- two\r',
  bom: `${BOM}# Plan\n\nFirst paragraph.\n`,
  'bom and frontmatter': `${BOM}---\ntitle: Plan\n---\n# Plan\n\nBody.\n`,
  'bom and frontmatter, crlf': `${BOM}---\r\ntitle: Plan\r\n---\r\nBody.\r\n`,
  'no final line break, target on the last line': 'One.\n\nLast paragraph',
  'one line': 'Only line.',
  tabs: '-\tone\n-\ttwo\n\n\t\tcode in a tab\n\nAfter\ttab.\n',
  'emoji before the target': '😀 🚀 ✨\n\nTarget after emoji.\n',
  nfd: `Caf${NFD_E} au lait.\n\n- ${NFD_E}l${NFD_E}ment\n`,
  'list with nested items': '- Freeze the API on Monday.\n- Run the load test.\n  - against staging\n  - against production\n- Tag the release.\n'
}

/** Where the bytes differ: the common prefix length and each side's differing middle. */
function contiguousChange(before: Uint8Array, after: Uint8Array): { start: number; removed: Uint8Array; added: Uint8Array } {
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1
  let tail = 0
  while (tail < before.length - start && tail < after.length - start && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail += 1
  return { start, removed: before.subarray(start, before.length - tail), added: after.subarray(start, after.length - tail) }
}

/** True when `plan` replaced exactly one block's `<!--` … `-->` with another. */
function isNodeReplace(text: string, plan: SplicePlan): boolean {
  const old = text.slice(plan.start, plan.end)
  return plan.op === 'replace' && old.startsWith('<!--') && old.endsWith('-->') && isSafeCommentText(plan.insert)
}

/** True when `plan` is the `line-start` shape at a line start, with the line's own line break. */
function isLineStartInsert(text: string, plan: SplicePlan): boolean {
  const eol = eolAt(text, plan.start)
  const indent = /^ */.exec(plan.insert)![0]
  const block = plan.insert.slice(indent.length, plan.insert.length - eol.length)
  const lineStart = plan.start === (text.startsWith(BOM) ? 1 : 0) || /[\r\n]$/.test(text.slice(0, plan.start))
  return plan.op === 'insert' && lineStart && plan.insert.endsWith(eol) && isSafeCommentText(block) && block.split(/\r\n|\r|\n/).slice(1).every(line => line.startsWith(indent))
}

const OPS: readonly ThreadOp[] = ['reply', 'edit', 'resolve', 'reopen']

describe('024-AC-013 byte-exact saves (Markdown)', () => {
  for (const [name, original] of Object.entries(MATRIX)) {
    it(`024-AC-013 ${name}: each action is one permitted contiguous change, and delete restores the bytes`, () => {
      const doc = parseMd(original)
      const targets = mdOf(doc).elements
      expect(targets.length).toBeGreaterThan(0)
      const originalBytes = encodeText(original)
      for (const target of targets) {
        const added = written(addComment(original, pickOf(doc, target)))
        const addedBytes = encodeText(added.text)
        expect(isLineStartInsert(original, added.plan), `${name} ${target.path}`).toBe(true)
        expect(verifySpliceBytes(originalBytes, addedBytes, original, added.plan)).toBe(true)
        const change = contiguousChange(originalBytes, addedBytes)
        expect(change.removed.length).toBe(0)
        // The differing middle is the insert (possibly shifted where it repeats its neighbours).
        expect(change.added.length).toBe(encodeText(added.plan.insert).length)

        let text = added.text
        for (const op of OPS) {
          const step = written(changeThread(text, added.data!.id, op))
          expect(isNodeReplace(text, step.plan), `${name} ${op}`).toBe(true)
          expect(verifySpliceBytes(encodeText(text), encodeText(step.text), text, step.plan)).toBe(true)
          text = step.text
        }
        const removed = written(changeThread(text, added.data!.id, 'delete'))
        expect(encodeText(removed.text)).toEqual(originalBytes)
      }
    })
  }

  it('024-AC-013 a list with comments on item 1, item 2 and a nested item, all at once; deleting them in any order restores the file', () => {
    const original = MATRIX['list with nested items']
    let text = original
    const ids: string[] = []
    for (const match of ['Freeze', 'Run the load', 'against production']) {
      const doc = parseMd(text)
      const target = mdOf(doc).elements.filter(t => t.kind === 'item' && mdOf(doc).visibleText.slice(t.textStart, t.textEnd).trim().startsWith(match))[0]
      const added = written(addComment(text, pickOf(doc, target)))
      ids.push(added.data!.id)
      text = added.text
    }
    const doc = parseMd(text)
    expect(doc.state.blocks.map(b => b.kind === 'ok' && b.target.state)).toEqual(['attached', 'attached', 'attached'])
    for (const id of [ids[1], ids[0], ids[2]]) text = written(changeThread(text, id, 'delete')).text
    expect(text).toBe(original)
  })
})
