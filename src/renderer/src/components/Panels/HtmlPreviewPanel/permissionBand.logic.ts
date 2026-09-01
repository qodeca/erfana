// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Every decision the permission band makes, as pure functions.
 *
 * House pattern: glue panel, pure logic (see `htmlPreview.logic.ts`). The band's
 * React component owns focus and effects; everything that can be decided from
 * values lives here, where it can be tested without a DOM.
 *
 * @see design/system/components/permission-band/index.html - status="decided"
 * @see design/product/html-approval/index.html - the nine-state journey
 */
import { ErrorCode } from '../../../../../shared/errors'
import {
  PREVIEW_BLOCKED_KINDS,
  type PreviewBlockedKind
} from '../../../../../shared/ipc/previewBlockedKind'
import type { PreviewBlockedHost } from '../../../stores/usePreviewStore'

/** What the band is doing right now. One at a time, by design. */
export type PermissionBandMode =
  | { readonly kind: 'idle' }
  | { readonly kind: 'confirming'; readonly host: string }
  | { readonly kind: 'approving'; readonly host: string }

/** The band's whole UI state. Lives in a reducer inside the component. */
export interface PermissionBandState {
  readonly expanded: boolean
  readonly mode: PermissionBandMode
  /** The host whose last approval failed, and why. Survives collapsing the list. */
  readonly failure: { readonly host: string; readonly text: string } | null
  /** Written into the live region. Empty until there is something to say. */
  readonly announcement: string
  /**
   * Whether the list was opened from the keyboard. The card: "Opening the list
   * with the keyboard moves focus to the first Allow; opening it with the mouse
   * does not, because the pointer already knows where it is."
   */
  readonly openedByKeyboard: boolean
}

export const INITIAL_BAND_STATE: PermissionBandState = {
  expanded: false,
  mode: { kind: 'idle' },
  failure: null,
  announcement: '',
  openedByKeyboard: false
}

export type PermissionBandAction =
  | { type: 'toggle'; byKeyboard: boolean }
  | { type: 'collapse' }
  | { type: 'allowClicked'; host: string }
  | { type: 'cancelConfirm' }
  | { type: 'approveStarted'; host: string }
  | { type: 'approveSucceeded'; host: string }
  | { type: 'approveFailed'; host: string; errorCode: ErrorCode }

/**
 * The band's state machine.
 *
 * Two rules worth stating, because both are load-bearing and neither is obvious:
 *
 *  - `approving` ignores every action except its own resolution. A write to
 *    `.erfana/settings.json` is already in flight and there is no safe way to
 *    cancel one that has been sent; offering a Cancel that cannot cancel is
 *    worse than offering none.
 *  - Nothing moves to the allowed list here. `approveSucceeded` only clears the
 *    confirm; the row disappears because `selectBandRows` subtracts the approved
 *    host from the blocked list once the store has the new allowlist. A row that
 *    moved on optimism would survive a failed write as a lie.
 */
export function bandReducer(
  state: PermissionBandState,
  action: PermissionBandAction
): PermissionBandState {
  if (state.mode.kind === 'approving') {
    const settles =
      action.type === 'approveSucceeded' || action.type === 'approveFailed'
    if (!settles) return state
  }

  switch (action.type) {
    case 'toggle': {
      const expanded = !state.expanded
      return {
        ...state,
        expanded,
        openedByKeyboard: expanded && action.byKeyboard,
        // Collapsing abandons an open question. The failure stays: the chip
        // keeps its red caret so closing the list cannot hide a failed write.
        mode: expanded ? state.mode : { kind: 'idle' }
      }
    }

    case 'collapse':
      return { ...state, expanded: false, mode: { kind: 'idle' }, openedByKeyboard: false }

    case 'allowClicked':
      return {
        ...state,
        mode: { kind: 'confirming', host: action.host },
        // A new question clears the previous answer's failure banner, but only
        // for the host being asked about again.
        failure: state.failure?.host === action.host ? null : state.failure,
        announcement: `Approving ${action.host}. This cannot be undone. Cancel or confirm.`
      }

    case 'cancelConfirm':
      return { ...state, mode: { kind: 'idle' }, announcement: '' }

    case 'approveStarted':
      return { ...state, mode: { kind: 'approving', host: action.host }, announcement: '' }

    case 'approveSucceeded':
      return {
        ...state,
        mode: { kind: 'idle' },
        failure: null,
        announcement: `${action.host} is now allowed in this project. The preview is reloading.`
      }

    case 'approveFailed':
      return {
        ...state,
        mode: { kind: 'idle' },
        failure: { host: action.host, text: approveFailureText(action.errorCode) },
        announcement: `Could not save ${action.host} to this project. It is still blocked.`
      }

    default:
      return state
  }
}

/** One row of the band's list. */
export interface BandRow {
  readonly host: string
  /** Absent on an allowed row, deliberately — see `selectBandRows`. */
  readonly kind: PreviewBlockedKind | null
  readonly state: 'allow' | 'not-approvable' | 'allowed'
  /** All kinds this host was refused for, for the confirm copy and the a11y name. */
  readonly kinds: readonly PreviewBlockedKind[]
}

export interface BandRows {
  readonly blocked: readonly BandRow[]
  readonly allowed: readonly BandRow[]
  readonly counts: { readonly blocked: number; readonly allowed: number }
}

/**
 * Turn the two stores into rows.
 *
 * The subtraction is what makes an approval "move" a row with no mutation
 * anywhere: `blockedHosts` is an append-only record of what was refused and is
 * never edited, and the view simply stops showing a host once it appears in the
 * allowlist. So the store's "never cleared" contract stays true, and the card's
 * step 5 — the row moves to Allowed, the remaining three stay listed — falls out.
 *
 * ALLOWED ROWS CARRY NO KIND, and the empty column is the point. On a blocked row
 * the kind is a true statement about something that happened: this host was
 * refused, for a font. On an allowed row the same word reads as "this host may
 * only serve a font", which is exactly the belief the confirm step exists to
 * destroy — an approved host is added to every CSP directive the preview builds.
 * The allowlist stores hosts and nothing else, so for a host approved last month
 * the kind is unknowable anyway; filling the column for this session's approvals
 * only would invite a reader to infer a difference in grant that does not exist.
 */
export function selectBandRows(
  blockedHosts: readonly PreviewBlockedHost[],
  allowedHosts: readonly string[]
): BandRows {
  const allowedSet = new Set(allowedHosts)

  const blocked: BandRow[] = blockedHosts
    .filter(entry => !allowedSet.has(entry.host))
    .map(entry => ({
      host: entry.host,
      kind: mostCapableKind(entry.kinds),
      kinds: entry.kinds,
      state: entry.approvable ? ('allow' as const) : ('not-approvable' as const)
    }))

  const allowed: BandRow[] = [...allowedHosts]
    .sort((a, b) => a.localeCompare(b))
    .map(host => ({ host, kind: null, kinds: [], state: 'allowed' as const }))

  return {
    blocked,
    allowed,
    counts: { blocked: blocked.length, allowed: allowed.length }
  }
}

/**
 * The one kind to show in a 72px column.
 *
 * `PREVIEW_BLOCKED_KINDS` is ordered by how much the resource can do, so the
 * first member present is the most capable — and the most capable is the honest
 * one to show, since it is the worst thing this host was already trying to do.
 *
 * NOT `kinds[0]`. `recordBlockedHost` merges sightings with a Set, which
 * preserves arrival order, not vocabulary order. It only happens to agree today
 * because main sends the whole accumulated set each time.
 */
export function mostCapableKind(
  kinds: readonly PreviewBlockedKind[]
): PreviewBlockedKind | null {
  if (kinds.length === 0) return null
  return PREVIEW_BLOCKED_KINDS.find(candidate => kinds.includes(candidate)) ?? null
}

/**
 * How a kind reads inside a sentence.
 *
 * A map rather than an `a`/`an` rule: the vocabulary has eight members and
 * "a connect" and "a other" are not English.
 */
const KIND_PHRASE: Record<PreviewBlockedKind, string> = {
  script: 'a script',
  style: 'a stylesheet',
  font: 'a font',
  image: 'an image',
  media: 'a media file',
  connect: 'a network request',
  frame: 'an embedded frame',
  other: 'a resource'
}

/** "a script", "a font and an image", "a script, a font and an image". */
export function describeKinds(kinds: readonly PreviewBlockedKind[]): string {
  const phrases = kinds.map(kind => KIND_PHRASE[kind])
  if (phrases.length === 0) return 'a resource'
  if (phrases.length === 1) return phrases[0]
  return `${phrases.slice(0, -1).join(', ')} and ${phrases[phrases.length - 1]}`
}

/**
 * What a failed approval says on the row.
 *
 * Kept short: it replaces the 72px kind column rather than widening the grid.
 * The product card widens the grid inline to fit a long message, which is a card
 * hack — copying it into the component would put an inline
 * `grid-template-columns` in shipping code.
 */
export function approveFailureText(errorCode: ErrorCode): string {
  switch (errorCode) {
    case ErrorCode.PREVIEW_ALLOWLIST_FULL:
      return 'Not saved — list full'
    case ErrorCode.PREVIEW_HOST_NOT_APPROVABLE:
      return 'Cannot be approved'
    default:
      return 'Not saved'
  }
}

/**
 * The chip's visible text. Always both counts, including two zeroes.
 *
 * A page that asks for nothing still gets a band with `0 blocked · 0 allowed`:
 * silence is the one state a permission control must never have, and a trust
 * signal that appears only when something is wrong is not a trust signal.
 */
export function countsLabel(counts: BandRows['counts']): string {
  return `${counts.blocked} blocked · ${counts.allowed} allowed`
}

/**
 * The chip's accessible name.
 *
 * Two obligations in one string. It must CONTAIN the visible text verbatim
 * (WCAG SC 2.5.3 label in name), and it is where the way out of the previewed
 * page is stated — SC 2.1.2 asks for an exit that is documented, not merely
 * present, and a forwarded Escape nobody knows about is not documented.
 */
export function chipAccessibleName(counts: BandRows['counts']): string {
  return (
    `${countsLabel(counts)}. Remote hosts in this preview. ` +
    'Press Escape in the previewed page to return here.'
  )
}
