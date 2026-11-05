// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * WelcomePanel.importIcon.test.tsx
 *
 * Pins the Welcome panel's Import button to the #452 pick: the same
 * `file-input` glyph as the project tree toolbar, never the old `file-up`
 * (docs/designs/project-tree/toolbar-icons.html § What the owner decided).
 *
 * Split from WelcomePanel.test.tsx (docs/windows/contributing.md § Test-file
 * split policy): that file mocks useImport at module scope with a fixed
 * `isImporting: false`, and this one needs the busy state controllable.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { WelcomePanel } from './WelcomePanel'
import { TEST_IDS } from '../../constants/testids'

const importState = { isImporting: false }
const mockContext = { projectPath: '/path/project-a' as string | null }

vi.mock('../../stores/useProjectStore', () => ({
  useProjectStore: (selector: (state: { isProjectChanging: boolean }) => boolean) =>
    selector({ isProjectChanging: false })
}))

vi.mock('../../context/ProjectManagementContext', () => ({
  useOpenProjectByPath: () => ({ handleOpenProjectByPath: vi.fn(), isSwitchingProject: false }),
  useProjectManagementContext: () => ({
    projectPath: mockContext.projectPath,
    handleOpenProject: vi.fn(),
    isSwitchingProject: false
  })
}))

vi.mock('../../hooks/useImport', () => ({
  useImport: () => ({ isImporting: importState.isImporting, importFile: vi.fn(async () => null) })
}))

vi.mock('../../components/Toast/toastService', () => ({ showGlobalToast: vi.fn() }))

const mockApi = {
  settings: {
    getRecentProjects: vi.fn(async () => ({ success: true, projects: [] })),
    removeRecentProject: vi.fn(async () => ({ success: true }))
  },
  file: { onProjectChanged: vi.fn(() => vi.fn()) }
}

const originalApi = (window as unknown as { api?: unknown }).api

const dockviewProps = { api: {} as never, containerApi: {} as never, params: {}, group: {} as never, title: 'Welcome' }

/** The lucide glyph names inside `el` (lucide-react renders `class="lucide lucide-<name>"`). */
function lucideNames(el: HTMLElement): string[] {
  return [...el.querySelectorAll('svg')].flatMap(svg => [...svg.classList].filter(c => c.startsWith('lucide-')))
}

async function renderWelcome(): Promise<void> {
  render(<WelcomePanel {...dockviewProps} />)
  // Let the recent-projects load settle so no state update lands after the test.
  await waitFor(() => expect(mockApi.settings.getRecentProjects).toHaveBeenCalled())
}

beforeEach(() => {
  vi.clearAllMocks()
  importState.isImporting = false
  mockContext.projectPath = '/path/project-a'
  ;(window as unknown as { api: typeof mockApi }).api = mockApi
})

afterEach(() => {
  ;(window as unknown as { api?: unknown }).api = originalApi
})

describe('WelcomePanel Import button icon (#452)', () => {
  it('shows file-input only, never file-up, when idle', async () => {
    await renderWelcome()

    const importBtn = screen.getByTestId(TEST_IDS.WELCOME_BTN_IMPORT)
    expect(lucideNames(importBtn)).toEqual(['lucide-file-input'])
    expect(importBtn).toHaveAttribute('title', 'Import a file')
    expect(importBtn).toHaveTextContent('Import...')
  })

  it('keeps file-input while importing, with the busy tooltip and text', async () => {
    importState.isImporting = true
    await renderWelcome()

    const importBtn = screen.getByTestId(TEST_IDS.WELCOME_BTN_IMPORT)
    expect(lucideNames(importBtn)).toEqual(['lucide-file-input'])
    expect(importBtn).toHaveAttribute('title', 'Importing file...')
    expect(importBtn).toHaveTextContent('Importing...')
    expect(importBtn).toBeDisabled()
  })

  it('is absent, with no stray import glyph, when no project is open', async () => {
    mockContext.projectPath = null
    await renderWelcome()

    expect(screen.queryByTestId(TEST_IDS.WELCOME_BTN_IMPORT)).not.toBeInTheDocument()
    expect(document.querySelector('.lucide-file-input, .lucide-file-up')).toBeNull()
  })
})
