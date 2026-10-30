// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The seeded large files of the timing measurement (spec 024 024-NFR-001,
 * 024-AC-024): a Markdown file and an HTML file of about 1 MB, each with 200
 * comments, the same bytes on every machine.
 *
 * The text is generated from a fixed word list with a seeded source. The
 * 200 comments are planned on ONE parse of the file with the kinds' own
 * planners – first slot, the anchor the kind builds for it – and spliced in
 * from the end backwards, so each block sits where a save would have put it
 * and every anchor is the one a save would have written (a block is not an
 * element, so it moves no `nth-of-type` path). The suite checks the result:
 * 200 `ok` blocks, every one attached.
 */
import { seededRandom } from '../../../../../shared/comments/__fixtures__/commentTestData'
import type { CommentFileKind, KindDocument } from '../../../../../shared/comments/fileKind'
import type { CommentAuthor, CommentView } from '../../../../../shared/comments/format'
import { htmlKind } from '../../../../../shared/comments/htmlKind'
import { planSlotInsert, type SplicePlan } from '../../../../../shared/comments/splice'
import { createThread } from '../../../../../shared/comments/thread'
import { buildDraftAnchor, planInsert, type CommentDocument } from '../../../../../shared/htmlComments'
import { markdownKind } from '../../../../../shared/markdownComments/markdownKind'
import type { MdIndex } from '../../../../../shared/markdownComments/mdIndex'
import { seededUnit } from './corpusTargets'

/** 024-NFR-001: about 1 MB, 200 comments. */
export const LARGE_FILE_BYTES = 1024 * 1024
export const LARGE_FILE_COMMENTS = 200
/** Room the 200 blocks take, so the file with them is about {@link LARGE_FILE_BYTES}. */
const BLOCK_ROOM_BYTES = 200 * 1_900

const AUTHOR: CommentAuthor = { name: 'Timing Reviewer', email: 'timing@example.invalid', role: 'human' }
const NOW = new Date('2026-10-30T12:00:00.000Z')
const VIEW: CommentView = { w: 900, h: 700, dpr: 2, x: 0, y: 0 }
const WORDS = (
  'comment preview editor markdown terminal agent window panel review change status thread reply file ' +
  'project build release colour layout header footer section table list item quote code block line page'
).split(' ')

/** A seeded sentence of 8–20 words. */
function sentences(random: () => number, count: number): string {
  const out: string[] = []
  for (let s = 0; s < count; s += 1) {
    const n = 8 + Math.floor(random() * 13)
    const words = Array.from({ length: n }, () => WORDS[Math.floor(random() * WORDS.length)])
    words[0] = words[0][0].toUpperCase() + words[0].slice(1)
    out.push(`${words.join(' ')}.`)
  }
  return out.join(' ')
}

function markdownSection(i: number, random: () => number): string {
  return [
    `## Section ${i + 1}: ${sentences(random, 1).slice(0, 40)}`,
    '',
    sentences(random, 6),
    '',
    sentences(random, 5),
    '',
    `- ${sentences(random, 1)}`,
    `- ${sentences(random, 1)}`,
    `  - ${sentences(random, 1)}`,
    `- ${sentences(random, 1)}`,
    '',
    '| Name | Value |',
    '|---|---|',
    `| ${WORDS[i % WORDS.length]} | ${sentences(random, 1)} |`,
    `| ${WORDS[(i + 3) % WORDS.length]} | ${sentences(random, 1)} |`,
    '',
    `> ${sentences(random, 3)}`,
    '',
    '```ts',
    `const section${i} = ${JSON.stringify(sentences(random, 1))}`,
    '```',
    '',
    sentences(random, 6),
    ''
  ].join('\n')
}

function htmlSection(i: number, random: () => number): string {
  return [
    `<section id="s${i + 1}">`,
    `  <h2>Section ${i + 1}</h2>`,
    `  <p>${sentences(random, 6)}</p>`,
    `  <p>${sentences(random, 5)}</p>`,
    '  <ul>',
    `    <li>${sentences(random, 1)}</li>`,
    `    <li>${sentences(random, 1)}</li>`,
    `    <li>${sentences(random, 1)}</li>`,
    '  </ul>',
    `  <table><tr><td>${WORDS[i % WORDS.length]}</td><td>${sentences(random, 1)}</td></tr></table>`,
    `  <blockquote><p>${sentences(random, 3)}</p></blockquote>`,
    `  <pre><code>const section${i} = 1</code></pre>`,
    `  <p>${sentences(random, 6)}</p>`,
    '</section>',
    ''
  ].join('\n')
}

/** Sections until the text, with room for the blocks, is about 1 MB. */
function body(section: (i: number, random: () => number) => string, seed: number): string {
  const random = seededUnit(seed)
  const parts: string[] = []
  let length = 0
  for (let i = 0; length < LARGE_FILE_BYTES - BLOCK_ROOM_BYTES; i += 1) {
    const part = section(i, random)
    parts.push(part)
    length += part.length
  }
  return parts.join('\n')
}

/** `count` targets spread evenly over `targets`. */
function spread<T>(targets: readonly T[], count: number): T[] {
  const step = targets.length / count
  return Array.from({ length: count }, (_, i) => targets[Math.floor(i * step)])
}

/** Apply plans made on one text, from the end backwards. */
function applyAll(text: string, plans: SplicePlan[]): string {
  let out = text
  for (const plan of [...plans].sort((a, b) => b.start - a.start)) out = out.slice(0, plan.start) + plan.insert + out.slice(plan.end)
  return out
}

const contextOf = (i: number): { author: CommentAuthor; now: Date; random: ReturnType<typeof seededRandom> } => ({ author: AUTHOR, now: NOW, random: seededRandom(9_000 + i) })

function planned<T>(kind: CommentFileKind, doc: KindDocument, targets: readonly T[], plan: (target: T, i: number) => ReturnType<typeof planSlotInsert>): string {
  const plans = targets.map((target, i) => {
    const result = plan(target, i)
    if (!result.ok) throw new Error(`${kind.id} fixture: comment ${i} not planned: ${result.reason}`)
    return result.plan
  })
  return applyAll(doc.text, plans)
}

/** The 1 MB Markdown fixture with 200 comments, and the same text without them. */
export function largeMarkdown(): { readonly plain: string; readonly text: string } {
  const plain = body(markdownSection, 24_001)
  const doc = markdownKind.parse(plain, 0)
  // Paragraphs and headings only. The limit scan (`markdownLimits.ts`) counts each block's readable
  // `target: <tag>` line as an unclosed raw-HTML element, so blocks on list items, rows and quotes
  // (two such tags each) would push 200 comments past MARKDOWN_COMMENT_MAX_HTML_NESTING and the
  // file would be read-only "too large" – reported with the timing run, not worked around here.
  const commentable = new Set(['paragraph', 'heading'])
  const targets = spread((doc.index as MdIndex).elements.filter(t => commentable.has(t.kind)), LARGE_FILE_COMMENTS)
  const text = planned(markdownKind, doc, targets, (target, i) => {
    const slot = markdownKind.slots(doc, target)[0]
    const anchor = markdownKind.anchorOf(doc, target, undefined, slot)
    const data = createThread({ anchor, view: VIEW, text: `Timing comment ${i + 1}.`, context: contextOf(i) })
    return planSlotInsert(doc, slot, data, markdownKind.refuseGrowth, markdownKind)
  })
  return { plain, text }
}

/** The 1 MB HTML fixture with 200 comments, and the same text without them. */
export function largeHtml(): { readonly plain: string; readonly text: string } {
  const head = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Large file</title>\n</head>\n<body>\n<main>\n'
  const plain = `${head}${body(htmlSection, 24_002)}</main>\n</body>\n</html>\n`
  const doc = htmlKind.parse(plain, 0) as CommentDocument
  const targets = spread(doc.index.elements.filter(el => ['p', 'h2', 'li'].includes(el.tag)), LARGE_FILE_COMMENTS)
  const text = planned(htmlKind, doc, targets, (el, i) => {
    const data = createThread({ anchor: buildDraftAnchor(doc.index, el), view: VIEW, text: `Timing comment ${i + 1}.`, context: contextOf(i) })
    return planInsert(doc, { targetStart: el.start, data, ws: 'collapse' }, htmlKind)
  })
  return { plain, text }
}
