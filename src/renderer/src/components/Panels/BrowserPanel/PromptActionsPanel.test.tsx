// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HeldCapture, PickSummary } from '../../../stores/useBrowserPickStore'
import { CHANGED_MARK_MS, PromptActionsPanel, type PromptActionsPanelProps } from './PromptActionsPanel'

const SUMMARY: PickSummary = {
  name: 'button.cta',
  size: '176 × 32',
  ancestors: ['html', 'body', 'main', 'section', 'div', 'button.cta'],
  box: { x: 10, y: 20, width: 176, height: 32 },
  atTop: false,
  atStart: true,
  gone: false,
  changedAfterPick: false
}
const CAPTURE: HeldCapture = { captureId: 'a'.repeat(32), summary: SUMMARY, changedAt: null, afterNavigation: false }

function renderPanel(overrides: Partial<PromptActionsPanelProps> = {}) {
  const props: PromptActionsPanelProps = {
    capture: CAPTURE,
    frozen: false,
    note: null,
    banner: null,
    busy: null,
    onAction: vi.fn(),
    onRefine: vi.fn(),
    onClose: vi.fn(),
    onBannerAction: vi.fn(),
    target: <button type="button">Target</button>,
    sheet: false,
    ...overrides
  }
  const view = render(<PromptActionsPanel {...props} />)
  return { props, ...view }
}

/** A pointer press and its click, as a mouse makes them. */
function press(element: HTMLElement): void {
  fireEvent.pointerDown(element)
  fireEvent.click(element, { detail: 1 })
}

describe('PromptActionsPanel (025-FR-027, 025-FR-030)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('names the element, cuts the path from its start, and focuses Explain', () => {
    renderPanel()
    expect(screen.getByRole('dialog', { name: 'Actions for button.cta, 176 by 32' })).toHaveAttribute('aria-modal', 'false')
    const path = screen.getByRole('navigation', { name: 'Element path' })
    expect(path).toHaveTextContent('…body›main›section›div›button.cta · 176 × 32')
    expect(screen.getByRole('button', { name: 'Explain' })).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Child element' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: 'Parent element' })).not.toHaveAttribute('aria-disabled')
  })

  it('is named "Actions for {tag}, {size spoken}" and described by the target and the key hint (deck *Panel*)', () => {
    renderPanel()
    const panel = screen.getByRole('dialog', { name: 'Actions for button.cta, 176 by 32' })
    expect(panel).toHaveAccessibleDescription('Target ↑ ↓ parent and child · Tab next action · Esc closes the panel')
  })

  it('draws all four actions in the secondary look – Explain is not the filled primary (design § Prompt-actions panel)', () => {
    renderPanel()
    for (const name of ['Explain', 'Ask', 'Change', 'Prompt']) {
      expect(screen.getByRole('button', { name })).not.toHaveClass('erf-brw-actions__action--primary')
    }
  })

  it('shows the element\'s text and confirmed source once main has read them, and nothing before', () => {
    const { rerender, props } = renderPanel()
    expect(screen.queryByText('Text')).toBeNull()
    expect(screen.queryByText('Source')).toBeNull()
    const capture = { ...CAPTURE, summary: { ...SUMMARY, text: 'Save draft', source: 'src/Save.tsx:7' } }
    rerender(<PromptActionsPanel {...props} capture={capture} />)
    expect(screen.getByText('Text').nextElementSibling).toHaveTextContent('Save draft')
    expect(screen.getByText('Source').nextElementSibling).toHaveTextContent('src/Save.tsx:7')
    rerender(<PromptActionsPanel {...props} capture={{ ...CAPTURE, summary: { ...SUMMARY, source: 'src/A.tsx' } }} />)
    expect(screen.queryByText('Text')).toBeNull()
    expect(screen.getByText('Source').nextElementSibling).toHaveTextContent('src/A.tsx')
  })

  it('sends Explain on a pointer press and opens a dialog action', () => {
    const { props } = renderPanel()
    press(screen.getByRole('button', { name: 'Explain' }))
    expect(props.onAction).toHaveBeenCalledWith('explain')
    press(screen.getByRole('button', { name: 'Ask' }))
    expect(props.onAction).toHaveBeenCalledWith('ask')
  })

  it('acts on a fresh Enter only, never on a key that began before the panel or an auto-repeat', () => {
    const { props } = renderPanel()
    const explain = screen.getByRole('button', { name: 'Explain' })
    fireEvent.click(explain)
    expect(props.onAction).not.toHaveBeenCalled()
    fireEvent.keyDown(explain, { key: 'Enter', repeat: true })
    fireEvent.click(explain)
    expect(props.onAction).not.toHaveBeenCalled()
    fireEvent.keyDown(explain, { key: 'Enter' })
    fireEvent.click(explain)
    expect(props.onAction).toHaveBeenCalledWith('explain')
  })

  it('refines with the arrows, the stepper and a crumb, and closes on Esc and ×', () => {
    const { props } = renderPanel()
    const panel = screen.getByRole('dialog')
    fireEvent.keyDown(panel, { key: 'ArrowUp' })
    fireEvent.keyDown(panel, { key: 'ArrowDown' })
    fireEvent.click(screen.getByRole('button', { name: 'Parent element' }))
    fireEvent.click(screen.getByRole('button', { name: 'main' }))
    expect(vi.mocked(props.onRefine).mock.calls).toEqual([['parent'], ['child'], ['parent'], [{ ancestor: 2 }]])
    fireEvent.keyDown(panel, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Close – nothing is sent' }))
    expect(props.onClose).toHaveBeenCalledTimes(2)
  })

  it('cycles Tab through the actions, the banner button and the target, and wraps to the first action; × is not a Tab stop (025-FR-030)', () => {
    renderPanel({ banner: { kind: 'sendAnyway', text: 'Terminal is running npx – it may not be your agent. Send anyway?', action: 'sendAnyway' } })
    const panel = screen.getByRole('dialog')
    expect(screen.getByRole('button', { name: 'Close – nothing is sent' })).toHaveAttribute('tabindex', '-1')
    const order = ['Explain', 'Ask', 'Change', 'Prompt', 'Send anyway', 'Target']
    const at = (name: string) => screen.getByRole('button', { name })
    expect(at('Explain')).toHaveFocus()
    for (const name of [...order.slice(1), order[0]]) {
      fireEvent.keyDown(panel, { key: 'Tab' })
      expect(at(name)).toHaveFocus()
    }
    fireEvent.keyDown(panel, { key: 'Tab', shiftKey: true })
    expect(at('Target')).toHaveFocus()
    // Ctrl+Tab is the editor tabs' key: the panel leaves it alone.
    expect(fireEvent.keyDown(panel, { key: 'Tab', ctrlKey: true })).toBe(true)
    expect(at('Target')).toHaveFocus()
  })

  it('shows a guard as an alert, focuses its button and passes its answer on', () => {
    const { props } = renderPanel({ banner: { kind: 'guardShell', text: 'No agent is running in Terminal.', action: 'chooseTerminal' } })
    expect(screen.getByRole('alert')).toHaveTextContent('No agent is running in Terminal.')
    const button = screen.getByRole('button', { name: 'Choose terminal' })
    expect(button).toHaveFocus()
    // Focus lands on the button at once, so the button itself carries the reason.
    expect(button).toHaveAccessibleDescription('No agent is running in Terminal.')
    fireEvent.click(button)
    expect(props.onBannerAction).toHaveBeenCalledWith('chooseTerminal')
  })

  it('marks busy actions, the note, the paused page and a changed page', () => {
    renderPanel({ busy: 'explain', note: 'Top of the page', frozen: true, capture: { ...CAPTURE, summary: { ...SUMMARY, changedAfterPick: true } } })
    // While busy the name matches the visible label (WCAG 2.5.3), and × says why it does nothing.
    expect(screen.getByRole('button', { name: 'Sending…' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'Already sending – the prompt is in the terminal' })).toHaveAttribute('aria-disabled', 'true')
    const ask = screen.getByRole('button', { name: 'Ask' })
    expect(ask).toHaveAttribute('aria-disabled', 'true')
    // The dim is on the label span, never the button, so a focused one keeps a full ring (Permission band card).
    expect(ask.firstElementChild?.tagName).toBe('SPAN')
    expect(ask.firstElementChild).toHaveTextContent('Ask…')
    expect(screen.getByRole('status')).toHaveTextContent('Top of the page')
    // Static tags, not the interactive address chip (no hover, no pointer).
    expect(screen.getByText('Page paused')).toHaveClass('erf-brw-tag')
    expect(screen.getByText('The page changed after the pick')).toHaveClass('erf-brw-tag')
  })

  it('marks the chip as changed for a second after a refinement', () => {
    vi.useFakeTimers()
    renderPanel({ capture: { ...CAPTURE, changedAt: 50 } })
    const chip = screen.getByText('button.cta · 176 × 32')
    expect(chip).toHaveClass('erf-brw-actions__chip--changed')
    act(() => vi.advanceTimersByTime(CHANGED_MARK_MS))
    expect(chip).not.toHaveClass('erf-brw-actions__chip--changed')
  })
})
