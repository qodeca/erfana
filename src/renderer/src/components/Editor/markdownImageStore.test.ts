// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The preview's image store (#71): what it reads, how it refreshes on the
 * existing watcher signals (debounced, version-gated, held while hidden), and
 * its bounds (images per document, reads in flight).
 */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import type {
  MarkdownImageReadRequest,
  MarkdownImageReadResponse
} from '../../../../shared/ipc/markdown-image-schema'
import { MAX_MARKDOWN_IMAGES_PER_DOCUMENT } from '../../../../shared/ipc/markdown-image-schema'
import {
  MARKDOWN_IMAGE_MAX_CONCURRENT_READS,
  MARKDOWN_IMAGE_MAX_WAIT_MS,
  MARKDOWN_IMAGE_RELEASE_GRACE_MS,
  MARKDOWN_IMAGE_RETRY_FIRST_MS,
  MARKDOWN_IMAGE_RETRY_WINDOW_MS,
  MARKDOWN_IMAGE_SETTLE_MS,
  ImageByteBudget,
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
let decode: Mock
let budget: ImageByteBudget

function makeStore(documentPath = '/p/docs/doc.md', platform: NodeJS.Platform = 'darwin'): MarkdownImageStore {
  const store = new MarkdownImageStore({
    read: disk.read,
    getProjectPath: async () => '/p',
    decode,
    budget,
    platform: () => platform,
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
  budget = new ImageByteBudget(1_000_000)
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

describe('MarkdownImageStore – files, not spellings', () => {
  it('shares one read and one cap slot between spellings of the same file', async () => {
    disk.write('/p/docs/a.png', 'A1')
    const store = makeStore()
    for (const spelling of ['./a.png', 'a.png', './x/../a.png', './A.PNG']) store.subscribe(spelling, () => {})
    await flush()
    expect(disk.read).toHaveBeenCalledTimes(1)
    expect(store.size).toBe(1)
    expect(store.getView('./A.PNG')).toEqual({ status: 'ready', url: 'data:image/png;base64,A1' })
  })

  it('keeps names that differ in case apart on a case-sensitive platform', async () => {
    disk.write('/p/docs/a.png', 'lower')
    disk.write('/p/docs/A.png', 'upper')
    const store = makeStore('/p/docs/doc.md', 'linux')
    store.subscribe('./a.png', () => {})
    store.subscribe('./A.png', () => {})
    await flush()
    expect(store.size).toBe(2)
    expect(store.getView('./A.png')).toEqual({ status: 'ready', url: 'data:image/png;base64,upper' })
  })

  it('counts the cap in files, so extra spellings of loaded files are not refused', async () => {
    const store = makeStore()
    for (let i = 0; i < MAX_MARKDOWN_IMAGES_PER_DOCUMENT; i++) store.subscribe(`./${i}.png`, () => {})
    store.subscribe('./x/../1.png', () => {})
    await flush()
    expect(store.size).toBe(MAX_MARKDOWN_IMAGES_PER_DOCUMENT)
    expect(store.getView('./x/../1.png')).not.toEqual({ status: 'unavailable', reason: 'limit' })
  })
})

describe('MarkdownImageStore – byte budget', () => {
  /** Full reads (answers that carried bytes) of one path so far. */
  const fullReads = async (filePath: string): Promise<number> => {
    let count = 0
    for (const [index, [request]] of disk.read.mock.calls.entries()) {
      const answer = await disk.read.mock.results[index].value
      if ((request as MarkdownImageReadRequest).filePath === filePath && answer.status === 'ok') count += 1
    }
    return count
  }

  it('shows an image that does not fit as unavailable, and reads it once room is released', async () => {
    budget = new ImageByteBudget(60)
    disk.write('/p/docs/a.png', 'A'.repeat(20))
    disk.write('/p/docs/b.png', 'B'.repeat(20))
    const store = makeStore()
    const offA = store.subscribe('./a.png', () => {})
    await flush()
    store.subscribe('./b.png', () => {})
    await flush()
    // Each data URL is 22 + 20 characters: one fits, two do not
    expect(store.getView('./a.png').status).toBe('ready')
    expect(store.getView('./b.png')).toEqual({ status: 'unavailable', reason: 'budget' })
    expect(budget.held).toBe(42)

    // Releasing a.png makes room: b.png is read without waiting for a change event
    offA()
    await flush(MARKDOWN_IMAGE_RELEASE_GRACE_MS)
    expect(store.getView('./b.png').status).toBe('ready')
    expect(await fullReads('/p/docs/b.png')).toBe(2)
  })

  it('does not re-read an over-budget image on refresh: 0 full reads over 3 refreshes, 1 after a release', async () => {
    budget = new ImageByteBudget(60)
    disk.write('/p/docs/a.png', 'A'.repeat(20))
    disk.write('/p/docs/b.png', 'B'.repeat(20))
    const store = makeStore()
    const offA = store.subscribe('./a.png', () => {})
    await flush()
    store.subscribe('./b.png', () => {})
    await flush()
    expect(await fullReads('/p/docs/b.png')).toBe(1)

    for (let i = 0; i < 3; i++) {
      directoryChanged()
      await flush(MARKDOWN_IMAGE_SETTLE_MS)
    }
    expect(await fullReads('/p/docs/b.png')).toBe(1)
    expect(decode).toHaveBeenCalledTimes(1)
    expect(store.getView('./b.png')).toEqual({ status: 'unavailable', reason: 'budget' })

    offA()
    await flush(MARKDOWN_IMAGE_RELEASE_GRACE_MS)
    expect(await fullReads('/p/docs/b.png')).toBe(2)
    expect(store.getView('./b.png').status).toBe('ready')
  })

  it('reserves before decoding, and gives the room back when the bytes do not decode', async () => {
    budget = new ImageByteBudget(1_000)
    disk.write('/p/docs/a.png', 'A'.repeat(20))
    let heldDuringDecode = -1
    decode.mockImplementationOnce(async () => {
      heldDuringDecode = budget.held
      throw new Error('bad')
    })
    const store = makeStore()
    store.subscribe('./a.png', () => {})
    await flush()
    expect(heldDuringDecode).toBe(42)
    expect(budget.held).toBe(0)
  })

  it('is shared: a second preview draws from the same budget', async () => {
    budget = new ImageByteBudget(50)
    disk.write('/p/docs/a.png', 'A'.repeat(20))
    const first = makeStore()
    const second = makeStore()
    first.subscribe('./a.png', () => {})
    second.subscribe('./a.png', () => {})
    await flush()
    expect(first.getView('./a.png').status).toBe('ready')
    expect(second.getView('./a.png')).toEqual({ status: 'unavailable', reason: 'budget' })
  })
})

describe('MarkdownImageStore – one read per change', () => {
  it('reads undecodable bytes once, however many refreshes follow', async () => {
    disk.write('/p/docs/a.png', 'BAD')
    decode.mockRejectedValue(new Error('bad'))
    const store = makeStore()
    store.subscribe('./a.png', () => {})
    await flush()
    for (let i = 0; i < 3; i++) {
      directoryChanged()
      await flush(MARKDOWN_IMAGE_SETTLE_MS)
    }
    const answers = await Promise.all(disk.read.mock.results.map((r) => r.value))
    expect(answers.filter((a) => a.status === 'ok')).toHaveLength(1)
    expect(answers.filter((a) => a.status === 'unchanged')).toHaveLength(3)
    expect(decode).toHaveBeenCalledTimes(1)
    expect(store.getView('./a.png')).toEqual({ status: 'unavailable', reason: 'undecodable' })
  })

  it('keeps at most one read per file waiting, and none for a file released meanwhile', async () => {
    const gates: Array<() => void> = []
    disk.read.mockImplementation(
      () =>
        new Promise<MarkdownImageReadResponse>((resolve) => {
          gates.push(() => resolve({ status: 'refused', reason: 'not-found' }))
        })
    )
    const store = makeStore()
    // Fill every slot, so the next reads wait
    for (let i = 0; i < MARKDOWN_IMAGE_MAX_CONCURRENT_READS; i++) store.subscribe(`./busy${i}.png`, () => {})
    const offWaiting = store.subscribe('./waiting.png', () => {})
    await flush()
    expect(disk.read).toHaveBeenCalledTimes(MARKDOWN_IMAGE_MAX_CONCURRENT_READS)

    // Three refreshes while it waits add no further waiting read for it
    store.refresh()
    store.refresh()
    store.refresh()
    // And it is released before a slot frees
    offWaiting()
    await flush(MARKDOWN_IMAGE_RELEASE_GRACE_MS)
    for (const open of gates.splice(0)) open()
    await flush()
    const asked = disk.read.mock.calls.map(([r]) => (r as MarkdownImageReadRequest).filePath)
    expect(asked.filter((p) => p.endsWith('waiting.png'))).toHaveLength(0)
  })
})

describe('MarkdownImageStore – a shown image survives a passing failure', () => {
  /** Make the next reads of a path answer `unreadable`, as a locked file does. */
  function lock(path: string): () => void {
    const real = disk.read.getMockImplementation()!
    disk.read.mockImplementation(async (request: MarkdownImageReadRequest) =>
      request.filePath === path ? { status: 'refused', reason: 'unreadable' } : real(request)
    )
    return () => disk.read.mockImplementation(real)
  }

  it('keeps the image while the file is locked, then shows the new one after the unlock without an event', async () => {
    disk.write('/p/docs/a.png', 'A1')
    const store = makeStore()
    store.subscribe('./a.png', () => {})
    await flush()

    // Another program locks the file and rewrites it
    const unlock = lock('/p/docs/a.png')
    disk.write('/p/docs/a.png', 'A2')
    directoryChanged()
    await flush(MARKDOWN_IMAGE_SETTLE_MS)
    expect(store.getView('./a.png')).toEqual({ status: 'ready', url: 'data:image/png;base64,A1' })

    // Still locked at the first re-try: still the last good image
    await flush(MARKDOWN_IMAGE_RETRY_FIRST_MS)
    expect(store.getView('./a.png')).toEqual({ status: 'ready', url: 'data:image/png;base64,A1' })

    // Unlocked with no further watcher event: the next re-try (2 s) catches it
    unlock()
    await flush(MARKDOWN_IMAGE_RETRY_FIRST_MS * 2)
    expect(store.getView('./a.png')).toEqual({ status: 'ready', url: 'data:image/png;base64,A2' })
  })

  it('stops re-trying a lock that never ends after the re-try window', async () => {
    disk.write('/p/docs/a.png', 'A1')
    const store = makeStore()
    store.subscribe('./a.png', () => {})
    await flush()
    lock('/p/docs/a.png')
    directoryChanged()
    await flush(MARKDOWN_IMAGE_SETTLE_MS)
    const afterEvent = disk.read.mock.calls.length

    await flush(MARKDOWN_IMAGE_RETRY_WINDOW_MS * 3)
    // 1 s, 2 s, 4 s, 8 s fit in the window; 16 s more would pass it
    expect(disk.read.mock.calls.length - afterEvent).toBe(4)
    expect(store.getView('./a.png')).toEqual({ status: 'ready', url: 'data:image/png;base64,A1' })
  })

  it('shows the placeholder when the very first read is unreadable', async () => {
    disk.write('/p/docs/a.png', 'A1')
    lock('/p/docs/a.png')
    const store = makeStore()
    store.subscribe('./a.png', () => {})
    await flush()
    expect(store.getView('./a.png')).toEqual({ status: 'unavailable', reason: 'unreadable' })
  })

  it('keeps the image over bytes that do not decode yet, and shows them once they do', async () => {
    disk.write('/p/docs/a.png', 'A1')
    const store = makeStore()
    store.subscribe('./a.png', () => {})
    await flush()

    disk.write('/p/docs/a.png', 'HALF')
    decode.mockRejectedValueOnce(new Error('truncated'))
    directoryChanged()
    await flush(MARKDOWN_IMAGE_SETTLE_MS)
    expect(store.getView('./a.png')).toEqual({ status: 'ready', url: 'data:image/png;base64,A1' })

    // The writer finishes without a further event; the re-try reads it
    disk.write('/p/docs/a.png', 'A2')
    await flush(MARKDOWN_IMAGE_RETRY_FIRST_MS)
    expect(store.getView('./a.png')).toEqual({ status: 'ready', url: 'data:image/png;base64,A2' })
  })

  it('still removes a shown image whose file was deleted or moved away', async () => {
    disk.write('/p/docs/a.png', 'A1')
    disk.write('/p/docs/b.png', 'B1')
    const store = makeStore()
    store.subscribe('./a.png', () => {})
    store.subscribe('./b.png', () => {})
    await flush()

    disk.files.delete('/p/docs/a.png')
    const real = disk.read.getMockImplementation()!
    disk.read.mockImplementation(async (request: MarkdownImageReadRequest) =>
      request.filePath === '/p/docs/b.png' ? { status: 'refused', reason: 'outside-project' } : real(request)
    )
    directoryChanged()
    await flush(MARKDOWN_IMAGE_SETTLE_MS)
    expect(store.getView('./a.png')).toEqual({ status: 'unavailable', reason: 'not-found' })
    expect(store.getView('./b.png')).toEqual({ status: 'unavailable', reason: 'outside-project' })
  })
})
