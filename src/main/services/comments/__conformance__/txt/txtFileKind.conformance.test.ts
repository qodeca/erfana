// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The `.txt` conformance preview, main half (spec 024 024-FR-002,
 * 024-AC-002; architecture note 001 § 3 "`.txt` test preview", § 8 C24).
 *
 * The `.txt` kind (`src/shared/comments/__conformance__/txt/txtKind.ts`) is
 * registered the way a production kind is – in a frozen registry, with the
 * in-process job table every kind gets – and the shared file-kind suite runs
 * against it through the real `FileCommentService`, `CommentWriter` and save
 * flow, over a temporary project. Nothing in the base is told about `.txt`:
 * this folder and the kind are the whole preview, which
 * `scripts/check-seam-commit.mjs` confirms for the commit that adds them.
 */
import { describe, expect, it, vi } from 'vitest'
import { runFileKindSuite } from '../../../../../shared/comments/__conformance__/fileKind.suite'
import type { FileKindCase, FileKindDriver, FileKindThread } from '../../../../../shared/comments/__conformance__/fileKindDriver'
import { TXT_AGENT_NOTE, txtKind, type TxtParagraph } from '../../../../../shared/comments/__conformance__/txt/txtKind'
import { agentNoteProblem } from '../../../../../shared/comments/fileKind'
import { commentFileKinds, fileCommentKinds, frozenCommentFileKinds } from '../../commentFileKinds'
import { FileCommentService, type FileCommentCaller } from '../../FileCommentService'
import { createInProcessKindJobs } from '../../kindCommentJobs'
import { FIXED_NOW, PANEL, TEST_REVIEWER, VIEW, fakeWatches, makeProject, seededRandom } from '../../__test-helpers__/fileCommentHarness'

const BOM = String.fromCharCode(0xfeff)
const PARTY = String.fromCodePoint(0x1f389)

/** The files every action runs on (024-FR-012's matrix, as far as paragraphs go). */
const TXT_CASES: readonly FileKindCase[] = [
  { label: 'LF', name: 'lf.txt', text: 'Intro paragraph.\n\nThe release ships on Friday.\nIt needs a date.\n\nLast paragraph.\n', target: 'The release ships' },
  { label: 'CRLF', name: 'crlf.txt', text: 'Intro paragraph.\r\n\r\nThe release ships on Friday.\r\nIt needs a date.\r\n', target: 'The release ships' },
  { label: 'CR only', name: 'cr.txt', text: 'Intro paragraph.\r\rThe release ships on Friday.\r', target: 'The release ships' },
  { label: 'mixed line endings', name: 'mixed.txt', text: 'Intro.\r\n\r\nThe release ships on Friday.\nIt needs a date.\r\n\nLast.\n', target: 'The release ships' },
  { label: 'BOM, target on the first line', name: 'bom.txt', text: `${BOM}The release ships on Friday.\n\nLast paragraph.\n`, target: 'The release ships' },
  { label: 'no final line break, target on the last line', name: 'no-eol.txt', text: 'Intro paragraph.\n\nThe last paragraph has no line break', target: 'no line break' },
  { label: 'emoji before the target', name: 'emoji.txt', text: `Party ${PARTY} first.\n\nThe release ships on Friday.\n`, target: 'The release ships' }
]

/** The paragraph of `text` that holds `target`, by the kind's own parse. */
function paragraphHolding(text: string, target: string): TxtParagraph {
  const { index } = txtKind.parse(text, text.startsWith(BOM) ? 1 : 0)
  const found = (index.elements as readonly TxtParagraph[]).filter(el => index.visibleText.slice(el.textStart, el.textEnd).includes(target))
  if (found.length !== 1) throw new Error(`"${target}" is in ${found.length} paragraphs`)
  return found[0]
}

/** The `.txt` kind over the real file-comment flow, on a fresh project. */
async function txtDriver(): Promise<FileKindDriver> {
  const project = await makeProject()
  const unsaved = new Set<string>()
  const service = new FileCommentService({
    kinds: frozenCommentFileKinds([txtKind]),
    unsaved: { hasAny: vi.fn(async (realPath: string) => unsaved.has(realPath)) },
    identity: () => TEST_REVIEWER,
    send: vi.fn(),
    jobs: createInProcessKindJobs(txtKind, { random: seededRandom() }),
    watch: fakeWatches().factory,
    now: () => FIXED_NOW
  })
  const caller: FileCommentCaller = { windowId: 1, root: project.root, realRoot: project.root }
  const listed = async (name: string) => {
    const answer = await service.list(caller, { panelId: PANEL, filePath: project.path(name) })
    if (!answer.ok) throw new Error(`list refused: ${answer.code}`)
    return answer
  }
  return {
    kind: '.txt',
    agentNoteFirstLine: TXT_AGENT_NOTE[0],
    cases: TXT_CASES,
    write: async (name, text) => {
      await project.write(name, text)
    },
    read: async name => new Uint8Array(await project.read(name)),
    list: async name => {
      const { file } = await listed(name)
      const threads: FileKindThread[] = file.threads.map(t => ({
        threadKey: t.threadKey,
        rawHash: t.rawHash,
        status: t.status,
        attached: t.attached,
        messages: t.messages.map(m => ({ id: m.id, text: m.text }))
      }))
      return { writable: file.writable, threads }
    },
    add: async (name, target, text) => {
      await listed(name)
      const line = paragraphHolding((await project.read(name)).toString('utf8'), target).line
      const draft = await service.openDraft(caller, { panelId: PANEL, filePath: project.path(name) })
      if (!draft.ok) return { ok: false, code: draft.code }
      const filePath = project.path(name)
      const pick = { lineStart: line, lineEnd: line, tag: 'p', ordinal: 0 }
      const saved = await service.save(caller, { panelId: PANEL, filePath, op: 'add', draftToken: draft.draftToken, target: pick, text, view: VIEW })
      return saved.ok ? { ok: true, threadKey: saved.threadKey } : { ok: false, code: saved.code }
    },
    change: async (name, thread, op) => {
      const { file } = await listed(name)
      const saved = await service.save(caller, { panelId: PANEL, fileKey: file.fileKey, threadKey: thread.threadKey, rawHash: thread.rawHash, ...op })
      return saved.ok ? { ok: true, threadKey: saved.threadKey } : { ok: false, code: saved.code }
    },
    setUnsaved: (name, on) => {
      if (on) unsaved.add(project.path(name))
      else unsaved.delete(project.path(name))
    },
    dispose: async () => {
      await service.clear()
      await project.dispose()
    }
  }
}

describe('024-AC-002 the .txt test preview plugs into the shared base (main half)', () => {
  it('024-AC-002 the .txt kind supplies only a kind: its note passes registration, a frozen registry names it by extension, and no production registry holds it', () => {
    expect(agentNoteProblem(txtKind.agentNote)).toBeUndefined()
    const registry = frozenCommentFileKinds([txtKind])
    expect(registry.kindOfName('notes.txt')).toBe(txtKind)
    expect(registry.kindOfName('notes.md')).toBeUndefined()
    for (const production of [commentFileKinds, fileCommentKinds]) {
      expect(production.kindById('txt')).toBeUndefined()
      expect(production.kindOfName('notes.txt')).toBeUndefined()
    }
  })

  it('024-AC-002 the shared block classifier reads what the .txt kind writes: one ok block, attached to its paragraph', async () => {
    const d = await txtDriver()
    try {
      const [c] = TXT_CASES
      await d.write(c.name, c.text)
      expect(await d.add(c.name, c.target, 'Is Friday fixed?')).toMatchObject({ ok: true })
      const text = new TextDecoder().decode(await d.read(c.name))
      const { state } = txtKind.parse(text, 0)
      expect(state.blocks.map(b => b.kind)).toEqual(['ok'])
      expect(state.writable).toBe(true)
      const [block] = state.blocks
      if (block.kind !== 'ok') throw new Error('not ok')
      expect(block.data.anchor).toMatchObject({ tag: 'p', path: 'p:nth(2)', quote: { exact: 'The release ships on Friday. It needs a date.' } })
    } finally {
      await d.dispose()
    }
  })

  describe('024-AC-002 the shared file-kind suite passes against the .txt kind', () => {
    runFileKindSuite('.txt (FileCommentService, CommentWriter, in-process jobs)', txtDriver)
  })
})
