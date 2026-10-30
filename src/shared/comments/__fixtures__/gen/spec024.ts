// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The bytes of every spec 024 golden (`../v1-spec024/`), built from the real
 * serializer and planner. `genSpec024.ts` writes them; `spec024.golden.test.ts`
 * compares them with the committed files. Pure: no file system.
 *
 * - `<case>.block.txt` – each block case of `../v1-spec024/cases.ts`;
 * - `f01`–`f03` – whole small files: an HTML page written through the current
 *   write path with the HTML kind, and two Markdown files built by hand with
 *   the `line-start` shape (`indent + block + eol`, design `markdown-format.md`
 *   § 2, § 4.2), one LF and one CRLF;
 * - `d01`–`d03` – the examples of docs/html-comments/format-v1.md, built as
 *   `gen/genFixtures.ts` builds them, `.txt` so no tool treats them as pages.
 */
import { analyzeCommentDocument } from '../../../htmlComments/parse'
import { applySplice, planInsert } from '../../../htmlComments/splice'
import { encodeText } from '../../encoding'
import { serializeBlock, type BlockLayout, type CommentData, type Eol } from '../../format'
import { htmlKind } from '../../htmlKind'
import { ADA, GRACE, VIEW, fixedId, makeComment, makeReply } from '../commentTestData'
import { RESOLVED_SELECTION, SPEC024_BLOCK_CASES, blockCase, type Spec024BlockCase } from '../v1-spec024/cases'

/** A whole golden file and how many blocks it holds. */
export interface Spec024File {
  readonly name: string
  readonly text: string
  readonly blocks: number
}

/** One block of a case, serialized with `layout`; throws when the serializer refuses. */
export function serializeCase(c: Spec024BlockCase, layout: BlockLayout = c.layout): string {
  const result = serializeBlock(c.data, layout, c.note)
  if (!result.ok) throw new Error(`spec 024 golden ${c.name}: ${result.reason}`)
  return result.block
}

const HTML_PAGE = [
  '<!doctype html>',
  '<html lang="en">',
  '<body>',
  '  <main>',
  '    <h1>Release plan</h1>',
  '    <p class="lede">We will ship by Friday at the latest.</p>',
  '    <p>Questions go to Ada.</p>',
  '  </main>',
  '</body>',
  '</html>',
  ''
].join('\n')

/** Add `data` before the `n`-th `<p>` through the current HTML write path, with the HTML kind's note and hints. */
function addToParagraph(text: string, n: number, data: CommentData, ws?: string): string {
  const doc = analyzeCommentDocument(text)
  const p = doc.index.elements.filter(el => el.tag === 'p')[n]
  const planned = planInsert(doc, { targetStart: p.start, data, ws }, htmlKind)
  if (!planned.ok) throw new Error(`spec 024 golden page: ${planned.reason}`)
  return applySplice(text, planned.plan)
}

/** The licence header every tracked `.html` file carries (`npm run check:headers`), as the v1-compat pages do. */
const SPDX_HTML_HEADER =
  '<!-- SPDX-License-Identifier: GPL-3.0-only -->\n<!-- SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o. -->\n'

function htmlSelectionPage(): string {
  const own = addToParagraph(HTML_PAGE, 0, blockCase('s01-html-selection').data, 'collapse')
  return addToParagraph(own, 1, RESOLVED_SELECTION)
}

/** A Markdown line, or the `line-start` shape of a case before it: `indent + block + eol`. */
type MdLine = string | { readonly block: string; readonly indent?: string }

function markdownFile(lines: readonly MdLine[], eol: Eol): string {
  return lines
    .map(line => {
      if (typeof line === 'string') return line + eol
      const indent = line.indent ?? ''
      return indent + serializeCase(blockCase(line.block), { indent, eol }) + eol
    })
    .join('')
}

/** A list with comments on item 1 (before the list) and item 2 (the last child of item 1). */
const LIST_LINES: readonly MdLine[] = [
  '# Launch checklist',
  '',
  { block: 'm04-list-item-1' },
  '- Freeze the API on Monday.',
  { block: 'm03-list-item-2', indent: '  ' },
  '- Run the load test against staging.',
  '- Tag the release.'
]

/** One comment per kind, each before its carrier's first line (design § 4.2). */
const MIXED_LINES: readonly MdLine[] = [
  '# Release notes',
  '',
  { block: 'm11-selection' },
  'The release ships when every check is green.',
  '',
  { block: 'm02-heading' },
  '## Next steps',
  '',
  { block: 'm05-table-row' },
  '| Name | Task | Day |',
  '| --- | --- | --- |',
  '| Ada | Notes | Thursday |',
  '| Piotr | Load test | Friday |',
  '',
  { block: 'm06-quote-inner' },
  '> Ship early.',
  '>',
  '> Ship small, ship often.',
  '',
  { block: 'm07-code-block' },
  '```sh',
  'npm install',
  '```',
  '',
  { block: 'm08-image' },
  '![Architecture](docs/arch.png)',
  '',
  { block: 'm09-divider' },
  '---',
  '',
  { block: 'm10-html-block' },
  '<details><summary>More</summary>',
  'Notes for reviewers.',
  '</details>'
]

/** The whole golden files, with their block counts. */
export function spec024Files(): readonly Spec024File[] {
  return [
    { name: 'f01-html-selection.html', text: SPDX_HTML_HEADER + htmlSelectionPage(), blocks: 2 },
    { name: 'f02-markdown-list.md', text: markdownFile(LIST_LINES, '\n'), blocks: 2 },
    { name: 'f03-markdown-mixed-crlf.md', text: markdownFile(MIXED_LINES, '\r\n'), blocks: 8 }
  ]
}

/** The format-v1.md examples, as `genFixtures.ts` `examples()` builds them (v0.23.1 note, as shipped). */
export function docExampleFiles(): readonly Spec024File[] {
  const page =
    '<!doctype html>\n<html lang="en">\n<body>\n  <main>\n    <h1>Pricing</h1>\n    <p>Plans start at <em>10 EUR</em> a month.</p>\n    <button class="cta">Buy now</button>\n  </main>\n</body>\n</html>\n'
  let doc = analyzeCommentDocument(page)
  const button = doc.index.elements.find(e => e.tag === 'button')!
  const first = planInsert(doc, { targetStart: button.start, data: makeComment(), ws: 'collapse' })
  if (!first.ok) throw new Error(first.reason)
  let text = applySplice(page, first.plan)
  doc = analyzeCommentDocument(text)
  const em = doc.index.elements.find(e => e.tag === 'em')!
  const midData = makeComment({
    id: fixedId('c-', 77),
    anchor: {
      tag: 'em',
      path: 'html > body > main:nth-of-type(1) > p:nth-of-type(1) > em:nth-of-type(1)',
      quote: { exact: '10 EUR', prefix: 'Plans start at', suffix: 'a month.' }
    },
    msgs: [{ ...makeComment().msgs[0], id: fixedId('m-', 77), by: GRACE, text: 'Say "9 EUR" here.' }]
  })
  const second = planInsert(doc, { targetStart: em.start, data: midData, ws: 'collapse' })
  if (!second.ok) throw new Error(second.reason)
  text = applySplice(text, second.plan)
  const resolved = makeComment({
    id: fixedId('c-', 78),
    status: 'resolved',
    resolved: { by: GRACE, at: '2026-10-27T08:00:00Z' },
    msgs: [makeComment().msgs[0], makeReply(1, 'Agreed, and fix the padding too.'), makeReply(2, 'Done.', ADA)]
  })
  const runtime = makeComment({
    id: fixedId('c-', 79),
    anchor: {
      tag: 'div',
      id: 'deck',
      path: 'html > body > div:nth-of-type(1)',
      runtime: {
        path: 'section:nth-of-type(2) > h2:nth-of-type(1)',
        tag: 'h2',
        quote: { exact: 'Q3 results', prefix: '', suffix: 'Revenue grew' },
        snapshot: '<h2>Q3 results</h2>',
        snapshotSource: 'page'
      }
    },
    view: { ...VIEW, hash: '#2' },
    msgs: [{ ...makeComment().msgs[0], text: 'Rename this slide to "Q3 2026 results".' }]
  })
  const block = (data: CommentData): string => {
    const result = serializeBlock(data, { indent: '', eol: '\n' })
    if (!result.ok) throw new Error(result.reason)
    return result.block + '\n'
  }
  return [
    { name: 'd01-doc-example-page.html.txt', text, blocks: 2 },
    { name: 'd02-doc-example-resolved.html.txt', text: block(resolved), blocks: 1 },
    { name: 'd03-doc-example-runtime.html.txt', text: block(runtime), blocks: 1 }
  ]
}

/** Every generated file of `../v1-spec024/`: name → bytes. */
export function spec024Goldens(): ReadonlyMap<string, Uint8Array> {
  const out = new Map<string, Uint8Array>()
  for (const c of SPEC024_BLOCK_CASES) out.set(`${c.name}.block.txt`, encodeText(serializeCase(c)))
  for (const file of [...spec024Files(), ...docExampleFiles()]) out.set(file.name, encodeText(file.text))
  return out
}
