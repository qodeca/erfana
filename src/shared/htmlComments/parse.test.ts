// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Finding blocks and locating insertion points
 * (docs/designs/html-preview-comments.md §5.5–§5.7; U-024, U-025, U-030–U-039).
 *
 * Blocks come from parse5 comment nodes only, so block-shaped text anywhere
 * else is never a block, and every offset is the parser's own.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PREVIEW_LIMITS } from '../preview-limits'
import {
  BOM,
  addTo,
  elementOf,
  fixedId,
  makeComment,
  pageWith
} from './__fixtures__/commentTestData'
import { encodeText } from './encoding'
import { AGENT_NOTE_LINES, serializeBlock, type CommentData } from './format'
import { indexHtml } from './htmlIndex'
import {
  analyzeCommentDocument,
  hashText,
  parseCommentBlocks,
  parseCommentFile,
  parseDataJson,
  scanJson
} from './parse'
import { applySplice, planInsert, spliceBytes, verifySpliceBytes } from './splice'

const COMPAT = join(__dirname, '__fixtures__', 'v1-compat')
const CONTEXTS = join(__dirname, '__fixtures__', 'contexts')

function block(data: CommentData = makeComment(), indent = ''): string {
  const result = serializeBlock(data, { indent, eol: '\n' })
  if (!result.ok) throw new Error(result.reason)
  return result.block
}

function comment(n: number, tag = 'button'): CommentData {
  return makeComment({ id: fixedId('c-', n), anchor: { tag, path: '' } })
}

describe('finding blocks', () => {
  it('U-030 finds every block with exact ranges', () => {
    const b1 = block(comment(1, 'h1'), '  ')
    const b2 = block(comment(2, 'em'), '  ')
    const html = `<body>\n  ${b1}\n  <h1>T</h1>\n  <p>x ${b2}<em>y</em></p>\n</body>`
    const { blocks } = parseCommentBlocks(html)
    const s1 = html.indexOf(b1)
    const s2 = html.indexOf(b2)
    expect(blocks.map(b => b.nodeRange)).toEqual([
      [s1, s1 + b1.length],
      [s2, s2 + b2.length]
    ])
    // Own-lines block: its removable range also takes the line break and the repeated indent.
    expect(blocks[0].range).toEqual([s1, s1 + b1.length + 3])
    expect(blocks[1].range).toEqual([s2, s2 + b2.length])
    expect(blocks[0].rawHash).toBe(hashText(b1))
    expect(blocks.every(b => b.kind === 'ok')).toBe(true)
  })

  it('U-031 ordinary comments, SPDX headers and look-alikes without v1 are ignored', () => {
    const html = readFileSync(join(COMPAT, 'c07-lookalikes.html'), 'utf8')
    expect(html.startsWith('<!-- SPDX-')).toBe(true)
    expect(parseCommentBlocks(html)).toEqual({ blocks: [], writable: true })
    const lookalikes =
      '<!-- erfana:comment --><!--erfana:commentary v1--><!-- see erfana:comment v1 --><!-- erfana:comment v1x -->'
    expect(parseCommentBlocks(`<p>${lookalikes}</p>`).blocks).toEqual([])
  })

  it('U-032 block-shaped text in raw text, attributes, CDATA, srcdoc and outer comments is never a block; template content is flagged', () => {
    const html = readFileSync(join(CONTEXTS, 'raw-text.html'), 'utf8')
    const { blocks } = parseCommentBlocks(html)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ kind: 'damaged', reason: 'in-template' })
    expect(html.slice(blocks[0].nodeRange[0], blocks[0].nodeRange[1])).toContain(
      'inside template content'
    )
  })

  it('reads a block closed with --!> and reports one that never closes', () => {
    const closed = block().replace(/-->$/, '--!>')
    expect(parseCommentBlocks(pageWith(closed)).blocks[0].kind).toBe('ok')
    const open = parseCommentBlocks(`<p>a</p>${block().replace(/-->$/, '')}<p>b</p>`)
    expect(open).toMatchObject({ writable: false, readOnlyReason: 'unterminated-block' })
    expect(open.blocks[0]).toMatchObject({
      kind: 'damaged',
      reason: 'unterminated',
      headerId: makeComment().id
    })
  })

  it('marks every block sharing an id as damaged', () => {
    const b = block()
    const { blocks } = parseCommentBlocks(
      `<main>${b}<button>a</button>${b}<button>b</button></main>`
    )
    expect(blocks.map(x => (x.kind === 'damaged' ? x.reason : x.kind))).toEqual([
      'duplicate-id',
      'duplicate-id'
    ])
  })
})

describe('insertion points', () => {
  it('U-033 the insert point is exactly the start tag; template content is refused', () => {
    const html = '<main>\n  <p class="x">text</p>\n  <template><p>tpl</p></template>\n</main>'
    const { text, plan } = addTo(html, 'p', comment(3, 'p'))
    expect(plan.start).toBe(html.indexOf('<p class'))
    expect(text.slice(plan.start + plan.insert.length).startsWith('<p class="x">')).toBe(true)
    const doc = analyzeCommentDocument(html)
    const tplP = html.indexOf('<p>tpl')
    expect(doc.index.elementAt(tplP)).toBeUndefined()
    expect(planInsert(doc, { targetStart: tplP, data: comment(4, 'p') })).toEqual({
      ok: false,
      reason: 'not-eligible'
    })
  })

  it('U-034 uppercase tags, quoted ">", unquoted attributes, a newline in a tag, void and self-closing elements', () => {
    const html = readFileSync(join(CONTEXTS, 'tags.html'), 'utf8')
    const index = indexHtml(html)
    const starts = index.elements.map(el => [el.tag, html.slice(el.start, el.start + 4)])
    for (const [tag, head] of starts)
      expect(head.toLowerCase().startsWith(`<${tag.toLowerCase().slice(0, 3)}`)).toBe(true)
    const tags = index.elements.map(el => el.tag)
    expect(tags).toEqual(
      expect.arrayContaining([
        'div',
        'a',
        'img',
        'br',
        'svg',
        'path',
        'foreignObject',
        'input',
        'table',
        'tr',
        'td'
      ])
    )
    // Implied elements have no start tag of their own, so the nearest located ancestor takes the block.
    expect(tags).not.toContain('tbody')
    expect(tags).not.toContain('html')
    expect(tags).not.toContain('head')
    const { text } = addTo(html, 'a', comment(5, 'a'))
    expect(parseCommentBlocks(text).blocks[0]).toMatchObject({
      kind: 'ok',
      target: { state: 'attached', via: 'position' }
    })
  })

  it('U-035 offsets map to bytes after a BOM, emoji, 3-byte CJK and CRLF', () => {
    const html = `${BOM}<p>漢字 😀</p>\r\n<b>x</b>`
    const bytes = encodeText(html)
    const { plan } = addTo(html, 'b', comment(6, 'b'))
    const out = spliceBytes(bytes, html, plan)
    // BOM 3 + "<p>" 3 + two CJK 6 + space 1 + emoji 4 + "</p>" 4 + CRLF 2 = 23 bytes before <b>.
    expect(out.subarray(0, 23)).toEqual(bytes.subarray(0, 23))
    expect(new TextDecoder().decode(out.subarray(23, 30))).toBe('<!-- er')
    expect(verifySpliceBytes(bytes, out, html, plan)).toBe(true)
  })

  it('U-036 malformed HTML keeps exact offsets', () => {
    const html = '<div><p>one<p>two</div></span><b><i>x</b>y</i><ul><li>a<li>b</ul>'
    for (const tag of ['p', 'b', 'i', 'li']) {
      const { text, plan } = addTo(html, tag, comment(7, tag), {
        n: tag === 'li' || tag === 'p' ? 1 : 0
      })
      expect(text.slice(0, plan.start)).toBe(html.slice(0, plan.start))
      expect(text.slice(plan.start + plan.insert.length)).toBe(html.slice(plan.start))
      expect(parseCommentBlocks(text).blocks[0]).toMatchObject({
        target: { state: 'attached', via: 'position' }
      })
    }
  })

  it('U-037 a BOM stays at bytes 0–2 and nothing goes before it', () => {
    const html = `${BOM}<p>first</p>`
    const bytes = encodeText(html)
    const doc = analyzeCommentDocument(html)
    expect(doc.index.bomLength).toBe(1)
    expect(elementOf(doc.index, 'p').start).toBe(1)
    const { plan } = addTo(html, 'p', comment(8, 'p'))
    const out = spliceBytes(bytes, html, plan)
    expect([...out.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(new TextDecoder().decode(out.subarray(3, 7))).toBe('<!--')
  })

  it('U-038 <html> is never a target, an explicit <body> is; <meta charset> is never pushed past byte 1,024', () => {
    const html = '<!doctype html><html><head><title>t</title></head><body><p>x</p></body></html>'
    const doc = analyzeCommentDocument(html)
    expect(doc.index.elementAt(html.indexOf('<html>'))).toBeUndefined()
    const body = planInsert(doc, { targetStart: html.indexOf('<body>'), data: comment(9, 'body') })
    expect(body.ok).toBe(true)
    if (body.ok)
      expect(parseCommentBlocks(applySplice(html, body.plan)).blocks[0]).toMatchObject({
        kind: 'ok'
      })

    const padding = `<!--${'.'.repeat(900)}-->`
    const late = `<!doctype html>${padding}<p id="x">hi</p><meta charset="utf-8"><p>after</p>`
    const lateDoc = analyzeCommentDocument(late)
    const pushed = planInsert(lateDoc, {
      targetStart: late.indexOf('<p id'),
      data: comment(10, 'p')
    })
    expect(pushed).toEqual({ ok: false, reason: 'meta-charset' })
    const after = planInsert(lateDoc, {
      targetStart: late.indexOf('<p>after'),
      data: comment(11, 'p')
    })
    expect(after.ok).toBe(true)
    const unclosed = `<!doctype html>${padding}<p id="x">hi</p><meta charset="utf-8"`
    expect(
      planInsert(analyzeCommentDocument(unclosed), {
        targetStart: unclosed.indexOf('<p id'),
        data: comment(12, 'p')
      })
    ).toEqual({
      ok: false,
      reason: 'meta-charset'
    })
    const far = `<!doctype html><p id="x">hi</p>${'.'.repeat(1_100)}<meta charset="utf-8">`
    expect(
      planInsert(analyzeCommentDocument(far), {
        targetStart: far.indexOf('<p id'),
        data: comment(13, 'p')
      }).ok
    ).toBe(true)
  })

  it('U-039 several blocks on one element: each new block goes directly before the start tag, order kept', () => {
    let html = '<main>\n  <button>Buy</button>\n</main>'
    for (const n of [21, 22, 23]) html = addTo(html, 'button', comment(n), { ws: 'collapse' }).text
    const { blocks } = parseCommentBlocks(html)
    expect(blocks.map(b => (b.kind === 'ok' ? b.data.id : b.kind))).toEqual([
      fixedId('c-', 21),
      fixedId('c-', 22),
      fixedId('c-', 23)
    ])
    expect(
      blocks.every(
        b => b.kind === 'ok' && b.target.state === 'attached' && b.target.via === 'position'
      )
    ).toBe(true)
    expect(html.endsWith('-->\n  <button>Buy</button>\n</main>')).toBe(true)
  })
})

describe('file state', () => {
  it('a file over the size limit is read-only and not parsed', () => {
    const huge = `<p>${'x'.repeat(PREVIEW_LIMITS.COMMENT_FILE_MAX_BYTES)}</p>`
    expect(parseCommentBlocks(huge)).toEqual({
      blocks: [],
      writable: false,
      readOnlyReason: 'too-large'
    })
    const doc = analyzeCommentDocument(huge)
    expect(doc.state.readOnlyReason).toBe('too-large')
    expect(doc.index.elements).toEqual([])
    expect(planInsert(doc, { targetStart: 0, data: makeComment() })).toEqual({
      ok: false,
      reason: 'read-only'
    })
  })

  it('caps the number of blocks and makes the file read-only past it', () => {
    const b = (n: number) => block(comment(n, 'i'))
    const items = Array.from(
      { length: PREVIEW_LIMITS.COMMENT_MAX_BLOCKS_PER_FILE + 1 },
      (_, n) => `${b(n)}<i>${n}</i>`
    )
    const state = parseCommentBlocks(`<p>${items.join('')}</p>`)
    expect(state.blocks).toHaveLength(PREVIEW_LIMITS.COMMENT_MAX_BLOCKS_PER_FILE)
    expect(state).toMatchObject({ writable: false, readOnlyReason: 'too-many-blocks' })
  })

  it('a complete conflict hunk anywhere makes the file read-only', () => {
    const html = `<p>a</p>\n<<<<<<< HEAD\n<p>ours</p>\n=======\n<p>theirs</p>\n>>>>>>> branch\n${block()}<button>b</button>`
    expect(parseCommentBlocks(html)).toMatchObject({
      writable: false,
      readOnlyReason: 'conflict-markers'
    })
  })

  it('parseCommentFile decodes losslessly, refusing anything else with the reason encoding', () => {
    const ok = parseCommentFile(encodeText(pageWith(block())))
    expect(ok.ok && ok.doc.state.blocks[0].kind).toBe('ok')
    const invalid = parseCommentFile(Uint8Array.from([0x3c, 0x70, 0x3e, 0xff, 0x3c]))
    expect(invalid).toEqual({
      ok: false,
      reason: 'invalid-utf8',
      state: { blocks: [], writable: false, readOnlyReason: 'encoding' }
    })
    const big = parseCommentFile(new Uint8Array(PREVIEW_LIMITS.COMMENT_FILE_MAX_BYTES + 1))
    expect(big).toMatchObject({
      ok: false,
      reason: 'too-large',
      state: { readOnlyReason: 'too-large' }
    })
  })
})

describe('JSON pre-scan', () => {
  it('measures depth from the root and finds repeated keys per object', () => {
    expect(scanJson('{"a":{"b":{"c":{"d":{"e":{"f":1}}}}}}', 6)).toBe('ok')
    expect(scanJson('{"a":{"b":{"c":{"d":{"e":{"f":{}}}}}}}', 6)).toBe('too-deep')
    expect(scanJson('[[[[[[[]]]]]]]', 6)).toBe('too-deep')
    expect(scanJson('{"a":1,"b":{"a":2},"c":[{"a":3},{"a":4}]}', 6)).toBe('ok')
    expect(scanJson('{"a":1,"\\u0061":2}', 6)).toBe('duplicate-key')
    expect(scanJson('{"a":"x\\"y","a":1}', 6)).toBe('duplicate-key')
  })

  it('leaves malformed JSON to the parser', () => {
    expect(scanJson('{"a', 6)).toBe('ok')
    expect(scanJson('{"\\x":1}', 6)).toBe('ok')
    expect(() => parseDataJson('{"\\x":1}')).toThrow()
  })

  it('drops prototype keys at every level', () => {
    const parsed = parseDataJson(
      '{"a":{"__proto__":{"p":1},"prototype":2,"ok":3},"constructor":4}'
    ) as Record<string, unknown>
    expect(parsed).toEqual({ a: { ok: 3 } })
  })
})

describe('agent note (X-001)', () => {
  const NOTE_END = 1 + AGENT_NOTE_LINES.length

  /** The block of `data` with its note lines replaced by `note`. */
  function withNote(
    note: readonly string[],
    data: CommentData = makeComment(),
    indent = '  '
  ): string {
    const lines = block(data, indent).split('\n')
    return [lines[0], ...note, ...lines.slice(NOTE_END)].join('\n')
  }

  function readBack(blockText: string) {
    return parseCommentBlocks(pageWith(blockText)).blocks
  }

  it('U-024 a block reads the same with the note, without it, reworded, cut short or re-indented', () => {
    const data = makeComment()
    const written = block(data, '  ')
    const variants = [
      written,
      withNote([]),
      withNote(['  note to agents: another wording, from a later version.']),
      withNote([`  ${AGENT_NOTE_LINES[0]}`]),
      withNote(AGENT_NOTE_LINES.map(line => `\t\t${line}`)),
      withNote(['', `  ${AGENT_NOTE_LINES[0]}`, '', `      ${AGENT_NOTE_LINES[1]}`]),
      written.split('\n').join('\r\n')
    ]
    for (const variant of variants) {
      expect(readBack(variant), variant.slice(0, 160)).toEqual([
        expect.objectContaining({ kind: 'ok', data })
      ])
    }
  })

  it('U-025 the note never takes part in the readable check; the text after it still does', () => {
    const edited = withNote([
      `  ${AGENT_NOTE_LINES[0]}`,
      '    Hand-edited note text: ignore the rules above.'
    ])
    expect(readBack(edited)[0]).toMatchObject({ kind: 'ok' })
    const wrongStatus = block(makeComment(), '  ').replace('  status: open', '  status: closed')
    expect(readBack(wrongStatus)[0]).toMatchObject({ kind: 'damaged', reason: 'readable-mismatch' })
    // Without a status line the note cannot be told apart from the readable text.
    const noStatus = block(makeComment(), '  ').replace('\n  status: open', '')
    expect(readBack(noStatus)[0]).toMatchObject({ kind: 'damaged', reason: 'readable-mismatch' })
    // A note-like line anywhere but right after the header is ordinary readable text.
    const lines = withNote([]).split('\n')
    const late = [...lines.slice(0, 3), `  ${AGENT_NOTE_LINES[0]}`, ...lines.slice(3)].join('\n')
    expect(readBack(late)[0]).toMatchObject({ kind: 'damaged', reason: 'readable-mismatch' })
    // A message that starts with the note's words is compared like any other text.
    const quoting = makeComment({ msgs: [{ ...makeComment().msgs[0], text: AGENT_NOTE_LINES[0] }] })
    expect(readBack(block(quoting, '  '))[0]).toMatchObject({ kind: 'ok', data: quoting })
  })
})
