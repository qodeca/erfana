// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Commented pages for the instrumentation tests (HTML Preview comments P3),
 * written with the real P1 serializer and splice, so every `ok` block is one
 * Erfana itself would write. Plain builders; no `vi.mock()` here.
 */
import {
  buildAnchor,
  indexHtml,
  type CommentAnchor,
  type CommentData
} from '../../../../../shared/htmlComments'
import {
  addTo,
  elementOf,
  fixedId,
  makeComment
} from '../../../../../shared/comments/__fixtures__/commentTestData'
import type { InstrumentOutcome, InstrumentedDocument } from '../commentParseCore'

/** The page every builder starts from. Ids name the elements the blocks target. */
export const BASE_PAGE = [
  '<!doctype html>',
  '<html lang="en">',
  '<head><title>-HPC-P3-</title><meta charset="utf-8"></head>',
  '<body>',
  '  <main id="main">',
  '    <h1 id="title">Fresh coffee</h1>',
  '    <p id="para">Delivered by <em id="when">Thursday</em> morning.</p>',
  '    <button id="cta" class="btn">Buy now</button>',
  '  </main>',
  '  <template><p id="in-template">later</p></template>',
  '  <script>const fake = "<p data-x=1>not a tag</p>"</script>',
  '</body>',
  '</html>',
  ''
].join('\n')

/** A comment on the element with `id`, its anchor taken from `html` as served. */
export function commentOn(
  html: string,
  tag: string,
  n: number,
  overrides: Partial<CommentData> = {}
): CommentData {
  const index = indexHtml(html)
  const anchor: CommentAnchor = buildAnchor(index, elementOf(index, tag, n))
  return makeComment({ anchor, ...overrides })
}

/** What {@link commentedPage} placed, block id → the `id` attribute of its element. */
export interface CommentedPage {
  readonly text: string
  readonly targets: ReadonlyMap<string, string>
}

/**
 * {@link BASE_PAGE} with three `ok` blocks Erfana wrote: an open one on the
 * line-start `<button>` (own lines), an open one on the mid-line `<em>`, and a
 * resolved one on the `<h1>`.
 */
export function commentedPage(): CommentedPage {
  const onButton = fixedId('c-', 1)
  const onEm = fixedId('c-', 2)
  const onTitle = fixedId('c-', 3)
  let text = BASE_PAGE
  text = addTo(text, 'button', commentOn(text, 'button', 0, { id: onButton }), {
    ws: 'collapse'
  }).text
  text = addTo(text, 'em', commentOn(text, 'em', 0, { id: onEm })).text
  const resolved: Partial<CommentData> = {
    id: onTitle,
    status: 'resolved',
    resolved: { by: { name: 'Grace Hopper', role: 'human' }, at: '2026-10-26T09:12:00Z' }
  }
  text = addTo(text, 'h1', commentOn(text, 'h1', 0, resolved), { ws: 'collapse' }).text
  return {
    text,
    targets: new Map([
      [onButton, 'cta'],
      [onEm, 'when'],
      [onTitle, 'title']
    ])
  }
}

/** A raw block Erfana cannot read (`bad-json`), naming `id` in its header. */
export function damagedBlock(id: string): string {
  return `<!-- erfana:comment v1 id=${id}\n@data {"v":1,\n-->`
}

/** A block of a later format version. */
export function newerBlock(id: string): string {
  return `<!-- erfana:comment v2 id=${id}\nsomething new\n-->`
}

/** Insert `block` right before the first occurrence of `marker` in `text`. */
export function insertBefore(text: string, marker: string, block: string): string {
  const at = text.indexOf(marker)
  if (at < 0) throw new Error(`marker not found: ${marker}`)
  return text.slice(0, at) + block + text.slice(at)
}

/** Narrow an outcome to an instrumented document, or fail the test. */
export function expectInstrumented(
  outcome: InstrumentOutcome | { kind: string }
): InstrumentedDocument {
  if (outcome.kind !== 'ok')
    throw new Error(`expected an instrumented document, got ${outcome.kind}`)
  return outcome as InstrumentedDocument
}

/** The token of index `i` in a token string. */
export function tokenOf(doc: Pick<InstrumentedDocument, 'tokens'>, i: number): string {
  return doc.tokens.slice(i * 12, (i + 1) * 12)
}
