// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import type { OriginPartsPayload, StripRow } from '../../../../../shared/ipc/browser-tab-schema'
import {
  answerLabel,
  arrivalAnnouncement,
  dismissDescription,
  dismissIsIcon,
  escapeAnswer,
  isGranting,
  isGuarded,
  originLine,
  queueCount,
  rememberedText,
  rowSentence,
  showsOriginLine,
  signInRejectedText,
  sortStripRows,
  STRIP_INPUT_GUARD_MS,
  stripRowRole
} from './stripRows.logic'

const ORIGIN: OriginPartsPayload = { kind: 'web', scheme: null, subdomain: 'www.', registrableDomain: 'harbour-garden.org', port: null, punycode: false }
const row = (kind: StripRow['kind'], patch: Partial<StripRow> = {}): StripRow => ({
  requestId: kind,
  kind,
  text: 'text',
  answers: [],
  takesFocus: false,
  ...patch
})

describe('stripRows.logic', () => {
  it('sorts rows in the fixed order of kinds, keeping arrival order within a kind', () => {
    const rows = [row('keyring'), row('permission', { requestId: 'p1' }), row('leavePage'), row('permission', { requestId: 'p2' }), row('hung')]
    expect(sortStripRows(rows.map(r => ({ row: r }))).map(s => s.row.requestId)).toEqual(['leavePage', 'p1', 'p2', 'hung', 'keyring'])
  })

  it('guards for 500 ms', () => {
    expect(isGuarded(100, 100 + STRIP_INPUT_GUARD_MS - 1)).toBe(true)
    expect(isGuarded(100, 100 + STRIP_INPUT_GUARD_MS)).toBe(false)
  })

  it('labels answers, page-dialog answers never OK or Cancel', () => {
    expect(answerLabel(row('popupBlocked'), 'alwaysAllow')).toBe('Always allow for this site')
    expect(answerLabel(row('permission'), 'allowOnce')).toBe('Allow once')
    expect(answerLabel(row('pageDialog', { answers: ['ok'] }), 'ok')).toBe('Close')
    expect(answerLabel(row('pageDialog', { answers: ['ok', 'cancel'] }), 'ok')).toBe('Confirm')
    expect(answerLabel(row('pageDialog', { answers: ['ok', 'cancel'] }), 'cancel')).toBe('Decline')
    expect(answerLabel(row('hung'), 'wait')).toBe('Wait')
  })

  it('knows granting answers, the close icon, Esc and roles', () => {
    expect(isGranting('allow')).toBe(true)
    expect(isGranting('stay')).toBe(false)
    expect(dismissIsIcon('permission')).toBe(true)
    expect(dismissIsIcon('keyring')).toBe(false)
    expect(dismissDescription('popupBlocked')).toMatch(/chip in the address bar/)
    expect(dismissDescription('permission')).toBe('Blocks this request until the page reloads')
    expect(escapeAnswer(row('leavePage', { answers: ['leave', 'stay'] }))).toBe('stay')
    expect(escapeAnswer(row('signIn', { answers: ['signIn', 'cancel'] }))).toBe('cancel')
    expect(escapeAnswer(row('hung', { answers: ['wait', 'reload'] }))).toBeNull()
    expect(stripRowRole('leavePage')).toBe('alertdialog')
    expect(stripRowRole('permission')).toBe('group')
  })

  it('writes origins through the formatter and composes the pop-up clause', () => {
    expect(originLine(ORIGIN)).toBe('www.harbour-garden.org')
    expect(originLine({ kind: 'file' })).toBe('Local file')
    expect(originLine({ kind: 'nonWeb', scheme: 'data' })).toBe('data:')
    expect(rowSentence(row('popupBlocked', { text: 'Pop-up blocked', requester: { origin: ORIGIN, inside: null } }))).toBe(
      'Pop-up blocked – www.harbour-garden.org tried to open a new tab or window.'
    )
    expect(rowSentence(row('popupBlocked', { text: 'Pop-up blocked' }))).toBe('Pop-up blocked – This page tried to open a new tab or window.')
    expect(rowSentence(row('download', { text: 'x' }))).toBe('x')
    expect(showsOriginLine(row('download', { requester: { origin: ORIGIN, inside: null } }))).toBe(true)
    expect(showsOriginLine(row('permission', { requester: { origin: ORIGIN, inside: null } }))).toBe(false)
  })

  it('describes what happens to a permission answer', () => {
    expect(rememberedText(row('permission', { remembered: 'saved', answers: ['block', 'allowOnce', 'allow'] }))).toMatch(/^Allow once is for this page load only/)
    expect(rememberedText(row('permission', { remembered: 'saved', answers: ['block', 'allow'] }))).toBe('Erfana remembers your answer for this site in this project.')
    expect(rememberedText(row('permission', { remembered: 'session' }))).toMatch(/until it closes/)
    expect(rememberedText(row('permission', { remembered: 'never' }))).toBeNull()
    expect(rememberedText(row('download', { remembered: 'saved' }))).toBeNull()
  })

  it('counts the queue and announces arrivals with the one F6 sentence', () => {
    expect(queueCount('permission', 0)).toBeNull()
    expect(queueCount('permission', undefined)).toBeNull()
    expect(queueCount('permission', 2)).toEqual({ text: '+2 waiting', name: '2 more requests waiting' })
    expect(queueCount('popupBlocked', 1)).toEqual({ text: '+1 waiting', name: '1 more pop-ups blocked' })
    expect(arrivalAnnouncement(row('leavePage', { text: 'Leave this page? Changes may not be saved.' }))).toBe(
      'Leave this page? Changes may not be saved. Press F6 to answer in the prompt above the page.'
    )
  })

  it('writes the sign-in rejection and adds it to the arrival sentence', () => {
    expect(signInRejectedText(null)).toBeNull()
    expect(signInRejectedText(undefined)).toBeNull()
    expect(signInRejectedText('saved')).toBe("The saved username and password weren't accepted. Enter them again.")
    const signIn = { username: '', savedPassword: false, insecure: false, rejected: null, remember: 'available' as const }
    expect(arrivalAnnouncement(row('signIn', { text: 'Sign in to a.test', signIn }))).toBe('Sign in to a.test. Press F6 to answer in the prompt above the page.')
    expect(arrivalAnnouncement(row('signIn', { text: 'Sign in to a.test', signIn: { ...signIn, rejected: 'saved' } }))).toBe(
      "Sign in to a.test. The saved username and password weren't accepted. Enter them again. Press F6 to answer in the prompt above the page."
    )
  })
})
