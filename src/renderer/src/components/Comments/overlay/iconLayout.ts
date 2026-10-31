// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Which comment icons the renderer's overlay draws, where, and what each one
 * shows and is named (state table § 4 "One icon per target", S-01, S-03,
 * S-05, S-07, S-08; comments-v2 C-05, C-06, C-17, R-16).
 *
 * - **One icon per target**, counting its open, found threads. The most
 *   urgent look wins: the warning icon ("!") when a damaged block sits in the
 *   target's slot, else the notched icon when a thread changed, else the
 *   plain one – two text lines for one thread, the number for 2–9, "9+" from 10
 *   (the HTML pin's rules, `preload/previewPageComments/pins.ts`).
 * - **A damaged block** has no target Erfana can read, so its icon goes on the
 *   block's slot carrier: a Markdown block is always written right before its
 *   carrier (`markdown-format.md` § 4.1), which is the first target that starts
 *   after the block's line.
 * - **A not-found comment** (S-05) gets a ghost at its own place between two
 *   blocks, in the right margin – one per comment.
 * - **Placement** is the shared `overlayCore/pinLayout.layoutPins`, the HTML
 *   preload's: three icons per crowded row, the rest merged into one stack
 *   icon ("+3") that opens all of them in document order (C-17).
 *
 * Pure apart from reading the rendered DOM's boxes; nothing here writes to it.
 *
 * @module components/Comments/overlay/iconLayout
 */
import {
  layoutPins,
  PIN_BOX_PX,
  PIN_TIP,
  PIN_TIP_OFFSET_PX,
  type Box
} from '../../../../../shared/comments/overlayCore/pinLayout'
import type { ThreadPlacement } from '../../../../../shared/ipc/file-comment-schema'
import type { CommentFileView } from '../../../../../shared/ipc/comment-common-schema'
import { CHANGE_MARK_COPY, MD_SURFACE_COPY } from '../commentCopyWords'
import { targetNounOf, type PreviewCommentAdapter } from './previewAdapter'

/** What an icon shows: two text lines, a count, "9+", "!" (damaged) or "+3" (a stack); `null` for the ghost. */
export type PinContent = 'lines' | '!' | '9+' | `${number}` | `+${number}`

/** A stack shows at most this many more (the HTML pin's cap, C-17). */
const STACK_SHOWN_MAX = 99
/** A count above this shows "9+" (S-01). */
const COUNT_SHOWN_MAX = 9

/** One drawn icon. */
export interface IconSpot {
  readonly key: string
  /** Its box in the area's CSS pixels. */
  readonly box: Box
  /** The targets it stands for (their `aria-details` point at it, C-11); empty for a ghost. */
  readonly elements: readonly HTMLElement[]
  readonly threadKeys: readonly string[]
  /** Damaged blocks in its target's slot (S-07, S-08). */
  readonly blockKeys: readonly string[]
  readonly name: string
  /** `null`: the not-found ghost (C-05). */
  readonly content: PinContent | null
  /** At least one of its threads is Changed or Words changed, and nothing outranks it (C-06). */
  readonly changed: boolean
  readonly damaged: boolean
  /** The rest of a crowded row (C-17). */
  readonly stack: boolean
}

/** One icon before placement, in document order. */
interface IconInput {
  readonly box: Box
  readonly element: HTMLElement | null
  readonly threadKeys: readonly string[]
  readonly blockKeys: readonly string[]
  readonly changed: number
  /** A not-found comment's line (the ghost), else `undefined`. */
  readonly ghostLine?: number
}

/** The icon of `count` open threads: two lines for one, the number for 2–9, "9+" from 10 (S-01). */
export function pinContent(count: number, damaged: boolean): PinContent {
  if (damaged) return '!'
  if (count <= 1) return 'lines'
  return count > COUNT_SHOWN_MAX ? '9+' : (`${count}` as PinContent)
}

/** `el`'s border box, relative to `area`. */
export function relativeBox(el: HTMLElement, area: DOMRect): Box {
  const box = el.getBoundingClientRect()
  return { left: box.left - area.left, top: box.top - area.top, width: box.width, height: box.height }
}

/** The open, found threads and the damaged blocks, grouped by the target they sit on, in document order. */
function targetInputs(
  adapter: PreviewCommentAdapter,
  placements: readonly ThreadPlacement[],
  file: CommentFileView,
  targets: readonly HTMLElement[],
  area: DOMRect
): IconInput[] {
  const openThreads = file.threads.filter(t => t.status === 'open' && t.attached)
  const open = new Set(openThreads.map(t => t.threadKey))
  const changedKeys = new Set(openThreads.filter(t => t.change !== undefined).map(t => t.threadKey))
  const byElement = new Map<HTMLElement, { threadKeys: string[]; blockKeys: string[] }>()
  const entry = (element: HTMLElement): { threadKeys: string[]; blockKeys: string[] } => {
    const found = byElement.get(element) ?? { threadKeys: [], blockKeys: [] }
    byElement.set(element, found)
    return found
  }
  for (const placement of placements) {
    if (!open.has(placement.threadKey)) continue
    const element = adapter.attach(placement)
    if (element !== null) entry(element).threadKeys.push(placement.threadKey)
  }
  for (const block of file.damaged) {
    const carrier = targets.find(target => adapter.lineOf(target) > block.line)
    if (carrier !== undefined) entry(carrier).blockKeys.push(block.blockKey)
  }
  return [...byElement]
    .sort(([a], [b]) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
    .map(([element, keys]) => ({
      box: relativeBox(element, area),
      element,
      ...keys,
      changed: keys.threadKeys.filter(key => changedKeys.has(key)).length
    }))
}

/**
 * The element box a ghost for a comment on `line` is placed from: a one-pixel
 * line across the text column, so the shared rule puts the ghost in the right
 * margin, centred on the gap between the target before the line and the one
 * after it (comments-v2 marks.html "C-05 ghost"); `null` with nothing to place by.
 */
function slotBox(adapter: PreviewCommentAdapter, targets: readonly HTMLElement[], line: number, area: DOMRect): Box | null {
  const next = targets.find(target => adapter.lineOf(target) > line) ?? null
  const before = targets.filter(target => adapter.lineOf(target) < line)
  const prev = before.length > 0 ? before[before.length - 1] : null
  const column = adapter.root?.() ?? next ?? prev
  if (column === null) return null
  const across = relativeBox(column, area)
  const nextTop = next === null ? null : relativeBox(next, area).top
  const prevBox = prev === null ? null : relativeBox(prev, area)
  const prevBottom = prevBox === null ? null : prevBox.top + prevBox.height
  const gap = nextTop !== null && prevBottom !== null ? (nextTop + prevBottom) / 2 : (nextTop ?? prevBottom ?? across.top)
  // `layoutPins` puts the tail tip PIN_TIP_OFFSET_PX above the box's top: shift the box so the icon's middle is on the gap.
  const top = gap - PIN_BOX_PX / 2 + PIN_TIP_OFFSET_PX + PIN_TIP.y
  return { left: across.left, top, width: across.width, height: 1 }
}

/** The not-found comments' ghosts, merged into `inputs` before the first target past their line. */
function withGhosts(
  adapter: PreviewCommentAdapter,
  inputs: readonly IconInput[],
  file: CommentFileView,
  targets: readonly HTMLElement[],
  area: DOMRect
): IconInput[] {
  const ghosts = file.threads
    .filter(t => t.status === 'open' && !t.attached)
    .sort((a, b) => a.line - b.line)
    .flatMap((t): IconInput[] => {
      const box = slotBox(adapter, targets, t.line, area)
      return box === null ? [] : [{ box, element: null, threadKeys: [t.threadKey], blockKeys: [], changed: 0, ghostLine: t.line }]
    })
  const merged: IconInput[] = []
  let next = 0
  for (const input of inputs) {
    const line = input.element === null ? 0 : adapter.lineOf(input.element)
    while (next < ghosts.length && (ghosts[next].ghostLine ?? 0) < line) merged.push(ghosts[next++])
    merged.push(input)
  }
  return [...merged, ...ghosts.slice(next)]
}

/** One placed icon's look and name. */
function spotOf(adapter: PreviewCommentAdapter, input: IconInput, box: Box): IconSpot {
  const { element, threadKeys, blockKeys } = input
  const key = [...threadKeys, ...blockKeys].join(',')
  if (element === null) {
    const line = input.ghostLine ?? 1
    return { key, box, elements: [], threadKeys, blockKeys, name: MD_SURFACE_COPY.ghostName(line), content: null, changed: false, damaged: false, stack: false }
  }
  const noun = targetNounOf(adapter, element)
  const line = adapter.lineOf(element)
  const damaged = blockKeys.length > 0
  const changed = !damaged && input.changed > 0
  const name = damaged
    ? MD_SURFACE_COPY.damagedName(noun, line)
    : changed
      ? CHANGE_MARK_COPY.iconName(threadKeys.length, noun, line, input.changed)
      : MD_SURFACE_COPY.iconName(threadKeys.length, noun, line)
  return { key, box, elements: [element], threadKeys, blockKeys, name, content: pinContent(threadKeys.length, damaged), changed, damaged, stack: false }
}

/** The stack icon of a crowded row: every merged icon's comments, in document order (C-17, R-16). */
function stackOf(members: readonly IconInput[], box: Box): IconSpot {
  const threadKeys = members.flatMap(member => member.threadKeys)
  const blockKeys = members.flatMap(member => member.blockKeys)
  const count = threadKeys.length + blockKeys.length
  return {
    key: `stack:${[...threadKeys, ...blockKeys].join(',')}`,
    box,
    elements: members.flatMap(member => (member.element === null ? [] : [member.element])),
    threadKeys,
    blockKeys,
    name: MD_SURFACE_COPY.stackName(count),
    content: `+${Math.min(count, STACK_SHOWN_MAX)}`,
    changed: false,
    damaged: blockKeys.length > 0,
    stack: true
  }
}

/**
 * The icons to draw over the preview now.
 *
 * @param adapter - The preview's adapter.
 * @param placements - Where main placed the listed threads.
 * @param file - The listed file; `null` draws nothing.
 * @param area - The overlay's box (its parent pane).
 * @returns The icons, placed by the shared rule.
 */
export function iconSpots(
  adapter: PreviewCommentAdapter,
  placements: readonly ThreadPlacement[],
  file: CommentFileView | null,
  area: DOMRect
): IconSpot[] {
  if (file === null) return []
  const needsTargets = file.damaged.length > 0 || file.threads.some(t => t.status === 'open' && !t.attached)
  const targets = needsTargets ? adapter.targetsInOrder() : []
  const inputs = withGhosts(adapter, targetInputs(adapter, placements, file, targets, area), file, targets, area)
  const slots = layoutPins(
    inputs.map(input => input.box),
    { width: area.width, height: area.height },
    PIN_BOX_PX
  )
  return slots.map(({ box, members, stack }) =>
    stack ? stackOf(members.map(index => inputs[index]), box) : spotOf(adapter, inputs[members[0]], box)
  )
}
