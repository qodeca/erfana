// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Spec 024 goldens (024-AC-009 to 024-AC-012): blocks with `anchor.sel` and
 * the note-area hint lines, Markdown-shaped blocks for each kind of the
 * Markdown `@data` table (design `markdown-format.md` § 5, § 6), whole small
 * files, and the examples of docs/html-comments/format-v1.md.
 *
 * Each block case is serialized with its layout and note area and must equal
 * `<name>.block.txt` in this folder byte for byte; each file case must equal
 * its file. `../v1-spec024.lock.json` holds the SHA-256 of every file here.
 *
 * APPEND ONLY, like `../v1/`. The Markdown cases pin the FORMAT of a block
 * about each kind; where a block goes in a Markdown file is the Markdown
 * kind's placement rule, locked later with its own goldens (spec 024 § 6
 * commit 16). The whole Markdown files here are built by hand from those
 * rules (design § 4.2) and are read-only samples for the cross-version tests.
 */
import { HTML_AGENT_NOTE_LINES, MARKDOWN_AGENT_NOTE_LINES } from '../../agentNotes'
import type { BlockLayout, CommentAnchor, CommentData, CommentView } from '../../format'
import { markdownTargetHint, selectionHints } from '../../noteLines'
import { ADA, GRACE, VIEW, fixedId, makeComment, makeReply } from '../commentTestData'

export interface Spec024BlockCase {
  readonly name: string
  readonly layout: BlockLayout
  readonly data: CommentData
  /** The note area: the kind's agent note, then its hint lines. */
  readonly note: readonly string[]
}

const LF: BlockLayout = { indent: '', eol: '\n' }

/** The Markdown preview's `view`: no `#hash` (design § 5). */
const MD_VIEW: CommentView = { w: 900, h: 700, dpr: 2, x: 0, y: 340 }

let serial = 0
/** A one-message comment with fixed ids, numbered in case order. */
function comment(anchor: CommentAnchor, text: string, view: CommentView = VIEW): CommentData {
  serial += 1
  return makeComment({
    id: fixedId('c-', 2400 + serial),
    anchor,
    view,
    msgs: [{ id: fixedId('m-', 2400 + serial), by: ADA, at: '2026-10-29T10:00:00Z', text }]
  })
}

/** An HTML block: the HTML agent note and the words hint of its `anchor.sel`. */
function htmlCase(name: string, layout: BlockLayout, data: CommentData): Spec024BlockCase {
  return { name, layout, data, note: [...HTML_AGENT_NOTE_LINES, ...selectionHints(data)] }
}

/** A Markdown block: the Markdown note, the target hint, then any words hint. */
function mdCase(
  name: string,
  layout: BlockLayout,
  data: CommentData,
  target: readonly [string, string]
): Spec024BlockCase {
  const hints = [markdownTargetHint(target[0], target[1]), ...selectionHints(data)]
  return { name, layout, data, note: [...MARKDOWN_AGENT_NOTE_LINES, ...hints] }
}

const LEDE: CommentAnchor = {
  tag: 'p',
  cls: ['lede'],
  path: 'html > body > main:nth-of-type(1) > p:nth-of-type(1)',
  quote: { exact: 'We will ship by Friday at the latest.', prefix: 'Release plan', suffix: 'Questions go to Ada.' },
  sel: { exact: 'ship by Friday', prefix: 'We will ', suffix: ' at the latest.' }
}

/** An emoji ZWJ sequence: one grapheme of five code points. */
const FAMILY = '\u{1f469}‍\u{1f469}‍\u{1f467}'
/** Exactly 200 code points of rendered text (7 + 5 + 1 + 185 + 2): the longest valid `exact`. */
const LONGEST_EXACT = `Family ${FAMILY} ${'abcd '.repeat(37)}xy`

/** HTML blocks with `anchor.sel` and the words hint (selection comments). */
export const SELECTION_CASES: readonly Spec024BlockCase[] = [
  htmlCase('s01-html-selection', { indent: '    ', eol: '\n' }, comment(LEDE, 'Say "by Thursday" instead.')),
  htmlCase(
    's02-html-selection-crlf-hostile',
    { indent: '\t', eol: '\r\n' },
    comment(
      {
        ...LEDE,
        sel: { exact: 'a "quoted" -- path\\to\\file ‮evil', prefix: 'See ', suffix: '.' }
      },
      'The words hold quotes, a backslash, -- and a bidi override.'
    )
  ),
  htmlCase(
    's03-html-selection-longest',
    LF,
    comment({ ...LEDE, sel: { exact: LONGEST_EXACT, prefix: '', suffix: '' } }, 'Shorten this sentence.')
  ),
  htmlCase(
    's04-html-selection-invalid-kept',
    LF,
    comment(
      { ...LEDE, sel: { exact: 'two  spaces', prefix: '', suffix: '', note: 'invalid: kept, no hint' } },
      'An invalid sel is kept and ignored, never Damaged.'
    )
  )
]

const li = (n: number): string => `li:nth-of-type(${n})`

/** One Markdown-shaped block per kind of the `@data` table (design § 5), with its target hint. */
export const MARKDOWN_CASES: readonly Spec024BlockCase[] = [
  mdCase('m01-paragraph', LF, comment({ tag: 'p', path: 'p:nth-of-type(3)' }, 'Shorten this paragraph.', MD_VIEW), [
    'paragraph',
    'The release ships when every check is green and the release notes are written.'
  ]),
  mdCase(
    'm02-heading',
    LF,
    comment({ tag: 'h2', id: 'next-steps', path: 'h2:nth-of-type(2)' }, 'Rename to "Open questions".', MD_VIEW),
    ['H2 heading', '## Next steps']
  ),
  mdCase(
    'm03-list-item-2',
    { indent: '  ', eol: '\n' },
    comment({ tag: 'li', path: `ul:nth-of-type(1) > ${li(2)}` }, 'Run it against a copy of production data.', MD_VIEW),
    ['item 2 of the list', '- Run the load test against staging.']
  ),
  mdCase(
    'm04-list-item-1',
    LF,
    comment(
      { tag: 'ul', path: 'ul:nth-of-type(1)', runtime: { path: li(1), tag: 'li', quote: { exact: 'Freeze the API on Monday.', prefix: '', suffix: 'Run the load test' }, snapshotSource: 'page' } },
      'Monday is a holiday; use Tuesday.',
      MD_VIEW
    ),
    ['item 1 of the list', '- Freeze the API on Monday.']
  ),
  mdCase(
    'm05-table-row',
    LF,
    comment(
      { tag: 'table', path: 'table:nth-of-type(1)', runtime: { path: 'tbody > tr:nth-of-type(2)', tag: 'tr', snapshotSource: 'page' } },
      'Piotr is on leave that week.',
      MD_VIEW
    ),
    ['row 2 of the table', '| Piotr | Load test | Friday |']
  ),
  mdCase(
    'm06-quote-inner',
    LF,
    comment(
      { tag: 'blockquote', path: 'blockquote:nth-of-type(1)', runtime: { path: 'p:nth-of-type(2)', tag: 'p', snapshotSource: 'page' } },
      'Cite the source of this quote.',
      MD_VIEW
    ),
    ['paragraph 2 inside the block quote', '> Ship small, ship often.']
  ),
  mdCase('m07-code-block', LF, comment({ tag: 'pre', path: 'pre:nth-of-type(1)' }, 'Use npm ci here.', MD_VIEW), [
    'code block',
    'npm install'
  ]),
  mdCase(
    'm08-image',
    LF,
    comment(
      { tag: 'p', path: 'p:nth-of-type(5)', runtime: { path: 'img:nth-of-type(1)', tag: 'img', snapshotSource: 'page' } },
      'This diagram is out of date.',
      MD_VIEW
    ),
    ['image', '![Architecture](docs/arch.png)']
  ),
  mdCase('m09-divider', LF, comment({ tag: 'hr', path: 'hr:nth-of-type(1)' }, 'Drop this divider.', MD_VIEW), [
    'divider',
    '---'
  ]),
  mdCase(
    'm10-html-block',
    LF,
    comment({ tag: 'details', path: 'details:nth-of-type(1)' }, 'Open this section by default.', MD_VIEW),
    ['HTML block', '<details><summary>More</summary>']
  ),
  mdCase(
    'm11-selection',
    LF,
    comment(
      {
        tag: 'p',
        path: 'p:nth-of-type(3)',
        quote: { exact: 'The release ships when every check is green.', prefix: 'Release', suffix: 'Questions' },
        sel: { exact: 'every check is green', prefix: 'The release ships when ', suffix: '.' }
      },
      'Name the checks.',
      MD_VIEW
    ),
    ['paragraph', 'The release ships when every check is green.']
  )
]

/** Every block case, in file order. */
export const SPEC024_BLOCK_CASES: readonly Spec024BlockCase[] = [...SELECTION_CASES, ...MARKDOWN_CASES]

/** A golden case by name; throws on a typo. */
export function blockCase(name: string): Spec024BlockCase {
  const found = SPEC024_BLOCK_CASES.find(c => c.name === name)
  if (!found) throw new Error(`no spec 024 block case ${name}`)
  return found
}

/** A resolved thread for the whole HTML file: replies keep `anchor.sel`. */
export const RESOLVED_SELECTION: CommentData = makeComment({
  id: fixedId('c-', 2499),
  status: 'resolved',
  resolved: { by: GRACE, at: '2026-10-29T12:00:00Z' },
  anchor: {
    tag: 'p',
    path: 'html > body > main:nth-of-type(1) > p:nth-of-type(2)',
    quote: { exact: 'Questions go to Ada.', prefix: 'at the latest.', suffix: '' },
    sel: { exact: 'Questions go to Ada', prefix: '', suffix: '.' }
  },
  msgs: [
    { id: fixedId('m-', 2499), by: ADA, at: '2026-10-29T10:00:00Z', text: 'Say who, not just a name.' },
    makeReply(2499, 'Done.')
  ]
})
