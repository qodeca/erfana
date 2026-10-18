// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi } from 'vitest'

vi.mock('../LoggingService', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }
}))

import { logger } from '../LoggingService'
import {
  NativeEventClassifier,
  type NativeClassifiedEvent,
  type NativeLstatResult,
  type NativeRawEventKind
} from './NativeEventClassifier'

const FILE: NativeLstatResult = { isDirectory: () => false, isSymbolicLink: () => false }
const DIR: NativeLstatResult = { isDirectory: () => true, isSymbolicLink: () => false }
const LINK: NativeLstatResult = { isDirectory: () => false, isSymbolicLink: () => true }

type Outcome = NativeLstatResult | string

const codeError = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code })

/** Let every settled promise run its callbacks. */
const flush = (): Promise<void> => new Promise(resolve => setImmediate(resolve))

interface PendingStat {
  readonly path: string
  settle(outcome: Outcome): void
}

interface HarnessOptions {
  /** Answer each stat at once from this table (missing → ENOENT); otherwise stats wait. */
  readonly table?: Readonly<Record<string, Outcome>>
  readonly known?: readonly string[]
  readonly openWatches?: readonly string[]
  readonly caseSensitive?: boolean
  readonly maxInFlight?: number
  readonly maxPending?: number
}

function createHarness(options: HarnessOptions = {}) {
  const events: NativeClassifiedEvent[] = []
  const stats: string[] = []
  const waiting: PendingStat[] = []
  let inFlight = 0
  let peakInFlight = 0
  const onBacklogOverflow = vi.fn()

  const lstat = (target: string): Promise<NativeLstatResult> => {
    stats.push(target)
    inFlight++
    peakInFlight = Math.max(peakInFlight, inFlight)
    return new Promise<NativeLstatResult>((resolve, reject) => {
      const settle = (outcome: Outcome): void => {
        inFlight--
        if (typeof outcome === 'string') reject(codeError(outcome))
        else resolve(outcome)
      }
      if (options.table) settle(options.table[target] ?? 'ENOENT')
      else waiting.push({ path: target, settle })
    })
  }

  const classifier = new NativeEventClassifier({
    lstat,
    isKnownFolder: target => options.known?.includes(target) ?? false,
    hasOpenWatch: target => options.openWatches?.includes(target) ?? false,
    caseSensitive: options.caseSensitive ?? true,
    maxInFlight: options.maxInFlight,
    maxPending: options.maxPending,
    onEvent: event => events.push(event),
    onBacklogOverflow
  })

  /** Settle the oldest waiting stat and let its result run. */
  const settleNext = async (outcome: Outcome): Promise<string> => {
    const next = waiting.shift()
    if (!next) throw new Error('no stat is waiting')
    next.settle(outcome)
    await flush()
    return next.path
  }

  /** Settle the waiting stat for one path. */
  const settle = async (target: string, outcome: Outcome): Promise<void> => {
    const index = waiting.findIndex(stat => stat.path === target)
    if (index < 0) throw new Error(`no stat is waiting for ${target}`)
    const [stat] = waiting.splice(index, 1)
    stat.settle(outcome)
    await flush()
  }

  /** Settle every stat, including those started meanwhile. */
  const settleAll = async (outcomeFor: (target: string) => Outcome): Promise<void> => {
    while (waiting.length > 0) {
      const next = waiting[0]
      await settleNext(outcomeFor(next.path))
    }
  }

  return {
    classifier,
    events,
    stats,
    waiting,
    onBacklogOverflow,
    settle,
    settleNext,
    settleAll,
    peak: (): number => peakInFlight,
    typesOf: (type: NativeClassifiedEvent['type']): string[] =>
      events.filter(event => event.type === type).map(event => event.path)
  }
}

describe('NativeEventClassifier (#211, D2)', () => {
  describe('classification table', () => {
    const X = 'C:/proj/x'
    it.each<[NativeRawEventKind, Outcome, { known?: boolean; watched?: boolean }, string | null]>([
      ['rename', FILE, {}, 'add'],
      ['rename', LINK, {}, 'add'],
      ['rename', DIR, {}, 'addDir'],
      ['rename', 'ENOENT', {}, 'unlink'],
      ['rename', 'ENOENT', { known: true }, 'unlinkDir'],
      ['rename', 'ENOTDIR', {}, 'unlink'],
      ['rename', 'EPERM', { watched: true }, 'locked'],
      ['rename', 'EBUSY', { watched: true }, 'locked'],
      ['rename', 'EPERM', {}, 'add'],
      ['rename', 'EACCES', {}, 'add'],
      ['change', FILE, {}, 'change'],
      ['change', LINK, {}, 'change'],
      ['change', DIR, {}, null],
      ['change', 'ENOENT', {}, null],
      ['change', 'ENOTDIR', {}, null],
      ['change', 'EACCES', {}, 'change'],
      ['recheck', DIR, {}, 'addDir'],
      ['recheck', LINK, {}, 'unlinkDir'],
      ['recheck', FILE, {}, 'unlinkDir'],
      ['recheck', 'ENOENT', {}, 'unlinkDir'],
      ['recheck', 'EPERM', { watched: true }, 'unlinkDir']
    ])('%s + %o (%o) → %s', async (kind, outcome, flags, expected) => {
      const h = createHarness({
        table: { [X]: outcome },
        known: flags.known ? [X] : [],
        openWatches: flags.watched ? [X] : []
      })

      h.classifier.enqueue(X, kind)
      await flush()

      expect(h.stats).toEqual([X])
      expect(h.events.map(event => event.type)).toEqual(expected === null ? [] : [expected])
      if (expected === 'locked') expect(h.events[0].code).toBe(outcome)
      if (expected !== null) expect(h.events[0]).toMatchObject({ path: X, source: kind })
    })

    it('treats an lstat that throws synchronously as its error code', async () => {
      const events: NativeClassifiedEvent[] = []
      const classifier = new NativeEventClassifier({
        lstat: () => {
          throw codeError('ENOENT')
        },
        isKnownFolder: () => false,
        caseSensitive: true,
        onEvent: event => events.push(event),
        onBacklogOverflow: () => undefined
      })

      classifier.enqueue('C:/proj/gone', 'rename')
      await flush()

      expect(events).toEqual([{ type: 'unlink', path: 'C:/proj/gone', source: 'rename' }])
    })
  })

  describe('bounded work', () => {
    it('never runs more than 2 lstat calls at once', async () => {
      const h = createHarness()
      for (let index = 0; index < 50; index++) h.classifier.enqueue(`C:/proj/f${index}`, 'rename')

      expect(h.stats).toHaveLength(2)
      expect(h.classifier.inFlightCount).toBe(2)
      expect(h.classifier.pendingCount).toBe(48)

      await h.settleAll(() => FILE)

      expect(h.peak()).toBe(2)
      expect(h.stats).toHaveLength(50)
      expect(h.typesOf('add')).toHaveLength(50)
    })

    it('honours a smaller maxInFlight', async () => {
      const h = createHarness({ maxInFlight: 1 })
      for (let index = 0; index < 5; index++) h.classifier.enqueue(`C:/proj/f${index}`, 'change')

      await h.settleAll(() => FILE)

      expect(h.peak()).toBe(1)
      expect(h.typesOf('change')).toHaveLength(5)
    })

    it('de-duplicates a queued path, rename winning over change either way', async () => {
      const h = createHarness()
      h.classifier.enqueue('C:/proj/busy1', 'change')
      h.classifier.enqueue('C:/proj/busy2', 'change')
      h.classifier.enqueue('C:/proj/a', 'change')
      h.classifier.enqueue('C:/proj/a', 'rename')
      h.classifier.enqueue('C:/proj/b', 'rename')
      h.classifier.enqueue('C:/proj/b', 'change')

      expect(h.classifier.pendingCount).toBe(2)
      await h.settleAll(() => FILE)

      expect(h.stats.filter(target => target === 'C:/proj/a')).toHaveLength(1)
      expect(h.stats.filter(target => target === 'C:/proj/b')).toHaveLength(1)
      expect(h.typesOf('add')).toEqual(['C:/proj/a', 'C:/proj/b'])
    })

    it('classifies a path again when it changes while its lstat is in flight', async () => {
      const h = createHarness()
      h.classifier.enqueue('C:/proj/a', 'rename')
      h.classifier.enqueue('C:/proj/a', 'change')

      expect(h.stats).toEqual(['C:/proj/a'])
      await h.settleNext(FILE)
      expect(h.stats).toEqual(['C:/proj/a', 'C:/proj/a'])
      await h.settleNext(FILE)

      expect(h.events.map(event => event.type)).toEqual(['add', 'change'])
    })

    it('calls onBacklogOverflow once when the backlog cap trips, and drops the extra events', async () => {
      const h = createHarness({ maxPending: 3 })
      for (let index = 0; index < 5; index++) h.classifier.enqueue(`C:/proj/f${index}`, 'rename')
      expect(h.onBacklogOverflow).not.toHaveBeenCalled()

      h.classifier.enqueue('C:/proj/over1', 'rename')
      h.classifier.enqueue('C:/proj/over2', 'rename')

      expect(h.onBacklogOverflow).toHaveBeenCalledTimes(1)
      await h.settleAll(() => FILE)
      expect(h.stats).not.toContain('C:/proj/over1')
      expect(h.stats).not.toContain('C:/proj/over2')
      expect(h.stats).toHaveLength(5)
    })

    it('trips the backlog again after clear()', () => {
      const h = createHarness({ maxPending: 1 })
      for (let index = 0; index < 4; index++) h.classifier.enqueue(`C:/proj/f${index}`, 'rename')
      expect(h.onBacklogOverflow).toHaveBeenCalledTimes(1)

      h.classifier.clear()
      h.classifier.enqueue('C:/proj/g1', 'rename')
      h.classifier.enqueue('C:/proj/g2', 'rename')

      expect(h.onBacklogOverflow).toHaveBeenCalledTimes(2)
    })

    it('never drops a re-check for the backlog cap', () => {
      const h = createHarness({ maxPending: 1 })
      for (let index = 0; index < 3; index++) h.classifier.enqueue(`C:/proj/f${index}`, 'rename')

      h.classifier.enqueue('C:/proj/watched', 'recheck')

      expect(h.classifier.pendingCount).toBe(2)
    })
  })

  describe('clear()', () => {
    it('drops queued events and ignores results in flight, but keeps re-checks', async () => {
      const h = createHarness()
      h.classifier.enqueue('C:/proj/a', 'rename')
      h.classifier.enqueue('C:/proj/b', 'rename')
      h.classifier.enqueue('C:/proj/c', 'rename')
      h.classifier.enqueue('C:/proj/watched', 'recheck')

      h.classifier.clear()

      expect(h.classifier.pendingCount).toBe(1)
      await h.settleAll(target => (target === 'C:/proj/watched' ? DIR : FILE))

      expect(h.stats).toEqual(['C:/proj/a', 'C:/proj/b', 'C:/proj/watched'])
      expect(h.events).toEqual([{ type: 'addDir', path: 'C:/proj/watched', source: 'recheck' }])
    })

    it('still classifies an event that arrives for a path in flight after the clear', async () => {
      const h = createHarness()
      h.classifier.enqueue('C:/proj/a', 'rename')
      h.classifier.clear()
      h.classifier.enqueue('C:/proj/a', 'change')

      await h.settleAll(() => FILE)

      expect(h.stats).toEqual(['C:/proj/a', 'C:/proj/a'])
      expect(h.events.map(event => event.type)).toEqual(['change'])
    })
  })

  describe('removal collapse (A1)', () => {
    it('deleting a 1,000-file folder costs a handful of stats and one unlinkDir', async () => {
      const h = createHarness()
      // Windows reports only part of the children, then the folder itself
      for (let index = 0; index < 300; index++) h.classifier.enqueue(`C:/proj/big/f${index}.txt`, 'rename')
      h.classifier.enqueue('C:/proj/big', 'rename')

      await h.settleAll(() => 'ENOENT')

      expect(h.stats.length).toBeLessThanOrEqual(4)
      expect(h.stats).toContain('C:/proj/big')
      expect(h.typesOf('unlinkDir')).toEqual(['C:/proj/big'])
      expect(h.typesOf('unlink').length).toBeLessThanOrEqual(2)
      expect(h.classifier.pendingCount).toBe(0)
    })

    it('lets a rename with queued descendants jump the queue', async () => {
      const h = createHarness({ maxInFlight: 1 })
      h.classifier.enqueue('C:/proj/first', 'change')
      h.classifier.enqueue('C:/proj/other', 'change')
      h.classifier.enqueue('C:/proj/dir/child', 'rename')
      h.classifier.enqueue('C:/proj/dir', 'rename')

      await h.settleNext(FILE)

      expect(h.stats).toEqual(['C:/proj/first', 'C:/proj/dir'])
    })

    it('drops a descendant queued after the removal until the queue drains', async () => {
      const h = createHarness({ known: ['C:/proj/dir'] })
      h.classifier.enqueue('C:/proj/busy', 'change')
      h.classifier.enqueue('C:/proj/dir', 'rename')
      await h.settle('C:/proj/dir', 'ENOENT')
      expect(h.typesOf('unlinkDir')).toEqual(['C:/proj/dir'])

      // `busy` is still in flight: the queue has not drained yet
      h.classifier.enqueue('C:/proj/dir/late', 'rename')
      expect(h.stats).not.toContain('C:/proj/dir/late')
      expect(h.classifier.pendingCount).toBe(0)

      await h.settleAll(() => FILE)
      h.classifier.enqueue('C:/proj/dir/after-drain', 'rename')
      expect(h.stats).toContain('C:/proj/dir/after-drain')
    })

    it('reports a folder that had queued descendants as unlinkDir even when unknown', async () => {
      const h = createHarness()
      h.classifier.enqueue('C:/proj/x1', 'change')
      h.classifier.enqueue('C:/proj/x2', 'change')
      h.classifier.enqueue('C:/proj/dir', 'rename')
      h.classifier.enqueue('C:/proj/dir/child', 'rename')

      await h.settleAll(() => 'ENOENT')

      // The child may be stat'ed alongside, but its removal is covered
      expect(h.typesOf('unlinkDir')).toEqual(['C:/proj/dir'])
      expect(h.typesOf('unlink')).toEqual([])
    })

    it('counts a descendant in flight as queued, so the folder jumps and is a folder', async () => {
      const h = createHarness({ maxInFlight: 2 })
      h.classifier.enqueue('C:/proj/dir/a', 'rename')
      h.classifier.enqueue('C:/proj/busy', 'change')
      h.classifier.enqueue('C:/proj/queued', 'change')
      h.classifier.enqueue('C:/proj/dir', 'rename')

      await h.settle('C:/proj/busy', FILE)
      expect(h.stats).toEqual(['C:/proj/dir/a', 'C:/proj/busy', 'C:/proj/dir'])
      await h.settle('C:/proj/dir', 'ENOENT')
      await h.settleAll(() => 'ENOENT')

      expect(h.typesOf('unlinkDir')).toEqual(['C:/proj/dir'])
      expect(h.typesOf('unlink')).toEqual([])
    })

    it('remembers an emitted addDir, so the folder’s later removal is an unlinkDir', async () => {
      const outcomes: Outcome[] = [DIR, 'ENOENT']
      const h = createHarness()
      h.classifier.enqueue('C:/proj/made', 'rename')
      await h.settleNext(outcomes[0])
      h.classifier.enqueue('C:/proj/made', 'rename')
      await h.settleNext(outcomes[1])

      expect(h.events.map(event => event.type)).toEqual(['addDir', 'unlinkDir'])
    })

    it('always answers a re-check, even under a folder just reported gone', async () => {
      const h = createHarness({ known: ['C:/proj/dir'] })
      h.classifier.enqueue('C:/proj/busy', 'change')
      h.classifier.enqueue('C:/proj/dir', 'rename')
      await h.settle('C:/proj/dir', 'ENOENT')
      h.classifier.enqueue('C:/proj/dir/sub', 'recheck')

      await h.settleAll(() => 'ENOENT')

      expect(h.events).toContainEqual({ type: 'unlinkDir', path: 'C:/proj/dir/sub', source: 'recheck' })
    })
  })

  describe('case folding (M3)', () => {
    it('keys paths case-folded when the platform is case-insensitive, emitting the latest spelling', async () => {
      const h = createHarness({ caseSensitive: false })
      h.classifier.enqueue('C:/proj/busy1', 'change')
      h.classifier.enqueue('C:/proj/busy2', 'change')
      h.classifier.enqueue('C:/Proj/Src/A.txt', 'change')
      h.classifier.enqueue('c:/proj/src/a.TXT', 'rename')

      await h.settleAll(() => FILE)

      expect(h.stats.filter(target => target.toLowerCase() === 'c:/proj/src/a.txt')).toHaveLength(1)
      expect(h.typesOf('add')).toEqual(['c:/proj/src/a.TXT'])
    })

    it('keeps differently cased paths apart when the platform is case-sensitive', async () => {
      const h = createHarness({ caseSensitive: true })
      h.classifier.enqueue('/proj/Src', 'rename')
      h.classifier.enqueue('/proj/src', 'rename')

      await h.settleAll(() => DIR)

      expect(h.typesOf('addDir')).toEqual(['/proj/Src', '/proj/src'])
    })

    it('collapses a removal across spellings when case-insensitive', async () => {
      const h = createHarness({ caseSensitive: false })
      h.classifier.enqueue('C:/proj/busy', 'change')
      h.classifier.enqueue('C:/proj/Dir/child', 'rename')
      h.classifier.enqueue('C:/proj/dir', 'rename')

      await h.settleAll(() => 'ENOENT')

      expect(h.typesOf('unlinkDir')).toEqual(['C:/proj/dir'])
    })
  })

  describe('dispose()', () => {
    it('emits nothing after dispose, even for a stat already in flight', async () => {
      const h = createHarness()
      h.classifier.enqueue('C:/proj/a', 'rename')
      h.classifier.dispose()
      h.classifier.enqueue('C:/proj/b', 'rename')

      await h.settleAll(() => FILE)

      expect(h.stats).toEqual(['C:/proj/a'])
      expect(h.events).toEqual([])
      expect(h.classifier.pendingCount).toBe(0)
    })

    it('ignores clear() after dispose', () => {
      const h = createHarness()
      h.classifier.dispose()
      h.classifier.clear()
      h.classifier.enqueue('C:/proj/a', 'rename')
      expect(h.stats).toEqual([])
    })
  })

  describe('a listener that throws (C-L1)', () => {
    it('is logged by code, leaves no unhandled rejection, and the next queued path is still classified', async () => {
      const unhandled = vi.fn()
      process.on('unhandledRejection', unhandled)
      try {
        const events: NativeClassifiedEvent[] = []
        let throwNext = true
        const classifier = new NativeEventClassifier({
          lstat: () => Promise.resolve(FILE),
          isKnownFolder: () => false,
          caseSensitive: true,
          maxInFlight: 1,
          onEvent: event => {
            if (throwNext) {
              throwNext = false
              throw codeError('EBOOM')
            }
            events.push(event)
          },
          onBacklogOverflow: () => undefined
        })

        classifier.enqueue('C:/proj/first', 'rename')
        classifier.enqueue('C:/proj/second', 'rename')
        expect(classifier.pendingCount).toBe(1)
        await flush()

        expect(events).toEqual([{ type: 'add', path: 'C:/proj/second', source: 'rename' }])
        expect(classifier.inFlightCount + classifier.pendingCount).toBe(0)
        expect(logger.warn).toHaveBeenCalledWith('Native classifier: listener failed', { code: 'EBOOM' })

        // Node reports an unhandled rejection from its own tick processing: wait a real tick
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(unhandled).not.toHaveBeenCalled()
      } finally {
        process.off('unhandledRejection', unhandled)
      }
    })

    it('still classifies a path again when its listener threw for the result in flight (R-L3)', async () => {
      const unhandled = vi.fn()
      process.on('unhandledRejection', unhandled)
      try {
        const events: NativeClassifiedEvent[] = []
        let throwNext = true
        const classifier = new NativeEventClassifier({
          lstat: () => Promise.resolve(FILE),
          isKnownFolder: () => false,
          caseSensitive: true,
          onEvent: event => {
            events.push(event)
            if (throwNext) {
              throwNext = false
              throw codeError('EBOOM')
            }
          },
          onBacklogOverflow: () => undefined
        })

        classifier.enqueue('C:/proj/a', 'rename')
        // Changes again while its lstat is in flight
        classifier.enqueue('C:/proj/a', 'change')
        await flush()

        expect(events.map(event => event.type)).toEqual(['add', 'change'])
        expect(classifier.inFlightCount + classifier.pendingCount).toBe(0)
        expect(logger.warn).toHaveBeenCalledWith('Native classifier: listener failed', { code: 'EBOOM' })

        await new Promise(resolve => setTimeout(resolve, 0))
        expect(unhandled).not.toHaveBeenCalled()
      } finally {
        process.off('unhandledRejection', unhandled)
      }
    })
  })

  it('splits ancestors at backslashes as well as slashes', async () => {
    const h = createHarness({ maxInFlight: 1 })
    h.classifier.enqueue('C:\\proj\\busy', 'change')
    h.classifier.enqueue('C:\\proj\\dir\\a', 'rename')
    h.classifier.enqueue('C:\\proj\\dir', 'rename')

    await h.settleAll(() => 'ENOENT')

    expect(h.typesOf('unlinkDir')).toEqual(['C:\\proj\\dir'])
    expect(h.stats).not.toContain('C:\\proj\\dir\\a')
  })
})
