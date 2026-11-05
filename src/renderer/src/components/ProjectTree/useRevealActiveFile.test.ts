// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * `useRevealActiveFile` on its own (#453): the parts the real tree cannot show
 * in jsdom, which does no layout.
 *
 * - The scroll: an out-of-view row is centred with
 *   `scrollToIndex(index, { align: 'center' })`; a row wholly inside the
 *   viewport is not scrolled (design note: "the scroll … only happens when the
 *   row is not fully visible (then it is centred)").
 * - A row that does not exist yet (a lazy folder's read, a refresh) is waited
 *   for, and the wait is dropped when the tab or project changes.
 * - The Tab stop moves only while focus is outside the tree.
 * - The row is found by `revealPathsEqual` when the tab's spelling is not a
 *   row's, exact spelling first.
 * - A filter change is not a tab switch, and turning the setting off hands the
 *   folders the reveal opened to the person.
 *
 * The virtualizer is a spy with a hand-made measurement cache; the container
 * is a div with a stubbed viewport. Through the real tree:
 * `ProjectTree.reveal.test.tsx` and `ProjectTree.reveal.edges.test.tsx`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { VirtualItem } from '@tanstack/react-virtual'
import type { FilterMode } from '../../types/filters'
import { useRevealActiveFile, type RevealActiveFileOptions } from './useRevealActiveFile'
import { createFakeDockview, type FakeDockview } from '../../test-utils/fakeDockview'
import { globalSettings } from '../../test-utils/globalSettings'
import { useProjectStore } from '../../stores/useProjectStore'
import { useGlobalSettingsStore } from '../../stores/useGlobalSettingsStore'

const P = '/proj'
const SRC = `${P}/src`
const SERVICES = `${SRC}/services`
const TOAST = `${SERVICES}/toast.ts`
const README = `${P}/README.md`
const ROW_HEIGHT = 28

/** A row index map: row `i` is `paths[i]`. */
function rows(...paths: string[]): Map<string, number> {
  return new Map(paths.map((path, index) => [path, index]))
}

/** A row index map with `path` at `index` and filler rows before it. */
function rowAt(path: string, index: number): Map<string, number> {
  const map = new Map<string, number>()
  for (let i = 0; i < index; i++) map.set(`${P}/filler-${i}`, i)
  map.set(path, index)
  return map
}

function measurements(count: number): VirtualItem[] {
  return Array.from({ length: count }, (_, index) => ({
    key: index,
    index,
    start: index * ROW_HEIGHT,
    end: (index + 1) * ROW_HEIGHT,
    size: ROW_HEIGHT,
    lane: 0
  }))
}

interface Props {
  projectPath: string | null
  filterMode: FilterMode
  indexByPath: ReadonlyMap<string, number>
}

let dock: FakeDockview
let container: HTMLDivElement
let platform: NodeJS.Platform

function setViewport(scrollTop: number, clientHeight: number): void {
  Object.defineProperty(container, 'scrollTop', { configurable: true, value: scrollTop })
  Object.defineProperty(container, 'clientHeight', { configurable: true, value: clientHeight })
}

/**
 * Mount the hook with real expansion state, a spy virtualizer and a stubbed
 * container. `initialExpanded` is what is open before the first tab.
 */
function mount(initial: Partial<Props> = {}, initialExpanded: string[] = [P]) {
  const virtualizer = { measurementsCache: measurements(40), scrollToIndex: vi.fn() }
  const setFocusedPath = vi.fn()
  const expansionWrites = vi.fn()
  const hook = renderHook(
    (props: Props) => {
      const [expandedFolders, setExpanded] = useState<Set<string>>(() => new Set(initialExpanded))
      const setExpandedFolders: Dispatch<SetStateAction<Set<string>>> = useCallback((value) => {
        expansionWrites(value)
        setExpanded(value)
      }, [])
      const treeContainerRef = useRef<HTMLDivElement | null>(container)
      const options: RevealActiveFileOptions = {
        ...props,
        rootFolderNode: null,
        expandedFolders,
        setExpandedFolders,
        virtualizer,
        treeContainerRef,
        setFocusedPath
      }
      return { revealed: useRevealActiveFile(options), expandedFolders, setExpanded }
    },
    { initialProps: { projectPath: P, filterMode: 'all', indexByPath: new Map(), ...initial } }
  )
  const props = (): Props => ({ projectPath: P, filterMode: 'all', indexByPath: new Map(), ...initial })
  let current = props()
  const rerender = (next: Partial<Props>) => {
    current = { ...current, ...next }
    hook.rerender(current)
  }
  return { hook, virtualizer, setFocusedPath, expansionWrites, rerender }
}

async function switchTo(filePath: string | null): Promise<void> {
  await act(async () => dock.activate(filePath))
}

async function setFollow(on: boolean): Promise<void> {
  await act(async () =>
    useGlobalSettingsStore.setState({ settings: globalSettings({ projectTree: { followActiveTab: on } }) })
  )
}

const open = (hook: { result: { current: { expandedFolders: Set<string> } } }) => [...hook.result.current.expandedFolders].sort()

beforeEach(() => {
  platform = 'linux'
  ;(window as unknown as { api: unknown }).api = { utils: { getPlatform: () => platform } }
  dock = createFakeDockview()
  useProjectStore.setState({ dockviewApi: dock.api })
  useGlobalSettingsStore.setState({ settings: globalSettings() })
  container = document.createElement('div')
  document.body.appendChild(container)
  setViewport(0, 10 * ROW_HEIGHT)
})

afterEach(() => {
  container.remove()
})

describe('useRevealActiveFile – scroll (#453)', () => {
  it('centres a row below the viewport', async () => {
    const { virtualizer, setFocusedPath } = mount({ indexByPath: rowAt(TOAST, 20) })

    await switchTo(TOAST)

    expect(virtualizer.scrollToIndex).toHaveBeenCalledTimes(1)
    expect(virtualizer.scrollToIndex).toHaveBeenCalledWith(20, { align: 'center' })
    expect(setFocusedPath).toHaveBeenCalledWith(TOAST)
  })

  it('centres a row above the viewport', async () => {
    setViewport(15 * ROW_HEIGHT, 10 * ROW_HEIGHT)
    const { virtualizer } = mount({ indexByPath: rowAt(TOAST, 2) })

    await switchTo(TOAST)

    expect(virtualizer.scrollToIndex).toHaveBeenCalledWith(2, { align: 'center' })
  })

  it('does not scroll a row that is fully visible, even flush with either edge', async () => {
    setViewport(ROW_HEIGHT, 10 * ROW_HEIGHT)
    // Row 1 starts at the top edge; row 10 ends at the bottom edge
    const map = rows(`${P}/a.md`, TOAST, ...Array.from({ length: 8 }, (_, i) => `${P}/f${i}.md`), README)
    const { virtualizer, setFocusedPath } = mount({ indexByPath: map })

    await switchTo(TOAST)
    await switchTo(README)

    expect(virtualizer.scrollToIndex).not.toHaveBeenCalled()
    // The Tab stop still follows
    expect(setFocusedPath.mock.calls).toEqual([[TOAST], [README]])
  })

  it('scrolls a row that is only partly visible – cut by the bottom or the top edge', async () => {
    setViewport(10, 10 * ROW_HEIGHT)
    // Row 0 starts 10px above the top; row 10 ends 18px below the bottom
    const map = rows(TOAST, ...Array.from({ length: 9 }, (_, i) => `${P}/f${i}.md`), README)
    const { virtualizer } = mount({ indexByPath: map })

    await switchTo(TOAST)
    await switchTo(README)

    expect(virtualizer.scrollToIndex.mock.calls).toEqual([
      [0, { align: 'center' }],
      [10, { align: 'center' }]
    ])
  })

  it('moves the Tab stop without scrolling when the row has no measurement yet', async () => {
    const { virtualizer, setFocusedPath } = mount({ indexByPath: rowAt(TOAST, 60) })

    await switchTo(TOAST)

    expect(virtualizer.scrollToIndex).not.toHaveBeenCalled()
    expect(setFocusedPath).toHaveBeenCalledWith(TOAST)
  })
})

describe('useRevealActiveFile – a row that is not there yet (#453)', () => {
  it('waits for the row, then scrolls to it and moves the Tab stop once', async () => {
    const { virtualizer, setFocusedPath, rerender } = mount({ indexByPath: rows(P, SRC) })

    await switchTo(TOAST)
    expect(virtualizer.scrollToIndex).not.toHaveBeenCalled()
    expect(setFocusedPath).not.toHaveBeenCalled()

    // The lazy read lands: the row exists now, far down
    act(() => rerender({ indexByPath: rowAt(TOAST, 25) }))
    expect(virtualizer.scrollToIndex).toHaveBeenCalledWith(25, { align: 'center' })
    expect(setFocusedPath).toHaveBeenCalledWith(TOAST)

    // A later row change (a refresh) is not a second reveal
    act(() => rerender({ indexByPath: rowAt(TOAST, 30) }))
    expect(virtualizer.scrollToIndex).toHaveBeenCalledTimes(1)
    expect(setFocusedPath).toHaveBeenCalledTimes(1)
  })

  it('drops the wait when the project changes before the row exists', async () => {
    const { virtualizer, setFocusedPath, rerender } = mount({ indexByPath: rows(P) })
    await switchTo(TOAST)

    act(() => rerender({ projectPath: '/other' }))
    // The old project's row shows up late (its read was already in flight)
    act(() => rerender({ indexByPath: rowAt(TOAST, 25) }))

    expect(virtualizer.scrollToIndex).not.toHaveBeenCalled()
    expect(setFocusedPath).not.toHaveBeenCalled()
  })
})

describe('useRevealActiveFile – focus (#453)', () => {
  it('leaves the Tab stop alone while focus is inside the tree, and still scrolls', async () => {
    const focusedRow = document.createElement('div')
    focusedRow.tabIndex = 0
    container.appendChild(focusedRow)
    focusedRow.focus()
    const { virtualizer, setFocusedPath } = mount({ indexByPath: rowAt(TOAST, 20) })

    await switchTo(TOAST)

    expect(setFocusedPath).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(focusedRow)
    expect(virtualizer.scrollToIndex).toHaveBeenCalledWith(20, { align: 'center' })
  })
})

describe('useRevealActiveFile – finding the row (#453)', () => {
  it('on macOS finds the row by case and Unicode form, and moves the Tab stop to the row’s own spelling', async () => {
    platform = 'darwin'
    const rowPath = `${P}/docs/Café.md`
    const { virtualizer, setFocusedPath } = mount({ indexByPath: rowAt(rowPath, 20) })

    await switchTo(`${P}/DOCS/café.md`)

    expect(setFocusedPath).toHaveBeenCalledWith(rowPath)
    expect(virtualizer.scrollToIndex).toHaveBeenCalledWith(20, { align: 'center' })
  })

  it('on macOS prefers the row with the exact spelling over an earlier case-folded match', async () => {
    platform = 'darwin'
    const { virtualizer, setFocusedPath } = mount({ indexByPath: rows(`${P}/a.md`, ...Array.from({ length: 20 }, (_, i) => `${P}/f${i}`), `${P}/A.md`) })

    await switchTo(`${P}/A.md`)

    expect(setFocusedPath).toHaveBeenCalledWith(`${P}/A.md`)
    expect(virtualizer.scrollToIndex).toHaveBeenCalledWith(21, { align: 'center' })
  })

  it('on Linux does not match a row that differs in case', async () => {
    const { virtualizer, setFocusedPath } = mount({ indexByPath: rowAt(`${P}/docs/Cafe.md`, 20) })

    await switchTo(`${P}/docs/cafe.md`)

    expect(setFocusedPath).not.toHaveBeenCalled()
    expect(virtualizer.scrollToIndex).not.toHaveBeenCalled()
  })
})

describe('useRevealActiveFile – what is not a tab switch (#453)', () => {
  it('a filter change after a reveal opens and closes nothing, and only hides the mark', async () => {
    const { hook, virtualizer, expansionWrites, rerender } = mount({ indexByPath: rowAt(TOAST, 20) })
    await switchTo(TOAST)
    expect(open(hook)).toEqual([P, SRC, SERVICES])
    expect(hook.result.current.revealed).toBe(TOAST)
    const writes = expansionWrites.mock.calls.length
    const scrolls = virtualizer.scrollToIndex.mock.calls.length

    act(() => rerender({ filterMode: 'markdown' }))
    expect(hook.result.current.revealed).toBeNull()
    act(() => rerender({ filterMode: 'all' }))
    expect(hook.result.current.revealed).toBe(TOAST)

    expect(expansionWrites).toHaveBeenCalledTimes(writes)
    expect(virtualizer.scrollToIndex).toHaveBeenCalledTimes(scrolls)
    expect(open(hook)).toEqual([P, SRC, SERVICES])
  })
})

describe('useRevealActiveFile – the setting turned off (#453)', () => {
  it('turning it off clears the mark and leaves every folder as it is', async () => {
    const { hook, expansionWrites } = mount()
    await switchTo(TOAST)
    const writes = expansionWrites.mock.calls.length

    await setFollow(false)

    expect(hook.result.current.revealed).toBeNull()
    expect(open(hook)).toEqual([P, SRC, SERVICES])
    expect(expansionWrites).toHaveBeenCalledTimes(writes)
  })

  it('a tab switch while it is off moves nothing', async () => {
    const { hook, expansionWrites, setFocusedPath } = mount({ indexByPath: rows(P, README) })
    await setFollow(false)

    await switchTo(TOAST)
    await switchTo(README)

    expect(hook.result.current.revealed).toBeNull()
    expect(open(hook)).toEqual([P])
    expect(expansionWrites).not.toHaveBeenCalled()
    expect(setFocusedPath).not.toHaveBeenCalled()
  })

  it('folders a reveal opened before the setting went off are the person’s after it is back on', async () => {
    const { hook } = mount()
    await switchTo(TOAST)
    await setFollow(false)
    await switchTo(README)

    await setFollow(true)
    expect(hook.result.current.revealed).toBe(README)
    await switchTo(`${P}/docs/guide.md`)

    expect(open(hook)).toEqual([P, `${P}/docs`, SRC, SERVICES])
  })

  it('without the off/on, the same folders close on the next switch (control)', async () => {
    const { hook } = mount()
    await switchTo(TOAST)
    await switchTo(README)

    expect(open(hook)).toEqual([P])
  })
})
