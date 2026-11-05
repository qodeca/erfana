// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The real TerminalPanel header through the "More actions" menu (#451).
 *
 * #451: dragged narrow, the terminal's toolbar lost its buttons – Maximize
 * among them – so the terminal could not be expanded. These tests render the
 * actual panel (not a synthetic action list) and narrow its header row:
 * - Maximize terminal is raised (`moveLast`): it is the last button to move;
 * - once it has moved, running it from the menu expands the terminal and the
 *   item's aria-checked follows;
 * - Lock scroll is a toggle, the capture buttons carry busy / disabled state
 *   and a busy label into the menu, and Restart, Scroll to bottom and the
 *   captures run from the menu;
 * - a resize while the menu is open closes it and leaves focus on ….
 *
 * jsdom does no layout, so the header row's width, each button's width (24)
 * and the icon's (16) are stubbed; CSS is not loaded, so gaps, padding and the
 * title reserve read as 0 (as in ToolbarOverflow.test.tsx). Only the header
 * row's ResizeObserver is driven – the terminal's own observers never fire.
 * xterm and the preload bridge are mocked as in TerminalPanel.restart.test.tsx.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ISplitviewPanelProps } from 'dockview'
import { TEST_IDS } from '../../constants/testids'
import { TOOLBAR_OVERFLOW_TEST_IDS } from '../../constants/toolbarOverflowTestids'
import { MORE_ACTIONS_LABEL } from '../ToolbarOverflow/ToolbarOverflow'
import { useActivityBarStore } from '../../stores/useActivityBarStore'
import { useTerminalStore } from '../../stores/useTerminalStore'
import { useClaudeStatusStore } from '../../stores/useClaudeStatusStore'
import type { TerminalBridge } from '../../../../shared/ipc/terminal-schema'
import { gatewayBridgeMock, type BridgeMock } from '../../test-utils/gatewayBridgeMock'

const terminalMock = (): BridgeMock<TerminalBridge> => gatewayBridgeMock('terminal')
const screenshotMock = (): BridgeMock<Window['api']['screenshot']> => gatewayBridgeMock('screenshot')

const TERMINAL_ID = 'test-terminal-1'
const BTN = 24
const ICON = 16
/** Icon + 2 buttons + …: only Capture screen (leftmost) and the raised Maximize stay. */
const NARROW = ICON + 3 * BTN
/** Icon + … alone: every button has moved, Maximize included. */
const FLOOR = ICON + BTN

const mockXtermInstance = {
  cols: 80,
  rows: 24,
  buffer: { active: { viewportY: 0, baseY: 0 } },
  parser: { registerCsiHandler: vi.fn().mockReturnValue({ dispose: vi.fn() }) },
  open: vi.fn(),
  loadAddon: vi.fn(),
  dispose: vi.fn(),
  write: vi.fn(),
  clear: vi.fn(),
  focus: vi.fn(),
  scrollToBottom: vi.fn(),
  onData: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  attachCustomKeyEventHandler: vi.fn(),
  attachCustomWheelEventHandler: vi.fn(),
  hasSelection: vi.fn().mockReturnValue(false),
  getSelection: vi.fn().mockReturnValue(''),
  clearSelection: vi.fn(),
  onSelectionChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  paste: vi.fn()
}

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn().mockImplementation(function () { return mockXtermInstance })
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(function () { return ({ fit: vi.fn() }) })
}))

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: vi.fn().mockImplementation(function () { return ({}) })
}))

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: vi.fn().mockImplementation(function () { return ({ onContextLoss: vi.fn(), dispose: vi.fn() }) })
}))

vi.mock('../../utils/domUtils', () => ({
  isElementVisible: vi.fn().mockReturnValue(true)
}))

function installApi(): void {
  ;(window as any).api = {
    terminal: {
      isAvailable: vi.fn().mockResolvedValue({ success: true, available: true }),
      create: vi.fn().mockResolvedValue({ success: true, terminalId: TERMINAL_ID, shellKind: 'posix' }),
      write: vi.fn().mockResolvedValue(undefined),
      resize: vi.fn(),
      kill: vi.fn().mockResolvedValue({ success: true }),
      onData: vi.fn().mockReturnValue(vi.fn()),
      onExit: vi.fn().mockReturnValue(vi.fn()),
      onError: vi.fn().mockReturnValue(vi.fn()),
      onClear: vi.fn().mockReturnValue(vi.fn()),
      markClearComplete: vi.fn(),
      ackOutput: vi.fn()
    },
    file: {
      getProjectPath: vi.fn().mockResolvedValue('/test/project'),
      onProjectChanged: vi.fn().mockReturnValue(vi.fn())
    },
    utils: {
      getPathForFile: vi.fn(),
      getPlatform: vi.fn().mockReturnValue('linux')
    },
    screenshot: {
      getDisplays: vi.fn().mockResolvedValue({ displays: [] }),
      enumerateWindows: vi.fn().mockResolvedValue({ sources: [], truncated: false, availability: 'native-picker' }),
      capture: vi.fn().mockResolvedValue({ success: false, errorCode: 'SCREENSHOT_CANCELLED' }),
      getCapabilities: vi.fn().mockResolvedValue({
        supported: true,
        hasNativeWindowPicker: true,
        areaCaptureMode: 'native'
      })
    }
  }
}

let rowWidth = 500
let rowObservers: Array<() => void> = []

/** Stand-in for a splitter drag: the header row's own ResizeObserver fires. */
function resizeTo(width: number): void {
  rowWidth = width
  act(() => rowObservers.forEach((callback) => callback()))
}

function header(): HTMLElement {
  return screen.getByTestId(TEST_IDS.TERMINAL_PANEL).querySelector('.erf-toolbar-overflow') as HTMLElement
}

function more(): HTMLElement {
  return within(header()).getByRole('button', { name: MORE_ACTIONS_LABEL })
}

function openMenu(): HTMLElement {
  fireEvent.click(more())
  return screen.getByRole('menu', { name: 'Terminal actions' })
}

function item(name: string): HTMLElement {
  const menu = screen.getByRole('menu')
  return within(menu).queryByRole('menuitemcheckbox', { name }) ?? within(menu).getByRole('menuitem', { name })
}

/** Render the panel and wait for its PTY and the capture buttons (capabilities are async). */
async function renderPanel(): Promise<void> {
  const { TerminalPanel } = await import('./TerminalPanel')
  render(<TerminalPanel {...({} as ISplitviewPanelProps)} />)
  await waitFor(() => expect(terminalMock().create).toHaveBeenCalled())
  await screen.findByTestId(TEST_IDS.TERMINAL_BTN_CAPTURE_SCREEN)
  await screen.findByTestId(TEST_IDS.TERMINAL_BTN_EXPAND)
}

describe('TerminalPanel header actions through the overflow menu (#451)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installApi()
    rowWidth = 500
    rowObservers = []
    useActivityBarStore.setState({ terminalExpanded: false })
    useTerminalStore.setState({ scrollLocked: false, activityById: new Map(), userInputById: new Map() })
    useClaudeStatusStore.getState().reset()
    const portalRoot = document.createElement('div')
    portalRoot.id = 'portal-root'
    document.body.appendChild(portalRoot)
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
        unobserve(): void {}
        disconnect(): void {}
      }
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    document.getElementById('portal-root')?.remove()
  })

  describe('the action list', () => {
    it('shows all eight buttons in toolbar order while wide, with no …', async () => {
      await renderPanel()
      const ids = within(header())
        .getAllByRole('button')
        .map((button) => button.getAttribute('data-testid'))
      expect(ids).toEqual([
        TEST_IDS.TERMINAL_BTN_CAPTURE_SCREEN,
        TEST_IDS.TERMINAL_BTN_CAPTURE_WINDOW,
        TEST_IDS.TERMINAL_BTN_CAPTURE_AREA,
        TEST_IDS.TERMINAL_BTN_CAMERA,
        TEST_IDS.TERMINAL_BTN_SCROLL,
        TEST_IDS.TERMINAL_BTN_RESTART,
        TEST_IDS.TERMINAL_BTN_LOCK,
        TEST_IDS.TERMINAL_BTN_EXPAND
      ])
      expect(screen.queryByTestId(TOOLBAR_OVERFLOW_TEST_IDS.MORE)).toBeNull()
    })

    it('moves Maximize terminal last: at a narrow width it stays beside … while Lock scroll has moved', async () => {
      await renderPanel()
      resizeTo(NARROW)
      const row = within(header()).getAllByRole('button')
      expect(row.map((b) => b.getAttribute('data-testid'))).toEqual([
        TEST_IDS.TERMINAL_BTN_CAPTURE_SCREEN,
        TEST_IDS.TERMINAL_BTN_EXPAND,
        TOOLBAR_OVERFLOW_TEST_IDS.MORE
      ])
      openMenu()
      expect(item('Lock scroll to bottom')).toBeInTheDocument()
      expect(within(screen.getByRole('menu')).queryByRole('menuitemcheckbox', { name: 'Maximize terminal' })).toBeNull()
    })

    it('marks Lock scroll a toggle: aria-pressed in the row, a checked item in the menu', async () => {
      await renderPanel()
      const lock = screen.getByTestId(TEST_IDS.TERMINAL_BTN_LOCK)
      expect(lock).toHaveAttribute('aria-pressed', 'false')
      act(() => useTerminalStore.getState().setScrollLocked(true))
      expect(lock).toHaveAttribute('aria-pressed', 'true')
      resizeTo(NARROW)
      openMenu()
      expect(item('Lock scroll to bottom')).toHaveAttribute('role', 'menuitemcheckbox')
      expect(item('Lock scroll to bottom')).toHaveAttribute('aria-checked', 'true')
    })
  })

  describe('Maximize terminal from the menu', () => {
    it('expands the terminal, and the item’s aria-checked follows', async () => {
      await renderPanel()
      resizeTo(FLOOR)
      expect(screen.queryByTestId(TEST_IDS.TERMINAL_BTN_EXPAND)).toBeNull()

      openMenu()
      const maximize = item('Maximize terminal')
      expect(maximize).toHaveAttribute('role', 'menuitemcheckbox')
      expect(maximize).toHaveAttribute('aria-checked', 'false')
      expect(maximize.querySelector('.lucide-maximize-2')).not.toBeNull()
      expect(maximize.querySelector('.context-menu-shortcut')).toHaveTextContent('Ctrl+Shift+M')

      fireEvent.click(maximize)
      expect(useActivityBarStore.getState().terminalExpanded).toBe(true)
      expect(screen.queryByRole('menu')).toBeNull()
      expect(more()).toHaveFocus()

      openMenu()
      expect(item('Maximize terminal')).toHaveAttribute('aria-checked', 'true')
      expect(item('Maximize terminal').querySelector('.lucide-minimize-2')).not.toBeNull()
    })

    it('restores the terminal from the keyboard: ↑ on … opens on Maximize, Enter runs it', async () => {
      useActivityBarStore.setState({ terminalExpanded: true })
      await renderPanel()
      resizeTo(FLOOR)
      more().focus()
      fireEvent.keyDown(more(), { key: 'ArrowUp' })
      const maximize = item('Maximize terminal')
      expect(maximize).toHaveFocus()
      expect(maximize).toHaveAttribute('aria-checked', 'true')
      fireEvent.keyDown(maximize, { key: 'Enter' })
      expect(useActivityBarStore.getState().terminalExpanded).toBe(false)
      expect(more()).toHaveFocus()
    })
  })

  describe('the other actions from the menu', () => {
    it('Restart terminal kills and recreates the PTY', async () => {
      await renderPanel()
      resizeTo(FLOOR)
      openMenu()
      fireEvent.click(item('Restart terminal'))
      await waitFor(() => expect(terminalMock().kill).toHaveBeenCalledWith(TERMINAL_ID))
      await waitFor(() => expect(terminalMock().create).toHaveBeenCalledTimes(2))
    })

    it('Scroll to bottom scrolls the terminal', async () => {
      await renderPanel()
      resizeTo(FLOOR)
      openMenu()
      fireEvent.click(item('Scroll to bottom'))
      expect(mockXtermInstance.scrollToBottom).toHaveBeenCalledTimes(1)
    })

    it('Lock scroll toggles the lock and the item’s aria-checked', async () => {
      await renderPanel()
      resizeTo(FLOOR)
      openMenu()
      fireEvent.click(item('Lock scroll to bottom'))
      expect(useTerminalStore.getState().scrollLocked).toBe(true)
      openMenu()
      expect(item('Lock scroll to bottom')).toHaveAttribute('aria-checked', 'true')
    })

    it.each([
      ['Capture screen', { mode: 'screen', displayId: undefined }],
      ['Capture window', { mode: 'window-native' }],
      ['Capture area', { mode: 'area' }]
    ])('%s starts that capture', async (label, request) => {
      await renderPanel()
      resizeTo(FLOOR)
      openMenu()
      fireEvent.click(item(label))
      await waitFor(() => expect(screenshotMock().capture).toHaveBeenCalledWith(request))
    })
  })

  describe('a capture in progress', () => {
    it('marks its button busy and the others disabled, in the row and in the menu', async () => {
      let finish: (value: unknown) => void = () => undefined
      await renderPanel()
      screenshotMock().capture.mockReturnValue(new Promise((resolve) => { finish = resolve }))

      fireEvent.click(screen.getByTestId(TEST_IDS.TERMINAL_BTN_CAPTURE_AREA))
      const area = await screen.findByRole('button', { name: 'Capturing area, please wait' })
      expect(area).toHaveAttribute('aria-busy', 'true')
      expect(area).toHaveAttribute('aria-disabled', 'true')
      // Busy keeps focus (Buttons card): not natively disabled, so focus is not dropped
      expect(area).not.toBeDisabled()
      area.focus()
      expect(area).toHaveFocus()
      expect(screen.getByTestId(TEST_IDS.TERMINAL_BTN_CAPTURE_SCREEN)).toBeDisabled()
      expect(screen.getByTestId(TEST_IDS.TERMINAL_BTN_CAPTURE_WINDOW)).toBeDisabled()

      resizeTo(FLOOR)
      openMenu()
      const busy = item('Capturing area…')
      expect(busy).toHaveAttribute('aria-disabled', 'true')
      expect(item('Capture screen')).toHaveAttribute('aria-disabled', 'true')
      expect(item('Capture window')).toHaveAttribute('aria-disabled', 'true')
      fireEvent.click(busy)
      expect(screenshotMock().capture).toHaveBeenCalledTimes(1)
      expect(screen.getByRole('menu')).toBeInTheDocument()

      await act(async () => finish({ success: false, errorCode: 'SCREENSHOT_CANCELLED' }))
      fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })
      openMenu()
      expect(item('Capture area')).not.toHaveAttribute('aria-disabled', 'true')
    })
  })

  it('closes an open menu when the header resizes and leaves focus on …', async () => {
    await renderPanel()
    resizeTo(FLOOR)
    more().focus()
    fireEvent.keyDown(more(), { key: 'ArrowDown' })
    expect(screen.getByRole('menu')).toContainElement(document.activeElement as HTMLElement)
    resizeTo(FLOOR + 1)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(more()).toHaveFocus()
  })
})
