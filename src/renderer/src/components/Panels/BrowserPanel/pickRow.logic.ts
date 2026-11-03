// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The pick row's words (spec 025, 025-FR-025 to 025-FR-027, 025-FR-061,
 * 025-FR-065; design deck *Pick banner, label and notes*, *Target chooser*,
 * *Guard, pre-warn and failure messages*; commit 19). Pure: what the status
 * slot says for where keyboard focus is, which note replaces the banner's
 * later clauses and for how long, and how the target terminal reads.
 *
 * The banner's clauses are returned separately: the first never drops, the
 * later ones fold away as the row narrows (CSS container queries in
 * `PickRow.css`, the drop order of 025-FR-065).
 */
import type { TargetStatusResponse } from '../../../../../shared/ipc/browser-tab-schema'
import type { StatusNote } from '../../../stores/useBrowserPickStore'

/**
 * The pick row's chip for site requests held while the menu or dialog is
 * open (025-FR-054, S-28): "1 site request waiting", "2 site requests
 * waiting"; null when none waits.
 */
export function heldRequestsText(count: number): string | null {
  if (!Number.isFinite(count) || count < 1) return null
  return count === 1 ? '1 site request waiting' : `${count} site requests waiting`
}

/** Where keyboard focus is, as the banner names it (025-FR-065's table). */
export type PickPlace = 'page' | 'toolbar' | 'panel' | 'dialog' | 'out' | 'outPanelClosed' | 'outDialog'

export type { StatusNote }

/** What decides where the banner says keyboard focus is. */
export interface PickPlaceInput {
  readonly surface: 'none' | 'panel' | 'dialog'
  readonly pageFocused: boolean
  /** Focus is in the tab's own controls (toolbar, panel, dialog). */
  readonly toolbarFocused: boolean
  /** Focus left the tab while the panel was open, which closed it (025-FR-065). */
  readonly panelClosedOnLeave: boolean
}

/**
 * Where keyboard focus is, as the banner names it (025-FR-065's table).
 *
 * @param input - {@link PickPlaceInput}
 * @returns The place
 */
export function pickPlace(input: PickPlaceInput): PickPlace {
  const { surface, pageFocused, toolbarFocused, panelClosedOnLeave } = input
  if (surface === 'dialog') return toolbarFocused ? 'dialog' : 'outDialog'
  if (surface === 'panel') return 'panel'
  if (pageFocused) return 'page'
  if (toolbarFocused) return 'toolbar'
  return panelClosedOnLeave ? 'outPanelClosed' : 'out'
}

/** The banner: a first clause that never drops, then clauses that fold as room runs out. */
export interface PickBanner {
  readonly first: string
  readonly rest: readonly string[]
}

/**
 * The banner for pick mode with focus at `place`.
 *
 * @param place - Where keyboard focus is
 * @param shortcut - The pick key as shown on this platform (`⌘E`, `Ctrl+E`)
 * @param label - The hovered element's label, which replaces the later clauses (Q1)
 * @returns The clauses
 *
 * @example
 * ```ts
 * pickBanner('page', '⌘E', null) // { first: 'Picking – click an element', rest: ['Esc to stop', '⌘E picks under the mouse'] }
 * ```
 */
export function pickBanner(place: PickPlace, shortcut: string, label: string | null): PickBanner {
  switch (place) {
    case 'page':
      if (label !== null) return { first: 'Picking – click an element', rest: [label] }
      return { first: 'Picking – click an element', rest: ['Esc to stop', `${shortcut} picks under the mouse`] }
    case 'toolbar':
      return { first: 'Picking – Esc returns to the page', rest: [] }
    case 'panel':
      return { first: 'Picking – Esc or click outside closes the panel', rest: [] }
    case 'dialog':
      return { first: 'Picking – Esc or Cancel closes the dialog', rest: [] }
    case 'out':
      return { first: 'Picking – click the page to continue', rest: [] }
    case 'outPanelClosed':
      return { first: 'Picking – the panel closed when you left; pick again', rest: [] }
    case 'outDialog':
      return { first: 'Picking – click to return to the dialog', rest: [] }
  }
}

/** Each note's words (deck rows *Note – …*). */
export const NOTE_TEXT: Readonly<Record<StatusNote, string>> = Object.freeze({
  loadAPage: 'Load a page to pick an element',
  moveTheMouse: 'Move the mouse over the page to pick an element',
  pageMoved: 'The page moved – click again',
  topOfPage: 'Top of the page',
  backAtStart: 'Back at the element you started from',
  elementGone: 'That element is gone – pick again',
  pageChanged: 'The page changed – pick the element again.'
})

/** How long each note shows, in ms (025-FR-025 and 025-FR-026: 4 s; refinement and guard notes: 2 s). */
export function noteDuration(note: StatusNote): number {
  return note === 'loadAPage' || note === 'moveTheMouse' || note === 'pageChanged' ? 4000 : 2000
}

/** The target terminal as the pick row, the panel and the dialog show it. */
export interface TargetView {
  /** `→ {name} · {process}`, or "No terminal open". */
  readonly text: string
  /** The accessible name: the visible words first (AX-13), then the state. */
  readonly name: string
  /** A shell or no terminal: the warning icon shows. */
  readonly warn: boolean
}

/** The foreground status of a terminal, or `null` while it is not read yet. */
export type TargetStatus = Pick<TargetStatusResponse, 'kind' | 'process'> | null

/**
 * The target's words (deck *Target chooser*).
 *
 * @param terminal - The terminal's name, or `null` when none is open
 * @param status - Its foreground, or `null` while unknown
 * @returns {@link TargetView}
 */
export function targetView(terminal: string | null, status: TargetStatus): TargetView {
  if (terminal === null) return { text: 'No terminal open', name: 'No terminal open, target terminal', warn: true }
  const process = status?.process ?? null
  if (status === null || status.kind === 'unknown' || process === null) {
    return { text: `→ ${terminal} · …`, name: `${terminal}, target terminal, process not known yet`, warn: false }
  }
  if (status.kind === 'shell') {
    return { text: `→ ${terminal} · ${process}`, name: `${terminal} · ${process}, target terminal, no agent running`, warn: true }
  }
  return { text: `→ ${terminal} · ${process}`, name: `${terminal} · ${process}, target terminal`, warn: false }
}

/** A message in the panel's or dialog's banner slot (025-FR-061, S-23). */
export type TargetBanner =
  | { readonly kind: 'preWarnShell' | 'guardShell'; readonly text: string; readonly action: 'chooseTerminal' }
  | { readonly kind: 'preWarnNoTerminal' | 'guardNoTerminal'; readonly text: string; readonly action: 'openTerminal' }
  | { readonly kind: 'sendAnyway'; readonly text: string; readonly action: 'sendAnyway' }
  | { readonly kind: 'targetChosen'; readonly text: string; readonly action: null }

const KEEP_PICK =
  'leaving this panel closes the pick. Ask…, Change… and Prompt… keep your pick while you\'re away.'

/**
 * The warning shown as the panel opens on a target that is not an agent (M-28).
 *
 * @param terminal - The target's name, or `null` with no terminal
 * @param status - Its foreground
 * @returns The pre-warning, or `null` for an agent or a status not read yet
 */
export function preWarning(terminal: string | null, status: TargetStatus): TargetBanner | null {
  if (terminal === null) {
    return { kind: 'preWarnNoTerminal', text: `No terminal open. Open one, start your agent there and pick again – ${KEEP_PICK}`, action: 'openTerminal' }
  }
  if (status?.kind !== 'shell') return null
  return {
    kind: 'preWarnShell',
    text: `${terminal} is running ${status.process ?? 'a shell'}, not an agent. Choose another terminal, or start your agent there and pick again – ${KEEP_PICK}`,
    action: 'chooseTerminal'
  }
}

/**
 * The banner of a send the shell guard refused (025-FR-061, S-23).
 *
 * @param kind - What main's guard found
 * @param terminal - The target's name
 * @param process - The foreground main read, when it has one
 * @returns The banner, with the button that answers it
 */
export function guardBanner(kind: 'shell' | 'wrapper' | 'unknown' | 'noTerminal', terminal: string | null, process: string | null): TargetBanner {
  if (kind === 'noTerminal' || terminal === null) {
    return {
      kind: 'guardNoTerminal',
      text: 'No agent is running in a terminal – no terminal is open. Open one, start your agent there, then send again.',
      action: 'openTerminal'
    }
  }
  if (kind === 'shell') {
    return { kind: 'guardShell', text: `No agent is running in ${terminal} – start your agent there, then send again.`, action: 'chooseTerminal' }
  }
  const what = kind === 'wrapper' && process !== null ? `${terminal} is running ${process}` : `Erfana can't tell what ${terminal} is running`
  return { kind: 'sendAnyway', text: `${what} – it may not be your agent. Send anyway?`, action: 'sendAnyway' }
}

/** The note that replaces a guard once another terminal is chosen (M-29). */
export function targetChosen(view: TargetView): TargetBanner {
  return { kind: 'targetChosen', text: `Sends to ${view.text} – send again when ready.`, action: null }
}
