// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterEach, describe, expect, it } from 'vitest'
import type { PickEvent } from '../../../shared/ipc/browser-tab-schema'
import { IDLE_PICK, useBrowserPickStore, type PickSummary } from './useBrowserPickStore'

const TAB = 'browser-tab-1'
const CAPTURE = 'a'.repeat(32)
const SUMMARY: PickSummary = {
  name: 'button.cta',
  size: '176 × 32',
  ancestors: ['html', 'body', 'main'],
  box: { x: 10, y: 20, width: 176, height: 32 },
  atTop: false,
  atStart: true,
  gone: false,
  changedAfterPick: false
}
const captured: PickEvent = {
  tabId: TAB,
  kind: 'captured',
  captureId: CAPTURE,
  still: new Uint8Array(4),
  stillWidth: 1,
  stillHeight: 1,
  summary: SUMMARY
}

const store = useBrowserPickStore.getState
const tab = () => store().byTab.get(TAB) ?? IDLE_PICK

afterEach(() => useBrowserPickStore.setState({ byTab: new Map() }))

describe('useBrowserPickStore', () => {
  it('follows pick mode, the hover label and capturing', () => {
    store().apply({ tabId: TAB, kind: 'mode', on: true })
    store().apply({ tabId: TAB, kind: 'highlight', label: 'button.cta 176 × 32' })
    store().apply({ tabId: TAB, kind: 'capturing' })
    expect(tab()).toMatchObject({ on: true, label: 'button.cta 176 × 32', capturing: true })
    store().apply({ tabId: TAB, kind: 'captureFailed', reason: 'The screenshot came back empty' })
    expect(tab().capturing).toBe(false)
    store().apply({ tabId: TAB, kind: 'mode', on: false })
    expect(tab()).toMatchObject({ on: false, label: null })
  })

  it('holds the capture, marks a refinement as changed, freezes only the held capture', () => {
    store().apply(captured)
    expect(tab().capture).toEqual({ captureId: CAPTURE, summary: SUMMARY, changedAt: null, afterNavigation: false })
    store().apply({ tabId: TAB, kind: 'refined', captureId: CAPTURE, summary: { ...SUMMARY, name: 'main' } }, 1234)
    expect(tab().capture).toMatchObject({ summary: { name: 'main' }, changedAt: 1234 })
    const before = tab()
    store().apply({ tabId: TAB, kind: 'refined', captureId: 'b'.repeat(32), summary: SUMMARY })
    store().apply({ tabId: TAB, kind: 'frozen', captureId: 'b'.repeat(32) })
    expect(tab()).toBe(before)
    store().apply({ tabId: TAB, kind: 'frozen', captureId: CAPTURE })
    expect(tab().frozen).toBe(true)
  })

  it('ends a capture, but keeps a page change\'s capture for the dialog (025-FR-053)', () => {
    store().apply(captured)
    store().apply({ tabId: TAB, kind: 'ended', reason: 'pageChanged' })
    expect(tab().capture).toMatchObject({ captureId: CAPTURE, afterNavigation: true })
    store().apply({ tabId: TAB, kind: 'ended', reason: 'user' })
    expect(tab().capture).toBeNull()
    store().apply({ tabId: TAB, kind: 'ended', reason: 'pageChanged' })
    expect(tab().capture).toBeNull()
  })

  it('restarts a repeated note and clears only the note it timed', () => {
    store().apply({ tabId: TAB, kind: 'note', note: 'topOfPage' })
    const first = tab().noteSeq
    store().showNote(TAB, 'topOfPage')
    store().clearNote(TAB, first)
    expect(tab().note).toBe('topOfPage')
    store().clearNote(TAB, tab().noteSeq)
    expect(tab().note).toBeNull()
    const cleared = store().byTab
    store().clearNote(TAB, tab().noteSeq)
    store().clearNote('browser-tab-9', 1)
    expect(store().byTab).toBe(cleared)
  })

  it('drops only the capture it names, and forgets a tab', () => {
    store().apply(captured)
    store().dropCapture(TAB, 'b'.repeat(32))
    expect(tab().capture).not.toBeNull()
    store().dropCapture(TAB, CAPTURE)
    expect(tab().capture).toBeNull()
    store().forget(TAB)
    expect(store().byTab.has(TAB)).toBe(false)
    const empty = store().byTab
    store().forget(TAB)
    expect(store().byTab).toBe(empty)
  })
})
