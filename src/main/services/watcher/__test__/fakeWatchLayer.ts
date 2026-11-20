// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * Fakes for the watch-layer suites (#478): a chokidar whose watchers a test
 * drives (events, a `ready` it can hold), Electron windows that record what
 * they are sent, and a disk the service's injected `fs` answers from.
 *
 * Use from a suite's module-scope mocks:
 *
 * ```ts
 * vi.mock('chokidar', async () => (await import('./watcher/__test__/fakeWatchLayer')).fakeChokidarModule())
 * vi.mock('electron', async () => (await import('./watcher/__test__/fakeWatchLayer')).fakeElectronModule())
 * ```
 */
import { vi, type Mock } from 'vitest'
import type { ArmFs } from '../armWatch'
import type { FileStamp } from '../../../../shared/freshness/freshnessTypes'

export interface FakeWatcher {
  readonly path: string
  readonly handlers: Map<string, (...args: unknown[]) => void>
  readonly close: Mock<() => Promise<void>>
  /** Says `ready`, once. */
  ready(): void
  /** Fires a chokidar event on it. */
  fire(event: 'change' | 'unlink' | 'error', arg?: unknown): void
}

/** Everything the fakes recorded; reset with {@link resetFakeWatchLayer}. */
export const fakeLayer = {
  watchers: [] as FakeWatcher[],
  sends: [] as Array<{ id: number; channel: string; payload: unknown }>,
  /** When false, a watcher's `ready` waits for the test's `ready()`. */
  autoReady: true,
  /** Path → what the disk holds there: a file identity, or an errno code. */
  disk: new Map<string, { ino: number } | string>(),
  /** Path → what `realpath` resolves it to (a link); absent = itself. */
  links: new Map<string, string>()
}

export function resetFakeWatchLayer(): void {
  fakeLayer.watchers.length = 0
  fakeLayer.sends.length = 0
  fakeLayer.autoReady = true
  fakeLayer.disk.clear()
  fakeLayer.links.clear()
}

/** The newest watcher bound to `path`. */
export function watcherOn(path: string): FakeWatcher | undefined {
  return fakeLayer.watchers.filter(w => w.path === path).at(-1)
}

export function fakeChokidarModule(): { default: { watch: Mock }; watch: Mock } {
  const watch = vi.fn((watchedPath: string) => {
    const handlers = new Map<string, (...args: unknown[]) => void>()
    let readyListener: (() => void) | null = null
    let saidReady = false
    const watcher = {
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        handlers.set(event, listener)
        return watcher
      }),
      once: vi.fn((event: string, listener: () => void) => {
        if (event === 'ready') readyListener = listener
        if (event === 'ready' && fakeLayer.autoReady) queueMicrotask(() => fake.ready())
        return watcher
      }),
      close: vi.fn(async () => {}),
      closed: false
    }
    const fake: FakeWatcher = {
      path: watchedPath,
      handlers,
      close: watcher.close,
      ready: () => {
        if (saidReady) return
        saidReady = true
        readyListener?.()
      },
      fire: (event, arg) => handlers.get(event)?.(arg)
    }
    fakeLayer.watchers.push(fake)
    return watcher
  })
  return { default: { watch }, watch }
}

export function fakeElectronModule(): unknown {
  const win = (id: number) => ({
    isDestroyed: () => false,
    webContents: {
      id,
      send: (channel: string, payload: unknown) => fakeLayer.sends.push({ id, channel, payload })
    }
  })
  return { BrowserWindow: { getAllWindows: vi.fn(() => [win(1), win(2)]) } }
}

const errno = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code })

/** The `fs` the service is given: answers from {@link fakeLayer}'s disk and links. */
export const fakeFs: ArmFs = {
  realpath: async filePath => {
    const target = fakeLayer.links.get(filePath) ?? filePath
    const state = fakeLayer.disk.get(target)
    if (state === undefined) throw errno('ENOENT')
    if (typeof state === 'string') throw errno(state)
    return target
  },
  stat: async filePath => {
    const state = fakeLayer.disk.get(filePath)
    if (state === undefined) throw errno('ENOENT')
    if (typeof state === 'string') throw errno(state)
    return { isFile: () => true, dev: 1, ino: state.ino, birthtimeMs: state.ino }
  }
}

/** `lstat` over the same disk, for the health round. */
export async function fakeLstat(filePath: string): Promise<{ dev: number; ino: number; birthtimeMs: number }> {
  const state = fakeLayer.disk.get(filePath)
  if (state === undefined) throw errno('ENOENT')
  if (typeof state === 'string') throw errno(state)
  return { dev: 1, ino: state.ino, birthtimeMs: state.ino }
}

/** The stamp every file is given. */
export const FAKE_STAMP: FileStamp = { size: 1, mtimeMs: 1, ctimeMs: 1, ino: '1' }

/** The `file-watch:event` payloads sent to window `id`. */
export function eventsTo(id: number): unknown[] {
  return fakeLayer.sends.filter(s => s.id === id && s.channel === 'file-watch:event').map(s => s.payload)
}

/**
 * `fs/promises` with `stat`, `realpath` and `lstat` over the fake disk (the
 * write-finish gate, the presence checks and the health round all ask it):
 *
 * ```ts
 * vi.mock('fs/promises', async importOriginal =>
 *   (await import('./watcher/__test__/fakeWatchLayer')).fakeFsPromisesModule(importOriginal))
 * ```
 */
export async function fakeFsPromisesModule(importOriginal: () => Promise<unknown>): Promise<unknown> {
  const real = (await importOriginal()) as Record<string, unknown>
  return {
    ...real,
    realpath: fakeFs.realpath,
    stat: async (filePath: string) => ({ ...(await fakeFs.stat(filePath)), size: 1 }),
    lstat: fakeLstat
  }
}
