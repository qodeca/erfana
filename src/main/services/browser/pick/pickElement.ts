// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Reading one picked element and the chain Up walks (spec 025, 025-FR-026,
 * 025-FR-027, 025-FR-029, 025-FR-033; solution design § 4 "refinement on the
 * still image", spec change S-34).
 *
 * - {@link describeForLabel}: the hover label from CDP alone (`describeNode`
 *   and `getBoxModel`, no page function), fast enough for every move.
 * - {@link readChain}: at confirm, the element's ancestors from the top
 *   page's root element down to the element – crossing shadow roots to their
 *   hosts and each frame's root to its `<iframe>` in the parent document, as
 *   Up does – with each entry's name, source attributes and box, the
 *   selector chain and the frame chain. Every entry gets a node handle, so
 *   refinement can highlight and read it later without running a page
 *   function (none may run while the page is frozen, ADR 0008 probe).
 * - {@link boxInView}: an element's border box in the top-level viewport.
 *
 * Every string here is page text and goes only into the untrusted block or
 * through `elementLabel.ts`'s sanitising (S10).
 */
import type { ElementNameInput } from '../../../../shared/browser/elementLabel'
import { PICK_ANCESTOR, PICK_CHAIN } from '../cdp/cdpPickFunctions'
import { isRecord } from '../cdp/cdpTypes'
import { mapBox, quadBounds, quadFrom, type Box } from './pickGeometry'
import { numberField, stringField, type PickNode, type PickReader } from './pickCdp'
import { chainFrames, type PickFrames } from './pickFrames'

/** One element of the chain Up walks. */
export interface ChainEntry {
  readonly name: ElementNameInput
  /** Source-location attributes on this element (025-FR-037 rule 1). */
  readonly attrs: readonly (readonly [string, string])[]
  /** The kind of shadow root the element sits in, if any. */
  readonly shadow: 'open' | 'closed' | null
  /** Bounding box in the element's own frame (CSS px). */
  readonly boxInFrame: Box
  /** Bounding box in the top-level viewport at the read (CSS px); null when the engine has none (`display: contents`). */
  boxInView: Box | null
  /** The element's handle; null when it could not be resolved. */
  node: PickNode | null
}

export interface ElementChain {
  /** Root first; the last entry is the element read. */
  readonly entries: ChainEntry[]
  /** One selector per document and open shadow root, top first (025-FR-033). */
  readonly selectors: readonly string[]
  /** The element sits in a closed shadow root: the selectors end at its host. */
  readonly closedShadow: boolean
  /** Frame origins from the top page to the element's frame. */
  readonly frameOrigins: readonly string[]
  /** The element was still in its document at the read. */
  readonly connected: boolean
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** The attributes array of `DOM.describeNode` as a map (first value wins). */
function attributeMap(raw: unknown): Map<string, string> {
  const map = new Map<string, string>()
  if (!Array.isArray(raw)) return map
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const name = str(raw[i]).toLowerCase()
    if (!map.has(name)) map.set(name, str(raw[i + 1]))
  }
  return map
}

/**
 * The name and size the hover label shows, and the border-box quad the live
 * outline is drawn on (in the node's own target's viewport; null without a
 * box), from CDP alone; null when the node is gone.
 */
export async function describeForLabel(
  reader: PickReader,
  node: PickNode
): Promise<{ name: ElementNameInput; width: number; height: number; border: number[] | null } | null> {
  try {
    const [described, model] = await Promise.all([
      reader.call('DOM.describeNode', { backendNodeId: node.backendNodeId }, node.sessionKey),
      reader.call('DOM.getBoxModel', { backendNodeId: node.backendNodeId }, node.sessionKey).catch(() => null)
    ])
    const desc = isRecord(described) ? described.node : undefined
    const attrs = attributeMap(isRecord(desc) ? desc.attributes : undefined)
    const boxModel = isRecord(model) ? model.model : undefined
    return {
      name: { tagName: stringField(desc, 'localName') || stringField(desc, 'nodeName'), id: attrs.get('id') ?? null, classAttr: attrs.get('class') ?? null },
      width: numberField(boxModel, 'width'),
      height: numberField(boxModel, 'height'),
      border: quadFrom(isRecord(boxModel) ? boxModel.border : undefined)?.flatMap(corner => [corner.x, corner.y]) ?? null
    }
  } catch {
    return null
  }
}

/** The element's border box in the top-level viewport (CSS px), or null when it has no box or its frame went. */
export async function boxInView(reader: PickReader, frames: PickFrames, node: PickNode): Promise<Box | null> {
  try {
    const [model, toView] = await Promise.all([
      reader.call('DOM.getBoxModel', { backendNodeId: node.backendNodeId }, node.sessionKey),
      frames.toView(node.sessionKey)
    ])
    const boxModel = isRecord(model) ? model.model : undefined
    const quad = quadFrom(isRecord(boxModel) ? boxModel.border : undefined)
    return quad === null ? null : mapBox(toView, quadBounds(quad))
  } catch {
    return null
  }
}

interface RawChain {
  chain: Array<{ name: ElementNameInput; attrs: Array<[string, string]>; shadow: 'open' | 'closed' | null; box: Box }>
  selectors: string[]
  closed: boolean
  connected: boolean
}

/** The value of {@link PICK_CHAIN}, checked: whatever the page made of its prototypes, only this shape passes. */
export function parseChain(raw: unknown): RawChain | null {
  if (!isRecord(raw) || !Array.isArray(raw.chain) || !Array.isArray(raw.selectors)) return null
  const chain: RawChain['chain'] = []
  for (const item of raw.chain) {
    if (!isRecord(item)) return null
    const attrs = Array.isArray(item.attrs)
      ? item.attrs.filter((a): a is [string, string] => Array.isArray(a) && a.length === 2 && typeof a[0] === 'string' && typeof a[1] === 'string')
      : []
    chain.push({
      name: { tagName: str(item.tag), id: str(item.id) || null, classAttr: str(item.cls) || null },
      attrs,
      shadow: item.shadow === 'open' || item.shadow === 'closed' ? item.shadow : null,
      box: { x: num(item.x), y: num(item.y), width: num(item.w), height: num(item.h) }
    })
  }
  return {
    chain,
    selectors: raw.selectors.filter((s): s is string => typeof s === 'string'),
    closed: raw.closed === true,
    connected: raw.connected === true
  }
}

/** Read {@link PICK_CHAIN} on `node` and give each entry its base node and step. */
async function chainOf(reader: PickReader, node: PickNode): Promise<{ raw: RawChain; base: PickNode }> {
  const raw = parseChain(await reader.valueOn(node, PICK_CHAIN))
  if (raw === null || raw.chain.length === 0) throw new Error('pick chain read failed')
  return { raw, base: node }
}

/** A handle to the element `k` steps above `base`. */
async function ancestorNode(reader: PickReader, base: PickNode, k: number): Promise<PickNode | null> {
  if (k === 0) return base
  try {
    const objectId = await reader.callObject(base.sessionKey, await reader.resolve(base, 'isolated'), PICK_ANCESTOR, [k])
    if (objectId === null) return null
    const described = await reader.call('DOM.describeNode', { objectId }, base.sessionKey)
    const backendNodeId = isRecord(described) && isRecord(described.node) ? described.node.backendNodeId : undefined
    return typeof backendNodeId === 'number' ? { ...base, backendNodeId } : null
  } catch {
    return null
  }
}

/**
 * The chain of 025-FR-027 for `node`, its selector chain and its frame chain,
 * with every entry's handle and top-level box resolved.
 *
 * @throws when the element's own chain cannot be read (the element or its frame went)
 */
export async function readChain(reader: PickReader, frames: PickFrames, node: PickNode): Promise<ElementChain> {
  const own = await chainOf(reader, node)
  const parts: Array<{ raw: RawChain; base: PickNode }> = [own]
  const all = await frames.allFrames()
  const frameChain = chainFrames(all, node.frameId)
  for (let i = frameChain.length - 1; i > 0; i--) {
    const owner = await frames.ownerOf(frameChain[i], all).catch(() => null)
    if (owner === null) break
    try {
      parts.unshift(await chainOf(reader, owner))
    } catch {
      break
    }
  }
  const entries: ChainEntry[] = []
  const pending: Array<Promise<void>> = []
  for (const { raw, base } of parts) {
    for (let k = raw.chain.length - 1; k >= 0; k--) {
      const item = raw.chain[k]
      const entry: ChainEntry = { name: item.name, attrs: item.attrs, shadow: item.shadow, boxInFrame: item.box, boxInView: null, node: null }
      entries.push(entry)
      pending.push(
        ancestorNode(reader, base, k).then(async (resolved) => {
          entry.node = resolved
          entry.boxInView = resolved === null ? null : await boxInView(reader, frames, resolved)
        })
      )
    }
  }
  await Promise.all(pending)
  return {
    entries,
    selectors: parts.flatMap((p) => p.raw.selectors),
    closedShadow: own.raw.closed,
    frameOrigins: frameChain.map((f) => f.origin),
    connected: own.raw.connected
  }
}
