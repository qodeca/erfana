// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pure decisions behind the strip rows above a browser tab's page (spec 025,
 * 025-FR-011, 025-FR-018 to 025-FR-022, 025-FR-054, 025-FR-056, 025-FR-058;
 * design README § Site prompts and the copy deck; Site prompts card,
 * proposed). No React, no IPC.
 *
 * Main composes each row's sentence from fixed strings and formatted origins
 * (`row.text`); the renderer adds only what the deck draws around it: the
 * pop-up row's clause, the origin line, the button words, the queue count and
 * the description of what happens to an answer.
 */
import { hostText, originText } from '../../../../../shared/browser/originFormat'
import type { OriginPartsPayload, StripAnswer, StripRow } from '../../../../../shared/ipc/browser-tab-schema'

/** The strip's input guard (OD-6): presses within this long of a row appearing or changing are ignored. */
export const STRIP_INPUT_GUARD_MS = 500

/** The fixed order of kinds, top to bottom (design § Anatomy zone 5). */
export const STRIP_KIND_ORDER: readonly StripRow['kind'][] = [
  'pageDialog',
  'leavePage',
  'signIn',
  'permission',
  'download',
  'popupBlocked',
  'hung',
  'keyring',
  'fullscreen',
  'pointerLock'
]

/**
 * Rows in the strip's fixed order of kinds; rows of one kind keep their arrival order.
 *
 * @param rows - The tab's rows in arrival order
 * @returns A new, sorted array
 */
export function sortStripRows<T extends { readonly row: StripRow }>(rows: readonly T[]): T[] {
  return rows
    .map((shown, index) => ({ shown, index }))
    .sort((a, b) => STRIP_KIND_ORDER.indexOf(a.shown.row.kind) - STRIP_KIND_ORDER.indexOf(b.shown.row.kind) || a.index - b.index)
    .map(entry => entry.shown)
}

/** Whether a row's answers are still inside the input guard at `now`. */
export function isGuarded(since: number, now: number): boolean {
  return now - since < STRIP_INPUT_GUARD_MS
}

/**
 * The visible word of an answer button (deck rows *Buttons*). `dismiss` on a
 * prompt is the row's close icon, named "Dismiss"; on a notice it is the word.
 *
 * @param row - The row the button belongs to
 * @param answer - One of `row.answers`
 * @returns The label
 */
export function answerLabel(row: Pick<StripRow, 'kind' | 'answers'>, answer: StripAnswer): string {
  if (row.kind === 'pageDialog') {
    // Never "OK" or "Cancel" – both collide with page text (deck, R2-M8).
    if (answer === 'ok') return row.answers.includes('cancel') ? 'Confirm' : 'Close'
    if (answer === 'cancel') return 'Decline'
  }
  return ANSWER_WORDS[answer]
}

const ANSWER_WORDS: Readonly<Record<StripAnswer, string>> = {
  allow: 'Allow',
  allowOnce: 'Allow once',
  alwaysAllow: 'Always allow for this site',
  block: 'Block',
  dismiss: 'Dismiss',
  signIn: 'Sign in',
  cancel: 'Cancel',
  ok: 'OK',
  leave: 'Leave',
  stay: 'Stay',
  wait: 'Wait',
  reload: 'Reload'
}

/** Answers that grant something: focus restored to a row never lands on one (H-10). */
const GRANTING: ReadonlySet<StripAnswer> = new Set(['allow', 'allowOnce', 'alwaysAllow', 'signIn', 'ok', 'leave'])

/** Whether `answer` grants (Allow, Allow once, Always allow, Sign in, Confirm, Leave). */
export function isGranting(answer: StripAnswer): boolean {
  return GRANTING.has(answer)
}

/** Whether a kind is a prompt whose `dismiss` is drawn as the row's close icon. */
export function dismissIsIcon(kind: StripRow['kind']): boolean {
  return kind === 'permission' || kind === 'popupBlocked'
}

/** The tooltip and description of a row's close icon (deck). */
export function dismissDescription(kind: StripRow['kind']): string {
  return kind === 'popupBlocked'
    ? 'Dismiss – the chip in the address bar brings this back while the row is kept'
    : 'Blocks this request until the page reloads'
}

/** Esc on a row: the answer it means, when the row offers one (it cancels or dismisses, 025-FR-051). */
export function escapeAnswer(row: Pick<StripRow, 'answers'>): StripAnswer | null {
  for (const answer of ['stay', 'cancel', 'dismiss'] as const) if (row.answers.includes(answer)) return answer
  return null
}

/** `alertdialog` for a page dialog and the leave-page prompt, `group` for the rest (design § Roles). */
export function stripRowRole(kind: StripRow['kind']): 'alertdialog' | 'group' {
  return kind === 'pageDialog' || kind === 'leavePage' ? 'alertdialog' : 'group'
}

/** An origin through the formatter, as plain text (Security rule 2). */
export function originLine(origin: OriginPartsPayload): string {
  if (origin.kind === 'web') return originText(origin)
  if (origin.kind === 'file') return 'Local file'
  return `${origin.scheme}:`
}

/**
 * The row's sentence. The pop-up row gets its clause (deck *Pop-up – row
 * text*); every other row is main's text as sent.
 *
 * @param row - The row
 * @returns The sentence
 *
 * @example
 * ```ts
 * rowSentence({ kind: 'popupBlocked', text: 'Pop-up blocked', requester: { origin, inside: null }, … })
 * // 'Pop-up blocked – harbour-garden.org tried to open a new tab or window.'
 * ```
 */
export function rowSentence(row: Pick<StripRow, 'kind' | 'text' | 'requester'>): string {
  if (row.kind === 'popupBlocked') {
    const origin = row.requester?.origin
    const who = origin?.kind === 'web' ? hostText(origin) : 'This page'
    return `${row.text} – ${who} tried to open a new tab or window.`
  }
  return row.text
}

/** Kinds whose sentence names no origin, so the origin line is drawn above it (CF-7). */
export function showsOriginLine(row: Pick<StripRow, 'kind' | 'requester'>): boolean {
  return row.requester !== undefined && (row.kind === 'download' || row.kind === 'leavePage')
}

/** The hung row's explanation (deck *Hung – explanation*). */
export const HUNG_EXPLANATION = 'Wait for it, or press Reload – reloading loses anything not saved on the page.'

/**
 * What happens to a permission answer (deck *Permission – remembered*), or `null`.
 *
 * @param row - A `permission` row
 * @returns The row's second line
 */
export function rememberedText(row: Pick<StripRow, 'kind' | 'answers' | 'remembered'>): string | null {
  if (row.kind !== 'permission' || row.remembered === undefined || row.remembered === 'never') return null
  if (row.remembered === 'session') return 'Without a keyring, Erfana remembers your answer for this site until it closes.'
  return row.answers.includes('allowOnce')
    ? 'Allow once is for this page load only. Allow and Block are remembered for this site in this project.'
    : 'Erfana remembers your answer for this site in this project.'
}

/**
 * The queue count (deck *Queue count*): "+{n} waiting" and its name.
 *
 * @param kind - The row's kind
 * @param waiting - Requests of that kind queued behind it
 * @returns The visible text and accessible name, or `null` when none wait
 */
export function queueCount(kind: StripRow['kind'], waiting: number | undefined): { text: string; name: string } | null {
  if (waiting === undefined || waiting <= 0) return null
  const name = kind === 'popupBlocked' ? `${waiting} more pop-ups blocked` : `${waiting} more requests waiting`
  return { text: `+${waiting} waiting`, name }
}

/**
 * The sign-in box's rejection line (deck *Sign-in – rejected*); the host is in the row's title.
 *
 * @param rejected - Which sign-in was refused, or `null`
 * @returns The line, or `null` when nothing was refused
 */
export function signInRejectedText(rejected: 'typed' | 'saved' | null | undefined): string | null {
  if (rejected === 'typed') return "That username and password weren't accepted. Check them and sign in again."
  if (rejected === 'saved') return "The saved username and password weren't accepted. Enter them again."
  return null
}

/**
 * The polite announcement when a row arrives (deck *Announce – prompt arrives*).
 * A sign-in box that comes back refused says so here: its rejection line is a
 * field error, not a live region (Form card, decided).
 *
 * @param row - The new row
 * @returns The sentence
 */
export function arrivalAnnouncement(row: Pick<StripRow, 'kind' | 'text' | 'requester' | 'signIn'>): string {
  const request = rowSentence(row).replace(/[.?]$/, '')
  const rejected = row.kind === 'signIn' ? signInRejectedText(row.signIn?.rejected) : null
  return `${request}. ${rejected === null ? '' : `${rejected} `}Press F6 to answer in the prompt above the page.`
}
