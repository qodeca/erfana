// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the self-re-arming single-file watch (Issue #74 hardening, #1).
 *
 * A fake low-level chokidar factory and a controllable atomic-save detector pin
 * the branch behaviour without real timers; one real temp file exercises the
 * re-arm success path, which does a genuine `fs.stat` existence check.
 */
import { describe, it, expect, vi } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FSWatcher } from 'chokidar'
import type { AtomicSaveDetector } from './AtomicSaveDetector'
import { WATCH_DEAD_OUTSIDE_PROJECT } from './atomicRearm'
import { createRearmingSingleFileWatcher } from './rearmingSingleFileWatch'

interface FakeWatcher {
  path: string
  handlers: { onChange: () => void; onUnlink: () => void; onError: (e: unknown) => void }
  close: ReturnType<typeof vi.fn>
  closed: boolean
}

function makeFactory(): {
  factory: (path: string, handlers: FakeWatcher['handlers']) => FSWatcher
  created: FakeWatcher[]
} {
  const created: FakeWatcher[] = []
  const factory = (path: string, handlers: FakeWatcher['handlers']): FSWatcher => {
    const watcher: FakeWatcher = {
      path,
      handlers,
      closed: false,
      close: vi.fn(async () => {
        watcher.closed = true
      })
    }
    created.push(watcher)
    return watcher as unknown as FSWatcher
  }
  return { factory, created }
}

function makeFakeDetector(): {
  detector: AtomicSaveDetector
  fire: (wasAtomicSave: boolean) => void
  dispose: ReturnType<typeof vi.fn>
} {
  let captured: ((path: string, wasAtomicSave: boolean) => void) | null = null
  let capturedPath = ''
  const dispose = vi.fn()
  const detector = {
    registerDelete: vi.fn((path: string, cb: (p: string, w: boolean) => void) => {
      capturedPath = path
      captured = cb
    }),
    cancelPending: vi.fn(),
    cancelAll: vi.fn(),
    hasPending: vi.fn(() => captured !== null),
    getPendingCount: vi.fn(() => (captured !== null ? 1 : 0)),
    dispose
  }
  return {
    detector: detector as unknown as AtomicSaveDetector,
    fire: (wasAtomicSave: boolean) => captured?.(capturedPath, wasAtomicSave),
    dispose
  }
}

describe('createRearmingSingleFileWatcher', () => {
  it('forwards a change to onChange', () => {
    const { factory, created } = makeFactory()
    const { detector } = makeFakeDetector()
    const onChange = vi.fn()
    createRearmingSingleFileWatcher(
      '/proj/a.css',
      { onChange, onDeleted: vi.fn(), onError: vi.fn() },
      { createWatcher: factory, createDetector: () => detector }
    )

    created[0].handlers.onChange()

    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('forwards a watcher error to onError', () => {
    const { factory, created } = makeFactory()
    const { detector } = makeFakeDetector()
    const onError = vi.fn()
    createRearmingSingleFileWatcher(
      '/proj/a.css',
      { onChange: vi.fn(), onDeleted: vi.fn(), onError },
      { createWatcher: factory, createDetector: () => detector }
    )

    const boom = new Error('boom')
    created[0].handlers.onError(boom)

    expect(onError).toHaveBeenCalledWith(boom)
  })

  it('treats a non-reappearing unlink as a genuine delete', async () => {
    const missing = join(tmpdir(), 'rearm-missing-xyz', 'gone.css')
    const { factory, created } = makeFactory()
    const { detector, fire } = makeFakeDetector()
    const onChange = vi.fn()
    const onDeleted = vi.fn()
    createRearmingSingleFileWatcher(
      missing,
      { onChange, onDeleted, onError: vi.fn() },
      { createWatcher: factory, createDetector: () => detector }
    )

    created[0].handlers.onUnlink()
    expect(detector.registerDelete).toHaveBeenCalledWith(missing, expect.any(Function))
    fire(false)

    await vi.waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('re-arms across an atomic save and re-enters the change path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rearm-ok-'))
    const file = join(dir, 'entry.html')
    await writeFile(file, '<html></html>')
    try {
      const { factory, created } = makeFactory()
      const { detector, fire } = makeFakeDetector()
      const onChange = vi.fn()
      const onDeleted = vi.fn()
      createRearmingSingleFileWatcher(
        file,
        { onChange, onDeleted, onError: vi.fn() },
        { createWatcher: factory, createDetector: () => detector, isPathConfined: async () => true }
      )

      created[0].handlers.onUnlink()
      fire(true)

      await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
      // A fresh watcher was opened on the replacement inode, and the old one closed.
      expect(created).toHaveLength(2)
      expect(created[0].closed).toBe(true)
      expect(onDeleted).not.toHaveBeenCalled()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('refuses to re-arm a path that no longer resolves inside the project', async () => {
    const { factory, created } = makeFactory()
    const { detector, fire } = makeFakeDetector()
    const onChange = vi.fn()
    const onWatchDead = vi.fn()
    createRearmingSingleFileWatcher(
      '/proj/a.css',
      { onChange, onDeleted: vi.fn(), onError: vi.fn(), onWatchDead },
      { createWatcher: factory, createDetector: () => detector, isPathConfined: async () => false }
    )

    created[0].handlers.onUnlink()
    fire(true)

    await vi.waitFor(() => expect(onWatchDead).toHaveBeenCalledWith(WATCH_DEAD_OUTSIDE_PROJECT))
    expect(created).toHaveLength(1)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('disposes the detector and closes the watcher on close', async () => {
    const { factory, created } = makeFactory()
    const { detector, dispose } = makeFakeDetector()
    const handle = createRearmingSingleFileWatcher(
      '/proj/a.css',
      { onChange: vi.fn(), onDeleted: vi.fn(), onError: vi.fn() },
      { createWatcher: factory, createDetector: () => detector }
    )

    await handle.close()

    expect(dispose).toHaveBeenCalledTimes(1)
    expect(created[0].close).toHaveBeenCalledTimes(1)
  })
})
