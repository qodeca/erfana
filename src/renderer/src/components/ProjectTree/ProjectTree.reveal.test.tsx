// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The project tree follows the active tab (#453), through the real tree.
 *
 * Switching to a file or preview tab opens the folders down to the file,
 * marks its row (`aria-current`, the lime underline of the Active file in the
 * tree card) and moves the tree's Tab stop there – without taking focus from
 * the editor. The setting turns it off; a file the filter hides, or one outside
 * the project, is not revealed; folders opened only by the reveal close on the
 * next switch, and folders the person opened or worked inside stay open.
 *
 * The editor area is a fake dockview API in the project store
 * (`test-utils/fakeDockview.ts`); the tree is mounted inside the real
 * project-management provider and opened through its project-changed bridge,
 * as `ProjectTree.expansion.test.tsx` does.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { ProjectTree } from './ProjectTree'
import { DialogProvider } from '../Dialog'
import { ProjectManagementProvider } from '../../context/ProjectManagementContext'
import type { FileNode } from '../../../../preload/index'
import type { FilterMode } from '../../types/filters'
import { installTreeViewport } from '../../test-utils/treeViewport'
import { createFakeDockview, type FakeDockview } from '../../test-utils/fakeDockview'
import { globalSettings } from '../../test-utils/globalSettings'
import { useProjectStore } from '../../stores/useProjectStore'
import { useGlobalSettingsStore } from '../../stores/useGlobalSettingsStore'

installTreeViewport()

const P = '/proj'
const DOCS = `${P}/docs`
const SRC = `${P}/src`
const SERVICES = `${P}/src/services`
const COMPONENTS = `${P}/src/components`
const ASSETS = `${P}/assets`
const README = `${P}/README.md`
const GUIDE = `${DOCS}/guide.md`
const TOAST = `${SERVICES}/toastService.ts`
const NOTES = `${SERVICES}/notes.md`
const LOGO = `${ASSETS}/logo.png`
const PAGE = `${P}/site/index.html`

function file(path: string, ext: string): FileNode {
  return { name: path.slice(path.lastIndexOf('/') + 1), path, type: 'file', extension: ext }
}

function folder(path: string, children: FileNode[]): FileNode {
  return { name: path.slice(path.lastIndexOf('/') + 1), path, type: 'directory', children }
}

function projectFiles(): FileNode[] {
  return [
    folder(ASSETS, [file(LOGO, '.png')]),
    folder(DOCS, [file(GUIDE, '.md')]),
    folder(`${P}/site`, [file(PAGE, '.html')]),
    folder(SRC, [
      folder(COMPONENTS, [file(`${COMPONENTS}/Toast.md`, '.md')]),
      folder(SERVICES, [file(NOTES, '.md'), file(TOAST, '.ts')])
    ]),
    file(README, '.md')
  ]
}

// --------------------------------------------------------------------------
// Bridge mocks (as in ProjectTree.expansion.test.tsx)
// --------------------------------------------------------------------------

let onProjectChanged: ((data: { newPath: string | null; oldPath: string | null }) => void) | null = null

function setupMockApi(): void {
  ;(window as unknown as { api: unknown }).api = {
    file: {
      readDirectory: vi.fn(async () => projectFiles()),
      onProjectChanged: vi.fn((cb: typeof onProjectChanged) => {
        onProjectChanged = cb
        return () => {}
      }),
      closeProject: vi.fn(async () => undefined),
      checkConflict: vi.fn(async () => false)
    },
    directoryWatch: {
      start: vi.fn(async () => ({ success: true })),
      stop: vi.fn(async () => ({ success: true })),
      pause: vi.fn(async () => ({ success: true })),
      resume: vi.fn(async () => ({ success: true })),
      onDirectoryChanged: () => () => {},
      onProjectDeleted: () => () => {},
      onDirectoryError: () => () => {}
    },
    gitWatcher: { start: vi.fn(async () => ({ success: true })), stop: vi.fn(async () => ({ success: true })), onStateChanged: () => () => {} },
    gitPolling: { start: vi.fn(async () => ({ success: true })), stop: vi.fn(async () => ({ success: true })), onPollTriggered: () => () => {} },
    git: {
      getStatus: vi.fn(async () => ({
        isGitRepo: false, branch: null, isDetached: false, files: [],
        counts: { modified: 0, untracked: 0, deleted: 0, staged: 0, conflicted: 0 }, truncated: false
      }))
    },
    import: { isSupported: vi.fn(async () => false) },
    logging: { log: vi.fn() }
  }
}

// --------------------------------------------------------------------------
// Harness
// --------------------------------------------------------------------------

let dock: FakeDockview

function Tree({ filterMode }: { filterMode: FilterMode }) {
  return <ProjectTree onFileSelect={vi.fn()} showControlPanel={false} filterMode={filterMode} onFilterModeChange={() => {}} />
}

/** Mount the tree with an editor stand-in that holds focus, and open the project. */
async function mountTree(filterMode: FilterMode = 'all') {
  const utils = render(
    <DialogProvider>
      <ProjectManagementProvider>
        <textarea aria-label="Editor" />
        <Tree filterMode={filterMode} />
      </ProjectManagementProvider>
    </DialogProvider>
  )
  await act(async () => onProjectChanged!({ newPath: P, oldPath: null }))
  await waitFor(() => expect(screen.getByText('README.md')).toBeInTheDocument())
  const editor = screen.getByRole('textbox', { name: 'Editor' })
  editor.focus()
  return { ...utils, editor }
}

function row(path: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[role="treeitem"][data-path="${path}"]`)
}

function isOpen(path: string): boolean {
  return row(path)?.getAttribute('aria-expanded') === 'true'
}

function markedRows(): string[] {
  return [...document.querySelectorAll<HTMLElement>('[role="treeitem"][aria-current="true"]')].map((r) => r.dataset.path!)
}

async function switchTo(filePath: string | null) {
  await act(async () => dock.activate(filePath))
}

/** A click on a folder row: what the person does to open or close it. */
async function clickFolder(path: string) {
  await act(async () => fireEvent.click(row(path)!))
}

beforeEach(() => {
  vi.clearAllMocks()
  onProjectChanged = null
  setupMockApi()
  dock = createFakeDockview()
  useProjectStore.setState({ dockviewApi: dock.api })
  useGlobalSettingsStore.setState({ settings: globalSettings() })
})

describe('ProjectTree follows the active tab (#453)', () => {
  it('opens the folders down to a file tab, marks its row and leaves focus in the editor', async () => {
    const { editor } = await mountTree()
    expect(isOpen(SRC)).toBe(false)

    await switchTo(TOAST)

    await waitFor(() => expect(markedRows()).toEqual([TOAST]))
    expect(isOpen(SRC)).toBe(true)
    expect(isOpen(SERVICES)).toBe(true)
    expect(document.activeElement).toBe(editor)
  })

  it('moves the tree’s one Tab stop to the revealed row, without focusing it', async () => {
    const { editor } = await mountTree()
    await switchTo(GUIDE)

    await waitFor(() => expect(row(GUIDE)).toHaveAttribute('tabindex', '0'))
    expect(document.querySelectorAll('[role="treeitem"][tabindex="0"]')).toHaveLength(1)
    expect(document.activeElement).toBe(editor)
  })

  it('follows a preview tab, including a move to another page inside it', async () => {
    await mountTree()
    await switchTo(PAGE)
    await waitFor(() => expect(markedRows()).toEqual([PAGE]))

    await act(async () => dock.movePage(GUIDE))
    await waitFor(() => expect(markedRows()).toEqual([GUIDE]))
  })

  it('does nothing when the setting is off, and reveals the active tab when it is turned on', async () => {
    useGlobalSettingsStore.setState({ settings: globalSettings({ projectTree: { followActiveTab: false } }) })
    await mountTree()
    await switchTo(TOAST)

    expect(markedRows()).toEqual([])
    expect(isOpen(SRC)).toBe(false)

    await act(async () =>
      useGlobalSettingsStore.setState({ settings: globalSettings({ projectTree: { followActiveTab: true } }) })
    )
    await waitFor(() => expect(markedRows()).toEqual([TOAST]))
    expect(isOpen(SERVICES)).toBe(true)
  })

  it('does nothing for a file the filter hides, and clears the previous mark', async () => {
    await mountTree('markdown')
    await switchTo(NOTES)
    await waitFor(() => expect(markedRows()).toEqual([NOTES]))

    await switchTo(LOGO)

    await waitFor(() => expect(markedRows()).toEqual([]))
    expect(row(ASSETS)).toBeNull()
    // The reveal-opened folders of the previous tab close all the same
    expect(isOpen(SRC)).toBe(false)
  })

  it('does nothing for a file outside the project', async () => {
    await mountTree()
    await switchTo('/elsewhere/todo.md')

    expect(markedRows()).toEqual([])
    expect(isOpen(SRC)).toBe(false)
    expect(isOpen(DOCS)).toBe(false)
  })

  it('closes folders opened only by the reveal on the next switch, never one the person opened', async () => {
    await mountTree()
    await clickFolder(DOCS)
    expect(isOpen(DOCS)).toBe(true)

    await switchTo(TOAST)
    await waitFor(() => expect(isOpen(SERVICES)).toBe(true))

    await switchTo(GUIDE)
    await waitFor(() => expect(markedRows()).toEqual([GUIDE]))
    expect(isOpen(SRC)).toBe(false)
    expect(row(SERVICES)).toBeNull()
    expect(isOpen(DOCS)).toBe(true)
  })

  it('keeps a reveal-opened folder the person worked inside – it is theirs now', async () => {
    await mountTree()
    await switchTo(TOAST)
    await waitFor(() => expect(isOpen(SERVICES)).toBe(true))

    // Inside the reveal-opened `src`, the person opens `components`
    await clickFolder(COMPONENTS)
    expect(isOpen(COMPONENTS)).toBe(true)

    await switchTo(README)
    await waitFor(() => expect(markedRows()).toEqual([README]))
    expect(isOpen(SRC)).toBe(true)
    expect(isOpen(COMPONENTS)).toBe(true)
    expect(isOpen(SERVICES)).toBe(false)
  })

  it('does not reopen a folder the person closed until the tab changes again', async () => {
    await mountTree()
    await switchTo(TOAST)
    await waitFor(() => expect(isOpen(SERVICES)).toBe(true))

    await clickFolder(SERVICES)
    expect(isOpen(SERVICES)).toBe(false)
    // A tab with the same file again is not a switch to another file
    await switchTo(TOAST)
    expect(isOpen(SERVICES)).toBe(false)

    await switchTo(README)
    await switchTo(TOAST)
    await waitFor(() => expect(isOpen(SERVICES)).toBe(true))
  })

  it('on Windows, reveals a tab whose path is spelled in another case and with other separators', async () => {
    ;(window as unknown as { api: { utils?: unknown } }).api.utils = { getPlatform: () => 'win32' }
    await mountTree()

    await switchTo('\\PROJ\\Src\\SERVICES\\toastservice.TS')

    await waitFor(() => expect(markedRows()).toEqual([TOAST]))
    expect(isOpen(SRC)).toBe(true)
    expect(isOpen(SERVICES)).toBe(true)
    await waitFor(() => expect(row(TOAST)).toHaveAttribute('tabindex', '0'))
  })

  it('clears the mark for a tab with no file (Welcome)', async () => {
    await mountTree()
    await switchTo(README)
    await waitFor(() => expect(markedRows()).toEqual([README]))

    await switchTo(null)
    await waitFor(() => expect(markedRows()).toEqual([]))
  })
})
