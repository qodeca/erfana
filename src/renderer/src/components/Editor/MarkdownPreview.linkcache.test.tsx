// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The preview's link checks remember `file.exists` answers (finding [31]):
 * only new link targets cross IPC, a file or folder appearing or going makes
 * them re-check (once per burst, and only while the panel is shown), answers
 * from before such a change are dropped, a "missing" answer expires, and a
 * re-check with the same outcome re-renders no link.
 *
 * @module MarkdownPreview.linkcache.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'

import { MarkdownPreview } from './MarkdownPreview'
import { ToastProvider } from '../Toast/ToastContext'
import { useGlobalSettingsStore } from '../../stores/useGlobalSettingsStore'
import { fileGateway } from '../../services/fileGateway'
import { LINK_TARGET_SETTLE_MS, LINK_TARGET_TTL_MS, type DirectoryChange } from './linkTargetCache'

// Counts link renders: the link renderer computes a tooltip for every resolved internal link.
const tooltipCalls = vi.hoisted(() => ({ count: 0 }))
vi.mock('../../utils/markdownLinkResolver', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../utils/markdownLinkResolver')>()
  return {
    ...real,
    getLinkTooltip: (...args: Parameters<typeof real.getLinkTooltip>) => {
      tooltipCalls.count += 1
      return real.getLinkTooltip(...args)
    }
  }
})

vi.mock('./MermaidDiagram', () => ({
  MermaidDiagram: ({ code }: { code: string }) => <div data-testid="mermaid-stub" data-code={code} />
}))

const FILE_PATH = '/proj/notes.md'

const ui = (content: string, isVisible = true) => (
  <ToastProvider>
    <MarkdownPreview content={content} filePath={FILE_PATH} isVisible={isVisible} />
  </ToastProvider>
)

let exists: ReturnType<typeof vi.fn>
let directoryListeners: Array<(change: DirectoryChange) => void>

/** Let timers run for `ms` (fake clock) and every promise callback they lead to. */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

/** Deliver a `directory-watch:changed` broadcast, without waiting for the re-check. */
function emit(change: DirectoryChange): void {
  for (const listener of [...directoryListeners]) listener(change)
}

/** Deliver a broadcast and wait until the debounced re-check has finished. */
async function broadcast(change: DirectoryChange): Promise<void> {
  emit(change)
  await advance(LINK_TARGET_SETTLE_MS)
}

/** Paths `file.exists` was asked about, in order. */
const askedPaths = (): string[] => exists.mock.calls.map(([request]) => (request as { filePath: string }).filePath)

beforeEach(() => {
  vi.useFakeTimers()
  tooltipCalls.count = 0
  directoryListeners = []
  exists = vi.fn().mockResolvedValue(true)
  ;(window as unknown as { api: unknown }).api = {
    file: {
      getProjectPath: vi.fn().mockResolvedValue('/proj'),
      exists,
      createFile: vi.fn().mockResolvedValue('/proj/created.md')
    },
    directoryWatch: {
      onDirectoryChanged: (listener: (change: DirectoryChange) => void) => {
        directoryListeners.push(listener)
        return () => {
          directoryListeners = directoryListeners.filter((l) => l !== listener)
        }
      }
    }
  }
  Object.defineProperty(window, 'electron', {
    value: { shell: { openExternal: vi.fn() } },
    writable: true,
    configurable: true
  })
  useGlobalSettingsStore.setState({
    settings: { logging: { level: 'info' }, editor: { preserveLineBreaks: false } },
    isLoading: false,
    error: null,
    isInitialized: true,
    wasCorruptionRecovered: false
  } as Parameters<typeof useGlobalSettingsStore.setState>[0])
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function mount(content: string, isVisible = true) {
  let result!: ReturnType<typeof render>
  await act(async () => {
    result = render(ui(content, isVisible))
  })
  await advance(0)
  return result
}

describe('MarkdownPreview – remembered link checks', () => {
  it('asks file.exists only about the new target when a link is added', async () => {
    const { rerender } = await mount('[a](./a.md) [b](./b.md) [c](./c.md)')
    expect(askedPaths().sort()).toEqual(['/proj/a.md', '/proj/b.md', '/proj/c.md'])
    exists.mockClear()

    await act(async () => rerender(ui('[a](./a.md) [b](./b.md) [c](./c.md) [d](./d.md)')))
    await advance(0)
    expect(askedPaths()).toEqual(['/proj/d.md'])
  })

  it('asks nothing while typing changes the text but not the links', async () => {
    const { rerender } = await mount('[a](./a.md)\n\ntext')
    exists.mockClear()
    for (let i = 0; i < 20; i++) {
      await act(async () => rerender(ui(`[a](./a.md)\n\ntext ${'x'.repeat(i)}`)))
    }
    await advance(0)
    expect(exists).not.toHaveBeenCalled()
  })

  it('shows a linked file as found once the watcher reports it was created', async () => {
    exists.mockResolvedValue(false)
    const { container } = await mount('[later](./later.md)')
    const link = () => container.querySelector('a[href="./later.md"]')
    expect(link()?.className).toBe('broken-link')

    exists.mockResolvedValue(true)
    await broadcast({ summary: { add: 1 } })
    expect(link()?.className).toBe('internal-link')
  })

  it('re-checks after a catch-up refresh or a payload without a summary, not after content-only changes', async () => {
    await mount('[a](./a.md)')
    exists.mockClear()

    await broadcast({ summary: { change: 3 } })
    expect(exists).not.toHaveBeenCalled()

    await broadcast({ summary: {}, catchUp: true })
    expect(askedPaths()).toEqual(['/proj/a.md'])

    await broadcast({ eventCount: 1 })
    expect(exists).toHaveBeenCalledTimes(2)
  })

  it("re-checks after this window's own file operation (the watcher is paused for those)", async () => {
    exists.mockResolvedValue(false)
    const { container } = await mount('[new](./created.md)')
    expect(container.querySelector('a')?.className).toBe('broken-link')

    exists.mockResolvedValue(true)
    await act(async () => {
      await fileGateway.createFile({ dirPath: '/proj', name: 'created.md' })
    })
    await advance(LINK_TARGET_SETTLE_MS)
    expect(container.querySelector('a')?.className).toBe('internal-link')
  })

  it('re-checks once for a burst of changes, after the burst settles', async () => {
    await mount('[a](./a.md) [b](./b.md)')
    exists.mockClear()

    for (let i = 0; i < 10; i++) {
      emit({ summary: { add: 1 } })
      await advance(50)
    }
    expect(exists).not.toHaveBeenCalled()

    await advance(LINK_TARGET_SETTLE_MS)
    expect(exists).toHaveBeenCalledTimes(2)
  })

  it('a hidden preview holds its re-check until it is shown, then does one', async () => {
    exists.mockResolvedValue(false)
    const { container, rerender } = await mount('[later](./later.md)', false)
    expect(container.querySelector('a')?.className).toBe('broken-link')
    exists.mockClear()
    exists.mockResolvedValue(true)

    for (let i = 0; i < 5; i++) await broadcast({ summary: { add: 1 } })
    expect(exists).not.toHaveBeenCalled()

    await act(async () => rerender(ui('[later](./later.md)', true)))
    await advance(0)
    expect(exists).toHaveBeenCalledTimes(1)
    expect(container.querySelector('a')?.className).toBe('internal-link')
  })

  it('re-checks a link shown as missing once its answer expires, with no event', async () => {
    exists.mockResolvedValue(false)
    const { container } = await mount('[later](./later.md)')
    expect(container.querySelector('a')?.className).toBe('broken-link')

    // Created where no event reaches this window.
    exists.mockResolvedValue(true)
    await advance(LINK_TARGET_TTL_MS - 1000)
    expect(container.querySelector('a')?.className).toBe('broken-link')

    await advance(1000 + LINK_TARGET_SETTLE_MS)
    expect(container.querySelector('a')?.className).toBe('internal-link')
  })

  it('drops an answer that was in flight when the file structure changed', async () => {
    // The first check hangs until released.
    let releaseFirst!: (v: boolean) => void
    exists.mockImplementationOnce(() => new Promise<boolean>((r) => (releaseFirst = r)))
    // The re-check after the change never answers.
    exists.mockImplementation(() => new Promise<boolean>(() => {}))

    const { container } = await mount('[a](./a.md)')
    // Unresolved links render as internal links until a check says otherwise.
    expect(container.querySelector('a')?.className).toBe('internal-link')

    // The structure changes, and the answer from before the change ("missing")
    // lands while the re-check is still waiting for the burst to settle.
    emit({ summary: { unlink: 1 } })
    releaseFirst(false)
    await advance(LINK_TARGET_SETTLE_MS / 2)
    expect(container.querySelector('a')?.className).toBe('internal-link')
  })

  it('re-renders no link when a re-check finds the same answers', async () => {
    await mount('[a](./a.md) [b](./b.md)')
    const settled = tooltipCalls.count
    expect(settled).toBeGreaterThan(0)

    await broadcast({ summary: { addDir: 1 } })
    expect(exists).toHaveBeenCalledTimes(4) // both links asked again …
    expect(tooltipCalls.count).toBe(settled) // … and nothing re-rendered
  })

  it('leaves no watcher listener behind when it unmounts', async () => {
    const { unmount } = await mount('[a](./a.md)')
    expect(directoryListeners).toHaveLength(1)
    unmount()
    expect(directoryListeners).toHaveLength(0)
  })
})
