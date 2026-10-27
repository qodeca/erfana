// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The pipeline's default reader and default scanner (issue #124 audit,
 * follow-up). The reader sizes its buffer from the file's length when it opens
 * it; a file that shrinks before it is read is cut to what was read. Without
 * an injected scanner the pipeline uses the shared link scan worker – which a
 * test run has not built, so the page loads with none of its links watched and
 * nothing is scanned on the main thread instead.
 *
 * Its own file because `node:fs/promises` and the logger are mocked at module
 * scope (docs/windows/contributing.md, "Test-file split policy"); the pipeline
 * itself is `previewLivePipeline.test.ts`.
 */
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** The file the fake handle stands for: its length says 32 bytes, but only `content` is left to read. */
const SHRUNK = vi.hoisted(() => ({ path: '', content: '<img src="a.png">' }))

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const open = async (path: string, flags?: string): Promise<unknown> => {
    if (path !== SHRUNK.path) return actual.open(path, flags)
    const bytes = Buffer.from(SHRUNK.content)
    return {
      stat: () => Promise.resolve({ size: 32 }),
      read: (buffer: Uint8Array, offset: number, length: number, position: number) => {
        const chunk = bytes.subarray(position, position + length)
        buffer.set(chunk, offset)
        return Promise.resolve({ bytesRead: chunk.length, buffer })
      },
      close: () => Promise.resolve()
    }
  }
  return { ...actual, default: { ...actual, open }, open }
})

vi.mock('../LoggingService', () => ({
  logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import { logger } from '../LoggingService'
import { inProcessLinkScanner } from './__test-helpers__/inProcessLinkScanner'
import type { PreviewLinkScanner } from './PreviewLinkScanWorkerAdapter'
import { createPreviewLivePipeline, type PreviewLivePipelineDeps } from './previewLivePipeline'
import type { HtmlSource } from './previewLinkScanProtocol'
import type { WatchSetResult } from './PreviewWatchCoordinator'

const PAGE = resolve('/proj/site/index.html')
SHRUNK.path = PAGE

function makePipeline(linkScanner: PreviewLinkScanner | undefined) {
  const setWatchSet = vi.fn((candidates: readonly string[]): Promise<WatchSetResult> =>
    Promise.resolve({ watched: [...candidates], dropped: [] })
  )
  const loadStateChanged = vi.fn()
  const deps: PreviewLivePipelineDeps = {
    panelId: 'panel-A',
    contents: { executeJavaScriptInIsolatedWorld: vi.fn(() => Promise.resolve(true)) },
    emit: { loadStateChanged },
    stillFrameCache: { invalidate: vi.fn() },
    now: () => 0,
    linkScanner,
    currentPage: () => PAGE,
    urlFor: absPath => `erfana-preview://token/${absPath}`,
    setWatchSet,
    recordChange: vi.fn(),
    reloadPage: vi.fn(),
    isWanted: () => true,
    captureWhileVisible: vi.fn(),
    isTornDown: () => false
  }
  return { pipeline: createPreviewLivePipeline(deps), setWatchSet, loadStateChanged }
}

beforeEach(() => {
  vi.mocked(logger.warn).mockClear()
})

describe('createPreviewLivePipeline – the default reader and scanner', () => {
  it('cuts a file that shrank before it was read to what was read', async () => {
    const scanned: HtmlSource[] = []
    const h = makePipeline({
      scan: (html, options) => {
        scanned.push(html)
        return inProcessLinkScanner.scan(html, options)
      }
    })
    h.pipeline.schedule()

    await vi.waitFor(() => expect(h.loadStateChanged).toHaveBeenCalledWith('panel-A', 'ready', 0))
    const [bytes] = scanned
    if (!(bytes instanceof Uint8Array)) throw new Error('expected bytes')
    expect(Buffer.from(bytes).toString('utf8')).toBe(SHRUNK.content)
    expect(h.setWatchSet).toHaveBeenCalledWith([resolve('/proj/site/a.png')], {
      changedSince: expect.any(Number)
    })
  })

  it('uses the shared link scan worker by default: unbuilt in a test run, so no links and one line', async () => {
    const h = makePipeline(undefined)
    h.pipeline.schedule()

    await vi.waitFor(() => expect(h.loadStateChanged).toHaveBeenCalledWith('panel-A', 'ready', 0))
    expect(h.setWatchSet).toHaveBeenCalledWith([], { changedSince: expect.any(Number) })
    expect(vi.mocked(logger.warn).mock.calls).toEqual([
      ['Preview auto-refresh: could not scan a page for its files', { failure: 'unavailable' }]
    ])
  })
})
