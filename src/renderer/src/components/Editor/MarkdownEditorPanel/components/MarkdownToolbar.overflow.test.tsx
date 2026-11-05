// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * MarkdownToolbar in a narrow panel (#461): buttons that do not fit move into
 * the "More actions" (…) menu, rightmost first, and every action stays
 * reachable; the comment tools, the modified dot and the live region never move.
 *
 * jsdom does no layout, so the row's width and each slot's width are stubbed
 * (as in ToolbarOverflow.test.tsx); CSS is not loaded, so gaps, padding and the
 * spacer's minimum read as 0. A stubbed ResizeObserver stands in for a splitter drag.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { MarkdownToolbar, type MarkdownToolbarProps } from './MarkdownToolbar'
import { MORE_ACTIONS_LABEL } from '../../../ToolbarOverflow/ToolbarOverflow'
import { TEST_IDS } from '../../../../constants/testids'
import type { MonacoEditorHandle } from '../../MonacoMarkdownEditor'

vi.mock('../../../../stores/useSearchStore', () => ({
  useSearchStore: { getState: () => ({ openSearch: vi.fn() }) }
}))
vi.mock('../../../../utils/selectionHelpers', () => ({ getSelectedText: vi.fn(() => undefined) }))

const BTN = 32
const COMMENT_TOOLS = 64

let rowWidth = 2000
let resizeCallbacks: Array<() => void> = []

function widthOf(element: Element): number {
  if (!element.hasAttribute('data-overflow-id')) {
    return element.classList.contains('erf-toolbar-overflow__more') ? BTN : 0
  }
  const kind = element.getAttribute('data-overflow-kind')
  if (kind === 'spacer') return 0
  if (kind === 'pinned') return element.getAttribute('data-overflow-id') === 'comment-tools' ? COMMENT_TOOLS : 0
  return BTN
}

function resizeTo(width: number): void {
  rowWidth = width
  act(() => resizeCallbacks.forEach((callback) => callback()))
}

const FORMATTING_IDS = [
  TEST_IDS.TOOLBAR_BTN_BOLD,
  TEST_IDS.TOOLBAR_BTN_ITALIC,
  TEST_IDS.TOOLBAR_BTN_STRIKETHROUGH,
  TEST_IDS.TOOLBAR_BTN_CODE,
  TEST_IDS.TOOLBAR_BTN_LINK,
  TEST_IDS.TOOLBAR_BTN_IMAGE,
  TEST_IDS.TOOLBAR_BTN_HEADING,
  TEST_IDS.TOOLBAR_BTN_LIST,
  TEST_IDS.TOOLBAR_BTN_LIST_ORDERED
]
const TRAILING_IDS = [
  TEST_IDS.TOOLBAR_BTN_SEARCH,
  TEST_IDS.VIEW_MODE_BTN_EDITOR,
  TEST_IDS.VIEW_MODE_BTN_SPLIT_HORIZONTAL,
  TEST_IDS.VIEW_MODE_BTN_SPLIT,
  TEST_IDS.VIEW_MODE_BTN_PREVIEW,
  TEST_IDS.TOOLBAR_BTN_EXPORT_PDF,
  TEST_IDS.TOOLBAR_BTN_EXPORT_DOCX
]
const ALL_IDS = [...FORMATTING_IDS, ...TRAILING_IDS]

function editorRef(): React.RefObject<MonacoEditorHandle | null> {
  return {
    current: {
      formatBold: vi.fn(),
      formatItalic: vi.fn(),
      formatStrikethrough: vi.fn(),
      formatCode: vi.fn(),
      formatCodeBlock: vi.fn(),
      insertLink: vi.fn(),
      insertImage: vi.fn(),
      insertHeading: vi.fn(),
      insertList: vi.fn(),
      getEditor: vi.fn(),
      getScrollTop: vi.fn(),
      setScrollTop: vi.fn(),
      getTopForLineNumber: vi.fn(),
      setPositionAndReveal: vi.fn(),
      getMonaco: vi.fn(() => null)
    }
  }
}

function props(overrides: Partial<MarkdownToolbarProps> = {}): MarkdownToolbarProps {
  return {
    viewMode: 'split',
    currentFile: { path: '/test/file.md', content: '# Test', modified: false },
    editorRef: editorRef(),
    isAutoSaving: false,
    isReloading: false,
    isExportingPdf: false,
    isExportingDocx: false,
    onViewModeChange: vi.fn(),
    onExportPdf: vi.fn(),
    onExportDocx: vi.fn(),
    ...overrides
  }
}

function toolbar(): HTMLElement {
  return screen.getByTestId(TEST_IDS.MARKDOWN_TOOLBAR)
}

function more(): HTMLElement {
  return within(toolbar()).getByRole('button', { name: MORE_ACTIONS_LABEL })
}

function openMenu(): HTMLElement {
  fireEvent.click(more())
  return screen.getByRole('menu')
}

/** How each action is reached: its row button, else its menu item, else not at all. */
function reachability(ids: readonly string[]): Record<string, 'row' | 'menu' | 'unreachable'> {
  const result: Record<string, 'row' | 'menu' | 'unreachable'> = {}
  const inRow = ids.filter((id) => within(toolbar()).queryByTestId(id) !== null)
  for (const id of inRow) result[id] = 'row'
  const rest = ids.filter((id) => !inRow.includes(id))
  if (rest.length === 0) return result
  const menu = openMenu()
  for (const id of rest) result[id] = within(menu).queryByTestId(`${id}-overflow-item`) ? 'menu' : 'unreachable'
  fireEvent.keyDown(menu, { key: 'Escape' })
  return result
}

describe('MarkdownToolbar overflow (#461)', () => {
  beforeEach(() => {
    rowWidth = 2000
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

  it('keeps every button in the row and shows no … while everything fits', () => {
    render(<MarkdownToolbar {...props()} />)
    resizeTo(2000)
    for (const id of ALL_IDS) expect(within(toolbar()).getByTestId(id)).toBeInTheDocument()
    expect(within(toolbar()).queryByRole('button', { name: MORE_ACTIONS_LABEL })).toBeNull()
  })

  it.each([6, 3, 1])('keeps every action reachable with room for %i buttons', (room) => {
    render(<MarkdownToolbar {...props()} />)
    resizeTo(room * BTN)
    const reach = reachability(ALL_IDS)
    expect(Object.entries(reach).filter(([, how]) => how === 'unreachable')).toEqual([])
    expect(Object.values(reach)).toContain('menu')
  })

  it('moves the rightmost first: exports, then view modes, then Find, keeping a run from the left', () => {
    render(<MarkdownToolbar {...props()} />)
    // Room for 12 buttons and …: Bold … Numbered list, Find and the editor mode stay.
    resizeTo(12 * BTN)
    for (const id of [...FORMATTING_IDS, TEST_IDS.TOOLBAR_BTN_SEARCH, TEST_IDS.VIEW_MODE_BTN_EDITOR]) {
      expect(within(toolbar()).getByTestId(id)).toBeInTheDocument()
    }
    for (const id of TRAILING_IDS.slice(2)) expect(within(toolbar()).queryByTestId(id)).toBeNull()
    const buttons = within(toolbar()).getAllByRole('button')
    expect(buttons[buttons.length - 1]).toBe(more())
  })

  it('lists moved items in toolbar order with a separator between groups, never first or last', () => {
    render(<MarkdownToolbar {...props()} />)
    // Room for the nine formatting buttons and …
    resizeTo(10 * BTN)
    const menu = openMenu()
    const entries = [...menu.children].map((child) =>
      child.getAttribute('role') === 'separator' ? '|' : child.getAttribute('data-testid')
    )
    expect(entries).toEqual([
      `${TEST_IDS.TOOLBAR_BTN_SEARCH}-overflow-item`,
      '|',
      `${TEST_IDS.VIEW_MODE_BTN_EDITOR}-overflow-item`,
      `${TEST_IDS.VIEW_MODE_BTN_SPLIT_HORIZONTAL}-overflow-item`,
      `${TEST_IDS.VIEW_MODE_BTN_SPLIT}-overflow-item`,
      `${TEST_IDS.VIEW_MODE_BTN_PREVIEW}-overflow-item`,
      '|',
      `${TEST_IDS.TOOLBAR_BTN_EXPORT_PDF}-overflow-item`,
      `${TEST_IDS.TOOLBAR_BTN_EXPORT_DOCX}-overflow-item`
    ])
  })

  it('takes a separator with its button: none leads the row or the menu', () => {
    render(<MarkdownToolbar {...props()} />)
    resizeTo(9 * BTN)
    // Code's separator stays in the row with Code; Find's left with Find.
    const separators = toolbar().querySelectorAll('.toolbar-separator')
    expect(separators).toHaveLength(2)
    expect(toolbar().querySelector('.erf-toolbar-overflow__actions')?.firstElementChild).not.toHaveClass(
      'toolbar-separator'
    )
  })

  it('shows the current view mode as the checked item; the row says it in aria-pressed', () => {
    const onViewModeChange = vi.fn()
    render(<MarkdownToolbar {...props({ viewMode: 'split', onViewModeChange })} />)
    expect(within(toolbar()).getByTestId(TEST_IDS.VIEW_MODE_BTN_SPLIT)).toHaveAttribute('aria-pressed', 'true')
    expect(within(toolbar()).getByTestId(TEST_IDS.VIEW_MODE_BTN_EDITOR)).toHaveAttribute('aria-pressed', 'false')
    resizeTo(6 * BTN)
    const menu = openMenu()
    const split = within(menu).getByTestId(`${TEST_IDS.VIEW_MODE_BTN_SPLIT}-overflow-item`)
    expect(split).toHaveAttribute('role', 'menuitemcheckbox')
    expect(split).toHaveAttribute('aria-checked', 'true')
    const preview = within(menu).getByTestId(`${TEST_IDS.VIEW_MODE_BTN_PREVIEW}-overflow-item`)
    expect(preview).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(preview)
    expect(onViewModeChange).toHaveBeenCalledWith('preview')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('keeps a disabled export reachable, with its reason, in the editor-only view', () => {
    const onExportPdf = vi.fn()
    render(<MarkdownToolbar {...props({ viewMode: 'editor', onExportPdf })} />)
    resizeTo(6 * BTN)
    const menu = openMenu()
    const pdf = within(menu).getByTestId(`${TEST_IDS.TOOLBAR_BTN_EXPORT_PDF}-overflow-item`)
    expect(pdf).toHaveAttribute('aria-disabled', 'true')
    expect(pdf).toHaveAccessibleDescription('Switch to preview or split mode')
    fireEvent.click(pdf)
    expect(onExportPdf).not.toHaveBeenCalled()
  })

  it('runs a formatting command from the menu, with its shortcut in the shortcut column', () => {
    const ref = editorRef()
    render(<MarkdownToolbar {...props({ editorRef: ref })} />)
    resizeTo(1)
    const menu = openMenu()
    const bold = within(menu).getByTestId(`${TEST_IDS.TOOLBAR_BTN_BOLD}-overflow-item`)
    expect(bold).toHaveAttribute('aria-keyshortcuts')
    fireEvent.click(bold)
    expect(ref.current?.formatBold).toHaveBeenCalledTimes(1)
  })

  it('never moves the comment tools, the modified dot or the live region', () => {
    render(
      <MarkdownToolbar
        {...props({
          viewMode: 'preview',
          isAutoSaving: true,
          currentFile: { path: '/test/file.md', content: '# Test', modified: true },
          commentTools: <button type="button" data-testid="comment-tools-stub">Comments</button>
        })}
      />
    )
    resizeTo(1)
    expect(within(toolbar()).getByTestId('comment-tools-stub')).toBeInTheDocument()
    expect(within(toolbar()).getByTestId(TEST_IDS.MODIFIED_INDICATOR)).toBeInTheDocument()
    const status = within(toolbar()).getByRole('status')
    expect(status).toContainElement(screen.getByTestId(TEST_IDS.AUTOSAVE_INDICATOR))
    // Every button has moved; only the pinned content and … are left.
    expect(within(toolbar()).queryByTestId(TEST_IDS.TOOLBAR_BTN_SEARCH)).toBeNull()
    const menu = openMenu()
    expect(within(menu).queryByText('Comments')).toBeNull()
  })

  it('keeps the live region mounted, and the same node, while buttons move', () => {
    render(<MarkdownToolbar {...props()} />)
    const before = within(toolbar()).getByRole('status')
    resizeTo(3 * BTN)
    expect(within(toolbar()).getByRole('status')).toBe(before)
    resizeTo(2000)
    expect(within(toolbar()).getByRole('status')).toBe(before)
  })

  it('counts the comment tools in the width: the buttons beside them give way', () => {
    render(
      <MarkdownToolbar
        {...props({ viewMode: 'preview', commentTools: <button type="button">Comments</button> })}
      />
    )
    // Find, the 4 modes and 2 exports (7 buttons) plus the tools would need 7 * 32 + 64.
    resizeTo(7 * BTN + COMMENT_TOOLS - 1)
    expect(more()).toBeInTheDocument()
    resizeTo(7 * BTN + COMMENT_TOOLS)
    expect(within(toolbar()).queryByRole('button', { name: MORE_ACTIONS_LABEL })).toBeNull()
  })
})
