// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ProjectTree keyboard and virtualisation tests (#87 / #88, review finding [33])
 *
 * The tree is one Tab stop (roving tabindex) that the arrow keys, Home, End,
 * Enter, type-ahead and Shift+F10 operate – the WAI-ARIA APG tree view
 * contract the Rows card decides (design/system/components/row/index.html).
 * Before this, dnd-kit gave every row its own Tab stop and no key did
 * anything.
 *
 * It also renders only the rows in view: a 5,000-entry folder mounts a
 * screenful of rows, and every row states `aria-level` / `aria-posinset` /
 * `aria-setsize`, because assistive tech cannot count rows that are not in the
 * DOM.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { ProjectTree } from './ProjectTree'
import { DialogProvider } from '../Dialog'
import { ProjectManagementProvider } from '../../context/ProjectManagementContext'
import { TEST_IDS } from '../../constants/testids'
import { useClipboardStore } from '../../stores/useClipboardStore'
import type { FileNode } from '../../../../preload/index'

const ROOT = '/proj'

const file = (path: string, name: string): FileNode => ({ name, path, type: 'file', extension: '.md' })

/** alpha.md, docs/{beta.md, guide.md}, lib/{gamma.md}, zeta.md */
function smallTree(): FileNode[] {
  return [
    file(`${ROOT}/alpha.md`, 'alpha.md'),
    {
      name: 'docs',
      path: `${ROOT}/docs`,
      type: 'directory',
      children: [file(`${ROOT}/docs/beta.md`, 'beta.md'), file(`${ROOT}/docs/guide.md`, 'guide.md')]
    },
    { name: 'lib', path: `${ROOT}/lib`, type: 'directory', children: [file(`${ROOT}/lib/gamma.md`, 'gamma.md')] },
    file(`${ROOT}/zeta.md`, 'zeta.md')
  ]
}

function bigTree(count: number): FileNode[] {
  return [
    {
      name: 'big',
      path: `${ROOT}/big`,
      type: 'directory',
      children: Array.from({ length: count }, (_, i) => {
        const name = `f${String(i).padStart(5, '0')}.md`
        return file(`${ROOT}/big/${name}`, name)
      })
    }
  ]
}

let onProjectChanged: ((data: { newPath: string | null; oldPath: string | null }) => void) | null = null

function setupMockApi(files: FileNode[]) {
  ;(window as any).api = {
    file: {
      readDirectory: vi.fn(async () => files),
      onProjectChanged: vi.fn((cb: any) => {
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
    git: {
      getStatus: vi.fn(async () => ({
        isGitRepo: false,
        branch: null,
        isDetached: false,
        files: [],
        counts: { modified: 0, untracked: 0, deleted: 0, staged: 0, conflicted: 0 },
        truncated: false
      }))
    },
    import: { isSupported: vi.fn(async () => false) },
    logging: { log: vi.fn() }
  }
}

async function renderTree(files: FileNode[]) {
  setupMockApi(files)
  const onFileSelect = vi.fn()
  render(
    <DialogProvider>
      <ProjectManagementProvider>
        <ProjectTree onFileSelect={onFileSelect} showControlPanel={false} filterMode={'all' as any} onFilterModeChange={() => {}} />
      </ProjectManagementProvider>
    </DialogProvider>
  )
  await act(async () => {
    onProjectChanged!({ newPath: ROOT, oldPath: null })
  })
  await waitFor(() => expect(item(ROOT)).toHaveAttribute('aria-expanded', 'true'))
  await waitFor(() => expect(document.querySelectorAll('[role="treeitem"]').length).toBeGreaterThan(1))
  return { onFileSelect }
}

function item(path: string): HTMLElement {
  for (const el of document.querySelectorAll<HTMLElement>('[role="treeitem"]')) {
    if (el.dataset.path === path) return el
  }
  throw new Error(`No treeitem rendered for "${path}"`)
}

function tabStops(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="tree"] [tabindex="0"]'))
}

function press(key: string, init: KeyboardEventInit = {}) {
  const target = document.activeElement
  if (!(target instanceof HTMLElement)) throw new Error('nothing focused')
  fireEvent.keyDown(target, { key, ...init })
}

let portalRoot: HTMLElement

beforeEach(() => {
  vi.clearAllMocks()
  onProjectChanged = null
  portalRoot = document.createElement('div')
  portalRoot.id = 'portal-root'
  document.body.appendChild(portalRoot)
})

afterEach(() => {
  portalRoot.remove()
  ;(globalThis as any).__treeViewportHeight = 2000
})

describe('ProjectTree – one Tab stop (roving tabindex)', () => {
  it('holds exactly one Tab stop for the whole tree, on the root row at first', async () => {
    await renderTree(smallTree())

    expect(tabStops()).toEqual([item(ROOT)])
    expect(document.querySelectorAll('[role="treeitem"][tabindex="-1"]').length).toBe(4)
  })

  it('owns only tree items: dnd-kit\'s live region is rendered outside the tree', async () => {
    await renderTree(smallTree())

    const tree = screen.getByRole('tree')
    expect(tree.querySelector('[role="status"]')).toBeNull()
    expect(tree.querySelector('[role]:not([role="treeitem"])')).toBeNull()
  })

  it('moves the Tab stop to the row that takes focus', async () => {
    await renderTree(smallTree())

    act(() => item(`${ROOT}/zeta.md`).focus())

    expect(tabStops()).toEqual([item(`${ROOT}/zeta.md`)])
  })
})

describe('ProjectTree – arrow keys, Home and End', () => {
  it('moves focus down and up one row at a time', async () => {
    await renderTree(smallTree())
    act(() => item(ROOT).focus())

    press('ArrowDown')
    expect(document.activeElement).toBe(item(`${ROOT}/alpha.md`))
    press('ArrowDown')
    expect(document.activeElement).toBe(item(`${ROOT}/docs`))
    press('ArrowUp')
    expect(document.activeElement).toBe(item(`${ROOT}/alpha.md`))
    expect(tabStops()).toEqual([item(`${ROOT}/alpha.md`)])
  })

  it('jumps to the first and last row with Home and End', async () => {
    await renderTree(smallTree())
    act(() => item(`${ROOT}/docs`).focus())

    press('End')
    expect(document.activeElement).toBe(item(`${ROOT}/zeta.md`))
    press('Home')
    expect(document.activeElement).toBe(item(ROOT))
  })

  it('opens a folder with →, steps into it with → again, and goes back up with ←', async () => {
    await renderTree(smallTree())
    act(() => item(`${ROOT}/docs`).focus())

    press('ArrowRight')
    expect(item(`${ROOT}/docs`)).toHaveAttribute('aria-expanded', 'true')
    expect(document.activeElement).toBe(item(`${ROOT}/docs`))

    press('ArrowRight')
    expect(document.activeElement).toBe(item(`${ROOT}/docs/beta.md`))

    press('ArrowLeft')
    expect(document.activeElement).toBe(item(`${ROOT}/docs`))

    press('ArrowLeft')
    expect(item(`${ROOT}/docs`)).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('beta.md')).not.toBeInTheDocument()
  })
})

describe('ProjectTree – Enter, type-ahead and the context menu key', () => {
  it('opens a file with Enter', async () => {
    const { onFileSelect } = await renderTree(smallTree())
    act(() => item(`${ROOT}/zeta.md`).focus())

    press('Enter')

    expect(onFileSelect).toHaveBeenCalledWith(`${ROOT}/zeta.md`)
  })

  it('toggles and selects a folder with Enter, like a click', async () => {
    await renderTree(smallTree())
    act(() => item(`${ROOT}/lib`).focus())

    press('Enter')

    expect(item(`${ROOT}/lib`)).toHaveAttribute('aria-expanded', 'true')
    expect(item(`${ROOT}/lib`)).toHaveAttribute('aria-selected', 'true')
  })

  it('moves to the next row whose name starts with the typed letters', async () => {
    await renderTree(smallTree())
    act(() => item(ROOT).focus())

    press('z')
    expect(document.activeElement).toBe(item(`${ROOT}/zeta.md`))
    press('l')
    // "zl" matches nothing, so focus stays put.
    expect(document.activeElement).toBe(item(`${ROOT}/zeta.md`))
  })

  it('opens the row context menu with Shift+F10', async () => {
    await renderTree(smallTree())
    act(() => item(`${ROOT}/alpha.md`).focus())

    press('F10', { shiftKey: true })

    expect(await screen.findByTestId(TEST_IDS.CONTEXT_MENU)).toBeInTheDocument()
  })

  it('leaves keys with Cmd / Ctrl to the app shortcuts', async () => {
    await renderTree(smallTree())
    act(() => item(ROOT).focus())

    press('ArrowDown', { metaKey: true })

    expect(document.activeElement).toBe(item(ROOT))
  })
})

describe('ProjectTree – row state in a flat list', () => {
  afterEach(() => {
    act(() => useClipboardStore.getState().clear())
  })

  it('dims a cut file below the root (the dimming used to reach the root row only)', async () => {
    await renderTree(smallTree())
    act(() => item(`${ROOT}/docs`).focus())
    press('ArrowRight')

    act(() => useClipboardStore.getState().cut(`${ROOT}/docs/beta.md`, 'beta.md', 'file'))

    expect(item(`${ROOT}/docs/beta.md`)).toHaveAttribute('data-clipboard-cut', 'true')
    expect(item(`${ROOT}/docs/guide.md`)).toHaveAttribute('data-clipboard-cut', 'false')
  })

  it('drops an OS file dragged over a file row into that file\'s folder, and tints the folder', async () => {
    await renderTree(smallTree())
    act(() => item(`${ROOT}/docs`).focus())
    press('ArrowRight')

    fireEvent.dragEnter(item(`${ROOT}/docs/beta.md`), { dataTransfer: { types: ['Files'] } })

    expect(item(`${ROOT}/docs`)).toHaveAttribute('data-external-drop-target', 'true')
    const wrapper = (path: string) => item(path).parentElement!
    expect(wrapper(`${ROOT}/docs/beta.md`)).toHaveAttribute('data-in-drop-zone', 'external')
    expect(wrapper(`${ROOT}/docs/guide.md`)).toHaveAttribute('data-in-drop-zone', 'external')
    expect(wrapper(`${ROOT}/zeta.md`)).not.toHaveAttribute('data-in-drop-zone')
  })
})

describe('ProjectTree – virtualised rows', () => {
  it('mounts only a screenful of a 5,000-entry folder, each row stating its place', async () => {
    // 280px viewport = 10 rows of 28px.
    ;(globalThis as any).__treeViewportHeight = 280
    await renderTree(bigTree(5000))

    act(() => item(`${ROOT}/big`).focus())
    press('ArrowRight')
    await waitFor(() => expect(item(`${ROOT}/big/f00000.md`)).toBeInTheDocument())

    const mounted = document.querySelectorAll('[role="treeitem"]').length
    expect(mounted).toBeGreaterThan(5)
    expect(mounted).toBeLessThan(40)
    expect(item(`${ROOT}/big/f00003.md`)).toHaveAttribute('aria-setsize', '5000')
    expect(item(`${ROOT}/big/f00003.md`)).toHaveAttribute('aria-posinset', '4')
    expect(item(`${ROOT}/big/f00003.md`)).toHaveAttribute('aria-level', '3')
    // The sizer still gives the scroll container the height of every row.
    const sizer = document.querySelector<HTMLElement>('.project-tree-rows')!
    expect(sizer.style.height).toBe(`${5002 * 28}px`)
  })

  it('renders and focuses the last row on End, even though it was not mounted', async () => {
    ;(globalThis as any).__treeViewportHeight = 280
    await renderTree(bigTree(5000))
    act(() => item(`${ROOT}/big`).focus())
    press('ArrowRight')
    await waitFor(() => expect(item(`${ROOT}/big/f00000.md`)).toBeInTheDocument())
    expect(() => item(`${ROOT}/big/f04999.md`)).toThrow()

    press('End')

    expect(document.activeElement).toBe(item(`${ROOT}/big/f04999.md`))
    expect(tabStops()).toEqual([item(`${ROOT}/big/f04999.md`)])
  })
})
