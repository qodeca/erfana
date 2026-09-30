// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * NativeRecursiveWatcher (#211, W12) against an in-memory, case-insensitive
 * file system: every `fs` function is injected, timers are fake, and no real
 * `fs.watch` handle is ever opened. The real-filesystem suite is
 * `NativeRecursiveWatcher.win32.test.ts` (W14).
 */
import path from 'path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../LoggingService', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }
}))

import { logger } from '../LoggingService'
import {
  NativeRecursiveWatcher,
  type NativeDirEntry,
  type NativeFsWatch,
  type NativeRecursiveWatcherOptions,
  type NativeWatchListener
} from './NativeRecursiveWatcher'
import type { NativeEventClassifier, NativeLstatResult } from './NativeEventClassifier'

/** The caller's spelling of the project root (host separators). */
const ROOT = path.join(path.sep, 'proj')
/** What `realpathSync.native` resolves the root to. */
const REAL_ROOT = 'C:\\Real\\Proj'

type NodeType = 'dir' | 'file' | 'link'

const codeError = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code })
const flush = (): Promise<void> => new Promise(resolve => setImmediate(resolve))
const toSlash = (value: string): string => value.replace(/\\/g, '/')

class FakeHandle {
  closed = false
  private readonly errorListeners: Array<(error: Error) => void> = []

  constructor(
    private readonly fsx: FakeFs,
    readonly rel: string,
    readonly realPath: string,
    readonly recursive: boolean,
    private readonly listener: NativeWatchListener
  ) {}

  readonly close = vi.fn((): void => {
    this.closed = true
    this.fsx.log.push(`close:${this.rel}`)
  })

  on(event: 'error', listener: (error: Error) => void): this {
    if (event === 'error') this.errorListeners.push(listener)
    return this
  }

  /** Deliver a raw event – even after `close()`, as libuv may before the close takes effect. */
  fire(eventType: 'rename' | 'change', filename: string | null): void {
    this.listener(eventType, filename)
  }

  fail(code: string): void {
    for (const listener of this.errorListeners) listener(codeError(code))
  }
}

interface FakeNode {
  readonly name: string
  readonly type: NodeType
}

/** A case-insensitive file system (like NTFS) keyed by root-relative paths. */
class FakeFs {
  readonly nodes = new Map<string, FakeNode>()
  readonly handles: FakeHandle[] = []
  readonly log: string[] = []
  readonly lstatCodes = new Map<string, string>()
  readonly watchCodes = new Map<string, string>()
  readonly readdirCodes = new Map<string, string>()
  readonly heldReaddirs = new Map<string, () => void>()
  readonly holdReaddirFor = new Set<string>()
  readonly heldLstats: Array<() => void> = []
  holdLstats = false
  rootExists = true
  realpathCode: string | null = null

  constructor(readonly realRoot: string = REAL_ROOT) {}

  add(rel: string, type: NodeType = 'dir'): this {
    const segments = rel.split('/')
    for (let depth = 1; depth < segments.length; depth++) {
      const parent = segments.slice(0, depth).join('/')
      if (!this.nodes.has(parent.toLowerCase())) this.nodes.set(parent.toLowerCase(), { name: segments[depth - 1], type: 'dir' })
    }
    this.nodes.set(rel.toLowerCase(), { name: segments[segments.length - 1], type })
    return this
  }

  remove(rel: string): void {
    const key = rel.toLowerCase()
    for (const nodeKey of [...this.nodes.keys()]) {
      if (nodeKey === key || nodeKey.startsWith(`${key}/`)) this.nodes.delete(nodeKey)
    }
  }

  rename(from: string, to: string): void {
    const fromKey = from.toLowerCase()
    const moved = [...this.nodes.entries()].filter(([key]) => key === fromKey || key.startsWith(`${fromKey}/`))
    this.remove(from)
    for (const [key, node] of moved) {
      const rest = key.slice(fromKey.length)
      this.nodes.set(`${to.toLowerCase()}${rest}`, rest === '' ? { name: to.split('/').pop() as string, type: node.type } : node)
    }
  }

  relOf(realPath: string): string {
    const target = toSlash(realPath)
    const root = toSlash(this.realRoot)
    if (target.toLowerCase() === root.toLowerCase()) return ''
    if (!target.toLowerCase().startsWith(`${root.toLowerCase()}/`)) throw new Error(`outside the fake root: ${realPath}`)
    return target.slice(root.length + 1)
  }

  typeOf(rel: string): NodeType | undefined {
    if (rel === '') return this.rootExists ? 'dir' : undefined
    return this.nodes.get(rel.toLowerCase())?.type
  }

  readonly fsWatch = vi.fn(
    (target: string, options: { recursive: boolean }, listener: NativeWatchListener): FakeHandle => {
      const rel = this.relOf(target)
      this.log.push(`watch:${rel}`)
      const code = this.watchCodes.get(rel.toLowerCase())
      if (code) throw codeError(code)
      if (this.typeOf(rel) !== 'dir') throw codeError('ENOENT')
      const handle = new FakeHandle(this, rel, target, options.recursive, listener)
      this.handles.push(handle)
      return handle
    }
  )

  readonly lstat = vi.fn((target: string): Promise<NativeLstatResult> => {
    const rel = this.relOf(target)
    this.log.push(`lstat:${rel}`)
    const answer = (): Promise<NativeLstatResult> => {
      const code = this.lstatCodes.get(rel.toLowerCase())
      if (code) return Promise.reject(codeError(code))
      const type = this.typeOf(rel)
      if (type === undefined) return Promise.reject(codeError('ENOENT'))
      return Promise.resolve({ isDirectory: () => type === 'dir', isSymbolicLink: () => type === 'link' })
    }
    if (!this.holdLstats) return answer()
    return new Promise<NativeLstatResult>((resolve, reject) => {
      this.heldLstats.push(() => answer().then(resolve, reject))
    })
  })

  readonly readdir = vi.fn((target: string): Promise<NativeDirEntry[]> => {
    const rel = this.relOf(target)
    this.log.push(`readdir:${rel}`)
    const answer = (): NativeDirEntry[] => {
      const code = this.readdirCodes.get(rel.toLowerCase())
      if (code) throw codeError(code)
      if (this.typeOf(rel) !== 'dir') throw codeError('ENOENT')
      const prefix = rel === '' ? '' : `${rel.toLowerCase()}/`
      return [...this.nodes.entries()]
        .filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
        .map(([, node]) => ({
          name: node.name,
          isDirectory: () => node.type === 'dir',
          isFile: () => node.type === 'file',
          isSymbolicLink: () => node.type === 'link'
        }))
    }
    if (!this.holdReaddirFor.has(rel.toLowerCase())) return Promise.resolve().then(answer)
    return new Promise<NativeDirEntry[]>((resolve, reject) => {
      this.heldReaddirs.set(rel.toLowerCase(), () => Promise.resolve().then(answer).then(resolve, reject))
    })
  })

  readonly realpathNative = vi.fn((): string => {
    if (this.realpathCode) throw codeError(this.realpathCode)
    return this.realRoot
  })

  /** The handle currently open for a root-relative path. */
  open(rel: string): FakeHandle {
    const handle = this.handles.find(candidate => !candidate.closed && candidate.rel.toLowerCase() === rel.toLowerCase())
    if (!handle) throw new Error(`no open handle for '${rel}'`)
    return handle
  }

  /** Open handles as `rel → recursive`, lower-cased and sorted. */
  openShape(): Record<string, boolean> {
    const shape: Record<string, boolean> = {}
    for (const handle of this.handles.filter(candidate => !candidate.closed).sort((a, b) => a.rel.localeCompare(b.rel))) {
      shape[handle.rel.toLowerCase()] = handle.recursive
    }
    return shape
  }

  watchCount(rel: string): number {
    return this.fsWatch.mock.calls.filter(([target]) => this.relOf(target).toLowerCase() === rel.toLowerCase()).length
  }

  lstatCount(rel?: string): number {
    return this.log.filter(line => line.startsWith('lstat:') && (rel === undefined || line.slice(6).toLowerCase() === rel.toLowerCase())).length
  }
}

/** The project most tests start from. */
function standardTree(fsx: FakeFs = new FakeFs()): FakeFs {
  return fsx
    .add('.git/objects')
    .add('node_modules/lib')
    .add('src/app.ts', 'file')
    .add('docs/guide.md', 'file')
    .add('README.md', 'file')
    .add('junction', 'link')
    .add('dirlink', 'link')
    .add('filelink', 'link')
    .add('packages/x/node_modules/dep')
    .add('packages/x/src')
    .add('packages/y')
    .add('build/cache/blob', 'file')
    .add('build/out')
}

const STANDARD_SPLIT_PATHS = ['build/cache', 'packages/x/node_modules']

/** Hidden `.git`, ignored `node_modules`, excluded `build/cache` (like ProjectPathFilter). */
function defaultDrop(extraExcluded: readonly string[] = []): (rel: string) => boolean {
  const excluded = ['build/cache', ...extraExcluded]
  return rel =>
    rel.split('/').some(segment => segment === '.git' || segment === 'node_modules') ||
    excluded.some(entry => rel.toLowerCase() === entry || rel.toLowerCase().startsWith(`${entry}/`))
}

/** `.local/test-tmp` is excluded, so `.local` is a split folder. */
const dropLocalTestTmp = (rel: string): boolean => rel.toLowerCase().startsWith('.local/test-tmp')

type Recorded = { type: string; rel?: string; value?: unknown }

function startWatcher(fsx: FakeFs, overrides: Partial<NativeRecursiveWatcherOptions> = {}) {
  const shouldDrop = vi.fn(overrides.shouldDrop ?? defaultDrop())
  const watcher = new NativeRecursiveWatcher(ROOT, {
    splitPaths: STANDARD_SPLIT_PATHS,
    caseSensitive: false,
    fsWatch: fsx.fsWatch,
    lstat: fsx.lstat,
    readdir: fsx.readdir,
    realpathNative: fsx.realpathNative,
    now: () => Date.now(),
    ...overrides,
    shouldDrop
  })
  const events: Recorded[] = []
  for (const type of ['add', 'addDir', 'unlink', 'unlinkDir', 'change'] as const) {
    watcher.on(type, (target: string) => {
      const rel = toSlash(path.relative(ROOT, target))
      events.push({ type, rel })
      fsx.log.push(`event:${type}:${rel}`)
    })
  }
  watcher.on('ready', () => events.push({ type: 'ready' }))
  watcher.on('resync', reason => events.push({ type: 'resync', value: reason }))
  watcher.on('error', (error: Error) => events.push({ type: 'error', value: (error as NodeJS.ErrnoException).code }))
  watcher.on('overflow', () => events.push({ type: 'overflow' }))
  const of = (type: string): Recorded[] => events.filter(event => event.type === type)
  const paths = (type: string): Array<string | undefined> => of(type).map(event => event.rel)
  return { watcher, events, shouldDrop, of, paths }
}

function classifierOf(watcher: NativeRecursiveWatcher): NativeEventClassifier {
  return (watcher as unknown as { classifier: NativeEventClassifier }).classifier
}

describe('NativeRecursiveWatcher (#211, W12)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('construction', () => {
    it('throws ENOENT when the root cannot be resolved', () => {
      const fsx = standardTree()
      fsx.realpathCode = 'ENOENT'
      expect(() => startWatcher(fsx)).toThrow(expect.objectContaining({ code: 'ENOENT' }))
    })

    it('reports EPERM on the root as ENOENT, from realpath or from the watch', () => {
      const fromRealpath = standardTree()
      fromRealpath.realpathCode = 'EPERM'
      expect(() => startWatcher(fromRealpath)).toThrow(expect.objectContaining({ code: 'ENOENT' }))

      const fromWatch = standardTree()
      fromWatch.watchCodes.set('', 'EPERM')
      expect(() => startWatcher(fromWatch)).toThrow(expect.objectContaining({ code: 'ENOENT' }))
    })

    it('watches the root as given when resolving it fails other than as gone (C-M2)', async () => {
      // The fake root is the caller's own spelling, so only the fallback resolves inside it
      const fsx = standardTree(new FakeFs(ROOT))
      fsx.realpathCode = 'EISDIR'
      const { of } = startWatcher(fsx)
      await flush()

      expect(fsx.fsWatch.mock.calls[0][0]).toBe(ROOT)
      expect(fsx.open('src').realPath).toBe(path.join(ROOT, 'src'))
      expect(of('ready')).toHaveLength(1)
      expect(of('error')).toEqual([])
      expect(logger.warn).toHaveBeenCalledWith('Native watcher: resolving the root failed, watching it as given', {
        code: 'EISDIR'
      })
    })

    it('watches the root synchronously and emits ready only after the plan', async () => {
      const fsx = standardTree()
      fsx.holdReaddirFor.add('packages')
      const { of } = startWatcher(fsx)

      expect(fsx.openShape()).toEqual({ '': false })
      await flush()
      expect(of('ready')).toHaveLength(0)

      fsx.heldReaddirs.get('packages')?.()
      await flush()
      expect(of('ready')).toHaveLength(1)
    })
  })

  describe('plan (D1)', () => {
    it('gives no handle to dropped folders, the excluded chain, a hinted nested node_modules or links', async () => {
      const fsx = standardTree()
      const { watcher, of } = startWatcher(fsx)
      await flush()

      expect(of('ready')).toHaveLength(1)
      expect(fsx.openShape()).toEqual({
        '': false,
        build: false,
        'build/out': true,
        docs: true,
        packages: false,
        'packages/x': false,
        'packages/x/src': true,
        'packages/y': true,
        src: true
      })
      expect(watcher.getPlanStats()).toMatchObject({
        handles: 9,
        recursiveWatches: 5,
        splitFolders: 4,
        planCapped: false
      })
      expect(watcher.getPlanStats().elapsedMs).toEqual(expect.any(Number))
      // Only the link-typed entries are confirmed with lstat – never a dropped one
      expect(fsx.log.filter(line => line.startsWith('lstat:')).sort()).toEqual(['lstat:dirlink', 'lstat:filelink', 'lstat:junction'])
    })

    it('opens every handle under the realpath while events carry the caller’s root', async () => {
      const fsx = standardTree()
      const { paths } = startWatcher(fsx)
      await flush()

      for (const [target] of fsx.fsWatch.mock.calls) {
        expect(toSlash(target).toLowerCase().startsWith(toSlash(REAL_ROOT).toLowerCase())).toBe(true)
      }
      expect(fsx.open('src').realPath).toBe(path.join(REAL_ROOT, 'src'))

      fsx.add('src/new.md', 'file')
      fsx.open('src').fire('rename', 'new.md')
      await flush()

      expect(paths('add')).toEqual(['src/new.md'])
    })

    it('keys split folders case-folded, so .Local/test-tmp still splits .local', async () => {
      const fsx = new FakeFs().add('.local/test-tmp/x').add('.local/keep')
      startWatcher(fsx, {
        splitPaths: ['.Local/test-tmp'],
        shouldDrop: rel => rel.toLowerCase().startsWith('.local/test-tmp')
      })
      await flush()

      expect(fsx.openShape()).toEqual({ '': false, '.local': false, '.local/keep': true })
    })

    it('keeps one recursive watch and reports planCapped past the handle cap', async () => {
      const fsx = standardTree()
      const { watcher, of } = startWatcher(fsx, { caps: { maxHandles: 3 } })
      await flush()

      expect(of('ready')).toHaveLength(1)
      expect(fsx.openShape()).toEqual({ '': true })
      expect(watcher.getPlanStats()).toMatchObject({ handles: 1, planCapped: true })
    })

    it('opens every top-level folder before expanding a split one, so the cap collapses the deeper folder (C-M1)', async () => {
      // `aaa` is listed first and `aaa/p` has six children: planned depth-first,
      // they would take the handles the later top-level folders need
      const fsx = new FakeFs().add('aaa/c0').add('aaa/p/node_modules/dep')
      for (let index = 0; index < 6; index++) fsx.add(`aaa/p/d${index}`)
      for (let index = 0; index < 5; index++) fsx.add(`z${index}`)
      const { watcher, of } = startWatcher(fsx, { splitPaths: ['aaa/p/node_modules'], caps: { maxHandles: 12 } })
      await flush()

      expect(of('ready')).toHaveLength(1)
      expect(fsx.openShape()).toEqual({
        '': false,
        aaa: false,
        'aaa/c0': true,
        'aaa/p': true,
        z0: true,
        z1: true,
        z2: true,
        z3: true,
        z4: true
      })
      expect(watcher.getPlanStats()).toMatchObject({ handles: 9, planCapped: true })
      expect(logger.warn).not.toHaveBeenCalledWith(
        'Native watcher: handle cap reached, folder left unwatched',
        expect.anything()
      )
    })

    it('keeps one recursive watch on a nested split folder whose listing fails during the plan (C-H1)', async () => {
      const fsx = standardTree()
      fsx.readdirCodes.set('packages', 'EBUSY')
      const { watcher, of, paths } = startWatcher(fsx)
      await flush()

      expect(of('ready')).toHaveLength(1)
      const shape = fsx.openShape()
      expect(shape.packages).toBe(true)
      expect(Object.keys(shape).filter(rel => rel.startsWith('packages/'))).toEqual([])
      expect(watcher.getPlanStats()).toMatchObject({ planCapped: true })
      expect(logger.warn).toHaveBeenCalledWith(
        'Native watcher: listing a split folder failed, watching it recursively',
        expect.objectContaining({ code: 'EBUSY' })
      )

      // Changes below it are reported again, and the drop test still filters them
      fsx.add('packages/y/new.md', 'file')
      fsx.open('packages').fire('rename', 'y\\new.md')
      fsx.open('packages').fire('rename', 'x\\node_modules\\dep\\a.js')
      await flush()
      expect(paths('add')).toEqual(['packages/y/new.md'])
      expect(fsx.lstatCount('packages/x/node_modules/dep/a.js')).toBe(0)
    })

    it('plans a split folder collapsed by a failed listing again at the next resync (R-M1)', async () => {
      const fsx = new FakeFs().add('.local/test-tmp/x').add('.local/keep').add('src')
      fsx.readdirCodes.set('.local', 'EBUSY')
      const { of } = startWatcher(fsx, { splitPaths: ['.local/test-tmp'], shouldDrop: dropLocalTestTmp })
      await flush()
      expect(fsx.openShape()).toEqual({ '': false, '.local': true, src: true })

      // The scanner lets go; the excluded churn overflows the recursive watch
      fsx.readdirCodes.delete('.local')
      fsx.open('.local').fire('rename', null)
      await vi.advanceTimersByTimeAsync(1000)
      await flush()

      expect(fsx.openShape()).toEqual({ '': false, '.local': false, '.local/keep': true, src: true })
      expect(fsx.watchCount('.local/test-tmp')).toBe(0)
      await vi.advanceTimersByTimeAsync(10_000)
      expect(of('resync')).toEqual([
        { type: 'resync', value: 'overflow' },
        { type: 'resync', value: 'reopen' }
      ])
    })

    it('stops re-planning a folder whose listing keeps failing after reopenLimit tries (R-M1)', async () => {
      const fsx = new FakeFs().add('.local/test-tmp/x').add('.local/keep')
      fsx.readdirCodes.set('.local', 'EBUSY')
      const { of } = startWatcher(fsx, { splitPaths: ['.local/test-tmp'], shouldDrop: dropLocalTestTmp })
      await flush()

      fsx.open('.local').fire('rename', null)
      for (let round = 0; round < 10; round++) {
        await vi.advanceTimersByTimeAsync(1000)
        await flush()
      }

      // The plan, then three re-plans: each opens the split watch, then the recursive one
      expect(fsx.watchCount('.local')).toBe(2 + 2 * 3)
      expect(fsx.openShape()).toEqual({ '': false, '.local': true })
      expect(of('resync')).toEqual([
        { type: 'resync', value: 'overflow' },
        { type: 'resync', value: 'reopen' },
        { type: 'resync', value: 'reopen' },
        { type: 'resync', value: 'reopen' }
      ])
    })

    it('skips a deferred expansion whose folder was re-planned as one recursive watch meanwhile (R-L1)', async () => {
      const fsx = new FakeFs().add('aaa/tmp/x').add('aaa/keep').add('bbb/tmp/x').add('bbb/child')
      fsx.holdReaddirFor.add('aaa')
      startWatcher(fsx, {
        splitPaths: ['aaa/tmp', 'bbb/tmp'],
        shouldDrop: rel => /^(aaa|bbb)\/tmp(\/|$)/i.test(rel)
      })
      await flush()

      // While the plan waits on `aaa`, `bbb` (queued behind it) errors, is
      // re-opened, and its listing fails: it keeps one recursive watch
      fsx.readdirCodes.set('bbb', 'EBUSY')
      fsx.open('bbb').fail('EIO')
      await flush()
      expect(fsx.openShape().bbb).toBe(true)
      fsx.readdirCodes.delete('bbb')
      const bbbListings = (): number => fsx.readdir.mock.calls.filter(([target]) => fsx.relOf(target) === 'bbb').length
      const listingsBefore = bbbListings()

      fsx.heldReaddirs.get('aaa')?.()
      await flush()

      expect(fsx.handles.filter(handle => !handle.closed && handle.rel.startsWith('bbb'))).toHaveLength(1)
      expect(bbbListings()).toBe(listingsBefore)
    })

    it('resyncs when a folder whose listing failed cannot keep a recursive watch either (R-L2)', async () => {
      const fsx = standardTree()
      fsx.readdirCodes.set('packages', 'EBUSY')
      const fsWatch: NativeFsWatch = (target, options, listener) => {
        if (options.recursive && fsx.relOf(target) === 'packages') throw codeError('EPERM')
        return fsx.fsWatch(target, options, listener)
      }
      const { of } = startWatcher(fsx, { fsWatch })
      await flush()

      expect(fsx.openShape().packages).toBeUndefined()
      expect(logger.warn).toHaveBeenCalledWith(
        'Native watcher: a watch failed to open',
        expect.objectContaining({ code: 'EPERM', recursive: true })
      )
      await vi.advanceTimersByTimeAsync(1000)
      expect(of('resync')).toEqual([{ type: 'resync', value: 'watch-error' }])
    })

    it('reports planCapped for split paths past the count or depth caps, or capped by the caller', async () => {
      const deep = startWatcher(standardTree(), { splitPaths: ['a/b/c'], caps: { maxSplitDepth: 2 } })
      const many = startWatcher(standardTree(), { splitPaths: ['a/b', 'c/d'], caps: { maxSplitPaths: 1 } })
      const byCaller = startWatcher(standardTree(), { splitInputsCapped: true })
      const within = startWatcher(standardTree())
      await flush()

      expect(deep.watcher.getPlanStats().planCapped).toBe(true)
      expect(many.watcher.getPlanStats().planCapped).toBe(true)
      expect(byCaller.watcher.getPlanStats().planCapped).toBe(true)
      expect(within.watcher.getPlanStats().planCapped).toBe(false)
    })

    it('ignores split paths that are empty or climb out of the root', async () => {
      const fsx = standardTree()
      const { watcher } = startWatcher(fsx, { splitPaths: ['', '../outside/x', './'] })
      await flush()

      expect(watcher.getPlanStats()).toMatchObject({ splitFolders: 1, planCapped: false })
    })

    it('emits an error when the root cannot be listed, and no ready', async () => {
      const fsx = standardTree()
      fsx.holdReaddirFor.add('')
      const { of } = startWatcher(fsx)
      fsx.rootExists = false
      fsx.heldReaddirs.get('')?.()
      await flush()

      expect(of('error')).toEqual([{ type: 'error', value: 'ENOENT' }])
      expect(of('ready')).toHaveLength(0)
    })
  })

  describe('events (D2, D4)', () => {
    it('never lstats a dropped path', async () => {
      const fsx = standardTree()
      const { events } = startWatcher(fsx)
      await flush()
      const before = fsx.lstatCount()
      const eventsBefore = events.length

      fsx.open('').fire('rename', 'node_modules')
      fsx.open('').fire('change', '.git')
      fsx.open('src').fire('rename', 'node_modules\\x\\y.js')
      fsx.open('src').fire('change', '.git\\index.lock')
      for (let index = 0; index < 200; index++) fsx.open('build').fire('rename', `cache\\f${index}.tmp`)
      await flush()

      expect(fsx.lstatCount()).toBe(before)
      expect(events.length).toBe(eventsBefore)
    })

    it('maps backslash names to POSIX relative paths for the drop test and emits host paths', async () => {
      const fsx = standardTree().add('src/deep/sub/file.txt', 'file')
      const { shouldDrop, events } = startWatcher(fsx)
      await flush()

      fsx.open('src').fire('change', 'deep\\sub\\file.txt')
      await flush()

      expect(shouldDrop).toHaveBeenCalledWith('src/deep/sub/file.txt')
      expect(events).toContainEqual({ type: 'change', rel: 'src/deep/sub/file.txt' })
    })

    it('drops a name that climbs out of its watch', async () => {
      const fsx = standardTree()
      const { shouldDrop } = startWatcher(fsx)
      await flush()
      shouldDrop.mockClear()

      fsx.open('src').fire('rename', '..\\escape.txt')
      fsx.open('src').fire('rename', '.')
      await flush()

      expect(shouldDrop).not.toHaveBeenCalled()
      expect(fsx.lstatCount('escape.txt')).toBe(0)
    })

    it('spends no lstat on a change to a folder it already knows (timestamp noise)', async () => {
      const fsx = standardTree()
      startWatcher(fsx)
      await flush()
      const before = fsx.lstatCount()

      fsx.open('').fire('change', 'src')
      fsx.open('').fire('change', 'README.md')
      await flush()

      expect(fsx.lstatCount()).toBe(before + 1)
      expect(fsx.lstatCount('README.md')).toBe(1)
    })

    it('reports a new top-level folder only after its watch is open', async () => {
      const fsx = standardTree()
      startWatcher(fsx)
      await flush()

      fsx.add('fresh')
      fsx.open('').fire('rename', 'fresh')
      await flush()

      const watchAt = fsx.log.indexOf('watch:fresh')
      const addDirAt = fsx.log.indexOf('event:addDir:fresh')
      expect(watchAt).toBeGreaterThanOrEqual(0)
      expect(addDirAt).toBeGreaterThan(watchAt)
      expect(fsx.openShape().fresh).toBe(true)
    })

    it('reports a folder deep inside a recursive watch without opening a watch', async () => {
      const fsx = standardTree().add('src/nested')
      const { paths } = startWatcher(fsx)
      await flush()
      const watches = fsx.fsWatch.mock.calls.length

      fsx.open('src').fire('rename', 'nested')
      await flush()

      expect(paths('addDir')).toEqual(['src/nested'])
      expect(fsx.fsWatch.mock.calls.length).toBe(watches)
    })

    it('re-lists a case-only rename without ever holding a second watch', async () => {
      const fsx = standardTree()
      const { paths, of } = startWatcher(fsx)
      await flush()
      const rootListings = fsx.readdir.mock.calls.filter(([target]) => fsx.relOf(target) === '').length

      fsx.rename('docs', 'Docs')
      fsx.open('').fire('rename', 'docs')
      fsx.open('').fire('rename', 'Docs')
      await flush()

      expect(fsx.readdir.mock.calls.filter(([target]) => fsx.relOf(target) === '').length).toBeGreaterThan(rootListings)
      expect(fsx.handles.filter(handle => !handle.closed && handle.rel.toLowerCase() === 'docs')).toHaveLength(1)
      expect(fsx.log.indexOf('close:docs')).toBeLessThan(fsx.log.indexOf('watch:Docs'))
      expect(paths('addDir')).toContain('Docs')
      expect(paths('unlinkDir')).toEqual([])

      fsx.add('Docs/later.md', 'file')
      fsx.open('Docs').fire('rename', 'later.md')
      await flush()
      expect(paths('add')).toContain('Docs/later.md')

      await vi.advanceTimersByTimeAsync(1000)
      expect(of('resync')).toEqual([{ type: 'resync', value: 'reopen' }])
    })

    it('respells a case-only rename found by a re-list, keeping every handle, in every later path (T2)', async () => {
      const fsx = standardTree()
      const { paths } = startWatcher(fsx)
      await flush()
      const watches = fsx.fsWatch.mock.calls.length

      // The rename events were lost: only the overflow re-list sees the new spelling
      fsx.rename('packages', 'Packages')
      fsx.open('').fire('rename', null)
      await flush()

      expect(fsx.fsWatch.mock.calls.length).toBe(watches)
      expect(fsx.handles.some(handle => handle.closed)).toBe(false)
      expect(paths('addDir')).toEqual(['Packages'])
      expect(paths('unlinkDir')).toEqual([])

      // The split folder, a recursive watch under it and its listing all carry the new spelling
      fsx.add('Packages/top.md', 'file')
      fsx.add('Packages/y/deep.md', 'file')
      fsx.open('packages').fire('rename', 'top.md')
      fsx.open('packages/y').fire('rename', 'deep.md')
      await flush()
      expect(paths('add')).toEqual(['Packages/top.md', 'Packages/y/deep.md'])

      fsx.open('packages').fire('rename', null)
      await flush()
      expect(toSlash(fsx.readdir.mock.calls[fsx.readdir.mock.calls.length - 1][0])).toBe(`${toSlash(REAL_ROOT)}/Packages`)
    })

    it('keeps the split listing in step with renames, so a later re-list reports nothing stale', async () => {
      const fsx = standardTree()
      const { events, paths } = startWatcher(fsx)
      await flush()

      fsx.rename('README.md', 'INTRO.md')
      fsx.open('').fire('rename', 'README.md')
      fsx.open('').fire('rename', 'INTRO.md')
      await flush()
      expect(paths('unlink')).toEqual(['README.md'])
      expect(paths('add')).toEqual(['INTRO.md'])

      const count = events.length
      fsx.open('').fire('rename', null)
      await flush()

      expect(events.slice(count)).toEqual([{ type: 'overflow' }])
    })
  })

  describe('lost events (D3)', () => {
    it('re-lists a split folder on overflow and emits only the differences, without a resync', async () => {
      const fsx = standardTree()
      const { events, of } = startWatcher(fsx)
      await flush()
      const count = events.length

      fsx.add('silent.md', 'file')
      fsx.add('silentdir')
      fsx.remove('README.md')
      fsx.remove('docs')
      fsx.open('').fire('rename', null)
      await flush()

      expect(events.slice(count)).toEqual(
        expect.arrayContaining([
          { type: 'overflow' },
          { type: 'add', rel: 'silent.md' },
          { type: 'addDir', rel: 'silentdir' },
          { type: 'unlink', rel: 'README.md' },
          { type: 'unlinkDir', rel: 'docs' }
        ])
      )
      expect(events.slice(count)).toHaveLength(5)
      expect(fsx.log.indexOf('event:addDir:silentdir')).toBeGreaterThan(fsx.log.indexOf('watch:silentdir'))
      expect(fsx.openShape().docs).toBeUndefined()

      await vi.advanceTimersByTimeAsync(6000)
      expect(of('resync')).toHaveLength(0)
    })

    it('resyncs when a split folder cannot be re-listed after an overflow, but not when it is gone (R-L4)', async () => {
      const busy = standardTree()
      const busyWatcher = startWatcher(busy)
      await flush()
      busy.readdirCodes.set('', 'EBUSY')
      busy.open('').fire('rename', null)
      await flush()
      await vi.advanceTimersByTimeAsync(1000)
      expect(busyWatcher.of('resync')).toEqual([{ type: 'resync', value: 'overflow' }])

      const gone = standardTree()
      const goneWatcher = startWatcher(gone)
      await flush()
      gone.readdirCodes.set('packages', 'ENOENT')
      gone.open('packages').fire('rename', null)
      await flush()
      await vi.advanceTimersByTimeAsync(6000)
      expect(goneWatcher.of('resync')).toEqual([])
    })

    it('reports a file that became a folder, and a folder that became a file, as gone then new (T2)', async () => {
      const fsx = standardTree()
      const { events } = startWatcher(fsx)
      await flush()
      const count = events.length
      const docsHandle = fsx.open('docs')

      fsx.remove('README.md')
      fsx.add('README.md')
      fsx.remove('docs')
      fsx.add('docs', 'file')
      fsx.open('').fire('rename', null)
      await flush()

      expect(events.slice(count)).toEqual(
        expect.arrayContaining([
          { type: 'overflow' },
          { type: 'unlink', rel: 'README.md' },
          { type: 'addDir', rel: 'README.md' },
          { type: 'unlinkDir', rel: 'docs' },
          { type: 'add', rel: 'docs' }
        ])
      )
      expect(events.slice(count)).toHaveLength(5)
      expect(fsx.log.indexOf('event:unlink:README.md')).toBeLessThan(fsx.log.indexOf('event:addDir:README.md'))
      expect(fsx.log.indexOf('event:addDir:README.md')).toBeGreaterThan(fsx.log.indexOf('watch:README.md'))
      expect(fsx.log.indexOf('event:unlinkDir:docs')).toBeLessThan(fsx.log.indexOf('event:add:docs'))
      expect(docsHandle.closed).toBe(true)
      expect(fsx.openShape()).toMatchObject({ 'readme.md': true })
      expect(fsx.openShape().docs).toBeUndefined()
    })

    it('turns many recursive null filenames within the debounce into exactly one resync', async () => {
      const fsx = standardTree()
      const { of, paths } = startWatcher(fsx)
      await flush()

      for (let index = 0; index < 10; index++) {
        fsx.open('src').fire('rename', null)
        await vi.advanceTimersByTimeAsync(100)
      }
      expect(of('overflow')).toHaveLength(10)
      await vi.advanceTimersByTimeAsync(899)
      expect(of('resync')).toHaveLength(0)
      await vi.advanceTimersByTimeAsync(1)
      expect(of('resync')).toEqual([{ type: 'resync', value: 'overflow' }])
      await vi.advanceTimersByTimeAsync(10_000)
      expect(of('resync')).toHaveLength(1)

      // The watch stays open after an overflow
      expect(fsx.open('src').close).not.toHaveBeenCalled()
      fsx.add('src/late.md', 'file')
      fsx.open('src').fire('rename', 'late.md')
      await flush()
      expect(paths('add')).toContain('src/late.md')
    })

    it('waits at most 5 s while null filenames keep arriving', async () => {
      const fsx = standardTree()
      const { of } = startWatcher(fsx)
      await flush()

      for (let elapsed = 0; elapsed < 5000; elapsed += 500) {
        fsx.open('src').fire('rename', null)
        await vi.advanceTimersByTimeAsync(499)
        expect(of('resync')).toHaveLength(0)
        await vi.advanceTimersByTimeAsync(1)
      }
      expect(of('resync')).toHaveLength(1)
    })

    it('asks for one resync when the classification backlog overflows', async () => {
      const fsx = standardTree()
      const { of } = startWatcher(fsx)
      await flush()
      fsx.holdLstats = true

      const planStats = fsx.lstatCount()
      for (let index = 0; index < 10_050; index++) fsx.open('src').fire('change', `f${index}.txt`)
      expect(fsx.lstatCount()).toBe(planStats + 2)
      await vi.advanceTimersByTimeAsync(999)
      expect(of('resync')).toHaveLength(0)
      await vi.advanceTimersByTimeAsync(1)

      expect(of('resync')).toEqual([{ type: 'resync', value: 'backlog' }])
      await vi.advanceTimersByTimeAsync(5000)
      expect(of('resync')).toHaveLength(1)
    })

    it('re-lists the split folders after a resync, so a cleared folder event still gets its watch', async () => {
      const fsx = new FakeFs().add('src/app.ts', 'file').add('docs')
      const { watcher, paths } = startWatcher(fsx, { splitPaths: [] })
      await flush()
      fsx.holdLstats = true

      fsx.open('src').fire('change', 'a.ts')
      fsx.open('src').fire('change', 'b.ts')
      fsx.add('arrived')
      fsx.open('').fire('rename', 'arrived') // queued behind two stats that never answer
      expect(classifierOf(watcher).pendingCount).toBe(1)
      fsx.open('src').fire('rename', null)
      await vi.advanceTimersByTimeAsync(1000)

      expect(fsx.openShape().arrived).toBe(true)
      expect(paths('addDir')).toContain('arrived')
    })
  })

  describe('a watched folder’s own removal (D15)', () => {
    it('closes the handle inside the same callback, before any lstat, on a \\\\?\\ self-event', async () => {
      const fsx = standardTree()
      const { watcher, paths } = startWatcher(fsx)
      await flush()
      fsx.remove('src')
      const handle = fsx.open('src')
      const selfName = `\\\\?\\${REAL_ROOT}\\src`

      handle.fire('rename', selfName)

      expect(handle.close).toHaveBeenCalledTimes(1)
      const closeAt = fsx.log.indexOf('close:src')
      expect(closeAt).toBeGreaterThanOrEqual(0)
      expect(fsx.log.slice(0, closeAt).some(line => line === 'lstat:src')).toBe(false)

      // The flood: 10,000 more before the close takes effect cost nothing
      const lstats = fsx.lstatCount()
      const timers = vi.getTimerCount()
      const classifier = classifierOf(watcher)
      const queued = classifier.pendingCount + classifier.inFlightCount
      vi.mocked(logger.warn).mockClear()
      vi.mocked(logger.debug).mockClear()
      for (let index = 0; index < 10_000; index++) handle.fire('rename', selfName)
      expect(fsx.lstatCount()).toBe(lstats)
      expect(vi.getTimerCount()).toBe(timers)
      expect(classifier.pendingCount + classifier.inFlightCount).toBe(queued)
      expect(logger.warn).not.toHaveBeenCalled()
      expect(logger.debug).not.toHaveBeenCalled()
      expect(handle.close).toHaveBeenCalledTimes(1)

      await flush()
      // One re-check: ENOENT → the folder is gone
      expect(fsx.lstatCount('src')).toBe(1)
      expect(paths('unlinkDir')).toEqual(['src'])
    })

    it('matches a self-event case-insensitively and with a trailing separator', async () => {
      const fsx = standardTree()
      const { paths } = startWatcher(fsx)
      await flush()
      fsx.remove('docs')

      fsx.open('docs').fire('rename', `\\\\?\\${REAL_ROOT.toLowerCase()}\\DOCS\\`)
      await flush()

      expect(paths('unlinkDir')).toEqual(['docs'])
    })

    it('matches \\\\?\\UNC\\ self-events on a UNC root, for a child and for the root', async () => {
      const unc = '\\\\server\\share\\proj'
      const fsx = standardTree(new FakeFs(unc))
      const { paths, of } = startWatcher(fsx)
      await flush()

      fsx.remove('src')
      fsx.open('src').fire('rename', '\\\\?\\UNC\\server\\share\\proj\\src')
      expect(fsx.handles.find(handle => handle.rel === 'src')?.closed).toBe(true)
      await flush()
      expect(paths('unlinkDir')).toEqual(['src'])

      fsx.rootExists = false
      fsx.open('').fire('rename', '\\\\?\\UNC\\server\\share\\proj')
      await flush()
      expect(of('error')).toEqual([{ type: 'error', value: 'ENOENT' }])
    })

    it('closes every handle and emits ENOENT when the deleted root is gone at the re-check', async () => {
      const fsx = standardTree()
      const { of } = startWatcher(fsx)
      await flush()
      fsx.rootExists = false

      fsx.open('').fire('rename', `\\\\?\\${REAL_ROOT}`)
      await flush()

      expect(of('error')).toEqual([{ type: 'error', value: 'ENOENT' }])
      expect(fsx.handles.every(handle => handle.closed)).toBe(true)
    })

    it('re-plans the root and resyncs when a readable folder is at the root again', async () => {
      const fsx = standardTree()
      const { of } = startWatcher(fsx)
      await flush()
      const shape = fsx.openShape()

      fsx.open('').fire('rename', `\\\\?\\${REAL_ROOT}`)
      await flush()

      expect(fsx.openShape()).toEqual(shape)
      expect(fsx.watchCount('')).toBe(2)
      await vi.advanceTimersByTimeAsync(1000)
      expect(of('resync')).toEqual([{ type: 'resync', value: 'reopen' }])
    })

    it('emits an error, and no resync, when the root is readable at the re-check but its watch cannot reopen (T2)', async () => {
      const fsx = standardTree()
      const { of } = startWatcher(fsx)
      await flush()

      fsx.watchCodes.set('', 'EPERM')
      fsx.open('').fire('rename', `\\\\?\\${REAL_ROOT}`)
      await flush()

      expect(fsx.watchCount('')).toBe(2)
      expect(of('error')).toEqual([{ type: 'error', value: 'ENOENT' }])
      expect(fsx.handles.every(handle => handle.closed)).toBe(true)
      await vi.advanceTimersByTimeAsync(6000)
      expect(of('resync')).toEqual([])
    })

    it('opens a fresh watch and resyncs when a readable new folder is there at the re-check', async () => {
      const fsx = standardTree()
      const { of, paths } = startWatcher(fsx)
      await flush()

      // Deleted and re-created: the old handle can never see the new folder
      fsx.open('src').fire('rename', `\\\\?\\${REAL_ROOT}\\src`)
      await flush()

      expect(fsx.watchCount('src')).toBe(2)
      expect(fsx.openShape().src).toBe(true)
      expect(paths('unlinkDir')).toEqual([])
      await vi.advanceTimersByTimeAsync(1000)
      expect(of('resync')).toEqual([{ type: 'resync', value: 'reopen' }])
    })

    it('treats a relative filename equal to the basename as an ordinary child event', async () => {
      const fsx = standardTree().add('src/src', 'file')
      const { paths } = startWatcher(fsx)
      await flush()

      fsx.open('src').fire('rename', 'src')
      await flush()

      expect(paths('add')).toEqual(['src/src'])
      expect(fsx.open('src').closed).toBe(false)
    })

    it('ignores an absolute name that is not the handle’s own path', async () => {
      const fsx = standardTree()
      const { events } = startWatcher(fsx)
      await flush()
      const count = events.length

      fsx.open('src').fire('rename', `\\\\?\\${REAL_ROOT}\\docs`)
      fsx.open('src').fire('rename', 'D:\\elsewhere')
      await flush()

      expect(fsx.open('src').closed).toBe(false)
      expect(events.length).toBe(count)
    })
  })

  describe('a renamed watched folder (D2)', () => {
    it('retires the old handle at once, then reports unlinkDir old and addDir new after its watch opens', async () => {
      const fsx = standardTree()
      const { paths, events } = startWatcher(fsx)
      await flush()
      const oldHandle = fsx.open('docs')

      fsx.rename('docs', 'manual')
      fsx.open('').fire('rename', 'docs')
      // Windows keeps the old handle on the moved folder, reporting under the old name
      oldHandle.fire('rename', 'after.txt')
      fsx.open('').fire('rename', 'manual')
      await flush()

      expect(fsx.lstatCount('docs/after.txt')).toBe(0)
      expect(events).not.toContainEqual(expect.objectContaining({ rel: 'docs/after.txt' }))
      expect(paths('unlinkDir')).toEqual(['docs'])
      expect(paths('addDir')).toEqual(['manual'])
      expect(oldHandle.closed).toBe(true)
      expect(fsx.log.indexOf('event:addDir:manual')).toBeGreaterThan(fsx.log.indexOf('watch:manual'))
    })

    it('closes a retired handle on its first absolute name, should its folder then be deleted', async () => {
      const fsx = standardTree()
      startWatcher(fsx)
      await flush()
      fsx.holdLstats = true
      const oldHandle = fsx.open('docs')

      fsx.open('').fire('rename', 'docs')
      oldHandle.fire('rename', `\\\\?\\${REAL_ROOT}\\docs`)
      expect(oldHandle.close).toHaveBeenCalledTimes(1)
      for (let index = 0; index < 1000; index++) oldHandle.fire('rename', `\\\\?\\${REAL_ROOT}\\docs`)
      expect(oldHandle.close).toHaveBeenCalledTimes(1)
    })

    it('gives no watch to a folder renamed to a dropped name', async () => {
      const fsx = standardTree()
      const { paths } = startWatcher(fsx)
      await flush()
      const watches = fsx.fsWatch.mock.calls.length

      fsx.rename('docs', 'node_modules2')
      fsx.remove('node_modules')
      fsx.rename('node_modules2', 'node_modules')
      fsx.open('').fire('rename', 'docs')
      fsx.open('').fire('rename', 'node_modules')
      await flush()

      expect(paths('unlinkDir')).toEqual(['docs'])
      expect(fsx.fsWatch.mock.calls.length).toBe(watches)
      expect(fsx.lstatCount('node_modules')).toBe(0)
    })

    it('plans a folder renamed to a split-folder name as one', async () => {
      const fsx = standardTree().add('docs/tmp/x').add('docs/guide')
      const { paths } = startWatcher(fsx, {
        splitPaths: [...STANDARD_SPLIT_PATHS, 'renamed/tmp'],
        shouldDrop: defaultDrop(['renamed/tmp'])
      })
      await flush()

      fsx.rename('docs', 'renamed')
      fsx.open('').fire('rename', 'docs')
      fsx.open('').fire('rename', 'renamed')
      await flush()

      const shape = fsx.openShape()
      expect(shape.renamed).toBe(false)
      expect(shape['renamed/guide']).toBe(true)
      expect(shape['renamed/tmp']).toBeUndefined()
      expect(paths('addDir')).toEqual(['renamed'])
      expect(fsx.log.indexOf('event:addDir:renamed')).toBeGreaterThan(fsx.log.indexOf('watch:renamed/guide'))
    })
  })

  describe('defensive paths (D2 EPERM row, D15)', () => {
    it('treats EPERM that persists after the close as gone: unlinkDir, no re-open', async () => {
      const fsx = standardTree()
      const { paths } = startWatcher(fsx)
      await flush()
      fsx.lstatCodes.set('docs', 'EPERM')

      fsx.open('').fire('rename', 'docs')
      await flush()

      expect(fsx.lstatCount('docs')).toBe(2) // the classification, then the re-check
      expect(paths('unlinkDir')).toEqual(['docs'])
      expect(fsx.watchCount('docs')).toBe(1)
      expect(fsx.openShape().docs).toBeUndefined()
    })

    it('runs the same close and re-check for an EPERM error event on a watch', async () => {
      const fsx = standardTree()
      const { paths } = startWatcher(fsx)
      await flush()
      fsx.lstatCodes.set('src', 'EPERM')

      fsx.open('src').fail('EPERM')
      await flush()

      expect(paths('unlinkDir')).toEqual(['src'])
      expect(fsx.watchCount('src')).toBe(1)
      expect(logger.warn).toHaveBeenCalledWith(
        'Native watcher: a watch reported an error',
        expect.objectContaining({ code: 'EPERM' })
      )
    })

    it('re-opens a watch that keeps erroring on a readable folder at most 3 times in 60 s, then resyncs once', async () => {
      const fsx = standardTree()
      const { of } = startWatcher(fsx)
      await flush()

      for (let round = 0; round < 5; round++) {
        const open = fsx.handles.find(handle => !handle.closed && handle.rel === 'src')
        open?.fail('EIO')
        await flush()
      }

      expect(fsx.watchCount('src')).toBe(4)
      expect(fsx.openShape().src).toBeUndefined()
      await vi.advanceTimersByTimeAsync(1000)
      expect(of('resync')).toEqual([{ type: 'resync', value: 'watch-error' }])
      expect(logger.warn).toHaveBeenCalledWith(
        'Native watcher: folder left unwatched after repeated re-opens',
        expect.objectContaining({ reopenLimit: 3, unwatched: 1 })
      )
    })

    it('leaves a folder renamed back and forth unwatched but reported after 3 re-opens in 60 s (T2)', async () => {
      const fsx = standardTree()
      const { of, paths } = startWatcher(fsx)
      await flush()

      // Each parent `rename` retires the watch; the re-list finds the folder still there
      for (let round = 0; round < 3; round++) {
        fsx.open('').fire('rename', 'docs')
        await flush()
      }
      expect(fsx.watchCount('docs')).toBe(4)
      expect(logger.warn).not.toHaveBeenCalledWith(
        'Native watcher: folder left unwatched after repeated re-opens',
        expect.anything()
      )

      fsx.open('').fire('rename', 'docs')
      await flush()

      expect(fsx.watchCount('docs')).toBe(4)
      expect(fsx.openShape().docs).toBeUndefined()
      expect(paths('addDir')).toEqual(['docs', 'docs', 'docs', 'docs'])
      expect(logger.warn).toHaveBeenCalledWith(
        'Native watcher: folder left unwatched after repeated re-opens',
        expect.objectContaining({ reopenLimit: 3, unwatched: 1 })
      )
      await vi.advanceTimersByTimeAsync(1000)
      expect(of('resync')).toEqual([{ type: 'resync', value: 'reopen' }])
    })

    it('allows re-opens again once the 60 s window has passed', async () => {
      const fsx = standardTree()
      startWatcher(fsx)
      await flush()

      for (let round = 0; round < 3; round++) {
        fsx.open('src').fail('EIO')
        await flush()
      }
      await vi.advanceTimersByTimeAsync(60_000)
      fsx.open('src').fail('EIO')
      await flush()

      expect(fsx.watchCount('src')).toBe(5)
      expect(fsx.openShape().src).toBe(true)
    })

    it('leaves a new folder unwatched but reported when the handle cap is reached', async () => {
      const fsx = new FakeFs().add('a').add('b')
      const { watcher, paths } = startWatcher(fsx, { splitPaths: [], caps: { maxHandles: 3 } })
      await flush()

      fsx.add('c')
      fsx.open('').fire('rename', 'c')
      await flush()

      expect(paths('addDir')).toEqual(['c'])
      expect(fsx.openShape().c).toBeUndefined()
      expect(watcher.getPlanStats()).toMatchObject({ handles: 3, planCapped: true })
    })

    it('reports a new folder whose watch fails to open with something other than ENOENT', async () => {
      const fsx = standardTree()
      const { paths } = startWatcher(fsx)
      await flush()

      fsx.add('locked')
      fsx.watchCodes.set('locked', 'EACCES')
      fsx.open('').fire('rename', 'locked')
      await flush()

      expect(paths('addDir')).toEqual(['locked'])
      expect(logger.warn).toHaveBeenCalledWith(
        'Native watcher: a watch failed to open',
        expect.objectContaining({ code: 'EACCES' })
      )
    })
  })

  describe('close()', () => {
    it('is silent after close: no events from handles, stats in flight or timers', async () => {
      const fsx = standardTree()
      const { watcher, events } = startWatcher(fsx)
      await flush()
      fsx.holdLstats = true
      fsx.add('src/pending.md', 'file')
      fsx.open('src').fire('rename', 'pending.md')
      fsx.open('src').fire('rename', null)
      const handles = fsx.handles.filter(handle => !handle.closed)
      const count = events.length

      await watcher.close()
      for (const release of fsx.heldLstats) release()
      for (const handle of handles) handle.fire('rename', 'late.md')
      handles[0].fail('EIO')
      await vi.advanceTimersByTimeAsync(10_000)
      await flush()

      expect(fsx.handles.every(handle => handle.closed)).toBe(true)
      expect(events.slice(count)).toEqual([])
      expect(watcher.getPlanStats().handles).toBe(0)
      await expect(watcher.close()).resolves.toBeUndefined()
    })

    it('emits no ready when closed during the plan', async () => {
      const fsx = standardTree()
      fsx.holdReaddirFor.add('packages')
      const { watcher, of } = startWatcher(fsx)
      await flush()

      await watcher.close()
      fsx.heldReaddirs.get('packages')?.()
      await flush()

      expect(of('ready')).toHaveLength(0)
    })
  })
})
