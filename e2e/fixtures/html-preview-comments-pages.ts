// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pages the HTML Preview comment e2e specs generate at test time and never
 * commit (docs/designs/comments/html-preview-comments.md §12.3 "Generated at test time
 * … never committed"): many comments on one page (E-013, F-003) and pages of a
 * given size for the instrumentation cost (F-002), and a full-width commented
 * element for the pin's edge clamp (E-029).
 *
 * Blocks come from the real serializer (`addTo`, the builder the unit tests
 * use), so each one is a block Erfana itself would write.
 */

import { commentOn } from '../../src/main/services/preview/comments/__test-helpers__/commentedPages'
import { addTo, fixedId } from '../../src/shared/htmlComments/__fixtures__/commentTestData'

/** A page of `count` paragraphs `#p-0` … `#p-{count-1}`, each with one open block on its own lines. */
export function manyCommentsPage(count: number, title = '-HPC-MANY-'): string {
  const rows = Array.from({ length: count }, (_, i) => `  <p id="p-${i}" class="row">Row ${i} of the long review page.</p>`)
  let text = [
    '<!doctype html>',
    '<html lang="en">',
    `<head><meta charset="utf-8"><title>${title}</title>`,
    '<style>body { font: 16px/1.5 sans-serif; margin: 40px; } .row { width: 320px; margin: 0 0 28px; padding: 4px 8px; border: 1px solid #ccc; }</style>',
    '</head>',
    '<body>',
    ...rows,
    '</body>',
    '</html>',
    ''
  ].join('\n')
  for (let i = 0; i < count; i += 1) {
    text = addTo(text, 'p', commentOn(text, 'p', i, { id: fixedId('c-', 100 + i) }), { n: i, ws: 'collapse' }).text
  }
  return text
}

/**
 * A page of about `bytes` UTF-8 bytes: paragraphs of ordinary text (about 110
 * bytes an element – about 240,000 elements at 25 MB, under the 640,000-token
 * cap) and one comment block on the `<h1>`, so the preview instruments it on
 * every load. Without the block (`withBlock: false`) the same page is served
 * raw – the control.
 *
 * The block is planned on the page cut after its first row: the `<h1>`'s
 * anchor (its quote's suffix reaches into that row) and its place depend on
 * nothing further, so the bytes are the ones a plan on the whole page gives,
 * without parsing 25 MB in the runner.
 */
export function sizedPage(bytes: number, title: string, withBlock = true): string {
  const plainHead = [
    '<!doctype html>',
    '<html lang="en">',
    `<head><meta charset="utf-8"><title>${title}</title></head>`,
    '<body>',
    '  <h1 id="top">Sized page</h1>',
    ''
  ].join('\n')
  const tail = '</body>\n</html>\n'
  const rows: string[] = []
  let size = Buffer.byteLength(plainHead) + Buffer.byteLength(tail)
  for (let i = 0; size < bytes; i += 1) {
    const row = `  <p id="r${i}">Row ${i}: a paragraph of ordinary review text, long enough to look like a real page.</p>\n`
    rows.push(row)
    size += Buffer.byteLength(row)
  }
  if (!withBlock) return plainHead + rows.join('') + tail
  const cutTail = (rows[0] ?? '') + tail
  const head = withTitleBlock(plainHead + cutTail).slice(0, -cutTail.length)
  return head + rows.join('') + tail
}

/**
 * A page whose commented element spans its whole width – the owner's
 * `div.doc` (E-029, §19 Rev 4 "pins at the right edge"): no body margin, a
 * header above it, and tall enough for a vertical scrollbar, so the element's
 * top-right corner sits on the scrollbar's left edge. One open block on
 * `#doc`, on its own lines.
 */
export function fullWidthCommentPage(title: string): string {
  const page = [
    '<!doctype html>',
    '<html lang="en">',
    `<head><meta charset="utf-8"><title>${title}</title>`,
    '<style>body { margin: 0; font: 16px/1.5 sans-serif; } header { height: 64px; } .doc { padding: 24px 32px; min-height: 3000px; }</style>',
    '</head>',
    '<body>',
    '  <header id="masthead">Design notes</header>',
    '  <div id="doc" class="doc">',
    '    <p>A long document that runs the whole width of the page view.</p>',
    '  </div>',
    '</body>',
    '</html>',
    ''
  ].join('\n')
  return addTo(page, 'div', commentOn(page, 'div', 0, { id: fixedId('c-', 9) }), { ws: 'collapse' }).text
}

/** `page` with one open block on its `<h1>`, the way Erfana writes one. */
function withTitleBlock(page: string): string {
  return addTo(page, 'h1', commentOn(page, 'h1', 0, { id: fixedId('c-', 7) }), { ws: 'collapse' }).text
}
