// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The fields of 025-FR-033 for one element, read from the page (spec 025,
 * 025-FR-033, 025-FR-035; ADR 0007 decision 3; solution design § 6.1 "full
 * facts after the menu shows").
 *
 * - Selector chain, frame chain, own-frame box: the pinned chain read.
 * - Outer HTML: the pinned cut in the isolated world (≤ 20,001 code units,
 *   so the context file can tell it was cut).
 * - Computed styles and the layout chain: the pinned style read.
 * - Matched rules: `CSS.getMatchedStylesForNode`, for an element in its
 *   frame target's own document and outside shadow roots (the selector finds
 *   its node id); otherwise, or when the CSS domain returns none, `null` –
 *   the context file then notes "matched rules not available". Stylesheet
 *   URLs come from the `CSS.styleSheetAdded` events the caller records.
 * - Covered by: what a click at the centre of the element's box would hit,
 *   when that is neither the element, one of its ancestors nor one of its
 *   descendants (025-FR-035). A CDP hit test, not `elementFromPoint`, which
 *   V8's side-effect check refuses in a page function (commit-14 probe).
 *
 * Each part fails alone: a part that cannot be read is left empty, never
 * blocking the rest. Nothing here runs while the page is frozen.
 */
import type { LayoutChainEntry, MatchedRule } from '../../../../shared/browser/contextFile'
import { OUTER_HTML_CUT, OUTER_HTML_READ_MAX_CODE_UNITS } from '../cdp/cdpPinned'
import { PICK_STRING_MAX, PICK_STYLES } from '../cdp/cdpPickFunctions'
import { isRecord } from '../cdp/cdpTypes'
import type { Box } from '../pick/pickGeometry'
import { stringField, type PickNode, type PickReader } from '../pick/pickCdp'
import { boxInView, readChain, type ElementChain } from '../pick/pickElement'
import type { PickFrames } from '../pick/pickFrames'
import { PickHitTest } from '../pick/pickHitTest'

/** Most matched rules listed. */
export const MATCHED_RULES_MAX = 30

/** A stylesheet the CSS domain announced: its URL and the line its text starts at. */
export interface StyleSheetHeader {
  readonly sourceURL: string
  readonly startLine: number
}

export interface ElementFacts {
  readonly selectors: readonly string[]
  readonly closedShadow: boolean
  readonly frameOrigins: readonly string[]
  readonly outerHtml: string
  readonly styles: readonly (readonly [string, string])[]
  readonly layout: readonly LayoutChainEntry[]
  readonly matchedRules: readonly MatchedRule[] | null
  readonly coveredBy: string | null
  /** Live top-level box at the read; null when the element has no box. */
  readonly boxInView: Box | null
  readonly boxInFrame: Box
  readonly connected: boolean
}

export interface FactsContext {
  readonly reader: PickReader
  readonly frames: PickFrames
  /** Stylesheet headers by id, from `CSS.styleSheetAdded`. */
  readonly styleSheets: ReadonlyMap<string, StyleSheetHeader>
  /** Runs `task` after every earlier node-id read of the same session (`DOM.getDocument` resets node ids). */
  readonly serialise: <T>(sessionKey: string, task: () => Promise<T>) => Promise<T>
}

const cut = (v: unknown): string => (typeof v === 'string' ? v.slice(0, PICK_STRING_MAX) : '')

function parseStyles(raw: unknown): { styles: Array<[string, string]>; layout: LayoutChainEntry[] } {
  if (!isRecord(raw)) return { styles: [], layout: [] }
  const styles = Array.isArray(raw.styles)
    ? raw.styles
        .filter((s): s is [string, string] => Array.isArray(s) && typeof s[0] === 'string' && typeof s[1] === 'string')
        .map(([n, v]): [string, string] => [cut(n), cut(v)])
    : []
  const layout = Array.isArray(raw.layout)
    ? raw.layout.filter(isRecord).map((l) => ({
        tag: cut(l.tag),
        display: cut(l.display),
        position: cut(l.position),
        overflow: cut(l.overflow),
        width: cut(l.width),
        height: cut(l.height)
      }))
    : []
  return { styles, layout }
}

/** The regular (author) rules of a `getMatchedStylesForNode` answer, with their stylesheet URL and 1-based line. */
export function parseMatchedRules(raw: unknown, sheets: ReadonlyMap<string, StyleSheetHeader>): MatchedRule[] {
  const list = isRecord(raw) && Array.isArray(raw.matchedCSSRules) ? raw.matchedCSSRules : []
  const rules: MatchedRule[] = []
  for (const match of list) {
    const rule = isRecord(match) ? match.rule : undefined
    if (!isRecord(rule) || rule.origin !== 'regular') continue
    const selector = isRecord(rule.selectorList) ? cut(rule.selectorList.text) : ''
    const style = isRecord(rule.style) ? rule.style : {}
    const header = sheets.get(stringField(rule, 'styleSheetId'))
    const range = isRecord(style.range) ? style.range : {}
    const startLine = typeof range.startLine === 'number' ? range.startLine : 0
    const line = (header?.startLine ?? 0) + startLine + 1
    rules.push({ stylesheetUrl: cut(header?.sourceURL ?? ''), line, text: cut(`${selector} { ${stringField(style, 'cssText').trim()} }`) })
    if (rules.length >= MATCHED_RULES_MAX) break
  }
  return rules
}

async function matchedRules(ctx: FactsContext, node: PickNode, chain: ElementChain): Promise<MatchedRule[] | null> {
  const selector = chain.selectors[chain.selectors.length - 1]
  const sessionTarget = ctx.frames.frameTargets().find((t) => t.sessionKey === node.sessionKey)
  const ownDocument = chain.selectors.length === chain.frameOrigins.length && !chain.closedShadow
  // Only the frame target's own document is reachable from `DOM.getDocument`'s root.
  if (selector === undefined || sessionTarget === undefined || !ownDocument || !(await isSessionRootFrame(ctx, node))) return null
  return ctx.serialise(node.sessionKey, async () => {
    const doc = await ctx.reader.call('DOM.getDocument', { depth: 0 }, node.sessionKey)
    const rootId = isRecord(doc) && isRecord(doc.root) ? doc.root.nodeId : undefined
    if (typeof rootId !== 'number') return null
    const found = await ctx.reader.call('DOM.querySelectorAll', { nodeId: rootId, selector }, node.sessionKey)
    const ids = isRecord(found) && Array.isArray(found.nodeIds) ? found.nodeIds : []
    if (ids.length !== 1 || typeof ids[0] !== 'number') return null
    const raw = await ctx.reader.call('CSS.getMatchedStylesForNode', { nodeId: ids[0] }, node.sessionKey)
    const rules = parseMatchedRules(raw, ctx.styleSheets)
    return rules.length === 0 ? null : rules
  })
}

/** Whether the node's frame is the root frame of its session (the document `DOM.getDocument` returns). */
async function isSessionRootFrame(ctx: FactsContext, node: PickNode): Promise<boolean> {
  const frames = await ctx.frames.allFrames()
  const own = frames.find((f) => f.frameId === node.frameId)
  if (own === undefined) return false
  const parent = own.parentId === null ? undefined : frames.find((f) => f.frameId === own.parentId)
  return parent === undefined || parent.sessionKey !== own.sessionKey
}

/** The tag of the element covering `node` at the centre of its box, or null (025-FR-035). */
async function coveringTag(ctx: FactsContext, node: PickNode, chain: ElementChain, box: { x: number; y: number; width: number; height: number }): Promise<string | null> {
  if (!(box.width > 0 && box.height > 0)) return null
  const hit = await new PickHitTest(ctx.reader, ctx.frames).atViewPoint({ x: box.x + box.width / 2, y: box.y + box.height / 2 })
  if (hit === null || hit.node.sessionKey !== node.sessionKey || hit.node.backendNodeId === node.backendNodeId) return null
  const own = (n: { node: PickNode | null }): number | undefined => n.node?.backendNodeId
  if (chain.entries.some((e) => own(e) === hit.node.backendNodeId)) return null
  const hitChain = await readChain(ctx.reader, ctx.frames, hit.node)
  if (hitChain.entries.some((e) => own(e) === node.backendNodeId)) return null
  return hitChain.entries[hitChain.entries.length - 1].name.tagName.toLowerCase() || null
}

/** Wrap a part so its failure leaves `fallback`. */
async function part<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work()
  } catch {
    return fallback
  }
}

/**
 * Read the facts of `node`. `chain` is its chain read when the caller has
 * one; otherwise it is read here.
 *
 * @throws when the element's chain cannot be read (the element or its frame went)
 */
export async function readElementFacts(ctx: FactsContext, node: PickNode, chain?: ElementChain): Promise<ElementFacts> {
  const own = chain ?? (await readChain(ctx.reader, ctx.frames, node))
  const self = own.entries[own.entries.length - 1]
  const [outerHtml, styles, rules, live] = await Promise.all([
    part(async () => cut20k(await ctx.reader.valueOn(node, OUTER_HTML_CUT)), ''),
    part(async () => parseStyles(await ctx.reader.valueOn(node, PICK_STYLES)), { styles: [], layout: [] }),
    part(() => matchedRules(ctx, node, own), null),
    boxInView(ctx.reader, ctx.frames, node)
  ])
  const coveredBy = live === null ? null : await part(() => coveringTag(ctx, node, own, live), null)
  return {
    selectors: own.selectors,
    closedShadow: own.closedShadow,
    frameOrigins: own.frameOrigins,
    outerHtml,
    styles: styles.styles,
    layout: styles.layout,
    matchedRules: rules,
    coveredBy,
    boxInView: live,
    boxInFrame: self.boxInFrame,
    connected: own.connected
  }
}

/** The outer HTML as read: a string of at most the read cap (the page cut it already). */
function cut20k(raw: unknown): string {
  return typeof raw === 'string' ? raw.slice(0, OUTER_HTML_READ_MAX_CODE_UNITS) : ''
}
