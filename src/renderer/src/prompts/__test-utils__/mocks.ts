// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { vi, expect } from 'vitest'
import { useTerminalStore } from '../../stores/useTerminalStore'
import { useProjectStore } from '../../stores/useProjectStore'
import { useActivityBarStore } from '../../stores/useActivityBarStore'

/**
 * Factory function to create mock window.api object for testing
 * All methods return resolved Promises by default
 * @returns Mock window.api object with terminal and file methods
 */
export function createMockWindowApi() {
  return {
    terminal: {
      create: vi.fn().mockResolvedValue({ terminalId: 'mock-terminal-1' }),
      write: vi.fn().mockResolvedValue({ success: true }),
      resize: vi.fn().mockResolvedValue({ success: true }),
      kill: vi.fn().mockResolvedValue({ success: true }),
      getInfo: vi.fn().mockResolvedValue({
        terminalId: 'mock-terminal-1',
        cols: 80,
        rows: 24
      }),
      list: vi.fn().mockResolvedValue(['mock-terminal-1']),
      isAvailable: vi.fn().mockResolvedValue(true),
      markClearComplete: vi.fn()
    },
    file: {
      readFile: vi.fn().mockResolvedValue('# Test File\n\nFile content here'),
      writeFile: vi.fn().mockResolvedValue({ success: true }),
      createFile: vi.fn().mockResolvedValue({ success: true }),
      createFolder: vi.fn().mockResolvedValue({ success: true }),
      deleteFile: vi.fn().mockResolvedValue({ success: true }),
      deleteFolder: vi.fn().mockResolvedValue({ success: true }),
      rename: vi.fn().mockResolvedValue({ success: true }),
      moveItem: vi.fn().mockResolvedValue({ path: '/test/project/moved-item' }),
      copyItem: vi.fn().mockResolvedValue({ path: '/test/project/copied-item' }),
      readDirectory: vi.fn().mockResolvedValue({
        name: 'project',
        path: '/test/project',
        type: 'directory',
        children: []
      }),
      openProject: vi.fn().mockResolvedValue({ success: true }),
      closeProject: vi.fn().mockResolvedValue({ success: true })
    },
    settings: {
      getProjectFilterMode: vi.fn().mockResolvedValue('all'),
      setProjectFilterMode: vi.fn().mockResolvedValue({ success: true }),
      getDirectoryWatchDepth: vi.fn().mockResolvedValue(3),
      setDirectoryWatchDepth: vi.fn().mockResolvedValue({ success: true })
    },
    'file-watch': {
      start: vi.fn(),
      stop: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      getStats: vi.fn().mockResolvedValue({ watchedFiles: 0 })
    },
    'directory-watch': {
      start: vi.fn(),
      stop: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn()
    },
    on: vi.fn(),
    off: vi.fn()
  }
}

/**
 * Install mock window.api globally for tests
 * Call this in beforeEach to ensure clean state
 */
export function installMockWindowApi(): ReturnType<typeof createMockWindowApi> {
  const mockApi = createMockWindowApi()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).api = mockApi
  return mockApi
}

/**
 * Reset all Zustand stores to initial state
 * Call this in beforeEach to ensure clean state
 */
export function resetStores(): void {
  // Reset terminal store
  useTerminalStore.setState({
    activeTerminalId: null,
    activityById: new Map(),
    userInputById: new Map()
  })

  // Reset project store
  useProjectStore.setState({
    dockviewApi: null,
    editorPanelIds: new Set(),
    dirtyPanelIds: new Set()
  })

  // Reset activity bar store
  useActivityBarStore.setState({
    leftActivePanel: 'project',
    rightActivePanel: null,
    leftWidth: 300,
    rightWidth: 300
  })
}

/**
 * Create a mock DOM Selection object for testing text selection
 * @param text - Selected text
 * @param anchorNode - DOM node where selection starts
 * @param focusNode - DOM node where selection ends
 * @returns Mock Selection object
 */
export function mockDOMSelection(
  text: string = 'Selected text',
  anchorNode: Node | null = null,
  focusNode: Node | null = null
): Selection {
  const selection = {
    toString: vi.fn().mockReturnValue(text),
    anchorNode,
    focusNode,
    anchorOffset: 0,
    focusOffset: text.length,
    isCollapsed: text.length === 0,
    rangeCount: text.length > 0 ? 1 : 0,
    type: text.length > 0 ? 'Range' : 'None',
    getRangeAt: vi.fn().mockReturnValue({
      startContainer: anchorNode,
      endContainer: focusNode,
      startOffset: 0,
      endOffset: text.length,
      collapsed: text.length === 0,
      commonAncestorContainer: anchorNode
    }),
    removeAllRanges: vi.fn(),
    addRange: vi.fn(),
    collapse: vi.fn(),
    collapseToStart: vi.fn(),
    collapseToEnd: vi.fn(),
    extend: vi.fn(),
    selectAllChildren: vi.fn(),
    deleteFromDocument: vi.fn(),
    containsNode: vi.fn().mockReturnValue(true)
  } as unknown as Selection

  return selection
}

/**
 * Install mock window.getSelection for testing
 * @param text - Selected text to return
 * @returns Mock Selection object
 */
export function installMockSelection(text: string = 'Selected text'): Selection {
  const mockSelection = mockDOMSelection(text)
  window.getSelection = vi.fn().mockReturnValue(mockSelection)
  return mockSelection
}

/**
 * Create a mock DOM element with line number attributes
 * @param lineStart - Starting line number
 * @param lineEnd - Ending line number (optional)
 * @param tagName - HTML tag name
 * @returns Mock HTMLElement
 */
export function createMockElementWithLines(
  lineStart: number,
  lineEnd?: number,
  tagName: string = 'p'
): HTMLElement {
  const element = document.createElement(tagName)

  if (lineEnd && lineEnd !== lineStart) {
    element.setAttribute('data-line-start', String(lineStart))
    element.setAttribute('data-line-end', String(lineEnd))
  } else {
    element.setAttribute('data-line', String(lineStart))
  }

  element.textContent = 'Test content'
  return element
}

/**
 * Create a mock container with nested elements having line attributes
 * Useful for testing line number extraction from DOM
 * @returns Mock container element with child elements
 */
export function createMockLineContainer(): HTMLElement {
  const container = document.createElement('div')
  container.setAttribute('data-testid', 'markdown-preview')

  // Paragraph at line 5
  const p1 = createMockElementWithLines(5)
  p1.textContent = 'First paragraph'

  // Code block spanning lines 7-10
  const code = createMockElementWithLines(7, 10, 'pre')
  code.textContent = 'Code block content'

  // Paragraph at line 12
  const p2 = createMockElementWithLines(12)
  p2.textContent = 'Second paragraph'

  container.appendChild(p1)
  container.appendChild(code)
  container.appendChild(p2)

  return container
}

/**
 * Mock xterm Terminal instance
 * Use this to avoid canvas errors in jsdom
 */
export function createMockTerminal() {
  return {
    open: vi.fn(),
    write: vi.fn(),
    writeln: vi.fn(),
    clear: vi.fn(),
    reset: vi.fn(),
    focus: vi.fn(),
    blur: vi.fn(),
    scrollToBottom: vi.fn(),
    scrollToTop: vi.fn(),
    scrollLines: vi.fn(),
    scrollPages: vi.fn(),
    scrollToLine: vi.fn(),
    dispose: vi.fn(),
    loadAddon: vi.fn(),
    onData: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onKey: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onResize: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    cols: 80,
    rows: 24,
    buffer: {
      active: {
        baseY: 0,
        viewportY: 0,
        length: 24,
        cursorY: 0,
        cursorX: 0
      },
      normal: {
        baseY: 0,
        viewportY: 0,
        length: 24
      },
      alternate: {
        baseY: 0,
        viewportY: 0,
        length: 24
      }
    },
    textarea: document.createElement('textarea'),
    element: document.createElement('div')
  }
}

/**
 * Mock xterm FitAddon
 */
export function createMockFitAddon() {
  return {
    fit: vi.fn(),
    proposeDimensions: vi.fn().mockReturnValue({ cols: 80, rows: 24 }),
    dispose: vi.fn()
  }
}

/**
 * Mock xterm WebglAddon
 */
export function createMockWebglAddon() {
  return {
    onContextLoss: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    dispose: vi.fn(),
    clearTextureAtlas: vi.fn()
  }
}

/**
 * Setup complete test environment with all mocks
 * Call this in beforeEach for comprehensive test setup
 * @returns Object with all mock instances for assertions
 */
export function setupTestEnvironment() {
  const mockApi = installMockWindowApi()
  resetStores()

  return {
    mockApi,
    stores: {
      terminal: useTerminalStore,
      project: useProjectStore,
      activityBar: useActivityBarStore
    }
  }
}

/**
 * Teardown test environment
 * Call this in afterEach to clean up
 */
export function teardownTestEnvironment(): void {
  vi.clearAllMocks()
  resetStores()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).api
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).getSelection
}

/**
 * Utility to wait for next tick (useful for async assertions)
 */
export function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Utility to wait for specific amount of time
 * @param ms - Milliseconds to wait
 */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Assert that a mock function was called with specific arguments
 * Provides better error messages than vitest default
 * @param mockFn - Mock function to check
 * @param expectedArgs - Expected arguments
 * @param callIndex - Which call to check (default: 0)
 */
export function expectCalledWith(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockFn: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  expectedArgs: any[],
  callIndex: number = 0
): void {
  expect(mockFn).toHaveBeenCalled()
  const calls = mockFn.mock.calls
  expect(calls.length).toBeGreaterThan(callIndex)
  expect(calls[callIndex]).toEqual(expectedArgs)
}
