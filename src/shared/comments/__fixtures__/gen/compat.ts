// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The v1-compat pages (G-002): files as other writers, editors, checkouts and
 * merges leave them, each with the parser's expected reading beside it. Run
 * through genFixtures.ts (`npm run fixtures:html-comments`), never on its own.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AGENT_NOTE_LINES,
  analyzeCommentDocument,
  applySplice,
  escapeJsonForComment,
  planInsert,
  serializeBlock,
  type CommentData
} from '../../../htmlComments/index'
import { ADA, GRACE, fixedId, makeComment, makeReply } from '../commentTestData'

/**
 * The licence lines every generated page starts with. Split so that REUSE and
 * the SPDX header check do not read this string as this file's own header.
 */
export const SPDX_HEADER =
  '<!-- SPDX-License-' + 'Identifier: GPL-3.0-only -->\n<!-- SPDX-' + 'FileCopyrightText: 2025-2026 Qodeca sp. z o.o. -->\n'

let counter = 100

/** A comment for `tag` with a fresh fixed id. */
function commentFor(tag: string, text: string, extra: Partial<CommentData['anchor']> = {}): CommentData {
  counter += 1
  return makeComment({
    id: fixedId('c-', counter),
    anchor: { tag, path: '', ...extra },
    msgs: [{ ...makeComment().msgs[0], id: fixedId('m-', counter), text }]
  })
}

/** Insert `data` before the n-th `<tag>` with planInsert. */
function insert(html: string, tag: string, data: CommentData, ws = 'collapse', n = 0): string {
  const doc = analyzeCommentDocument(html)
  const el = doc.index.elements.filter((e) => e.tag === tag)[n]
  if (!el) throw new Error(`no <${tag}> #${n}`)
  const plan = planInsert(doc, { targetStart: el.start, data, ws })
  if (!plan.ok) throw new Error(`insert before <${tag}>: ${plan.reason}`)
  return applySplice(html, plan.plan)
}

function block(data: CommentData, indent = '    '): string {
  const result = serializeBlock(data, { indent, eol: '\n' })
  if (!result.ok) throw new Error(result.reason)
  return result.block
}

function page(title: string, body: string): string {
  return `${SPDX_HEADER}<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <title>${title}</title>\n</head>\n<body>\n${body}</body>\n</html>\n`
}

function c01(): string {
  let html = page(
    'Compat c01 - canonical blocks',
    '  <main>\n    <h1 id="title">Pricing</h1>\n    <p>Our plans start at <em>10 EUR</em> per month.</p>\n    <button class="cta">Buy now</button>\n  </main>\n'
  )
  html = insert(html, 'h1', commentFor('h1', 'Shorter headline, please.', { id: 'title' }))
  html = insert(html, 'em', commentFor('em', 'Say 9 EUR here.'))
  html = insert(html, 'button', commentFor('button', 'Make this button blue.', { cls: ['cta'] }))
  const second = commentFor('button', 'And bigger.', { cls: ['cta'] })
  html = insert(html, 'button', { ...second, msgs: [...second.msgs, makeReply(1, 'Agreed.')] })
  return html
}

/** c01 after a CRLF checkout and an editor that re-indents and pads lines. */
function c02(source: string): string {
  let inBlock = false
  const lines = source.split('\n').map((line) => {
    if (line.includes('<!-- erfana:comment')) {
      inBlock = true
      return line
    }
    if (!inBlock) return line
    if (line.includes('-->')) inBlock = false
    return '\t' + line.trimStart() + '   '
  })
  return lines.join('\r\n').replace('Compat c01 - canonical blocks', 'Compat c02 - CRLF, re-indented')
}

/** Blocks written by another v1 writer: key order, spacing, escapes and a multi-line @data. */
function c03(): string {
  const data = commentFor('h1', 'Shorter headline, please.', { id: 'title' })
  const reordered = {
    msgs: data.msgs.map((m) => ({ text: m.text, at: m.at, by: { role: 'human', email: ADA.email, name: ADA.name }, id: m.id })),
    view: data.view,
    anchor: { path: '', tag: 'h1', id: 'title' },
    status: 'open',
    id: data.id,
    v: 1,
    'x-other-writer': { version: '0.1', note: 'kept on edit' }
  }
  const spaced = escapeJsonForComment(JSON.stringify(reordered))
    .replace(/,"/g, ', "')
    .replace(/":/g, '": ')
    .replace(/\\u00([0-9a-f]{2})/g, (_m, hex: string) => '\\u00' + hex.toUpperCase())
  const readable = [
    'status: open',
    'target: <h1 id="title">',
    `comment by ${ADA.name} <${ADA.email}> at ${data.msgs[0].at}:`,
    '  Shorter headline, please.'
  ]
  const first = [`<!--   erfana:comment   v1   id=${data.id}`, ...readable.map((l) => '    ' + l), `    @data ${spaced}`, '    -->'].join('\n')

  const second = commentFor('em', 'Say 9 EUR here.')
  const pretty = escapeJsonForComment(JSON.stringify({ ...second, msgs: [{ ...second.msgs[0], by: GRACE }] }, null, 2))
  const readable2 = [
    'status: open',
    'target: <em>',
    `comment by ${GRACE.name} at ${second.msgs[0].at}:`,
    '  Say 9 EUR here.'
  ]
  const secondBlock = [`<!-- erfana:comment v1 id=${second.id}`, ...readable2, `@data ${pretty}`, '-->'].join('\n')
  return page(
    'Compat c03 - non-canonical writer',
    `  <main>\n    ${first}\n    <h1 id="title">Pricing</h1>\n    <p>From ${secondBlock}<em>10 EUR</em>.</p>\n  </main>\n`
  )
}

/** One damaged block per reason, a newer block and one ok block; the file stays writable. */
function c04(): string {
  const items: string[] = []
  const add = (raw: string, label: string) => {
    const n = items.length + 1
    items.push(`    ${raw}\n    <li id="i${n}">${label}</li>\n`)
  }
  const ok = block(commentFor('li', 'This one is fine.', { id: 'i1' }))
  add(ok, 'ok')
  add(block(commentFor('li', 'No data line.')).replace(/\n {4}@data [^\n]*/, ''), 'no-data')
  add(block(commentFor('li', 'Truncated JSON.')).replace(/(\n[ \t]*@data [^\n]{40})[^\n]*/, '$1'), 'bad-json')
  add(block(commentFor('li', 'Status out of range.')).replace('"status":"open"', '"status":"closed"'), 'schema')
  add(block(commentFor('li', 'Nested too deep.')).replace('"view":{', '"view":{"deep":[[[[[[1]]]]]],'), 'limits')
  add(block(commentFor('li', 'Original text.')).replace('\n      Original text.', '\n      Hand-edited text.'), 'readable-mismatch')
  add(block(commentFor('li', 'Merge went through me.')).replace('\n    status: open', '\n    status: open\n======='), 'conflict-marker')
  const dup = block(commentFor('li', 'Copied with its element.'))
  add(dup, 'duplicate-id one')
  add(dup, 'duplicate-id two')
  const other = commentFor('li', 'Header id differs.')
  add(block(other).replace(`id=${other.id}`, `id=${fixedId('c-', 999)}`), 'id-mismatch')
  add(block(commentFor('li', 'Repeated key.')).replace('"status":"open"', '"status":"open","status":"open"'), 'duplicate key')
  add(`<!-- erfana:comment v2 id=${fixedId('c-', 998)}\n    status: open\n    @data {"v":2,"future":true}\n    -->`, 'newer')
  const tpl = block(commentFor('li', 'Inside a template.'))
  return page(
    'Compat c04 - damaged and newer blocks',
    `  <ul>\n${items.join('')}  </ul>\n  <template>\n    ${tpl}\n    <li>template item</li>\n  </template>\n`
  )
}

/** An ok block, then a block that never ends: the whole file is read-only. */
function c05(): string {
  const okBlock = block(commentFor('p', 'Fine.', { id: 'a' }))
  const open = block(commentFor('p', 'Never closed.', { id: 'b' })).replace(/\n {4}-->$/, '\n')
  return `${SPDX_HEADER}<!doctype html>\n<html lang="en">\n<body>\n    ${okBlock}\n    <p id="a">A</p>\n    ${open}    <p id="b">B</p>\n</body>\n</html>\n`
}

/** A real merge conflict through a block: the block is damaged and the file read-only. */
function c06(): string {
  const data = commentFor('p', 'Text A', { id: 'x' })
  const lines = block(data).split('\n')
  const target = lines.findIndex((l) => l.includes('target:'))
  const dataLine = lines.findIndex((l) => /^[ \t]*@data /.test(l))
  const ours = lines.slice(target, dataLine)
  const theirs = ours.map((l) => l.replace('Text A', 'Text B'))
  const conflicted = [...lines.slice(0, target), '<<<<<<< HEAD', ...ours, '=======', ...theirs, '>>>>>>> feature', ...lines.slice(dataLine)].join('\n')
  return page('Compat c06 - conflict hunk', `  <main>\n    ${conflicted}\n    <p id="x">X</p>\n  </main>\n`)
}

/** Block-shaped text where no comment node exists: no blocks at all. */
function c07(): string {
  const looks = `<!-- erfana:comment v1 id=${fixedId('c-', 997)}\nstatus: open\n@data {"v":1}\n-->`
  const inline = `<!-- erfana:comment v1 id=${fixedId('c-', 996)} -->`
  return (
    `${SPDX_HEADER}<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n` +
    `  <title>${inline}</title>\n` +
    `  <style>/* ${inline} */ p { color: black; }</style>\n` +
    `  <script>const s = "${inline}"; // ${inline}\n  </script>\n` +
    `  <noscript>${inline}</noscript>\n</head>\n<body>\n` +
    `  <textarea>${looks}</textarea>\n` +
    `  <xmp>${looks}</xmp>\n` +
    `  <div title="${inline}" data-x='${inline}'>attribute values</div>\n` +
    `  <iframe srcdoc="${inline}"></iframe>\n` +
    `  <svg><text><![CDATA[${inline}]]></text></svg>\n` +
    `  <!-- outer ${inline}\n` +
    '  <!-- erfana:comment without a version -->\n' +
    '  <!--erfana:commentary v1-->\n' +
    '  <!-- a note that mentions erfana:comment v1 in the middle -->\n' +
    '  <p>Body</p>\n</body>\n</html>\n'
  )
}

/**
 * The agent note as written, absent (another writer), reworded (another
 * Erfana), cut to its first line and re-indented: readers skip it, so every
 * block reads ok.
 */
function c09(): string {
  const noteCount = AGENT_NOTE_LINES.length
  const withNote = (lines: string[], note: string[]): string => [lines[0], ...note, ...lines.slice(1 + noteCount)].join('\n')
  const variants: Array<[string, (lines: string[]) => string]> = [
    ['as written', (lines) => lines.join('\n')],
    ['absent', (lines) => withNote(lines, [])],
    ['reworded', (lines) => withNote(lines, ['    note to agents: an earlier wording of this note, from an older checkout.'])],
    ['first line only', (lines) => withNote(lines, [lines[1]])],
    ['re-indented', (lines) => withNote(lines, lines.slice(1, 1 + noteCount).map((line) => '\t\t' + line.trim()))]
  ]
  const items = variants.map(([name, change]) => {
    const data = commentFor('li', `Note ${name}.`)
    return `    ${change(block(data).split('\n'))}\n    <li>${name}</li>\n`
  })
  return page('Compat c09 - agent note variants', `  <ul>\n${items.join('')}  </ul>\n`)
}

/** Implied tbody, unclosed li and p, three blocks on one element: position by source order. */
function c08(): string {
  let html = page(
    'Compat c08 - source order',
    '  <table>\n    <tr><td>1</td></tr>\n    <tr><td>2</td></tr>\n  </table>\n  <ul>\n    <li>one\n    <li>two\n  </ul>\n  <p>para one\n  <p>para two\n  <section>\n    <h2>Heading</h2>\n  </section>\n'
  )
  html = insert(html, 'tr', commentFor('tr', 'First row, implied tbody.'))
  html = insert(html, 'li', commentFor('li', 'After an unclosed li.'), 'collapse', 1)
  html = insert(html, 'p', commentFor('p', 'After an unclosed p.'), 'collapse', 1)
  html = insert(html, 'h2', commentFor('h2', 'First of three.'))
  html = insert(html, 'h2', commentFor('h2', 'Second of three.'), 'preserve')
  html = insert(html, 'h2', commentFor('h2', 'Third of three.'))
  return html
}

export function buildCompat(dir: string, expected: (html: string) => string): void {
  const files: Array<[string, string]> = []
  const one = c01()
  files.push(['c01-canonical', one], ['c02-crlf-reindented', c02(one)], ['c03-other-writer', c03()])
  files.push(['c04-damaged-and-newer', c04()], ['c05-unterminated', c05()], ['c06-conflict-hunk', c06()])
  files.push(['c07-lookalikes', c07()], ['c08-source-order', c08()], ['c09-agent-note', c09()])
  for (const [name, html] of files) {
    writeFileSync(join(dir, `${name}.html`), html)
    writeFileSync(join(dir, `${name}.expected.json`), expected(html))
  }
}
