// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Refinement and the held capture while the pick menu or dialog is open
 * (spec 025, 025-FR-027, 025-FR-030; solution design § 6.1). Kept out of
 * `BrowserTabPick.ts`.
 *
 * - {@link liveStep}: one Up or Down before a confirm, on the hovered
 *   element's chain of the live page.
 *
 * - {@link refineHeld}: Up and Down in the menu move along the chain the
 *   capture snapshotted. A live page is first checked for the picked element
 *   still being in its document (a frozen page cannot change, and a page
 *   function on it would hang, ADR 0008). After the move the element's facts
 *   and hints are read and the summary is sent again with the element's text
 *   and source – marked "changed after the pick" when the live box is more
 *   than 1 px from the snapshot's.
 * - {@link closeEvent}: which routing event a `closePick` reason is.
 */
import type { PickSurface, RoutingEvent } from '../../../../shared/browser/routingState'
import type { PickEvent } from '../../../../shared/ipc/browser-tab-schema'
import type { ClosePickReason } from '../../../../shared/ipc/browser-tab-pick-schema'
import type { BrowserCapture, RefineMove } from '../capture/BrowserCapture'
import type { PickNode, PickReader } from './pickCdp'
import { readChain, type ElementChain } from './pickElement'
import type { PickFrames } from './pickFrames'
import { boxChanged } from './pickGeometry'

type RefinedEvent = Extract<PickEvent, { kind: 'refined' }>
type NoteEvent = Extract<PickEvent, { kind: 'note' }>

/**
 * One Up (`parent`) or Down (`child`) step before a confirm (025-FR-027),
 * from `index` on the hovered element's `chain` (`null`: at the hovered
 * element; a `null` chain could not be read). Answers the element to outline
 * and the new index (`null` again back at the hovered element), or the note
 * the step shows instead.
 */
export function liveStep(
  chain: ElementChain | null,
  index: number | null,
  move: 'parent' | 'child'
): { readonly node: PickNode; readonly index: number | null } | { readonly note: 'elementGone' | 'topOfPage' | 'backAtStart' } {
  if (chain === null) return { note: 'elementGone' }
  const last = chain.entries.length - 1
  const at = index ?? last
  const next = move === 'parent' ? at - 1 : at + 1
  if (next < 0) return { note: 'topOfPage' }
  if (next > last) return { note: 'backAtStart' }
  const node = chain.entries[next].node
  if (node === null) return { note: 'elementGone' }
  return { node, index: next === last ? null : next }
}

export interface RefineHeldDeps {
  readonly reader: PickReader
  readonly frames: PickFrames
  /** Whether `capture` is still the one held (a close or a new pick replaces it). */
  readonly isHeld: (capture: BrowserCapture) => boolean
  readonly refined: (event: Omit<RefinedEvent, 'tabId' | 'kind'>) => void
  readonly note: (note: NoteEvent['note']) => void
}

/** Move the held capture one step (or to an ancestor) and tell the menu. Never rejects. */
export async function refineHeld(capture: BrowserCapture, move: RefineMove, deps: RefineHeldDeps): Promise<void> {
  if (!capture.frozen && !capture.gone && !(await stillConnected(capture, deps))) capture.markGone()
  if (!deps.isHeld(capture)) return
  const moved = capture.move(move)
  if ('refused' in moved) {
    deps.note(moved.refused)
    if (moved.refused === 'elementGone') deps.refined({ captureId: capture.id, summary: capture.summary() })
    return
  }
  deps.refined({ captureId: capture.id, summary: capture.summary() })
  try {
    const [facts] = await Promise.all([capture.facts(), capture.hints()])
    if (!capture.isLatest(moved.generation) || !deps.isHeld(capture)) return
    const snapshot = capture.entry.boxInView
    const live = facts.boxInView
    // Again with the element's text and source, and "changed after the pick" when its box moved.
    deps.refined({ captureId: capture.id, summary: capture.summary(snapshot !== null && live !== null && boxChanged(snapshot, live)) })
  } catch {
    // The send reads them again; a failed refinement read only loses the change note.
  }
}

async function stillConnected(capture: BrowserCapture, deps: Pick<RefineHeldDeps, 'reader' | 'frames'>): Promise<boolean> {
  const node = capture.chain.entries[capture.firstIndex].node
  if (node === null) return false
  try {
    return (await readChain(deps.reader, deps.frames, node)).connected
  } catch {
    return false
  }
}

/** The routing event of a `closePick` reason while `surface` is open. */
export function closeEvent(reason: ClosePickReason, surface: PickSurface): RoutingEvent {
  switch (reason) {
    case 'sent':
      return { type: 'sent' }
    case 'tabHidden':
      return { type: 'endSilently' }
    case 'focusLeft':
      return { type: 'focusOut' }
    default:
      if (surface === 'dialog') return { type: 'dialogClose' }
      return { type: 'menuClose', reason: reason === 'toolbar' ? 'toolbarClick' : 'esc' }
  }
}
