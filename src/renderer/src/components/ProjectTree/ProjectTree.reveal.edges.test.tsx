// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The project tree follows the active tab (#453) – the edges, through the real
 * tree. The main cases are in `ProjectTree.reveal.test.tsx`; the hook's scroll
 * and its wait for a missing row are pinned in `useRevealActiveFile.test.ts`.
 *
 * - A file inside a lazy folder (not read yet): the reveal opens the folder,
 *   nothing breaks while it is read, and the row is marked and takes the Tab
 *   stop once it arrives. Likewise a file that appears only after a refresh.
 * - Focus already inside the tree: the Tab stop and focus stay where they are.
 * - On macOS the tab's path may differ from the row's in case and Unicode form.
 * - A filter change is not a tab switch.
 * - Folders a reveal opened before the setting was turned off are the
 *   person's once it is back on.
 *
 * Same harness as `ProjectTree.reveal.test.tsx`, with a per-folder listing so
 * a lazy folder can be read on its own. The platform comes from the preload
 * bridge (`window.api.utils.getPlatform`), set per test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { ProjectTree } from './ProjectTree'
import { DialogProvider } from '../Dialog'
import { ProjectManagementProvider } from '../../context/ProjectManagementContext'
import type { FileNode } from '../../../../shared/ipc/file-schema'
import type { FilterMode } from '../../types/filters'
import { installTreeViewport } from '../../test-utils/treeViewport'
import { createFakeDockview, type FakeDockview } from '../../test-utils/fakeDockview'
import { globalSettings } from '../../test-utils/globalSettings'
import { useProjectStore } from '../../stores/useProjectStore'
import { useGlobalSettingsStore } from '../../stores/useGlobalSettingsStore'
import { useLazyFolderStore } from '../../stores/useLazyFolderStore'

installTreeViewport()

const P = '/proj'
const DOCS = `${P}/docs`
const SRC = `${P}/src`
const SERVICES = `${SRC}/services`
const DIST = `${P}/dist`
const README = `${P}/README.md`
const GUIDE = `${DOCS}/guide.md`
const TOAST = `${SERVICES}/toastService.ts`
const NOTES = `${SERVICES}/notes.md`
/** A folder and a file whose names are stored NFC, as most tools write them */
const RESUME = `${P}/Résumé`
const CAFE = `${RESUME}/café.md`
const BUNDLE = `${DIST}/bundle.md`

function file(path: string, ext: string): FileNode {
  return { name: path.slice(path.lastIndexOf('/') + 1), path, type: 'file', extension: ext }
}

function folder(path: string, children: FileNode[], lazy?: FileNode['lazy']): FileNode {
  return { name: path.slice(path.lastIndexOf('/') + 1), path, type: 'directory', children, ...(lazy ? { lazy } : {}) }
}

/** The project as the full read answers it; `dist` is ignored, so lazy */
function projectFiles(extra: FileNode[] = []): FileNode[] {
  return [
    folder(DIST, [], 'ignored'),
    folder(DOCS, [file(GUIDE, '.md'), ...extra]),
    folder(RESUME, [file(CAFE, '.md')]),
    folder(SRC, [folder(SERVICES, [file(NOTES, '.md'), file(TOAST, '.ts')])]),
    file(README, '.md')
  ]
}

// --------------------------------------------------------------------------
// Bridge mocks (as in ProjectTree.reveal.test.tsx)
// --------------------------------------------------------------------------

let onProjectChanged: ((data: { newPath: string | null; oldPath: string | null }) => void) | null = null
let onDirectoryChanged: ((data: unknown) => void) | null = null
let platform: NodeJS.Platform
/** What a full read of the project answers */
let rootListing: () => FileNode[]
/** What a shallow read of a folder answers, by path */
let listing: Record<string, () => Promise<FileNode[]>>

function setupMockApi(): void {
  ;(window as unknown as { api: unknown }).api = {
    file: {
      readDirectory: vi.fn(async ({ dirPath }: { dirPath: string }) =>
        dirPath === P ? rootListing() : (listing[dirPath]?.() ?? [])
      ),
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
      onDirectoryChanged: (cb: (data: unknown) => void) => {
        onDirectoryChanged = cb
        return () => {}
      },
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
    logging: { log: vi.fn() },
    utils: { getPlatform: () => platform }
  }
}

// --------------------------------------------------------------------------
// Harness
// --------------------------------------------------------------------------

let dock: FakeDockview

const treeUi = (filterMode: FilterMode) => (
  <DialogProvider>
    <ProjectManagementProvider>
      <textarea aria-label="Editor" />
      <ProjectTree onFileSelect={vi.fn()} showControlPanel={false} filterMode={filterMode} onFilterModeChange={() => {}} />
    </ProjectManagementProvider>
  </DialogProvider>
)

/** Mount the tree with an editor stand-in that holds focus, and open the project. */
async function mountTree(filterMode: FilterMode = 'all') {
  const utils = render(treeUi(filterMode))
  await act(async () => onProjectChanged!({ newPath: P, oldPath: null }))
  await waitFor(() => expect(screen.getByText('README.md')).toBeInTheDocument())
  const editor = screen.getByRole('textbox', { name: 'Editor' })
  editor.focus()
  return { ...utils, editor, setFilter: (mode: FilterMode) => utils.rerender(treeUi(mode)) }
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

function tabStops(): string[] {
  return [...document.querySelectorAll<HTMLElement>('[role="treeitem"][tabindex="0"]')].map((r) => r.dataset.path!)
}

async function switchTo(filePath: string | null) {
  await act(async () => dock.activate(filePath))
}

async function setFollow(on: boolean) {
  await act(async () =>
    useGlobalSettingsStore.setState({ settings: globalSettings({ projectTree: { followActiveTab: on } }) })
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  onProjectChanged = null
  onDirectoryChanged = null
  platform = 'linux'
  rootListing = () => projectFiles()
  listing = {}
  useLazyFolderStore.getState().reset()
  setupMockApi()
  dock = createFakeDockview()
  useProjectStore.setState({ dockviewApi: dock.api })
  useGlobalSettingsStore.setState({ settings: globalSettings() })
})

describe('ProjectTree follows the active tab – a row that arrives later (#453)', () => {
  it('opens a lazy folder for a file inside it, and marks the row once the read lands', async () => {
    let finish!: (nodes: FileNode[]) => void
    listing[DIST] = () => new Promise<FileNode[]>((resolve) => (finish = resolve))
    const { editor } = await mountTree()

    await switchTo(BUNDLE)

    // Pending: the folder is open and being read, no row is marked yet
    await waitFor(() => expect(row(DIST)).toHaveAttribute('aria-busy', 'true'))
    expect(isOpen(DIST)).toBe(true)
    expect(row(BUNDLE)).toBeNull()
    expect(markedRows()).toEqual([])

    await act(async () => finish([file(BUNDLE, '.md')]))

    await waitFor(() => expect(markedRows()).toEqual([BUNDLE]))
    await waitFor(() => expect(tabStops()).toEqual([BUNDLE]))
    expect(document.activeElement).toBe(editor)
  })

  it('opens two levels of lazy folders, each read in turn', async () => {
    const NESTED = `${DIST}/nested`
    const DEEP = `${NESTED}/deep.md`
    listing[DIST] = async () => [folder(NESTED, [], 'ignored')]
    listing[NESTED] = async () => [file(DEEP, '.md')]
    await mountTree()

    await switchTo(DEEP)

    await waitFor(() => expect(markedRows()).toEqual([DEEP]))
    await waitFor(() => expect(tabStops()).toEqual([DEEP]))
    expect(isOpen(DIST)).toBe(true)
    expect(isOpen(NESTED)).toBe(true)
  })

  it('marks a file that shows up only after a tree refresh (a file just created)', async () => {
    const FRESH = `${DOCS}/fresh.md`
    await mountTree()

    await switchTo(FRESH)
    await waitFor(() => expect(isOpen(DOCS)).toBe(true))
    expect(row(FRESH)).toBeNull()

    rootListing = () => projectFiles([file(FRESH, '.md')])
    act(() => onDirectoryChanged!({ eventCount: 1, structural: true }))

    await waitFor(() => expect(markedRows()).toEqual([FRESH]), { timeout: 3_000 })
    await waitFor(() => expect(tabStops()).toEqual([FRESH]))
  })
})

describe('ProjectTree follows the active tab – focus inside the tree (#453)', () => {
  it('keeps the Tab stop and focus on the row the person is on', async () => {
    await mountTree()
    const readme = row(README)!
    act(() => readme.focus())
    await waitFor(() => expect(tabStops()).toEqual([README]))

    await switchTo(GUIDE)

    await waitFor(() => expect(markedRows()).toEqual([GUIDE]))
    expect(isOpen(DOCS)).toBe(true)
    expect(tabStops()).toEqual([README])
    expect(document.activeElement).toBe(readme)
  })
})

describe('ProjectTree follows the active tab – macOS spellings (#453)', () => {
  it('reveals a tab whose path differs from the row only in letter case', async () => {
    platform = 'darwin'
    await mountTree()

    await switchTo(`${P}/SRC/Services/TOASTSERVICE.ts`)

    await waitFor(() => expect(markedRows()).toEqual([TOAST]))
    expect(isOpen(SRC)).toBe(true)
    expect(isOpen(SERVICES)).toBe(true)
    await waitFor(() => expect(tabStops()).toEqual([TOAST]))
  })

  it('reveals a tab whose path is NFD when the rows are NFC', async () => {
    platform = 'darwin'
    await mountTree()
    const nfd = CAFE.normalize('NFD')
    expect(nfd).not.toBe(CAFE)

    await switchTo(nfd)

    await waitFor(() => expect(markedRows()).toEqual([CAFE]))
    expect(isOpen(RESUME)).toBe(true)
    await waitFor(() => expect(tabStops()).toEqual([CAFE]))
  })

  it('on Linux, the same case-differing path is another file and is not revealed', async () => {
    await mountTree()

    await switchTo(`${P}/SRC/Services/TOASTSERVICE.ts`)

    expect(markedRows()).toEqual([])
    expect(isOpen(SRC)).toBe(false)
  })
})

describe('ProjectTree follows the active tab – a filter change is not a tab switch (#453)', () => {
  it('neither closes the revealed folders nor reopens closed ones; only the mark follows the filter', async () => {
    const { setFilter } = await mountTree()
    await switchTo(TOAST)
    await waitFor(() => expect(markedRows()).toEqual([TOAST]))

    // "Markdown only" hides the .ts file: the mark goes, the folders stay
    await act(async () => setFilter('markdown'))
    expect(markedRows()).toEqual([])
    expect(isOpen(SRC)).toBe(true)
    expect(isOpen(SERVICES)).toBe(true)

    // The person closes services; going back to "All files" does not reopen it
    await act(async () => fireEvent.click(row(SERVICES)!))
    expect(isOpen(SERVICES)).toBe(false)
    await act(async () => setFilter('all'))
    expect(isOpen(SERVICES)).toBe(false)
    expect(isOpen(SRC)).toBe(true)
  })
})

describe('ProjectTree follows the active tab – the setting off and on again (#453)', () => {
  it('turning it off leaves the revealed folders open; once back on, they are the person’s and stay open', async () => {
    await mountTree()
    await switchTo(TOAST)
    await waitFor(() => expect(isOpen(SERVICES)).toBe(true))

    await setFollow(false)
    expect(markedRows()).toEqual([])
    expect(isOpen(SERVICES)).toBe(true)

    await switchTo(README)
    expect(isOpen(SERVICES)).toBe(true)

    await setFollow(true)
    await waitFor(() => expect(markedRows()).toEqual([README]))
    await switchTo(GUIDE)
    await waitFor(() => expect(markedRows()).toEqual([GUIDE]))

    expect(isOpen(SRC)).toBe(true)
    expect(isOpen(SERVICES)).toBe(true)
    // What the reveal opened after the setting came back is still its own
    await switchTo(README)
    await waitFor(() => expect(markedRows()).toEqual([README]))
    expect(isOpen(DOCS)).toBe(false)
  })
})
