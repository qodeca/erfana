// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The Project panel header at narrow widths (#451): its one button, File
 * filter, never trades itself for "More actions" (Toolbar overflow card,
 * rule 5) – the title and then the icon give way instead – and it keeps its
 * disclosure state (aria-expanded / aria-controls) at every width.
 *
 * jsdom does no layout, so the row's width, the button's (24) and the icon's
 * (16) are stubbed, as in ToolbarOverflow.test.tsx; a stubbed ResizeObserver
 * stands in for a splitter drag. The tree is stubbed as in ProjectPanel.test.tsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import type { ISplitviewPanelProps } from 'dockview'
import { ProjectPanel } from './ProjectPanel'
import { PROJECT_FILTER_PANEL_ID } from '../ProjectTree/constants'
import { MORE_ACTIONS_LABEL } from '../ToolbarOverflow/ToolbarOverflow'
import { TOOLBAR_OVERFLOW_TEST_IDS } from '../../constants/toolbarOverflowTestids'

const settings = vi.hoisted(() => ({
  getProjectFilterMode: vi.fn(async (): Promise<{ success: boolean; mode?: string }> => ({ success: true, mode: 'all' })),
  setProjectFilterMode: vi.fn(async () => ({ success: true }))
}))

vi.mock('../../services/settingsGateway', () => ({ settingsGateway: settings }))

vi.mock('../ProjectTree/ProjectTree', () => ({
  ProjectTree: (props: { showControlPanel: boolean }) => (
    <div data-testid="tree-stub" data-show-panel={String(props.showControlPanel)} />
  )
}))

const BTN = 24
const ICON = 16

let rowWidth = 500
let rowObservers: Array<() => void> = []

function resizeTo(width: number): void {
  rowWidth = width
  act(() => rowObservers.forEach((callback) => callback()))
}

function header(): HTMLElement {
  return document.querySelector('.project-panel .erf-toolbar-overflow') as HTMLElement
}

beforeEach(() => {
  vi.clearAllMocks()
  rowWidth = 500
  rowObservers = []
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('erf-toolbar-overflow') ? rowWidth : 0
  })
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    let width = 0
    if (this.classList.contains('erf-toolbar-overflow__slot')) width = BTN
    else if (this.classList.contains('erf-toolbar-overflow__more')) width = BTN
    else if (this.classList.contains('erf-toolbar-overflow__icon')) width = this.hasAttribute('hidden') ? 0 : ICON
    return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: BTN, width, height: BTN, toJSON: () => ({}) } as DOMRect
  })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private readonly callback: () => void) {}
      observe(target: Element): void {
        if (target.classList.contains('erf-toolbar-overflow')) rowObservers.push(this.callback)
      }
      disconnect(): void {}
    }
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function renderPanel(): Promise<HTMLElement> {
  render(<ProjectPanel {...({ params: {} } as unknown as ISplitviewPanelProps)} />)
  await waitFor(() => expect(settings.getProjectFilterMode).toHaveBeenCalled())
  // The title's reserve comes from CSS, which jsdom does not load.
  ;(header().querySelector('.erf-toolbar-overflow__title') as HTMLElement).style.minWidth = '32px'
  return screen.getByTestId(TOOLBAR_OVERFLOW_TEST_IDS.PROJECT_PANEL_BTN_FILTER)
}

describe('ProjectPanel header at narrow widths (#451)', () => {
  it.each([ICON + BTN, BTN, 1])('keeps File filter in the row and shows no … at %i px', async (width) => {
    await renderPanel()
    resizeTo(width)
    expect(screen.getByRole('button', { name: 'File filter' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: MORE_ACTIONS_LABEL })).toBeNull()
    expect(screen.queryByTestId(TOOLBAR_OVERFLOW_TEST_IDS.MORE)).toBeNull()
  })

  it('lets the title, then the icon, give way instead of the button', async () => {
    await renderPanel()
    const title = header().querySelector('.erf-toolbar-overflow__title')
    const icon = header().querySelector('.erf-toolbar-overflow__icon')
    expect(title).not.toHaveAttribute('hidden')
    resizeTo(ICON + BTN)
    expect(title).toHaveAttribute('hidden')
    expect(icon).not.toHaveAttribute('hidden')
    resizeTo(BTN)
    expect(icon).toHaveAttribute('hidden')
    resizeTo(500)
    expect(title).not.toHaveAttribute('hidden')
    expect(icon).not.toHaveAttribute('hidden')
  })

  it('keeps aria-expanded and aria-controls on the button at the floor, and still toggles the filter panel', async () => {
    const filter = await renderPanel()
    resizeTo(1)
    expect(filter).toHaveAttribute('aria-controls', PROJECT_FILTER_PANEL_ID)
    expect(filter).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(filter)
    expect(filter).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('tree-stub')).toHaveAttribute('data-show-panel', 'true')
  })
})
