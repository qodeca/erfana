// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../utils/platform', () => ({ isMacOS: () => true, isWindows: () => false }))

import { IDLE_PICK, type PickSummary } from '../../../stores/useBrowserPickStore'
import { PickSurface } from './PickSurface'
import type { BrowserPick } from './useBrowserPick'
import { BROWSER_TEST_IDS } from './browserTestIds'

const SUMMARY: PickSummary = {
  name: 'button.cta',
  size: '176 × 32',
  ancestors: ['html', 'button.cta'],
  box: { x: 10, y: 20, width: 176, height: 32 },
  atTop: false,
  atStart: true,
  gone: false,
  changedAfterPick: false
}

function pick(overrides: Partial<BrowserPick> = {}): BrowserPick {
  return {
    tab: { ...IDLE_PICK, on: true, note: 'topOfPage', capture: { captureId: 'a'.repeat(32), summary: SUMMARY, changedAt: null, afterNavigation: false } },
    surface: 'panel',
    dialogAction: null,
    returnAction: undefined,
    draft: '',
    busy: null,
    banner: null,
    notice: null,
    lastCapture: null,
    togglePick: vi.fn(),
    close: vi.fn(),
    refine: vi.fn(),
    openDialog: vi.fn(),
    back: vi.fn(),
    setDraft: vi.fn(),
    send: vi.fn(),
    bannerAction: vi.fn(),
    targetChosenAgain: vi.fn(),
    showTerminal: vi.fn(),
    openCapture: vi.fn(),
    dismissNotice: vi.fn(),
    ...overrides
  }
}

function renderIn(value: BrowserPick) {
  const area = document.createElement('div')
  Object.defineProperty(area, 'clientWidth', { value: 800 })
  Object.defineProperty(area, 'clientHeight', { value: 600 })
  document.body.appendChild(area)
  return render(<PickSurface pick={value} image={null} zoomPercent={100} target={<button type="button">Target</button>} />, { container: area })
}

describe('PickSurface', () => {
  it('renders nothing without a capture or a surface', () => {
    const { container } = renderIn(pick({ surface: 'none' }))
    expect(container).toBeEmptyDOMElement()
  })

  it('places the panel next to the outline with the store note, and closes on Esc', () => {
    const value = pick()
    renderIn(value)
    const panel = screen.getByTestId(BROWSER_TEST_IDS.PROMPT_ACTIONS)
    expect(panel.style.visibility).toBe('')
    expect(screen.getByRole('button', { name: 'Explain' })).toHaveFocus()
    expect(panel.style.left).toBe('10px')
    expect(screen.getByRole('status')).toHaveTextContent('Top of the page')
    fireEvent.keyDown(panel, { key: 'Escape' })
    expect(value.close).toHaveBeenCalledWith('esc')
    fireEvent.keyDown(panel, { key: 'ArrowUp' })
    expect(value.refine).toHaveBeenCalledWith('parent')
  })

  it('shows the dialog for a dialog action, and wires send, cancel and back', () => {
    const value = pick({ surface: 'dialog', dialogAction: 'change', draft: 'Blue' })
    renderIn(value)
    expect(screen.getByTestId(BROWSER_TEST_IDS.INSTRUCTION_DIALOG)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(value.send).toHaveBeenCalledWith('change')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(value.close).toHaveBeenCalledWith('cancel')
    fireEvent.click(screen.getByRole('button', { name: 'Back to actions' }))
    expect(value.back).toHaveBeenCalledOnce()
  })
})
