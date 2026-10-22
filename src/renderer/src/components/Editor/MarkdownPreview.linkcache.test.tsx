// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The preview's link checks remember `file.exists` answers (finding [31]):
 * only new link targets cross IPC, a file or folder appearing or going makes
 * them re-check, answers from before such a change are dropped, and a re-check
 * with the same outcome re-renders no link.
 *
 * @module MarkdownPreview.linkcache.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'

import { MarkdownPreview } from './MarkdownPreview'
import { ToastProvider } from '../Toast/ToastContext'
import { useGlobalSettingsStore } from '../../stores/useGlobalSettingsStore'
import { fileGateway } from '../../services/fileGateway'
import type { DirectoryChange } from './linkTargetCache'

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

const ui = (content: string) => (
  <ToastProvider>
    <MarkdownPreview content={content} filePath={FILE_PATH} />
  </ToastProvider>
)

let exists: ReturnType<typeof vi.fn>
let directoryListeners: Array<(change: DirectoryChange) => void>

/** Deliver a `directory-watch:changed` broadcast to the preview. */
async function broadcast(change: DirectoryChange): Promise<void> {
  await act(async () => {
    for (const listener of [...directoryListeners]) listener(change)
  })
}

/** Paths `file.exists` was asked about, in order. */
const askedPaths = (): string[] => exists.mock.calls.map(([request]) => (request as { filePath: string }).filePath)

beforeEach(() => {
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
  vi.restoreAllMocks()
})

async function mount(content: string) {
  let result!: ReturnType<typeof render>
  await act(async () => {
    result = render(ui(content))
  })
  return result
}

describe('MarkdownPreview – remembered link checks', () => {
  it('asks file.exists only about the new target when a link is added', async () => {
    const { rerender } = await mount('[a](./a.md) [b](./b.md) [c](./c.md)')
    expect(askedPaths().sort()).toEqual(['/proj/a.md', '/proj/b.md', '/proj/c.md'])
    exists.mockClear()

    await act(async () => rerender(ui('[a](./a.md) [b](./b.md) [c](./c.md) [d](./d.md)')))
    expect(askedPaths()).toEqual(['/proj/d.md'])
  })

  it('asks nothing while typing changes the text but not the links', async () => {
    const { rerender } = await mount('[a](./a.md)\n\ntext')
    exists.mockClear()
    for (let i = 0; i < 20; i++) {
      await act(async () => rerender(ui(`[a](./a.md)\n\ntext ${'x'.repeat(i)}`)))
    }
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

  it('re-checks after a catch-up refresh, but not after content-only changes', async () => {
    await mount('[a](./a.md)')
    exists.mockClear()

    await broadcast({ summary: { change: 3 } })
    expect(exists).not.toHaveBeenCalled()

    await broadcast({ summary: {}, catchUp: true })
    expect(askedPaths()).toEqual(['/proj/a.md'])
  })

  it("re-checks after this window's own file operation (the watcher is paused for those)", async () => {
    exists.mockResolvedValue(false)
    const { container } = await mount('[new](./created.md)')
    expect(container.querySelector('a')?.className).toBe('broken-link')

    exists.mockResolvedValue(true)
    await act(async () => {
      await fileGateway.createFile({ dirPath: '/proj', name: 'created.md' })
    })
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
    // lands before React has re-rendered for the change: it must be dropped.
    await act(async () => {
      for (const listener of [...directoryListeners]) listener({ summary: { unlink: 1 } })
      releaseFirst(false)
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
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
})
