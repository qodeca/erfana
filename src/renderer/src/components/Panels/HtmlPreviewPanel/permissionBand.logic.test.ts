// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The permission band's decisions, tested without a DOM.
 *
 * @see design/system/components/permission-band/index.html - status="decided"
 */
import { describe, expect, it } from 'vitest'

import { ErrorCode } from '../../../../../shared/errors'
import { PREVIEW_BLOCKED_KINDS } from '../../../../../shared/ipc/previewBlockedKind'
import {
  INITIAL_BAND_STATE,
  approveFailureText,
  bandReducer,
  chipAccessibleName,
  countsLabel,
  describeKinds,
  selectBandRows
} from './permissionBand.logic'
import type { PreviewBlockedHost } from '../../../stores/usePreviewStore'

const blocked = (
  host: string,
  kinds: PreviewBlockedHost['kinds'] = ['image'],
  approvable = true
): PreviewBlockedHost => ({ host, kinds, approvable })

describe('selectBandRows', () => {
  it('always reports both counts, including two zeroes', () => {
    // Silence is the one state a permission control must never have: a trust
    // signal that appears only when something is wrong is not a trust signal.
    const rows = selectBandRows([], [])
    expect(rows.counts).toEqual({ blocked: 0, allowed: 0 })
    expect(countsLabel(rows.counts)).toBe('0 blocked · 0 allowed')
  })

  it('subtracts an approved host from the blocked list without mutating it', () => {
    // This is how an approval "moves" a row with no mutation anywhere. The store
    // slice is an append-only record of what was refused and is deliberately
    // never edited — `applyApprovedHosts` clears the failure log, so a list built
    // on that log empties the moment the reader approves anything, exactly when
    // they are mid-way through a cascade.
    const input = [blocked('a.example.com'), blocked('b.example.com')]
    const rows = selectBandRows(input, ['a.example.com'])

    expect(rows.blocked.map(r => r.host)).toEqual(['b.example.com'])
    expect(rows.allowed.map(r => r.host)).toEqual(['a.example.com'])
    expect(rows.counts).toEqual({ blocked: 1, allowed: 1 })
    // Untouched.
    expect(input.map(r => r.host)).toEqual(['a.example.com', 'b.example.com'])
  })

  it('lists a host approved in an earlier session, never blocked here', () => {
    // The case nothing in the app surfaced before: a cloned repository can arrive
    // with hosts already approved by someone else (docs/security.md residual
    // risk 5), and until now there was no screen anywhere that showed it.
    const rows = selectBandRows([], ['inherited.example.com'])
    expect(rows.allowed.map(r => r.host)).toEqual(['inherited.example.com'])
    expect(rows.counts.allowed).toBe(1)
  })

  it('carries the kinds for the confirm copy without putting them on a row', () => {
    // A row never names a resource kind — the word would read as the scope of
    // the block and of the grant, and neither is scoped: `previewCsp.ts` appends
    // the same host list to script-src, style-src, img-src, font-src, media-src
    // and connect-src. The kinds survive on the row DATA because the confirm box
    // reads them, in a sentence that denies the limit in its next clause.
    const rows = selectBandRows([blocked('a.example.com', ['font', 'script'])], [])
    expect(rows.blocked[0].kinds).toEqual(['font', 'script'])
    expect(rows.blocked[0]).not.toHaveProperty('kind')
  })

  it('gives an allowed row no kinds at all', () => {
    // Nothing to carry: the allowlist stores hosts and nothing else, so for a
    // host approved last month the kind is unknowable.
    const rows = selectBandRows([blocked('a.example.com', ['font'])], ['a.example.com'])
    expect(rows.allowed[0].kinds).toEqual([])
  })

  it('marks a host that can never be approved', () => {
    const rows = selectBandRows([blocked('203.0.113.7', ['image'], false)], [])
    expect(rows.blocked[0].state).toBe('not-approvable')
  })
})

describe('describeKinds', () => {
  it('reads as English for every kind', () => {
    // The card's helper picked "a"/"an" from the first letter, which yields
    // "a connect" and "a other". Eight members, so a map rather than a rule.
    for (const kind of PREVIEW_BLOCKED_KINDS) {
      const phrase = describeKinds([kind])
      expect(phrase).toMatch(/^(a|an) /)
      expect(phrase).not.toMatch(/\b(a|an) (connect|other)\b/)
    }
  })

  it('joins several kinds', () => {
    expect(describeKinds(['script', 'font'])).toBe('a script and a font')
    expect(describeKinds(['script', 'font', 'image'])).toBe('a script, a font and an image')
  })

  it('leads with the most capable kind, whatever order they arrived in', () => {
    // This sentence is the last thing read before a one-way grant, so the worst
    // thing the host was already trying to do goes first. Not cosmetic:
    // `recordBlockedHost` merges sightings with a Set, which preserves arrival
    // order, not vocabulary order — the two only happen to agree today because
    // main sends the whole accumulated set each time.
    expect(describeKinds(['image', 'script'])).toBe('a script and an image')
    expect(describeKinds(['other', 'font'])).toBe('a font and a resource')
    expect(describeKinds(['connect', 'style'])).toBe('a stylesheet and a network request')
  })

  it('never returns an empty phrase', () => {
    expect(describeKinds([])).toBe('a resource')
  })
})

describe('chipAccessibleName', () => {
  it('contains the visible text verbatim (WCAG SC 2.5.3)', () => {
    const counts = { blocked: 4, allowed: 2 }
    expect(chipAccessibleName(counts)).toContain(countsLabel(counts))
  })

  it('states the way out of the previewed page (WCAG SC 2.1.2)', () => {
    // SC 2.1.2 asks for an exit that is DOCUMENTED, not merely present. A
    // forwarded Escape nobody is told about is not documented.
    expect(chipAccessibleName({ blocked: 0, allowed: 0 })).toMatch(/Escape/)
  })
})

describe('bandReducer', () => {
  it('records whether the list was opened from the keyboard', () => {
    const byKey = bandReducer(INITIAL_BAND_STATE, { type: 'toggle', byKeyboard: true })
    expect(byKey).toMatchObject({ expanded: true, openedByKeyboard: true })

    const byMouse = bandReducer(INITIAL_BAND_STATE, { type: 'toggle', byKeyboard: false })
    expect(byMouse).toMatchObject({ expanded: true, openedByKeyboard: false })
  })

  it('abandons an open question when the list collapses', () => {
    let s = bandReducer(INITIAL_BAND_STATE, { type: 'toggle', byKeyboard: false })
    s = bandReducer(s, { type: 'allowClicked', host: 'a.example.com' })
    expect(s.mode.kind).toBe('confirming')

    s = bandReducer(s, { type: 'toggle', byKeyboard: false })
    expect(s.expanded).toBe(false)
    expect(s.mode.kind).toBe('idle')
  })

  it('keeps a failure visible after the list is collapsed', () => {
    // The chip carries a red caret for exactly this reason: closing the list must
    // not hide a write that did not happen.
    let s = bandReducer(INITIAL_BAND_STATE, { type: 'toggle', byKeyboard: false })
    s = bandReducer(s, {
      type: 'approveFailed',
      host: 'a.example.com',
      errorCode: ErrorCode.PREVIEW_ALLOWLIST_FULL
    })
    s = bandReducer(s, { type: 'toggle', byKeyboard: false })
    expect(s.failure?.host).toBe('a.example.com')
  })

  it('ignores everything except its own resolution while a write is in flight', () => {
    // There is no safe way to cancel a write already sent, and offering a Cancel
    // that cannot cancel is worse than offering none.
    let s = bandReducer(INITIAL_BAND_STATE, { type: 'toggle', byKeyboard: false })
    s = bandReducer(s, { type: 'allowClicked', host: 'a.example.com' })
    s = bandReducer(s, { type: 'approveStarted', host: 'a.example.com' })

    expect(bandReducer(s, { type: 'cancelConfirm' })).toBe(s)
    expect(bandReducer(s, { type: 'collapse' })).toBe(s)
    expect(bandReducer(s, { type: 'toggle', byKeyboard: false })).toBe(s)

    const done = bandReducer(s, { type: 'approveSucceeded', host: 'a.example.com' })
    expect(done.mode.kind).toBe('idle')
  })

  it('announces each irreversible step, and clears the announcement on cancel', () => {
    let s = bandReducer(INITIAL_BAND_STATE, { type: 'toggle', byKeyboard: false })
    expect(s.announcement).toBe('')

    s = bandReducer(s, { type: 'allowClicked', host: 'a.example.com' })
    expect(s.announcement).toMatch(/cannot be undone/)

    s = bandReducer(s, { type: 'cancelConfirm' })
    expect(s.announcement).toBe('')
  })

  it('clears a stale failure only for the host being asked about again', () => {
    let s = bandReducer(INITIAL_BAND_STATE, { type: 'toggle', byKeyboard: false })
    s = bandReducer(s, {
      type: 'approveFailed',
      host: 'a.example.com',
      errorCode: ErrorCode.UNKNOWN_ERROR
    })

    s = bandReducer(s, { type: 'allowClicked', host: 'b.example.com' })
    expect(s.failure?.host).toBe('a.example.com')

    s = bandReducer(s, { type: 'allowClicked', host: 'a.example.com' })
    expect(s.failure).toBeNull()
  })

  it('moves nothing to the allowed list on success', () => {
    // The row disappears because `selectBandRows` subtracts it once the store has
    // the new allowlist from main — never on optimism here, because a row that
    // moved optimistically would survive a failed write as a lie.
    let s = bandReducer(INITIAL_BAND_STATE, { type: 'toggle', byKeyboard: false })
    s = bandReducer(s, { type: 'allowClicked', host: 'a.example.com' })
    s = bandReducer(s, { type: 'approveStarted', host: 'a.example.com' })
    s = bandReducer(s, { type: 'approveSucceeded', host: 'a.example.com' })
    expect(s).not.toHaveProperty('allowed')
    expect(s.announcement).toMatch(/is now allowed in this project/)
  })
})

describe('approveFailureText', () => {
  it('names the cause where it can, and stays short enough for the row', () => {
    // The failed text is the one message the 72px middle cell carries, and it
    // has to fit that cell rather than widening the
    // grid; the product card widens it with an inline `grid-template-columns`,
    // which is a card hack and must not reach shipping code.
    expect(approveFailureText(ErrorCode.PREVIEW_ALLOWLIST_FULL)).toBe('Not saved — list full')
    expect(approveFailureText(ErrorCode.PREVIEW_HOST_NOT_APPROVABLE)).toBe('Cannot be approved')
    expect(approveFailureText(ErrorCode.UNKNOWN_ERROR)).toBe('Not saved')
    for (const code of [
      ErrorCode.PREVIEW_ALLOWLIST_FULL,
      ErrorCode.PREVIEW_HOST_NOT_APPROVABLE,
      ErrorCode.UNKNOWN_ERROR
    ]) {
      expect(approveFailureText(code).length).toBeLessThanOrEqual(24)
    }
  })
})
