// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ProjectTree.toolbar.test.tsx
 *
 * Covers the toolbar Import button (the wired in-component button), which the
 * extracted runToolbarImport unit test cannot reach:
 * - renders only when a project is open, positioned after New Folder / before Refresh
 * - idle: FileInput icon, enabled, accessible name "Import a file"
 * - importing: busy (aria-busy + aria-disabled, focus kept) + the busy ring
 * - the icon of each #452 control is pinned (Import, Import busy, All files, Markdown only),
 *   and the icon and tooltip of every other row button (unchanged by #452)
 * - the tooltips of Import (idle and busy) and both filter cells; the busy ring is aria-hidden
 *   (the checked cell's CSS cue is pinned in ProjectTree.fileFilter.css.test.ts)
 * - clicking invokes the import flow (proves onClick wiring)
 *
 * Render setup mirrors ProjectTree.switching.test.tsx (window.api mock +
 * DialogProvider + ProjectManagementProvider, project opened via onProjectChanged).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { ProjectTree } from './ProjectTree'
import { DialogProvider } from '../Dialog'
import { ProjectManagementProvider } from '../../context/ProjectManagementContext'
import { TEST_IDS } from '../../constants/testids'
import type { FileNode } from '../../../../preload/index'
import type { FilterMode } from '../../types/filters'
import { isMacOS } from '../../utils/platform'
import { installTreeViewport } from '../../test-utils/treeViewport'

// The tree is virtualised; give it a viewport so every fixture row is mounted.
installTreeViewport()

// Defaults to false: with no preload bridge the tree already resolved to a
// non-macOS platform here, so every other test keeps its old behaviour.
vi.mock('../../utils/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/platform')>()),
  isMacOS: vi.fn(() => false)
}))

const mockIsMacOS = vi.mocked(isMacOS)

// Controllable useImport mock (factory reads these lazily at call time)
const importState = { isImporting: false }
const mockImportFile = vi.fn(async () => null as string | null)
vi.mock('../../hooks/useImport', () => ({
  useImport: () => ({
    isImporting: importState.isImporting,
    importFile: mockImportFile,
    processFiles: vi.fn(async () => ({
      successCount: 0, failCount: 0, skippedCount: 0, outputPaths: [], failures: []
    }))
  })
}))

let onProjectChangedCallback: ((data: { newPath: string | null; oldPath: string | null }) => void) | null = null

const projFiles: FileNode[] = [
  { name: 'demo.md', path: '/proj/demo.md', type: 'file', extension: 'md' }
]

function setupMockApi() {
  const readDirectory = vi.fn(async () => projFiles)
  const getStatus = vi.fn(async () => ({
    isGitRepo: false,
    branch: null,
    isDetached: false,
    files: [],
    counts: { modified: 0, untracked: 0, deleted: 0, staged: 0, conflicted: 0 },
    truncated: false
  }))

  ;(window as any).api = {
    file: {
      readDirectory,
      onProjectChanged: (cb: any) => {
        onProjectChangedCallback = cb
        return () => {}
      },
      moveItem: vi.fn(async () => ({ path: '/moved' })),
      copyItem: vi.fn(async () => ({ path: '/copied' })),
      checkConflict: vi.fn(async () => false)
    },
    directoryWatch: {
      start: vi.fn(async () => ({ success: true })),
      stop: vi.fn(async () => ({ success: true })),
      onDirectoryChanged: () => () => {},
      onProjectDeleted: () => () => {},
      onDirectoryError: () => () => {}
    },
    gitWatcher: {
      start: vi.fn(async () => ({ success: true })),
      stop: vi.fn(async () => ({ success: true })),
      onStateChanged: () => () => {}
    },
    gitPolling: {
      start: vi.fn(async () => ({ success: true })),
      stop: vi.fn(async () => ({ success: true })),
      onPollTriggered: () => () => {}
    },
    git: { getStatus },
    logging: { log: vi.fn() }
  }

  return { readDirectory, getStatus }
}

interface RenderOptions {
  showControlPanel?: boolean
  filterMode?: FilterMode
  onFilterModeChange?: (mode: FilterMode) => void
}

function renderProjectTree({ showControlPanel = false, filterMode = 'all', onFilterModeChange = () => {} }: RenderOptions = {}) {
  return render(
    <DialogProvider>
      <ProjectManagementProvider>
        <ProjectTree
          onFileSelect={() => {}}
          showControlPanel={showControlPanel}
          filterMode={filterMode}
          onFilterModeChange={onFilterModeChange}
        />
      </ProjectManagementProvider>
    </DialogProvider>
  )
}

/** Render and drive the tree into a project-open state. */
async function renderWithProjectOpen(options: RenderOptions = {}) {
  setupMockApi()
  const view = renderProjectTree(options)
  await act(async () => {
    onProjectChangedCallback!({ newPath: '/proj', oldPath: null })
  })
  await waitFor(() => {
    expect(screen.getByText('demo.md')).toBeInTheDocument()
  })
  return view
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIsMacOS.mockReturnValue(false)
  onProjectChangedCallback = null
  importState.isImporting = false
  ;(window as any).api = undefined
})

describe('ProjectTree toolbar Import button', () => {
  it('is absent when no project is open', () => {
    setupMockApi()
    renderProjectTree()
    expect(screen.queryByTestId(TEST_IDS.PROJECT_TREE_BTN_IMPORT)).not.toBeInTheDocument()
  })

  it('renders after New Folder and before Refresh when a project is open', async () => {
    await renderWithProjectOpen()

    const importBtn = screen.getByTestId(TEST_IDS.PROJECT_TREE_BTN_IMPORT)
    expect(importBtn).toBeInTheDocument()

    // Order within the toolbar action group
    const actions = importBtn.closest('.project-tree-actions')!
    const order = [...actions.querySelectorAll('button')].map((b) => b.getAttribute('data-testid'))
    const folderIdx = order.indexOf(TEST_IDS.PROJECT_TREE_BTN_NEW_FOLDER)
    const importIdx = order.indexOf(TEST_IDS.PROJECT_TREE_BTN_IMPORT)
    const refreshIdx = order.indexOf(TEST_IDS.PROJECT_TREE_BTN_REFRESH)
    expect(folderIdx).toBeLessThan(importIdx)
    expect(importIdx).toBeLessThan(refreshIdx)
  })

  it('is enabled with the import accessible name when idle', async () => {
    await renderWithProjectOpen()

    const importBtn = screen.getByRole('button', { name: 'Import a file' })
    expect(importBtn).toBeEnabled()
    expect(importBtn.querySelector('.spin')).toBeNull()
  })

  it('is busy, keeps focus and ignores clicks while importing', async () => {
    importState.isImporting = true
    await renderWithProjectOpen()

    // aria-disabled, not disabled (Buttons card): focus is not dropped mid-import.
    const importBtn = screen.getByRole('button', { name: 'Importing file...' })
    expect(importBtn).toHaveAttribute('aria-busy', 'true')
    expect(importBtn).toHaveAttribute('aria-disabled', 'true')
    expect(importBtn).not.toBeDisabled()
    importBtn.focus()
    expect(importBtn).toHaveFocus()
    fireEvent.click(importBtn)
    expect(mockImportFile).not.toHaveBeenCalled()
  })

  it('invokes importFile when clicked', async () => {
    await renderWithProjectOpen()

    fireEvent.click(screen.getByTestId(TEST_IDS.PROJECT_TREE_BTN_IMPORT))
    expect(mockImportFile).toHaveBeenCalledTimes(1)
  })
})

describe('ProjectTree toolbar Refresh tooltip (#143)', () => {
  it('shows Ctrl+Alt+R, not ⌘ or "Cmd", on Windows', async () => {
    mockIsMacOS.mockReturnValue(false)
    await renderWithProjectOpen()

    const refresh = screen.getByTestId(TEST_IDS.PROJECT_TREE_BTN_REFRESH)
    expect(refresh).toHaveAttribute('title', 'Refresh (Ctrl+Alt+R)')
    expect(refresh.getAttribute('title')).not.toMatch(/[⌘⌥⇧⌃]|Cmd/)
  })

  it('shows ⌥⌘R on macOS', async () => {
    mockIsMacOS.mockReturnValue(true)
    await renderWithProjectOpen()

    expect(screen.getByTestId(TEST_IDS.PROJECT_TREE_BTN_REFRESH)).toHaveAttribute('title', 'Refresh (⌥⌘R)')
  })
})

/** The lucide glyph names inside `el` (lucide-react renders `class="lucide lucide-<name>"`). */
function lucideNames(el: HTMLElement): string[] {
  return [...el.querySelectorAll('svg')].flatMap(svg => [...svg.classList].filter(c => c.startsWith('lucide-')))
}

describe('ProjectTree toolbar icons (#452, docs/designs/project-tree/toolbar-icons.html)', () => {
  it('Import a file shows file-input, not file-up', async () => {
    await renderWithProjectOpen()

    expect(lucideNames(screen.getByRole('button', { name: 'Import a file' }))).toEqual(['lucide-file-input'])
  })

  it('Import while busy shows the busy ring, never the rotate-cw arrows of Refresh', async () => {
    importState.isImporting = true
    await renderWithProjectOpen()

    const importBtn = screen.getByTestId(TEST_IDS.PROJECT_TREE_BTN_IMPORT)
    expect(lucideNames(importBtn)).toEqual([])
    expect(importBtn.querySelector('.icon-btn__busy-ring')).not.toBeNull()
    // Refresh keeps its arrows.
    expect(lucideNames(screen.getByTestId(TEST_IDS.PROJECT_TREE_BTN_REFRESH))).toEqual(['lucide-rotate-cw'])
  })

  it('Show all files and folders shows folder-tree', async () => {
    await renderWithProjectOpen({ showControlPanel: true })

    expect(lucideNames(screen.getByRole('radio', { name: 'All files' }))).toEqual(['lucide-folder-tree'])
  })

  it('Show only Markdown files shows file-text', async () => {
    await renderWithProjectOpen({ showControlPanel: true })

    expect(lucideNames(screen.getByRole('radio', { name: 'Markdown only' }))).toEqual(['lucide-file-text'])
  })

  // #452 acceptance: "Other toolbar buttons are unchanged" – pinned on the rendered row.
  it.each([
    { testId: TEST_IDS.PROJECT_TREE_BTN_OPEN, icon: 'lucide-replace', title: 'Change project' },
    { testId: TEST_IDS.PROJECT_TREE_BTN_CLOSE, icon: 'lucide-x', title: 'Close project' },
    { testId: TEST_IDS.PROJECT_TREE_BTN_NEW_FILE, icon: 'lucide-file-plus', title: 'Create new markdown file' },
    { testId: TEST_IDS.PROJECT_TREE_BTN_NEW_FOLDER, icon: 'lucide-folder-plus', title: 'Create new folder' },
    { testId: TEST_IDS.PROJECT_TREE_BTN_REFRESH, icon: 'lucide-rotate-cw', title: 'Refresh (Ctrl+Alt+R)' }
  ])('the unchanged $title button keeps $icon', async ({ testId, icon, title }) => {
    await renderWithProjectOpen()

    const button = screen.getByTestId(testId)
    expect(lucideNames(button)).toEqual([icon])
    expect(button).toHaveAttribute('title', title)
  })

  it('with no project open, Open project keeps folder-open', () => {
    setupMockApi()
    renderProjectTree()

    const open = screen.getByTestId(TEST_IDS.PROJECT_TREE_BTN_OPEN)
    expect(lucideNames(open)).toEqual(['lucide-folder-open'])
    expect(open).toHaveAttribute('title', 'Open project')
  })
})

describe('ProjectTree toolbar tooltips and busy ring (#452)', () => {
  it('Import idle has the "Import a file" tooltip', async () => {
    await renderWithProjectOpen()

    expect(screen.getByTestId(TEST_IDS.PROJECT_TREE_BTN_IMPORT)).toHaveAttribute('title', 'Import a file')
  })

  it('Import busy has the busy tooltip, no glyph, and a ring hidden from assistive tech', async () => {
    importState.isImporting = true
    await renderWithProjectOpen()

    const importBtn = screen.getByTestId(TEST_IDS.PROJECT_TREE_BTN_IMPORT)
    expect(importBtn).toHaveAttribute('title', 'Importing file...')
    expect(importBtn.querySelector('svg')).toBeNull()
    expect(importBtn.querySelector('.icon-btn__busy-ring')).toHaveAttribute('aria-hidden', 'true')
  })

  it('each filter cell keeps its tooltip', async () => {
    await renderWithProjectOpen({ showControlPanel: true })

    expect(screen.getByRole('radio', { name: 'All files' })).toHaveAttribute('title', 'Show all files and folders')
    expect(screen.getByRole('radio', { name: 'Markdown only' }))
      .toHaveAttribute('title', 'Show only markdown files and their folders')
  })
})

describe('ProjectTree file filter choice (#452)', () => {
  it('is a radio group named "Show" with the active choice checked', async () => {
    await renderWithProjectOpen({ showControlPanel: true, filterMode: 'markdown' })

    expect(screen.getByRole('radiogroup', { name: 'Show' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Markdown only' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'All files' })).toHaveAttribute('aria-checked', 'false')
  })

  it('has one tab stop: the checked choice', async () => {
    await renderWithProjectOpen({ showControlPanel: true, filterMode: 'all' })

    expect(screen.getByRole('radio', { name: 'All files' })).toHaveAttribute('tabIndex', '0')
    expect(screen.getByRole('radio', { name: 'Markdown only' })).toHaveAttribute('tabIndex', '-1')
  })

  it('checks a choice on click and does not re-report the checked one', async () => {
    const onFilterModeChange = vi.fn()
    await renderWithProjectOpen({ showControlPanel: true, filterMode: 'all', onFilterModeChange })

    fireEvent.click(screen.getByRole('radio', { name: 'All files' }))
    expect(onFilterModeChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('radio', { name: 'Markdown only' }))
    expect(onFilterModeChange).toHaveBeenCalledWith('markdown')
  })

  it('moves and checks with the arrow keys, wrapping at both ends', async () => {
    const onFilterModeChange = vi.fn()
    await renderWithProjectOpen({ showControlPanel: true, filterMode: 'all', onFilterModeChange })

    const all = screen.getByRole('radio', { name: 'All files' })
    fireEvent.keyDown(all, { key: 'ArrowRight' })
    expect(onFilterModeChange).toHaveBeenLastCalledWith('markdown')
    expect(screen.getByRole('radio', { name: 'Markdown only' })).toHaveFocus()

    // Still "all" (the parent owns the state): Left wraps from the first choice to the last.
    fireEvent.keyDown(all, { key: 'ArrowLeft' })
    expect(onFilterModeChange).toHaveBeenLastCalledWith('markdown')

    fireEvent.keyDown(all, { key: 'Enter' })
    expect(onFilterModeChange).toHaveBeenCalledTimes(2)
  })

  it('is absent while the control panel is closed', async () => {
    await renderWithProjectOpen()

    expect(screen.queryByRole('radiogroup', { name: 'Show' })).not.toBeInTheDocument()
  })
})
