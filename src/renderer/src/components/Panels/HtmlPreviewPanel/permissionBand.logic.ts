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
  readonly state: 'allow' | 'not-approvable' | 'allowed'
  /**
   * All kinds this host was refused for. Read by the CONFIRM copy only — no row
   * ever shows a kind. See `selectBandRows`.
   */
  readonly kinds: readonly PreviewBlockedKind[]
}

export interface BandRows {
  /** Blocked and offerable — the rows with an Allow button. */
  readonly blocked: readonly BandRow[]
  /** Approved for this project. */
  readonly allowed: readonly BandRow[]
  /** Blocked with no button, because the mechanism cannot express them. */
  readonly unapprovable: readonly BandRow[]
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
 * NO ROW CARRIES A KIND — not blocked, not allowed. It is true that a blocked host
 * was refused for a font, but that is a fact about what the page happened to
 * request, and a permission list is not where a fact about traffic belongs: put
 * "font" beside a host and an Allow button and it reads as the SCOPE of the
 * block and of the grant. Neither is scoped. `previewCsp.ts` appends the same
 * host list to `script-src`, `style-src`, `img-src`, `font-src`, `media-src` and
 * `connect-src`, so a host is refused for everything and, once approved, allowed
 * for everything.
 *
 * The kinds survive in `kinds`, for the CONFIRM copy alone. There the sentence
 * denies the scope in the same breath it names it — "blocked for a stylesheet,
 * but Erfana cannot limit it to that" — which is the one place the word can
 * appear without misleading. On the row there is no such breath.
 *
 * (An allowed row could not show one anyway: the allowlist stores hosts and
 * nothing else, so for a host approved last month the kind is unknowable.)
 */
export function selectBandRows(
  blockedHosts: readonly PreviewBlockedHost[],
  allowedHosts: readonly string[]
): BandRows {
  const allowedSet = new Set(allowedHosts)

  const stillBlocked = blockedHosts.filter(entry => !allowedSet.has(entry.host))

  /*
   * THREE GROUPS, ORDERED BY WHAT THE READER CAN DO ABOUT THEM.
   *
   * Answerable first, then answered, then unanswerable. The list is a queue of
   * decisions, and the only rows that are a decision are the ones with a button
   * — so a page that asked for twenty hosts does not bury its one actionable
   * row under nineteen settled ones.
   *
   * The unapprovable rows go LAST rather than being dropped. They are still
   * facts about what the page tried to reach, and a refusal the reader cannot
   * act on is exactly the kind of thing that must not be silently hidden — but
   * it does not belong between them and the button they came for.
   *
   * Arrival order is preserved WITHIN each group. Blocked hosts are already in
   * first-seen order, which is the only order that means anything about a page,
   * and re-sorting them by name would shuffle the list every time the page
   * requested something new.
   */
  const blocked: BandRow[] = stillBlocked
    .filter(entry => entry.approvable)
    .map(entry => ({ host: entry.host, kinds: entry.kinds, state: 'allow' as const }))

  const unapprovable: BandRow[] = stillBlocked
    .filter(entry => !entry.approvable)
    .map(entry => ({ host: entry.host, kinds: entry.kinds, state: 'not-approvable' as const }))

  const allowed: BandRow[] = [...allowedHosts]
    .sort((a, b) => a.localeCompare(b))
    .map(host => ({ host, kinds: [], state: 'allowed' as const }))

  return {
    blocked,
    allowed,
    unapprovable,
    // An unapprovable host IS blocked, and the count says so. Splitting it out
    // of the total would make the chip disagree with the failure badge, which
    // counts every refusal — the exact class of contradiction the origin work
    // removed.
    counts: { blocked: blocked.length + unapprovable.length, allowed: allowed.length }
  }
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

/**
 * "a script", "a font and an image", "a script, a font and an image".
 *
 * MOST CAPABLE FIRST, not arrival order. `PREVIEW_BLOCKED_KINDS` is ordered by
 * how much a resource can do, and this sentence is the last thing read before a
 * one-way grant, so the worst thing the host was already trying to do leads it.
 * Sorting is not cosmetic: `recordBlockedHost` merges sightings with a Set,
 * which preserves arrival order, not vocabulary order — the two only happen to
 * agree today because main sends the whole accumulated set each time.
 */
export function describeKinds(kinds: readonly PreviewBlockedKind[]): string {
  const phrases = PREVIEW_BLOCKED_KINDS.filter(kind => kinds.includes(kind)).map(
    kind => KIND_PHRASE[kind]
  )
  if (phrases.length === 0) return 'a resource'
  if (phrases.length === 1) return phrases[0]
  return `${phrases.slice(0, -1).join(', ')} and ${phrases[phrases.length - 1]}`
}

/** What a buttonless row says, and the fuller reason it announces. */
export interface BandRefusal {
  /** Short enough for the row's fixed middle column. */
  readonly short: string
  /** The whole reason, carried by the accessible name. */
  readonly detail: string
}

/**
 * Why this origin cannot be offered an Allow button.
 *
 * Derived from the origin the row already holds, NOT carried over IPC. The
 * canonicaliser is pure and dependency-free precisely so it can run in both
 * bundles, and adding a `reason` to `PreviewHostBlockedPayloadSchema` would mean
 * editing seven files across a `.strict()` boundary where a half-landed change
 * drops the ENTIRE payload rather than one field.
 *
 * The row used to hardcode the IPv6 sentence for every refusal, so a host
 * refused for a different reason was told the wrong cause. Two reviewers found
 * that independently, and a test pinned it: an IPv4 literal asserted to render
 * the IPv6 copy.
 */
export function describeRefusal(origin: string): BandRefusal {
  let hostname = ''
  try {
    hostname = new URL(origin).hostname
  } catch {
    // Not a URL at all. Nothing specific can be said honestly.
    return {
      short: 'Cannot be allowed',
      detail: 'This address cannot be allowed: it is not a form Erfana can record.'
    }
  }

  // PHYSICS, not policy: CSP3's `host-char` is `ALPHA / DIGIT / "-"`, so a
  // bracketed literal cannot be written as a host-source at all. A grant would
  // live in the network filter and never reach the CSP.
  if (hostname.startsWith('[') || hostname.includes(':')) {
    return {
      short: 'IPv6 cannot be allowed',
      detail:
        'IPv6 addresses cannot be allowed: the browser security policy that ' +
        'carries a permission has no way to write one down.'
    }
  }

  // A single trailing dot is the DNS root label and is legal — take it off
  // before judging the labels, exactly as the canonicaliser does.
  const namePart = hostname.endsWith('.') ? hostname.slice(0, -1) : hostname
  const badLabel = namePart
    .split('.')
    .some((label) => !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  if (badLabel) {
    return {
      short: 'Not a valid host name',
      detail:
        `"${hostname}" cannot be allowed: it is not a valid host name. Every ` +
        'part must be letters, digits or hyphens — an underscore or an empty ' +
        'part makes it something a permission cannot be written for.'
    }
  }

  return {
    short: 'Cannot be allowed',
    detail: `"${hostname}" cannot be allowed: it is not a form Erfana can record a permission for.`
  }
}

/**
 * What a failed approval says on the row.
 *
 * Kept short: it is the ONE message the 72px middle cell carries, and it must
 * fit rather than widen the grid.
 * The product card widens the grid inline to fit a long message, which is a card
 * hack — copying it into the component would put an inline
 * `grid-template-columns` in shipping code.
 */
export function approveFailureText(errorCode: ErrorCode): string {
  switch (errorCode) {
    case ErrorCode.PREVIEW_ALLOWLIST_FULL:
      return 'Not saved — list full'
    case ErrorCode.PREVIEW_HOST_NOT_APPROVABLE:
      // Reachable only if a row offered an Allow the boundary then refused,
      // which is the defect the shared canonicaliser exists to make impossible.
      // It says "Not saved" like every other failure rather than "Cannot be
      // approved", because the reader DID something and it did not take — that
      // is a different message from a row that never offered a button.
      return 'Not saved — not allowed'
    case ErrorCode.PROJECT_SETTINGS_VALIDATION_FAILED:
      // The project's settings file is malformed, so the write was refused
      // rather than allowed to destroy what is there. Naming the file matters:
      // this is the one approval failure the reader can actually fix, and
      // without it every retry reports a bare "Not saved" forever.
      return 'Not saved — check settings'
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
