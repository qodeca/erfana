// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Other tools' HTML comments, read the same in every file kind (spec 024
 * 024-FR-023; design `markdown-format.md` § 4.4; architecture note 001 § 8
 * C4).
 *
 * A GENERATED REGION is the text another tool rewrites between a START
 * comment and its END comment (doctoc's `<!-- START doctoc … -->` …
 * `<!-- END doctoc … -->`, `<!-- ALL-CONTRIBUTORS-LIST:START -->` …). A new
 * block is never written inside one, and a target inside one is refused:
 * the tool would drop the block on its next run.
 *
 * What counts as a START or END is read from the comment's first word only,
 * so the rule is the same in HTML and Markdown; which comments may pair (the
 * siblings of one container) is the kind's to say.
 */

/** A comment as the region rule reads it: its node's offsets and the text between `<!--` and `-->`. */
export interface ForeignComment {
  /** Offset of `<!--`. */
  readonly start: number
  /** Offset just after `-->`. */
  readonly end: number
  readonly data: string
}

/** A generated region: from its START comment's `<!--` to its END comment's `-->`. */
export interface GeneratedRegion {
  readonly start: number
  readonly end: number
}

const REGION_START = /^(?:(.*)[:-])?(?:START|BEGIN)$/
const REGION_END = /^(?:(.*)[:-])?END$/

function firstWord(data: string): string {
  return data.trim().split(/\s+/, 1)[0] ?? ''
}

/**
 * The leading name of a comment that opens a generated region – `START` or
 * `BEGIN` as its first word, or as the suffix of its first word after `:` or
 * `-` (`ALL-CONTRIBUTORS-LIST:START` → `ALL-CONTRIBUTORS-LIST`; `START` → '')
 * – or `undefined` when it opens none.
 */
export function regionStartName(data: string): string | undefined {
  const match = REGION_START.exec(firstWord(data))
  return match === null ? undefined : (match[1] ?? '')
}

/** The leading name of a comment that closes a region (`END`, `…:END`, `…-END`), or `undefined`. */
export function regionEndName(data: string): string | undefined {
  const match = REGION_END.exec(firstWord(data))
  return match === null ? undefined : (match[1] ?? '')
}

/** How a comment's region names are read; {@link REGION_NAMES} unless a kind wraps them. */
export interface RegionNameReaders {
  readonly startName: (data: string) => string | undefined
  readonly endName: (data: string) => string | undefined
}

/** The region names as this module reads them. */
export const REGION_NAMES: RegionNameReaders = { startName: regionStartName, endName: regionEndName }

/**
 * The generated regions among `comments`, siblings of one container in
 * document order: each START pairs with the first END of its name after it,
 * and a START with no END opens nothing. One pass – the STARTs still waiting
 * are kept by name – so a file of many STARTs costs linear time (security
 * audit of 8a4e442e, L1: a search per START was quadratic).
 *
 * @param comments - One container's comments, in document order.
 * @param names - How names are read; the Markdown index passes its own, which its cost test counts.
 * @returns The regions, in the order of their START comments.
 */
export function pairGeneratedRegions(
  comments: readonly ForeignComment[],
  names: RegionNameReaders = REGION_NAMES
): GeneratedRegion[] {
  const waiting = new Map<string, number[]>()
  const ends: Array<number | undefined> = []
  comments.forEach((comment, i) => {
    const endName = names.endName(comment.data)
    if (endName !== undefined) {
      for (const start of waiting.get(endName) ?? []) ends[start] = comment.end
      waiting.delete(endName)
    }
    const name = names.startName(comment.data)
    if (name === undefined) return
    const starts = waiting.get(name)
    if (starts === undefined) waiting.set(name, [i])
    else starts.push(i)
  })
  const regions: GeneratedRegion[] = []
  comments.forEach((comment, i) => {
    const end = ends[i]
    if (end !== undefined) regions.push({ start: comment.start, end })
  })
  return regions
}

/** True when `offset` lies strictly inside one of `regions` (024-FR-023). */
export function inAnyRegion(regions: readonly GeneratedRegion[], offset: number): boolean {
  return regions.some(region => region.start < offset && offset < region.end)
}
