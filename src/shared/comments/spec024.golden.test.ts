// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Spec 024 format additions against the goldens and the frozen v0.23.1 copy
 * (024-AC-009 to 024-AC-012; architecture note 001 § 6 commit 11, § 8 C30).
 *
 * HOW THE FROZEN PARSER READS A MARKDOWN FILE. v0.23.1 reads HTML only: it
 * walks parse5's comment nodes. Its parser is therefore given a Markdown block
 * inside a minimal page (`pageWith`), and a whole Markdown file as it is: to an
 * HTML parser, Markdown text is character data in `<body>`, and `<!--` opens a
 * comment node there, so every block of the file becomes a comment node – the
 * same nodes the Markdown kind finds in CommonMark's `html` nodes. The goldens
 * hold no `<script>`, `<style>`, `<textarea>`, `<title>` or `<template>`, which
 * would hide a comment from parse5.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { analyzeCommentDocument as frozenAnalyze } from './__fixtures__/frozen-v0.23.1/parse'
import { planReplace as frozenPlanReplace, applySplice as frozenApplySplice } from './__fixtures__/frozen-v0.23.1/splice'
import { addReply as frozenAddReply, setStatus as frozenSetStatus } from './__fixtures__/frozen-v0.23.1/thread'
import { ADA, GRACE, FIXED_NOW, LATER, makeComment, pageWith } from './__fixtures__/commentTestData'
import { docExampleFiles, spec024Files, spec024Goldens } from './__fixtures__/gen/spec024'
import { MARKDOWN_CASES, SELECTION_CASES, SPEC024_BLOCK_CASES } from './__fixtures__/v1-spec024/cases'
import { HTML_AGENT_NOTE_LINES, MARKDOWN_AGENT_NOTE_LINES } from './agentNotes'
import { anchorSelectionOf } from './anchorSel'
import { decodeLossless } from './encoding'
import { AGENT_NOTE_LINES, CommentDataSchema, escapeJsonForComment, serializeBlock } from './format'
import { htmlKind } from './htmlKind'
import { WORDS_HINT_LEAD, wordsHint } from './noteLines'
import { addReply } from './thread'
import { CommentDataSchema as FrozenSchema, type CommentData as FrozenData } from './__fixtures__/frozen-v0.23.1/format'
import { analyzeCommentDocument } from '../htmlComments/parse'
import { applySplice, planReplace } from '../htmlComments/splice'

const FIXTURES = join(__dirname, '__fixtures__')
const FOLDER = 'v1-spec024'
const SPEC = join(__dirname, '..', '..', '..', 'docs', 'html-comments', 'format-v1.md')

const golden = (name: string): Uint8Array => new Uint8Array(readFileSync(join(FIXTURES, FOLDER, name)))
const goldenText = (name: string): string => {
  const decoded = decodeLossless(golden(name))
  if (!decoded.ok) throw new Error(`${name}: ${decoded.reason}`)
  return decoded.text
}

/** Every block of a parse as `ok` or `damaged: <reason>` / `newer`. */
function kinds(blocks: readonly { kind: string; reason?: string }[]): string[] {
  return blocks.map(block => (block.kind === 'damaged' ? `damaged: ${block.reason}` : block.kind))
}

const BLOCK_FILES = SPEC024_BLOCK_CASES.map(c => `${c.name}.block.txt`)
const WHOLE_FILES = [...spec024Files(), ...docExampleFiles()]

describe('spec 024 goldens (locked)', () => {
  it('024-AC-009 every golden equals what the serializer and planner write, byte for byte', () => {
    const built = spec024Goldens()
    for (const [name, bytes] of built) expect(golden(name), name).toEqual(bytes)
    const committed = readdirSync(join(FIXTURES, FOLDER)).filter(file => file !== 'cases.ts')
    expect(committed.sort()).toEqual([...built.keys()].sort())
  })

  it('024-AC-009 the SHA-256 lock matches every file in the folder, with none missing or extra', () => {
    const lock = JSON.parse(readFileSync(join(FIXTURES, `${FOLDER}.lock.json`), 'utf8')) as {
      algorithm: string
      files: Record<string, string>
    }
    expect(lock.algorithm).toBe('sha256')
    const actual: Record<string, string> = {}
    for (const file of readdirSync(join(FIXTURES, FOLDER))) {
      actual[`${FOLDER}/${file}`] = createHash('sha256').update(golden(file)).digest('hex')
    }
    // A shipped golden changed: change the format only on purpose – spec, goldens and lock together.
    expect(actual).toEqual(lock.files)
  })

  it('024-AC-009 git keeps the goldens\' bytes (`-text`, no line-ending conversion; C8)', () => {
    const root = join(__dirname, '..', '..', '..')
    for (const name of ['f03-markdown-mixed-crlf.md', 's02-html-selection-crlf-hostile.block.txt']) {
      const file = relative(root, join(FIXTURES, FOLDER, name)).replaceAll('\\', '/')
      const out = execFileSync('git', ['check-attr', 'text', '--', file], { cwd: root, encoding: 'utf8' })
      expect(out.trim()).toBe(`${file}: text: unset`)
    }
  })

  it('024-AC-009 the goldens cover selection, every Markdown @data kind, and both together', () => {
    expect(SELECTION_CASES.every(c => 'sel' in c.data.anchor)).toBe(true)
    expect(MARKDOWN_CASES.map(c => c.name)).toEqual([
      'm01-paragraph',
      'm02-heading',
      'm03-list-item-2',
      'm04-list-item-1',
      'm05-table-row',
      'm06-quote-inner',
      'm07-code-block',
      'm08-image',
      'm09-divider',
      'm10-html-block',
      'm11-selection'
    ])
    expect(anchorSelectionOf(MARKDOWN_CASES.at(-1)!.data.anchor)).toBeDefined()
  })
})

describe('024-AC-009 new samples are valid v1 blocks (current parser)', () => {
  it.each(SPEC024_BLOCK_CASES.map(c => [c.name, c] as const))('024-AC-009 %s parses ok with equal data', (name, c) => {
    const text = goldenText(`${name}.block.txt`)
    expect(text.startsWith('<!-- erfana:comment v1 id=')).toBe(true)
    const blocks = analyzeCommentDocument(pageWith(text)).state.blocks
    expect(kinds(blocks)).toEqual(['ok'])
    expect(blocks[0]).toMatchObject({ kind: 'ok', data: c.data })
  })

  it.each(WHOLE_FILES.map(f => [f.name, f.blocks] as const))('024-AC-009 whole file %s: %i blocks, each ok', (name, count) => {
    expect(kinds(analyzeCommentDocument(goldenText(name)).state.blocks)).toEqual(Array(count).fill('ok'))
  })

  it('024-AC-009 no golden needs a field v0.23.1 did not require: v0.23.1\'s schema accepts each, and so does the current one without anchor.sel', () => {
    for (const c of SPEC024_BLOCK_CASES) {
      expect(FrozenSchema.safeParse(c.data).success, c.name).toBe(true)
      const anchor = Object.fromEntries(Object.entries(c.data.anchor).filter(([key]) => key !== 'sel'))
      expect(CommentDataSchema.safeParse({ ...c.data, anchor }).success, c.name).toBe(true)
    }
    // And every block v0.23.1 accepted, the current schema accepts.
    expect(CommentDataSchema.safeParse(makeComment()).success).toBe(true)
  })

  it('024-AC-009 the Markdown goldens carry the target hint; the selection goldens the words hint, matching anchor.sel', () => {
    for (const c of SPEC024_BLOCK_CASES) {
      const text = goldenText(`${c.name}.block.txt`)
      expect(text.includes('target in Markdown (when commented): '), c.name).toBe(c.name.startsWith('m'))
      const sel = anchorSelectionOf(c.data.anchor)
      if (sel) expect(text, c.name).toContain(wordsHint(sel.exact))
      else expect(text, c.name).not.toContain(WORDS_HINT_LEAD)
    }
  })
})

describe('024-AC-010 frozen v0.23.1 parser reads every new sample', () => {
  it.each(BLOCK_FILES)('024-AC-010 %s reads ok in v0.23.1', name => {
    const blocks = frozenAnalyze(pageWith(goldenText(name))).state.blocks
    expect(kinds(blocks)).toEqual(['ok'])
  })

  it.each(WHOLE_FILES.map(f => [f.name, f.blocks] as const))('024-AC-010 whole file %s reads in v0.23.1 as %i ok blocks', (name, count) => {
    const doc = frozenAnalyze(goldenText(name))
    expect(doc.state.writable).toBe(true)
    expect(kinds(doc.state.blocks)).toEqual(Array(count).fill('ok'))
  })

  it('024-AC-010 canary: a block only the current parser accepts reads Damaged in v0.23.1', () => {
    // A readable-line extension a later version may add (C-01): tolerated now, not in v0.23.1.
    const block = serializeBlock(makeComment(), { indent: '', eol: '\n' })
    if (!block.ok) throw new Error(block.reason)
    const canary = pageWith(block.block.replace('target: <button class="cta">', 'target: <button class="cta"> (a later field)'))
    expect(kinds(analyzeCommentDocument(canary).state.blocks)).toEqual(['ok'])
    expect(kinds(frozenAnalyze(canary).state.blocks)).toEqual(['damaged: readable-mismatch'])
  })
})

describe('024-AC-011 the frozen v0.23.1 writer keeps anchor.sel', () => {
  const PAGE = 'f01-html-selection.html'

  /** The `ok` block with thread id `id`, from the current or the frozen parse. */
  function okBlock<B extends { readonly kind: string }>(blocks: readonly B[], id: string): Extract<B, { kind: 'ok' }> {
    const isIt = (b: B): b is Extract<B, { kind: 'ok' }> =>
      b.kind === 'ok' && (b as { readonly data?: { readonly id?: string } }).data?.id === id
    const found = blocks.find(isIt)
    if (!found) throw new Error(`no ok block ${id}`)
    return found
  }

  /** One frozen thread step: parse, change `@data` with the frozen thread op, plan with the frozen planner, splice. */
  function frozenStep(text: string, id: string, change: (data: FrozenData) => FrozenData): string {
    const doc = frozenAnalyze(text)
    const block = okBlock(doc.state.blocks, id)
    const planned = frozenPlanReplace(doc, { id, rawHash: block.rawHash, data: change(block.data) })
    if (!planned.ok) throw new Error(`frozen plan: ${planned.reason}`)
    return frozenApplySplice(text, planned.plan)
  }

  it('024-AC-011 a v0.23.1 reply and resolve keep anchor.sel byte for byte; the hint may go; a current reply restores it', () => {
    const original = goldenText(PAGE)
    const first = okBlock(analyzeCommentDocument(original).state.blocks, SELECTION_CASES[0].data.id)
    const sel = first.data.anchor.sel
    const selJson = escapeJsonForComment(JSON.stringify({ sel })).slice(1, -1)
    expect(original).toContain(wordsHint(anchorSelectionOf(first.data.anchor)!.exact))

    const reply = { author: GRACE, now: LATER }
    const replied = frozenStep(original, first.data.id, d => frozenAddReply(d, 'Thursday works.', reply))
    const resolved = frozenStep(replied, first.data.id, d => frozenSetStatus(d, 'resolved', reply))

    for (const text of [replied, resolved]) {
      const now = okBlock(analyzeCommentDocument(text).state.blocks, first.data.id)
      expect(JSON.stringify(now.data.anchor.sel)).toBe(JSON.stringify(sel))
      const raw = text.slice(now.nodeRange[0], now.nodeRange[1])
      expect(raw).toContain(selJson)
      // v0.23.1 rewrites the note area from its fixed lines (accepted, 024-FR-010).
      expect(raw).not.toContain(WORDS_HINT_LEAD)
      expect(kinds(frozenAnalyze(text).state.blocks)).toEqual(['ok', 'ok'])
    }
    expect(okBlock(analyzeCommentDocument(resolved).state.blocks, first.data.id).data.status).toBe('resolved')

    // The next save by this version, through the HTML kind, writes the hint again from @data.
    const doc = analyzeCommentDocument(resolved)
    const block = okBlock(doc.state.blocks, first.data.id)
    const data = addReply(block.data, 'Reopen if Friday slips.', { author: ADA, now: FIXED_NOW })
    const planned = planReplace(doc, { id: data.id, rawHash: block.rawHash, data }, htmlKind)
    if (!planned.ok) throw new Error(planned.reason)
    const restored = applySplice(resolved, planned.plan)
    const after = okBlock(analyzeCommentDocument(restored).state.blocks, first.data.id)
    const raw = restored.slice(after.nodeRange[0], after.nodeRange[1])
    expect(raw).toContain(wordsHint(anchorSelectionOf(after.data.anchor)!.exact))
    expect(JSON.stringify(after.data.anchor.sel)).toBe(JSON.stringify(sel))
    expect(kinds(frozenAnalyze(restored).state.blocks)).toEqual(['ok', 'ok'])
  })
})

/** The locked Markdown placement goldens (`markdownGoldens.test.ts`), decoded. */
function markdownGoldenTexts(): string[] {
  const folder = join(__dirname, '..', 'markdownComments', '__fixtures__', 'goldens')
  return readdirSync(folder).map(file => {
    const decoded = decodeLossless(new Uint8Array(readFileSync(join(folder, file))))
    if (!decoded.ok) throw new Error(`${file}: ${decoded.reason}`)
    return decoded.text
  })
}

/** Every fenced example in the format document that holds a v1 block, line breaks as LF. */
function docExamples(markdown: string): string[] {
  const text = markdown.replace(/\r\n/g, '\n')
  return [...text.matchAll(/^```[a-z]*\n([\s\S]*?)^```/gm)]
    .map(match => match[1])
    .filter(code => code.includes('erfana:comment v1'))
}

describe('024-AC-012 the format document', () => {
  const doc = readFileSync(SPEC, 'utf8')

  it('024-AC-012 every example block in format-v1.md is byte-identical to a golden', () => {
    const examples = docExamples(doc)
    expect(examples.length).toBeGreaterThanOrEqual(3)
    // The Markdown examples of "In Markdown files" are the locked Markdown placement goldens.
    const goldens = [...[...spec024Goldens().keys()].map(goldenText), ...markdownGoldenTexts()]
    for (const example of examples) {
      expect(goldens.includes(example), example.slice(0, 80)).toBe(true)
    }
  })

  it('024-AC-012 shows each kind\'s agent note exactly as Erfana writes it', () => {
    const text = doc.replace(/\r\n/g, '\n')
    for (const note of [HTML_AGENT_NOTE_LINES, MARKDOWN_AGENT_NOTE_LINES, AGENT_NOTE_LINES]) {
      const shown = note.map((line, i) => (i === 0 ? line : `  ${line}`)).join('\n')
      expect(text).toContain('```text\n' + shown + '\n```')
    }
  })

  it('024-AC-012 has the section "In Markdown files" and describes anchor.sel and the hint lines', () => {
    expect(doc).toMatch(/^## In Markdown files\r?$/m)
    expect(doc).toContain('`anchor.sel`')
    expect(doc).toContain('comment is about the words (when commented)')
    expect(doc).toContain('target in Markdown (when commented)')
  })
})
