// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../utils/platform', () => ({ isMacOS: () => true, isWindows: () => false }))

import { IDLE_PICK, useBrowserPickStore, type BrowserPickTab, type PickSummary } from '../../../stores/useBrowserPickStore'
import { PickRow, SEND_NOTICE_MS, type PickRowProps } from './PickRow'
import { BROWSER_TEST_IDS } from './browserTestIds'

const TAB = 'browser-tab-1'
const SUMMARY: PickSummary = {
  name: 'button.cta',
  size: '176 × 32',
  ancestors: ['html', 'button.cta'],
  box: { x: 0, y: 0, width: 1, height: 1 },
  atTop: false,
  atStart: true,
  gone: false,
  changedAfterPick: false
}
const HELD: BrowserPickTab = { ...IDLE_PICK, on: true, capture: { captureId: 'a'.repeat(32), summary: SUMMARY, changedAt: null, afterNavigation: false } }

function renderRow(overrides: Partial<PickRowProps> = {}) {
  const props: PickRowProps = {
    tabId: TAB,
    pick: IDLE_PICK,
    live: true,
    place: 'page',
    still: false,
    notice: null,
    onToggle: vi.fn(),
    onShowTerminal: vi.fn(),
    onOpenCapture: vi.fn(),
    onNoticeDone: vi.fn(),
    target: <button type="button">Target</button>,
    ...overrides
  }
  return { props, ...render(<PickRow {...props} />) }
}

const status = () => screen.getByTestId(BROWSER_TEST_IDS.PICK_STATUS)

describe('PickRow (025-FR-025, 025-FR-065)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    // The row reads the hover label from the store, so it hears this while still mounted.
    act(() => useBrowserPickStore.getState().forget(TAB))
  })

  it('is an F6 zone with Pick element, an empty status and the target', () => {
    const { props } = renderRow()
    expect(screen.getByRole('group', { name: 'Pick and send' })).toHaveAttribute('data-brw-zone', 'pick')
    const button = screen.getByRole('button', { name: 'Pick element' })
    expect(button).toHaveAttribute('aria-pressed', 'false')
    expect(button).toHaveAttribute('aria-keyshortcuts', 'Meta+E')
    // The tooltip's text is the button's description (shown on focus and hover by ToolbarTooltip), never a native title.
    expect(button).not.toHaveAttribute('title')
    expect(button.dataset.tip).toContain('press ⌘E again to pick what is under the mouse')
    expect(button).toHaveAccessibleDescription(/press ⌘E again to pick what is under the mouse/)
    // The visible slot has no live role: the tab's hidden region speaks (M-45).
    expect(status()).not.toHaveAttribute('aria-live')
    expect(status()).toBeEmptyDOMElement()
    fireEvent.click(button)
    expect(props.onToggle).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Target' })).toBeInTheDocument()
  })

  it('puts the width preset between the spacer and the target, and says when picking or a notice folds it', () => {
    const { rerender, props } = renderRow({ widthPreset: <button type="button">Page width: Full width</button> })
    const row = screen.getByTestId(BROWSER_TEST_IDS.PICK_ROW)
    const buttons = Array.from(row.querySelectorAll('button')).map(b => b.textContent)
    expect(buttons.slice(-2)).toEqual(['Page width: Full width', 'Target'])
    expect(row).not.toHaveAttribute('data-picking')
    expect(row).not.toHaveAttribute('data-notice')
    rerender(<PickRow {...props} pick={{ ...IDLE_PICK, on: true }} notice={{ text: 'Sent Explain to Terminal', contextPath: 'c.md' }} />)
    expect(row).toHaveAttribute('data-picking', 'true')
    expect(row).toHaveAttribute('data-notice', 'true')
  })

  it('marks data-surface while the panel or the dialog is open, so the width preset and target fold by CSS', () => {
    const { rerender, props } = renderRow({ pick: HELD, place: 'panel' })
    const row = screen.getByTestId(BROWSER_TEST_IDS.PICK_ROW)
    expect(row).not.toHaveAttribute('data-surface')
    rerender(<PickRow {...props} surface="panel" />)
    expect(row).toHaveAttribute('data-surface', 'panel')
    rerender(<PickRow {...props} surface="dialog" />)
    expect(row).toHaveAttribute('data-surface', 'dialog')
    rerender(<PickRow {...props} surface="none" />)
    expect(row).not.toHaveAttribute('data-surface')
  })

  it('draws the toolbar tooltip in its band, and holds the send notice while one shows', () => {
    const notice = { text: 'Sent Explain to Terminal', contextPath: 'c.md' }
    const { rerender, props } = renderRow({ notice, tooltip: <span role="tooltip">Reload (⌘R)</span>, tooltipOpen: true })
    expect(screen.getByTestId(BROWSER_TEST_IDS.PICK_ROW)).toContainElement(screen.getByRole('tooltip'))
    act(() => vi.advanceTimersByTime(SEND_NOTICE_MS * 2))
    expect(props.onNoticeDone).not.toHaveBeenCalled()
    rerender(<PickRow {...props} tooltip={null} tooltipOpen={false} />)
    act(() => vi.advanceTimersByTime(SEND_NOTICE_MS))
    expect(props.onNoticeDone).toHaveBeenCalledOnce()
  })

  it('marks Pick element unavailable without a live page', () => {
    renderRow({ live: false })
    const button = screen.getByRole('button', { name: 'Pick element' })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button.dataset.tip).toBe('Load a page to pick an element')
  })

  it('shows the banner for where focus is, and the hover label in place of its later clauses', () => {
    const { rerender, props } = renderRow({ pick: { ...IDLE_PICK, on: true } })
    expect(screen.getByRole('button', { name: 'Pick element' })).toHaveAttribute('aria-pressed', 'true')
    expect(status()).toHaveTextContent('Picking – click an elementEsc to stop⌘E picks under the mouse')
    // The hover label comes from the store, read by the row itself (performance review).
    act(() => useBrowserPickStore.getState().apply({ tabId: TAB, kind: 'highlight', label: 'a.link' }))
    expect(status()).toHaveTextContent('Picking – click an elementa.link')
    rerender(<PickRow {...props} pick={{ ...IDLE_PICK, on: true }} place="toolbar" />)
    expect(status()).toHaveTextContent('Picking – Esc returns to the page')
  })

  it('says Capturing… and the paused or still chip', () => {
    const { rerender, props } = renderRow({ pick: { ...IDLE_PICK, on: true, capturing: true } })
    expect(status()).toHaveTextContent('Capturing…')
    rerender(<PickRow {...props} pick={{ ...HELD, frozen: true }} place="panel" />)
    expect(status()).toHaveTextContent('Page paused')
    rerender(<PickRow {...props} pick={HELD} place="panel" still />)
    expect(status()).toHaveTextContent('Still image')
    // A static tag, never the interactive address chip.
    expect(screen.getByText('Still image')).toHaveClass('erf-brw-tag')
  })

  it('shows the waiting site requests beside the still chip while the menu or dialog is open (S-28)', () => {
    const { rerender, props } = renderRow({ pick: HELD, place: 'panel', still: true })
    expect(status()).not.toHaveTextContent('waiting')
    rerender(<PickRow {...props} pick={HELD} place="panel" still heldRequests={1} />)
    expect(status()).toHaveTextContent('Still image')
    expect(status()).toHaveTextContent('1 site request waiting')
    rerender(<PickRow {...props} pick={HELD} place="dialog" still heldRequests={3} />)
    expect(status()).toHaveTextContent('3 site requests waiting')
  })

  it('shows a note for its time, then clears it in the store', () => {
    act(() => useBrowserPickStore.getState().showNote(TAB, 'loadAPage'))
    const pick = useBrowserPickStore.getState().byTab.get(TAB) ?? IDLE_PICK
    renderRow({ pick })
    expect(status()).toHaveTextContent('Load a page to pick an element')
    act(() => vi.advanceTimersByTime(4000))
    expect(useBrowserPickStore.getState().byTab.get(TAB)?.note ?? null).toBeNull()
  })

  it('shows a note in place of the banner clauses while picking', () => {
    renderRow({ pick: { ...IDLE_PICK, on: true, note: 'topOfPage', noteSeq: 1 } })
    expect(status()).toHaveTextContent('Picking – click an elementTop of the page')
    expect(status()).not.toHaveTextContent('Esc to stop')
  })

  it('shows the send notice for 5 s, paused while hovered or focused, with its two actions', () => {
    const notice = { text: 'Sent Explain to Terminal', contextPath: '.erfana/browser/captures/c.md' }
    const { props } = renderRow({ notice })
    expect(status()).toHaveTextContent('Sent Explain to Terminal')
    const show = screen.getByRole('button', { name: 'Show terminal' })
    fireEvent.pointerEnter(show.parentElement as HTMLElement)
    act(() => vi.advanceTimersByTime(SEND_NOTICE_MS * 2))
    expect(props.onNoticeDone).not.toHaveBeenCalled()
    fireEvent.pointerLeave(show.parentElement as HTMLElement)
    fireEvent.focus(show)
    act(() => vi.advanceTimersByTime(SEND_NOTICE_MS * 2))
    expect(props.onNoticeDone).not.toHaveBeenCalled()
    fireEvent.blur(show)
    act(() => vi.advanceTimersByTime(SEND_NOTICE_MS))
    expect(props.onNoticeDone).toHaveBeenCalledOnce()
    fireEvent.click(show)
    expect(props.onShowTerminal).toHaveBeenCalledOnce()
  })

  it('after a pause, the send notice goes once the time left has run, not a fresh 5 s', () => {
    const notice = { text: 'Sent Explain to Terminal', contextPath: '.erfana/browser/captures/c.md' }
    const { props } = renderRow({ notice })
    const slot = screen.getByRole('button', { name: 'Show terminal' }).parentElement as HTMLElement
    act(() => vi.advanceTimersByTime(2000))
    fireEvent.pointerEnter(slot)
    act(() => vi.advanceTimersByTime(SEND_NOTICE_MS * 2))
    fireEvent.pointerLeave(slot)
    act(() => vi.advanceTimersByTime(SEND_NOTICE_MS - 2000 - 1))
    expect(props.onNoticeDone).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(props.onNoticeDone).toHaveBeenCalledOnce()
  })

  it('opens the terminal and the capture from the send notice', () => {
    const notice = { text: 'Sent Explain to Terminal', contextPath: '.erfana/browser/captures/c.md' }
    const { props } = renderRow({ notice })
    fireEvent.click(screen.getByRole('button', { name: 'Show terminal' }))
    expect(props.onShowTerminal).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Open capture' }))
    expect(props.onOpenCapture).toHaveBeenCalledWith('.erfana/browser/captures/c.md')
  })
})
