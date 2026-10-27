// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Golden tests: the v1 format as shipped (docs/designs/html-preview-comments.md
 * §12, decision 22; G-001–G-004). The format is a one-way door – every file
 * Erfana ever wrote must stay readable – so these fixtures are APPEND ONLY and
 * pinned by a SHA-256 manifest.
 *
 * G-005 (a v1 block inside Markdown stays hidden in the Markdown preview) runs
 * in the renderer suite, where that pipeline lives:
 * `src/renderer/src/components/Editor/MarkdownPreview.comments.test.tsx`.
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { projectState } from './__fixtures__/commentTestData'
import { GOLDEN_CASES } from './__fixtures__/v1/cases'
import { encodeText } from './encoding'
import { AGENT_NOTE_LINES, renderAgentNote, serializeBlock } from './format'
import { analyzeCommentDocument, parseCommentFile } from './parse'

const FIXTURES = join(__dirname, '__fixtures__')
const LOCKED_FOLDERS = ['v1', 'v1-compat'] as const
const ROOT = join(__dirname, '..', '..', '..')
const SPEC = join(ROOT, 'docs', 'html-comments', 'format-v1.md')
const AGENT_REVIEW = join(
  ROOT,
  'e2e',
  'fixtures',
  'html-preview-corpus',
  'comments',
  'agent-review'
)

describe('v1 goldens', () => {
  it('G-001 the ten canonical serializations equal their committed files byte for byte', () => {
    expect(GOLDEN_CASES).toHaveLength(10)
    for (const { name, layout, data } of GOLDEN_CASES) {
      const result = serializeBlock(data, layout)
      if (!result.ok) throw new Error(`${name}: ${result.reason}`)
      expect(result.block, name).toContain(renderAgentNote(layout))
      expect(encodeText(result.block), name).toEqual(
        new Uint8Array(readFileSync(join(FIXTURES, 'v1', `${name}.block.txt`)))
      )
    }
    const files = readdirSync(join(FIXTURES, 'v1')).filter(file => file.endsWith('.block.txt'))
    expect(files.sort()).toEqual(GOLDEN_CASES.map(c => `${c.name}.block.txt`).sort())
  })

  it('G-002 every v1-compat file parses to its expected state', () => {
    const pages = readdirSync(join(FIXTURES, 'v1-compat')).filter(file => file.endsWith('.html'))
    expect(pages.length).toBeGreaterThanOrEqual(8)
    for (const page of pages) {
      const result = parseCommentFile(
        new Uint8Array(readFileSync(join(FIXTURES, 'v1-compat', page)))
      )
      if (!result.ok) throw new Error(`${page}: ${result.reason}`)
      const expected: unknown = JSON.parse(
        readFileSync(join(FIXTURES, 'v1-compat', page.replace(/\.html$/, '.expected.json')), 'utf8')
      )
      expect(projectState(result.doc), page).toEqual(expected)
    }
  })

  it('G-003 the SHA-256 manifest matches every locked file, with none missing or extra', () => {
    const lock = JSON.parse(readFileSync(join(FIXTURES, 'v1.lock.json'), 'utf8')) as {
      algorithm: string
      files: Record<string, string>
    }
    expect(lock.algorithm).toBe('sha256')
    const actual: Record<string, string> = {}
    for (const folder of LOCKED_FOLDERS) {
      for (const file of readdirSync(join(FIXTURES, folder))) {
        actual[`${folder}/${file}`] = createHash('sha256')
          .update(readFileSync(join(FIXTURES, folder, file)))
          .digest('hex')
      }
    }
    // A mismatch here means a shipped fixture changed. Change the format only on purpose: spec, goldens and lock together.
    expect(actual).toEqual(lock.files)
  })
})

/** What each agent-review page must hold: the X-001 check scores agents against exactly this. */
const AGENT_REVIEW_STATES: Record<string, readonly string[]> = {
  'landing.html': [
    'resolved',
    'open',
    'open',
    'open',
    'open',
    'damaged: readable-mismatch',
    'open'
  ],
  'slides.html': ['open', 'open', 'open', 'resolved', 'damaged: bad-json', 'open'],
  'signup-form.html': ['resolved', 'open', 'open', 'open', 'damaged: conflict-marker', 'open']
}

describe('agent-review pages (X-001)', () => {
  it('hold the planned open, resolved and damaged blocks, each with the agent note', () => {
    for (const [page, states] of Object.entries(AGENT_REVIEW_STATES)) {
      const text = readFileSync(join(AGENT_REVIEW, page), 'utf8')
      const doc = analyzeCommentDocument(text)
      expect(doc.state.writable, page).toBe(true)
      const found = doc.state.blocks.map(block =>
        block.kind === 'ok'
          ? block.data.status
          : block.kind === 'damaged'
            ? `damaged: ${block.reason}`
            : block.kind
      )
      expect(found, page).toEqual(states)
      for (const block of doc.state.blocks) {
        const raw = text.slice(block.nodeRange[0], block.nodeRange[1])
        for (const line of AGENT_NOTE_LINES) expect(raw, page).toContain(line)
      }
    }
  })
})

/** The ```html examples of the public spec that hold a v1 block. */
function specExamples(markdown: string): string[] {
  const fences = [...markdown.matchAll(/^```html\r?\n([\s\S]*?)^```/gm)].map(match => match[1])
  return fences.filter(code => code.includes('erfana:comment v1'))
}

describe('public spec', () => {
  it('G-004 every example in docs/html-comments/format-v1.md parses, each block ok', () => {
    const examples = specExamples(readFileSync(SPEC, 'utf8'))
    expect(examples.length).toBeGreaterThanOrEqual(3)
    for (const example of examples) {
      const doc = analyzeCommentDocument(example)
      expect(doc.state.blocks.length, example.slice(0, 80)).toBeGreaterThan(0)
      for (const block of doc.state.blocks) {
        expect(
          block.kind === 'damaged' ? `damaged: ${block.reason}` : block.kind,
          example.slice(0, 80)
        ).toBe('ok')
        // Examples are current serializer output, so each carries the agent note.
        const raw = example.slice(block.nodeRange[0], block.nodeRange[1])
        for (const line of AGENT_NOTE_LINES) expect(raw, example.slice(0, 80)).toContain(line)
      }
    }
  })
})
