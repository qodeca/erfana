// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * MermaidToolbar on a narrow diagram (#461): direction buttons that do not fit
 * move into the "More actions" (…) menu, rightmost first, and every action
 * stays reachable; the directions are radio items, the current one checked (and disabled).
 *
 * jsdom does no layout, so the row's width and each button's width are stubbed
 * (as in ToolbarOverflow.test.tsx). A stubbed ResizeObserver stands in for the
 * diagram narrowing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { MermaidToolbar } from './MermaidToolbar'
import { MORE_ACTIONS_LABEL } from '../../ToolbarOverflow/ToolbarOverflow'
import { TEST_IDS } from '../../../constants/testids'

vi.mock('../../../utils/panelUtils', () => ({
  executePromptTemplate: vi.fn().mockResolvedValue({ success: true })
}))

import { executePromptTemplate } from '../../../utils/panelUtils'

const BTN = 28

let rowWidth = 1000
let resizeCallbacks: Array<() => void> = []

function widthOf(element: Element): number {
  if (element.hasAttribute('data-overflow-id')) return BTN
  return element.classList.contains('erf-toolbar-overflow__more') ? BTN : 0
}

function resizeTo(width: number): void {
  rowWidth = width
  act(() => resizeCallbacks.forEach((callback) => callback()))
}

const FLOWCHART = 'flowchart LR\n  A --> B'
const DIRECTION_IDS = ['TB', 'TD', 'BT', 'LR', 'RL'].map((d) => `${TEST_IDS.MERMAID_DIRECTION_BTN}-${d}`)
const ALL_IDS = [...DIRECTION_IDS, TEST_IDS.MERMAID_BTN_EXPAND]

function renderToolbar(onExpand = vi.fn()) {
  return render(
    <MermaidToolbar
      code={FLOWCHART}
      hasSvgContent={true}
      filePath="/project/doc.md"
      startLine={3}
      endLine={5}
      isLoading={false}
      onExpand={onExpand}
    />
  )
}

function toolbar(): HTMLElement {
  return screen.getByRole('toolbar', { name: 'Mermaid diagram toolbar' })
}

function more(): HTMLElement {
  return within(toolbar()).getByRole('button', { name: MORE_ACTIONS_LABEL })
}

function openMenu(): HTMLElement {
  fireEvent.click(more())
  return screen.getByRole('menu')
}

describe('MermaidToolbar overflow (#461)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rowWidth = 1000
    resizeCallbacks = []
    const portalRoot = document.createElement('div')
    portalRoot.id = 'portal-root'
    document.body.appendChild(portalRoot)
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('erf-toolbar-overflow') ? rowWidth : 0
    })
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const width = widthOf(this)
      return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: BTN, width, height: BTN, toJSON: () => ({}) } as DOMRect
    })
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resizeCallbacks.push(callback)
        }
        observe(): void {}
        disconnect(): void {}
      }
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('keeps every button in the group and shows no … while everything fits', () => {
    renderToolbar()
    resizeTo(1000)
    for (const id of ALL_IDS) expect(within(toolbar()).getByTestId(id)).toBeInTheDocument()
    expect(within(toolbar()).queryByRole('button', { name: MORE_ACTIONS_LABEL })).toBeNull()
  })

  it.each([4, 2, 1])('keeps every action reachable with room for %i buttons', (room) => {
    renderToolbar()
    resizeTo(room * BTN)
    const inRow = ALL_IDS.filter((id) => within(toolbar()).queryByTestId(id) !== null)
    const rest = ALL_IDS.filter((id) => !inRow.includes(id))
    expect(rest.length).toBeGreaterThan(0)
    const menu = openMenu()
    for (const id of rest) expect(within(menu).getByTestId(`${id}-overflow-item`)).toBeInTheDocument()
  })

  it('moves the rightmost first and keeps … inside the Layout direction group', () => {
    renderToolbar()
    resizeTo(4 * BTN)
    // TB, TD, BT stay; LR, RL and the fullscreen button move.
    for (const id of DIRECTION_IDS.slice(0, 3)) expect(within(toolbar()).getByTestId(id)).toBeInTheDocument()
    expect(within(toolbar()).queryByTestId(TEST_IDS.MERMAID_BTN_EXPAND)).toBeNull()
    const group = screen.getByRole('group', { name: /layout direction/i })
    expect(group).toHaveAttribute('data-testid', TEST_IDS.MERMAID_DIRECTIONS_GROUP)
    expect(group).toContainElement(more())
  })

  it('shows the directions as radio items, the current one checked and disabled, and runs another', async () => {
    renderToolbar()
    resizeTo(1)
    const menu = openMenu()
    const lr = within(menu).getByTestId(`${TEST_IDS.MERMAID_DIRECTION_BTN}-LR-overflow-item`)
    expect(lr).toHaveAttribute('role', 'menuitemradio')
    expect(lr).toHaveAttribute('aria-checked', 'true')
    expect(lr).toHaveAttribute('aria-disabled', 'true')
    expect(lr.querySelector('.context-menu-check svg')).not.toBeNull()
    const tb = within(menu).getByTestId(`${TEST_IDS.MERMAID_DIRECTION_BTN}-TB-overflow-item`)
    expect(tb).toHaveAccessibleName('Top to Bottom')
    expect(tb).toHaveAttribute('role', 'menuitemradio')
    expect(tb).toHaveAttribute('aria-checked', 'false')
    expect(tb.querySelector('.context-menu-check svg')).toBeNull()
    await act(async () => {
      fireEvent.click(tb)
    })
    expect(executePromptTemplate).toHaveBeenCalledWith(
      'change-mermaid-direction',
      expect.objectContaining({ targetDirection: 'TB', fileRef: '@/project/doc.md:3-5' })
    )
  })

  it('opens fullscreen from the menu', () => {
    const onExpand = vi.fn()
    renderToolbar(onExpand)
    resizeTo(1)
    fireEvent.click(within(openMenu()).getByTestId(`${TEST_IDS.MERMAID_BTN_EXPAND}-overflow-item`))
    expect(onExpand).toHaveBeenCalledTimes(1)
  })

  it('never trades a lone fullscreen button for … (a chart with no directions)', () => {
    render(<MermaidToolbar code={"pie\n  'Dogs': 386"} hasSvgContent={true} isLoading={false} onExpand={vi.fn()} />)
    resizeTo(1)
    expect(within(toolbar()).getByTestId(TEST_IDS.MERMAID_BTN_EXPAND)).toBeInTheDocument()
    expect(within(toolbar()).queryByRole('button', { name: MORE_ACTIONS_LABEL })).toBeNull()
  })
})
