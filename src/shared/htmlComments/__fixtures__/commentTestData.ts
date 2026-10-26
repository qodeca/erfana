// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Shared test data for the htmlComments suites: fixed authors, anchors, a
 * fixed clock and a seeded random source, so every serialized block is the
 * same on every machine and in every time zone.
 *
 * Characters that are invisible or reorder text are built with
 * `String.fromCharCode`, never typed or escaped, so no tool can silently
 * turn them into something else in this source.
 */
import { parse, type DefaultTreeAdapterMap } from 'parse5'
import { analyzeCommentDocument, type CommentDocument } from '../parse'
import { applySplice, planInsert, type SplicePlan } from '../splice'
import type { CommentAnchor, CommentAuthor, CommentData, CommentView, RandomBytes } from '../format'
import type { HtmlIndex, IndexedElement } from '../htmlIndex'

type ChildNode = DefaultTreeAdapterMap['childNode']

const PRE_LIKE = new Set(['pre', 'textarea', 'listing', 'plaintext'])

/**
 * The parse5 DOM of `html` as a list of tokens, ignoring comment nodes and
 * the whitespace a block can add (U-041): text outside pre-like elements is
 * merged across removed comments and its whitespace runs collapsed; text
 * inside `pre`/`textarea`/`listing`/`plaintext` is kept exactly.
 */
export function domSignature(html: string): string[] {
  const out: string[] = []
  let pendingText = ''
  let pendingPre = false
  const flush = (): void => {
    if (pendingText === '') return
    const text = pendingPre ? pendingText : pendingText.replace(/\s+/g, ' ')
    if (pendingPre || text.trim() !== '') out.push(`#text ${JSON.stringify(text)}`)
    pendingText = ''
  }
  type Visit = { node: ChildNode; pre: boolean } | { end: string }
  const stack: Visit[] = [...parse(html).childNodes].reverse().map(node => ({ node, pre: false }))
  for (let visit = stack.pop(); visit; visit = stack.pop()) {
    if ('end' in visit) {
      flush()
      out.push(visit.end)
      continue
    }
    const { node, pre } = visit
    if (node.nodeName === '#comment') continue
    if (node.nodeName === '#text' && 'value' in node) {
      if (pendingText !== '' && pendingPre !== pre) flush()
      pendingText += node.value
      pendingPre = pre
      continue
    }
    if (!('tagName' in node)) continue
    flush()
    out.push(
      `<${node.tagName} ${node.attrs.map(a => `${a.name}=${JSON.stringify(a.value)}`).join(' ')}>`
    )
    stack.push({ end: `</${node.tagName}>` })
    const childPre = pre || PRE_LIKE.has(node.tagName)
    const children =
      'content' in node
        ? [...(node.content as { childNodes: ChildNode[] }).childNodes]
        : node.childNodes
    for (let i = children.length - 1; i >= 0; i -= 1)
      stack.push({ node: children[i], pre: childPre })
  }
  flush()
  return out
}

/** One character from its code point. */
export const ch = (codePoint: number): string => String.fromCodePoint(codePoint)
/** One UTF-16 code unit (a lone surrogate included). */
export const unit = (code: number): string => String.fromCharCode(code)

export const BOM = unit(0xfeff)
export const RLO = unit(0x202e)
export const LRI = unit(0x2066)
export const PDI = unit(0x2069)
export const ZWSP = unit(0x200b)
export const ZWJ = unit(0x200d)
export const LINE_SEP = unit(0x2028)
export const PARA_SEP = unit(0x2029)
export const LONE_HIGH = unit(0xd83d)
export const LONE_LOW = unit(0xde00)
export const NUL = unit(0)

export const FIXED_NOW = new Date('2026-10-25T14:03:00.000Z')
export const LATER = new Date('2026-10-26T09:12:00.000Z')

export const ADA: CommentAuthor = { name: 'Ada Lovelace', email: 'ada@example.com', role: 'human' }
export const GRACE: CommentAuthor = { name: 'Grace Hopper', role: 'human' }

export const VIEW: CommentView = { w: 1280, h: 800, dpr: 2, x: 0, y: 120 }

export const BUTTON_ANCHOR: CommentAnchor = {
  tag: 'button',
  cls: ['cta'],
  path: 'html > body > main:nth-of-type(1) > button:nth-of-type(1)',
  quote: { exact: 'Buy now', prefix: 'Pricing', suffix: '' }
}

/** A deterministic `RandomBytes` (xorshift32). */
export function seededRandom(seed = 1): RandomBytes {
  let state = seed >>> 0 || 1
  return length => {
    const out = new Uint8Array(length)
    for (let i = 0; i < length; i += 1) {
      state ^= state << 13
      state >>>= 0
      state ^= state >>> 17
      state ^= state << 5
      state >>>= 0
      out[i] = state & 0xff
    }
    return out
  }
}

/** A minimal valid comment with fixed ids. */
export function makeComment(overrides: Partial<CommentData> = {}): CommentData {
  return {
    v: 1,
    id: 'c-k3j7q2m6x7p4d2za',
    status: 'open',
    anchor: BUTTON_ANCHOR,
    view: VIEW,
    msgs: [
      {
        id: 'm-a2b3c4d5e6f7g2h3',
        by: ADA,
        at: '2026-10-25T14:03:00Z',
        text: 'Make this button blue and bigger.'
      }
    ],
    ...overrides
  }
}

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567'

/** A valid fixed id: `prefix` + 16 base32 characters encoding `n`. */
export function fixedId(prefix: 'c-' | 'm-', n: number): string {
  let digits = ''
  for (let rest = n; digits.length < 16; rest = Math.floor(rest / 32)) {
    digits = BASE32[rest % 32] + digits
  }
  return prefix + digits
}

/** A reply message with a fixed id. */
export function makeReply(n: number, text: string, by: CommentAuthor = GRACE) {
  return { id: fixedId('m-', 1000 + n), by, at: '2026-10-26T09:12:00Z', text }
}

/** The `n`-th (0-based) eligible element with tag `tag`. */
export function elementOf(index: HtmlIndex, tag: string, n = 0): IndexedElement {
  const el = index.elements.filter(e => e.tag === tag)[n]
  if (!el) throw new Error(`no <${tag}> #${n} in the index`)
  return el
}

/** Analyse `html`, add `data` before the `n`-th `<tag>`, and return the plan and new text. */
export function addTo(
  html: string,
  tag: string,
  data: CommentData,
  options: { n?: number; ws?: string } = {}
): { doc: CommentDocument; plan: SplicePlan; text: string } {
  const doc = analyzeCommentDocument(html)
  const el = elementOf(doc.index, tag, options.n)
  const result = planInsert(doc, { targetStart: el.start, data, ws: options.ws })
  if (!result.ok) throw new Error(`planInsert failed: ${result.reason}`)
  return { doc, plan: result.plan, text: applySplice(html, result.plan) }
}

/**
 * A JSON-safe projection of a document's comment state, for the v1-compat
 * `.expected.json` files: kinds, reasons, ranges, hashes, targets (with the
 * tag found there) and the full data of every `ok` block.
 */
export function projectState(doc: CommentDocument): unknown {
  const { state, index } = doc
  return {
    writable: state.writable,
    ...(state.readOnlyReason ? { readOnlyReason: state.readOnlyReason } : {}),
    blocks: state.blocks.map(block => {
      const base = {
        kind: block.kind,
        range: block.range,
        nodeRange: block.nodeRange,
        rawHash: block.rawHash
      }
      if (block.kind === 'ok') {
        const target =
          block.target.state === 'attached'
            ? { ...block.target, tag: index.elementAt(block.target.startOffset)?.tag }
            : block.target
        return { ...base, target, data: block.data }
      }
      if (block.kind === 'damaged') {
        return {
          ...base,
          reason: block.reason,
          ...(block.headerId ? { headerId: block.headerId } : {})
        }
      }
      return { ...base, version: block.version }
    })
  }
}

/** The six-character `\uXXXX` escape of one code unit, built without typing one. */
export const uEsc = (code: number): string =>
  String.fromCharCode(0x5c) + 'u' + code.toString(16).padStart(4, '0')

/** Wrap one serialized block in a small page whose button the block targets. */
export function pageWith(block: string): string {
  return `<!doctype html><main><p>Pricing</p>\n${block}<button class="cta">Buy now</button></main>`
}
