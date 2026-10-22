// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The preview's image store (#71): what it reads, how it refreshes on the
 * existing watcher signals (debounced, version-gated, held while hidden), and
 * its bounds (images per document, reads in flight).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type {
  MarkdownImageReadRequest,
  MarkdownImageReadResponse
} from '../../../../shared/ipc/markdown-image-schema'
import { MAX_MARKDOWN_IMAGES_PER_DOCUMENT } from '../../../../shared/ipc/markdown-image-schema'
import {
  MARKDOWN_IMAGE_MAX_CONCURRENT_READS,
  MARKDOWN_IMAGE_MAX_WAIT_MS,
  MARKDOWN_IMAGE_RELEASE_GRACE_MS,
  MARKDOWN_IMAGE_SETTLE_MS,
  MarkdownImageStore
} from './markdownImageStore'

vi.mock('../../utils/logger', () => ({
  logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }
}))

/** A fake disk: path -> bytes label; each write bumps the version. */
class FakeDisk {
  readonly files = new Map<string, { label: string; version: number }>()
  write(path: string, label: string): void {
    const previous = this.files.get(path)?.version ?? 0
    this.files.set(path, { label, version: previous + 1 })
  }
  readonly read = vi.fn(async (request: MarkdownImageReadRequest): Promise<MarkdownImageReadResponse> => {
    const file = this.files.get(request.filePath)
    if (!file) return { status: 'refused', reason: 'not-found' }
    const version = String(file.version)
    if (request.knownVersion === version) return { status: 'unchanged', version }
    return { status: 'ok', dataUrl: `data:image/png;base64,${file.label}`, version }
  })
}

let disk: FakeDisk
let directoryListeners: Set<() => void>
let ownListeners: Set<() => void>
let decode: ReturnType<typeof vi.fn>

function makeStore(documentPath = '/p/docs/doc.md'): MarkdownImageStore {
  const store = new MarkdownImageStore({
    read: disk.read,
    getProjectPath: async () => '/p',
    decode,
    platform: () => 'darwin',
    onDirectoryChanged: (callback) => {
      directoryListeners.add(callback)
      return () => directoryListeners.delete(callback)
    },
    onFileStructureChanged: (callback) => {
      ownListeners.add(callback)
      return () => ownListeners.delete(callback)
    }
  })
  store.setDocument(documentPath)
  return store
}

/** Let timers and the promise chains they start run. */
async function flush(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
}

function directoryChanged(): void {
  for (const listener of [...directoryListeners]) listener()
}

beforeEach(() => {
  vi.useFakeTimers()
  disk = new FakeDisk()
  directoryListeners = new Set()
  ownListeners = new Set()
  decode = vi.fn(async () => {})
})

afterEach(() => {
  vi.useRealTimers()
})

describe('MarkdownImageStore – reading', () => {
  it('reads a document-relative image as a data URL', async () => {
    disk.write('/p/docs/img/a.png', 'A1')
    const store = makeStore()
    const listener = vi.fn()
    store.subscribe('./img/a.png', listener)
    expect(store.getView('./img/a.png')).toEqual({ status: 'loading' })

    await flush()
    expect(store.getView('./img/a.png')).toEqual({ status: 'ready', url: 'data:image/png;base64,A1' })
    expect(disk.read).toHaveBeenCalledWith({ filePath: '/p/docs/img/a.png', knownVersion: undefined })
    expect(listener).toHaveBeenCalled()
  })

  it('never asks about a path that leaves the project or is not an image type', async () => {
    const store = makeStore()
    store.subscribe('../../etc/a.png', () => {})
    store.subscribe('./notes.txt', () => {})
    await flush()
    expect(store.getView('../../etc/a.png')).toEqual({ status: 'unavailable', reason: 'outside-project' })
    expect(store.getView('./notes.txt')).toEqual({ status: 'unavailable', reason: 'unsupported-type' })
    expect(disk.read).not.toHaveBeenCalled()
  })

  it('shows the main-process refusal reason', async () => {
    const store = makeStore()
    store.subscribe('./missing.png', () => {})
    await flush()
    expect(store.getView('./missing.png')).toEqual({ status: 'unavailable', reason: 'not-found' })
  })

  it('shares one read between elements showing the same image', async () => {
    disk.write('/p/docs/a.png', 'A1')
    const store = makeStore()
    store.subscribe('./a.png', () => {})
    store.subscribe('./a.png', () => {})
    await flush()
    expect(disk.read).toHaveBeenCalledTimes(1)
  })

  it('reports undecodable bytes instead of showing a broken image', async () => {
    disk.write('/p/docs/a.png', 'A1')
    decode.mockRejectedValueOnce(new Error('bad'))
    const store = makeStore()
    store.subscribe('./a.png', () => {})
    await flush()
    expect(store.getView('./a.png')).toEqual({ status: 'unavailable', reason: 'undecodable' })
  })

  it('keeps at most MAX_CONCURRENT reads in flight', async () => {
    let inFlight = 0
    let peak = 0
    disk.read.mockImplementation(async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 10))
      inFlight -= 1
      return { status: 'refused', reason: 'not-found' }
    })
    const store = makeStore()
    for (let i = 0; i < 12; i++) store.subscribe(`./${i}.png`, () => {})
    await flush(200)
    expect(disk.read).toHaveBeenCalledTimes(12)
    expect(peak).toBe(MARKDOWN_IMAGE_MAX_CONCURRENT_READS)
  })

  it('shows images past the per-document cap as unavailable without reading them', async () => {
    const store = makeStore()
    for (let i = 0; i <= MAX_MARKDOWN_IMAGES_PER_DOCUMENT; i++) store.subscribe(`./${i}.png`, () => {})
    await flush()
    expect(disk.read).toHaveBeenCalledTimes(MAX_MARKDOWN_IMAGES_PER_DOCUMENT)
    expect(store.getView(`./${MAX_MARKDOWN_IMAGES_PER_DOCUMENT}.png`)).toEqual({
      status: 'unavailable',
      reason: 'limit'
    })
  })

  it('re-reads every shown image relative to a new document path', async () => {
    disk.write('/p/docs/a.png', 'DOCS')
    disk.write('/p/other/a.png', 'OTHER')
    const store = makeStore()
    store.subscribe('./a.png', () => {})
    await flush()
    store.setDocument('/p/other/doc.md')
    await flush()
    expect(store.getView('./a.png')).toEqual({ status: 'ready', url: 'data:image/png;base64,OTHER' })
  })

  it('forgets an image nobody shows after the grace period', async () => {
    disk.write('/p/docs/a.png', 'A1')
    const store = makeStore()
    const off = store.subscribe('./a.png', () => {})
    await flush()
    off()
    expect(store.size).toBe(1)
    await flush(MARKDOWN_IMAGE_RELEASE_GRACE_MS)
    expect(store.size).toBe(0)
  })
})

describe('MarkdownImageStore – refresh', () => {
  it('re-reads a changed image once a burst of change events settles', async () => {
    disk.write('/p/docs/a.png', 'A1')
    const store = makeStore()
    store.subscribe('./a.png', () => {})
    await flush()

    disk.write('/p/docs/a.png', 'A2')
    directoryChanged()
    directoryChanged()
    await flush(MARKDOWN_IMAGE_SETTLE_MS - 1)
    expect(store.getView('./a.png')).toEqual({ status: 'ready', url: 'data:image/png;base64,A1' })

    await flush(1)
    expect(store.getView('./a.png')).toEqual({ status: 'ready', url: 'data:image/png;base64,A2' })
    // Two events, one re-check
    expect(disk.read).toHaveBeenCalledTimes(2)
  })

  it('re-checks with the version shown, so an unchanged image is not re-sent', async () => {
    disk.write('/p/docs/a.png', 'A1')
    disk.write('/p/docs/b.png', 'B1')
    const store = makeStore()
    const listenerA = vi.fn()
    store.subscribe('./a.png', listenerA)
    store.subscribe('./b.png', () => {})
    await flush()
    const viewA = store.getView('./a.png')
    listenerA.mockClear()

    disk.write('/p/docs/b.png', 'B2')
    directoryChanged()
    await flush(MARKDOWN_IMAGE_SETTLE_MS)

    expect(disk.read).toHaveBeenCalledWith({ filePath: '/p/docs/a.png', knownVersion: '1' })
    expect(store.getView('./a.png')).toBe(viewA)
    expect(listenerA).not.toHaveBeenCalled()
    expect(store.getView('./b.png')).toEqual({ status: 'ready', url: 'data:image/png;base64,B2' })
  })

  it('caps how long a continuous burst postpones the re-check', async () => {
    disk.write('/p/docs/a.png', 'A1')
    const store = makeStore()
    store.subscribe('./a.png', () => {})
    await flush()
    disk.write('/p/docs/a.png', 'A2')
    for (let t = 0; t < MARKDOWN_IMAGE_MAX_WAIT_MS; t += 100) {
      directoryChanged()
      await flush(100)
    }
    expect(store.getView('./a.png')).toEqual({ status: 'ready', url: 'data:image/png;base64,A2' })
  })

  it('refreshes on this window’s own file operations too', async () => {
    const store = makeStore()
    store.subscribe('./a.png', () => {})
    await flush()
    expect(store.getView('./a.png')).toEqual({ status: 'unavailable', reason: 'not-found' })

    disk.write('/p/docs/a.png', 'A1')
    for (const listener of [...ownListeners]) listener()
    await flush(MARKDOWN_IMAGE_SETTLE_MS)
    expect(store.getView('./a.png')).toEqual({ status: 'ready', url: 'data:image/png;base64,A1' })
  })

  it('shows a deleted image as not found', async () => {
    disk.write('/p/docs/a.png', 'A1')
    const store = makeStore()
    store.subscribe('./a.png', () => {})
    await flush()
    disk.files.delete('/p/docs/a.png')
    directoryChanged()
    await flush(MARKDOWN_IMAGE_SETTLE_MS)
    expect(store.getView('./a.png')).toEqual({ status: 'unavailable', reason: 'not-found' })
  })

  it('keeps the last good image when new bytes do not decode (half-written file)', async () => {
    disk.write('/p/docs/a.png', 'A1')
    const store = makeStore()
    store.subscribe('./a.png', () => {})
    await flush()
    disk.write('/p/docs/a.png', 'TRUNCATED')
    decode.mockRejectedValueOnce(new Error('truncated'))
    directoryChanged()
    await flush(MARKDOWN_IMAGE_SETTLE_MS)
    expect(store.getView('./a.png')).toEqual({ status: 'ready', url: 'data:image/png;base64,A1' })
  })

  it('reads nothing while hidden and catches up once when shown', async () => {
    disk.write('/p/docs/a.png', 'A1')
    const store = makeStore()
    store.subscribe('./a.png', () => {})
    await flush()

    store.setVisible(false)
    disk.write('/p/docs/a.png', 'A2')
    directoryChanged()
    directoryChanged()
    await flush(MARKDOWN_IMAGE_MAX_WAIT_MS * 2)
    expect(disk.read).toHaveBeenCalledTimes(1)
    expect(store.getView('./a.png')).toEqual({ status: 'ready', url: 'data:image/png;base64,A1' })

    store.setVisible(true)
    await flush()
    expect(disk.read).toHaveBeenCalledTimes(2)
    expect(store.getView('./a.png')).toEqual({ status: 'ready', url: 'data:image/png;base64,A2' })
  })

  it('does not read a hidden preview’s images until it is shown', async () => {
    disk.write('/p/docs/a.png', 'A1')
    const store = makeStore()
    store.setVisible(false)
    store.subscribe('./a.png', () => {})
    await flush()
    expect(disk.read).not.toHaveBeenCalled()
    store.setVisible(true)
    await flush()
    expect(store.getView('./a.png')).toEqual({ status: 'ready', url: 'data:image/png;base64,A1' })
  })

  it('stops listening when the last image goes', async () => {
    const store = makeStore()
    const off = store.subscribe('./a.png', () => {})
    expect(directoryListeners.size).toBe(1)
    expect(ownListeners.size).toBe(1)
    off()
    expect(directoryListeners.size).toBe(0)
    expect(ownListeners.size).toBe(0)
  })
})
