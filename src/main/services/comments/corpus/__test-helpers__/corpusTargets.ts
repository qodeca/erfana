// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Which targets of a corpus file get comments (spec 024 024-NFR-003): up to
 * five – the first, the last, and up to three more chosen with a seeded
 * random source so that the file's other block kinds are covered.
 */
import type { IndexedElement } from '../../../../../shared/htmlComments'
import type { MdTarget } from '../../../../../shared/markdownComments/mdIndex'

/** Targets per file, at most (024-NFR-003). */
export const TARGETS_PER_FILE = 5

/** A small seeded source of numbers in [0, 1) (mulberry32). */
export function seededUnit(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A 32-bit seed from the run's seed and a file's hash, so each file has its own. */
export function fileSeed(runSeed: number, sha256: string): number {
  return (runSeed ^ Number.parseInt(sha256.slice(0, 8), 16)) >>> 0
}

/**
 * Up to {@link TARGETS_PER_FILE} of `targets`: the first, the last, then one
 * of each kind not yet chosen, in a seeded order, each a seeded pick among
 * its kind. In source order.
 */
export function chooseTargets<T>(targets: readonly T[], kindOf: (t: T) => string, random: () => number): T[] {
  if (targets.length <= 2) return [...targets]
  const chosen = new Set<T>([targets[0], targets[targets.length - 1]])
  const byKind = new Map<string, T[]>()
  for (const target of targets) {
    const kind = kindOf(target)
    if (!byKind.has(kind)) byKind.set(kind, [])
    byKind.get(kind)!.push(target)
  }
  const covered = new Set([...chosen].map(kindOf))
  const kinds = [...byKind.keys()].filter(kind => !covered.has(kind))
  // A seeded shuffle of the kinds not yet covered.
  for (let i = kinds.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[kinds[i], kinds[j]] = [kinds[j], kinds[i]]
  }
  for (const kind of kinds) {
    if (chosen.size >= TARGETS_PER_FILE) break
    const pool = byKind.get(kind)!
    chosen.add(pool[Math.floor(random() * pool.length)])
  }
  // A file with fewer kinds than slots: fill with seeded picks of any kind.
  for (let tries = 0; chosen.size < Math.min(TARGETS_PER_FILE, targets.length) && tries < 50; tries += 1) {
    chosen.add(targets[Math.floor(random() * targets.length)])
  }
  return targets.filter(target => chosen.has(target))
}

/** A Markdown target's kind, in the `@data` table's words. */
export const markdownTargetKind = (target: MdTarget): string => target.kind

const HTML_GROUPS: ReadonlyArray<readonly [string, RegExp]> = [
  ['heading', /^h[1-6]$/],
  ['paragraph', /^p$/],
  ['list item', /^(?:li|dt|dd)$/],
  ['list', /^(?:ul|ol|dl|menu)$/],
  ['table', /^(?:table|thead|tbody|tfoot|caption|colgroup|col)$/],
  ['row or cell', /^(?:tr|td|th)$/],
  ['code', /^(?:pre|code|kbd|samp)$/],
  ['image or media', /^(?:img|picture|figure|figcaption|svg|video|audio|canvas|iframe)$/],
  ['inline text', /^(?:a|span|em|strong|b|i|u|small|sub|sup|abbr|cite|q|mark|br|wbr|time)$/],
  ['form', /^(?:form|input|button|select|option|textarea|label|fieldset|legend)$/],
  ['script or style', /^(?:script|style|noscript|link|meta)$/],
  ['section', /^(?:body|div|section|article|main|nav|header|footer|aside|blockquote|hr|details|summary|address)$/]
]

/** An HTML element's kind: its tag's group. */
export function htmlTargetKind(element: IndexedElement): string {
  const tag = element.tag.toLowerCase()
  return HTML_GROUPS.find(([, rule]) => rule.test(tag))?.[0] ?? 'other'
}
