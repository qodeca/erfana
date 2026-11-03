// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useBrowserPickStore, type PickSummary } from '../../../stores/useBrowserPickStore'
import { PickAnnouncer } from './PickAnnouncer'
import { BROWSER_TEST_IDS } from './browserTestIds'

const TAB = 'browser-tab-1'
const CAPTURE = 'a'.repeat(32)
const SUMMARY: PickSummary = {
  name: 'button.cta',
  size: '176 × 32',
  ancestors: ['html', 'body', 'button.cta'],
  box: { x: 0, y: 0, width: 176, height: 32 },
  atTop: false,
  atStart: true,
  gone: false,
  changedAfterPick: false
}

const region = () => screen.getByTestId(BROWSER_TEST_IDS.PICK_ANNOUNCER)
const apply = (event: Parameters<ReturnType<typeof useBrowserPickStore.getState>['apply']>[0], now?: number): void =>
  act(() => useBrowserPickStore.getState().apply(event, now))

describe('PickAnnouncer (design § Announcements, M-45)', () => {
  afterEach(() => {
    useBrowserPickStore.getState().forget(TAB)
  })

  it('is one always-mounted, visually hidden polite region, empty at rest – even with no tab yet', () => {
    render(<PickAnnouncer tabId={null} sent={null} />)
    expect(region()).toHaveAttribute('aria-live', 'polite')
    expect(region()).toHaveClass('erf-brw-hidden')
    expect(region()).toHaveTextContent('')
  })

  it('says pick mode on and off, and never the hover label', () => {
    render(<PickAnnouncer tabId={TAB} sent={null} />)
    apply({ tabId: TAB, kind: 'mode', on: true })
    expect(region()).toHaveTextContent('Picking. Esc to stop.')
    apply({ tabId: TAB, kind: 'highlight', label: 'a.link · 40 × 12' })
    expect(region()).toHaveTextContent('Picking. Esc to stop.')
    expect(region()).not.toHaveTextContent('a.link')
    apply({ tabId: TAB, kind: 'mode', on: false })
    expect(region()).toHaveTextContent('Picking stopped.')
  })

  it('says each refinement and the pause once', () => {
    render(<PickAnnouncer tabId={TAB} sent={null} />)
    apply({ tabId: TAB, kind: 'mode', on: true })
    apply({ tabId: TAB, kind: 'captured', captureId: CAPTURE, still: new Uint8Array(4), stillWidth: 1, stillHeight: 1, summary: SUMMARY })
    apply({ tabId: TAB, kind: 'refined', captureId: CAPTURE, summary: { ...SUMMARY, name: 'div.card', size: '320 × 200', ancestors: ['html', 'body'] } }, 10)
    expect(region()).toHaveTextContent('Picked div.card, 320 by 200.')
    apply({ tabId: TAB, kind: 'frozen', captureId: CAPTURE })
    expect(region()).toHaveTextContent('Page paused.')
  })

  it('says the send with its fallback, and re-announces a repeated sentence as a new node', () => {
    const { rerender } = render(<PickAnnouncer tabId={TAB} sent={null} />)
    rerender(<PickAnnouncer tabId={TAB} sent="Sent Explain to Terminal" />)
    expect(region()).toHaveTextContent('Sent Explain to Terminal. Show terminal and Open capture are also in the target menu.')
    const first = region().firstElementChild
    rerender(<PickAnnouncer tabId={TAB} sent={null} />)
    rerender(<PickAnnouncer tabId={TAB} sent="Sent Explain to Terminal" />)
    expect(region().firstElementChild).not.toBe(first)
    expect(region()).toHaveTextContent('Sent Explain to Terminal. Show terminal and Open capture are also in the target menu.')
  })
})
