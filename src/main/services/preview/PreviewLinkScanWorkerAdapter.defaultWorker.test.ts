// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The production worker factory of `PreviewLinkScanClient` (issue #124 audit,
 * follow-up): the built bundle next to the main bundle
 * (`out/main/preview-link-scan.worker.js`), started in its role with a heap
 * ceiling – or no worker at all when the bundle is missing, which leaves
 * auto-refresh with no links instead of scanning on the main thread.
 * `node:fs` and `node:worker_threads` are mocked at module scope, hence a file
 * of its own.
 */
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PreviewLinkScanClient, WORKER_HEAP_MB } from './PreviewLinkScanWorkerAdapter'
import { PREVIEW_LINK_SCAN_WORKER_ROLE } from './previewLinkScanProtocol'

const WORKER_FILE = 'preview-link-scan.worker.js'

const state = vi.hoisted(() => ({
  bundlePresent: false,
  started: [] as Array<{ path: string; options: unknown }>
}))

vi.mock('../LoggingService', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  const existsSync = (path: string): boolean =>
    path.endsWith('preview-link-scan.worker.js') ? state.bundlePresent : actual.existsSync(path)
  return { ...actual, default: { ...actual, existsSync }, existsSync }
})

vi.mock('node:worker_threads', async importOriginal => {
  const actual = await importOriginal<typeof import('node:worker_threads')>()
  const { EventEmitter } = await import('node:events')
  /** Records how it was started; answers every request with an error outcome. */
  class RecordingWorker extends EventEmitter {
    constructor(path: string, options: unknown) {
      super()
      state.started.push({ path, options })
    }
    postMessage(message: { id: number }): void {
      queueMicrotask(() =>
        this.emit('message', { type: 'result', id: message.id, outcome: { kind: 'error', error: 'Error' } })
      )
    }
    terminate(): Promise<number> {
      return Promise.resolve(1)
    }
    unref(): void {}
  }
  return { ...actual, default: { ...actual, Worker: RecordingWorker }, Worker: RecordingWorker }
})

beforeEach(() => {
  state.bundlePresent = false
  state.started.length = 0
})

describe('PreviewLinkScanClient – the production worker', () => {
  it('starts no worker when the bundle is missing: no links, never a scan on main', async () => {
    const client = new PreviewLinkScanClient()
    await expect(client.scan('<img src="a.png">', { frames: true })).resolves.toEqual({
      kind: 'failed',
      failure: 'unavailable'
    })
    expect(state.started).toEqual([])
  })

  it('starts the bundle beside the main bundle, in its role, with its heap ceiling', async () => {
    state.bundlePresent = true
    const client = new PreviewLinkScanClient()
    // The recording worker answers an error outcome: the request made the round trip.
    await expect(client.scan('<img src="a.png">', { frames: true })).resolves.toEqual({
      kind: 'error',
      error: 'Error'
    })
    expect(state.started).toEqual([
      {
        path: join(__dirname, WORKER_FILE),
        options: {
          workerData: { role: PREVIEW_LINK_SCAN_WORKER_ROLE },
          resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB }
        }
      }
    ])
    expect(WORKER_HEAP_MB).toBe(512)
    await client.dispose()
  })
})
