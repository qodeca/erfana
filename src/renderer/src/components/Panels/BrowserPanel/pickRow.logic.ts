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
    text: `${terminal} is running ${status.process ?? 'a shell'}, not an agent. Start your agent there, then pick again – ${KEEP_PICK}`,
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

/** What the tab's hidden polite region speaks about (design § Announcements, M-45). Hover labels are not in it. */
export interface PickAnnounceFacts {
  readonly on: boolean
  readonly frozen: boolean
  readonly captureId: string | null
  /** The held capture's last refinement stamp (`HeldCapture.changedAt`). */
  readonly changedAt: number | null
  /** The held element's name and `{w} × {h}` size, for *Announce – refined*. */
  readonly name: string | null
  readonly size: string | null
  readonly note: StatusNote | null
  readonly noteSeq: number
  /** The send notice's sentence ("Sent Explain to Terminal"), while it shows. */
  readonly sent: string | null
  /**
   * The send notice's identity, while it shows: a second send with the same
   * sentence replaces the notice with a new one, and is said again.
   */
  readonly sentKey?: object | null
  /** A send is in flight: pick mode ending now is the send's doing, said by its own sentence. */
  readonly sending?: boolean
  /** The sentence for a send that has started ("Sending Explain to Terminal…"), while it is in flight. */
  readonly sendingText?: string | null
}

/** The refinement end notes the region repeats as a sentence, for the held capture (§ Announcements, *Refinement*). */
const SPOKEN_NOTES: ReadonlySet<StatusNote> = new Set<StatusNote>(['topOfPage', 'backAtStart'])

/**
 * The notes said whenever they show, capture held or not (§ Announcements,
 * *Page changed*; ux review round 2): the page change drops the capture as it
 * shows, and the other two answer a key press that otherwise seems to do nothing.
 */
const NOTES_ALWAYS_SPOKEN: ReadonlySet<StatusNote> = new Set<StatusNote>(['pageChanged', 'elementGone', 'loadAPage'])

/** A note's words as a sentence: with its full stop (OD-9), never two. */
function noteSentence(note: StatusNote): string {
  const text = NOTE_TEXT[note]
  return text.endsWith('.') ? text : `${text}.`
}

/**
 * A size as a screen reader says it: "101 × 18" → "101 by 18".
 *
 * @param size - Main's `{w} × {h}`
 * @returns The spoken size
 */
export function spokenSize(size: string): string {
  return size.replace(/\s*×\s*/, ' by ')
}

/**
 * What the tab's polite region says as the pick state moves from `prev` to
 * `next`, or `null` for nothing (design § Announcements: *Pick mode on*,
 * *off*, *Announce – refined* and its end notes, *Page paused* once,
 * *Announce – sent*, *Page changed*, and the element-gone and load-a-page
 * notes). The send outranks the pick mode ending with it.
 *
 * @param prev - The facts last spoken about
 * @param next - The facts now
 * @returns The sentence, with its full stop (OD-9), or `null`
 *
 * @example
 * ```ts
 * pickAnnouncement({ ...idle }, { ...idle, on: true }) // 'Picking. Esc to stop.'
 * ```
 */
export function pickAnnouncement(prev: PickAnnounceFacts, next: PickAnnounceFacts): string | null {
  if (next.sent !== null && (next.sent !== prev.sent || (next.sentKey ?? null) !== (prev.sentKey ?? null))) {
    return `${next.sent}. Show terminal and Open last capture are also in the target menu.`
  }
  // The wait for Enter can take seconds while the agent works (#449): say that the send started (round-3 UX review).
  if (next.sendingText != null && next.sendingText !== (prev.sendingText ?? null)) return next.sendingText
  const sameCapture = next.captureId !== null && next.captureId === prev.captureId
  const newNote = next.note !== null && next.noteSeq !== prev.noteSeq ? next.note : null
  if (newNote !== null && (NOTES_ALWAYS_SPOKEN.has(newNote) || (sameCapture && SPOKEN_NOTES.has(newNote)))) {
    return noteSentence(newNote)
  }
  if (sameCapture && next.changedAt !== null && next.changedAt !== prev.changedAt && next.name !== null && next.size !== null) {
    return `Picked ${next.name}, ${spokenSize(next.size)}.`
  }
  if (sameCapture && next.frozen && !prev.frozen) return 'Page paused.'
  if (next.on && !prev.on) return 'Picking. Esc to stop.'
  // A send ends pick mode too; its own sentence is said instead.
  if (!next.on && prev.on && next.sent === null && next.sending !== true) return 'Picking stopped.'
  return null
}
