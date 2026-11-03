// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('../LoggingService', () => ({ logger: mockLogger }))

import { BrowserProjectTeardown, leavesProject, tabInScope, type TeardownScope } from './browserProjectTeardown'
import { ProjectSessionStore, type ProjectSessionSnapshot } from '../session/ProjectSession'

const snap = (realRoot: string, caseSensitive = true): Omit<ProjectSessionSnapshot, 'generation'> => ({
  root: realRoot,
  realRoot,
  caseSensitive,
  ownerWebContentsId: 1
})

/** A scope as the old string root the steps used to get: the project root, or `window:<id>`. */
const at = (scope: TeardownScope): string => (scope.kind === 'project' ? scope.projectRoot : `window:${scope.windowId}`)

describe('BrowserProjectTeardown (ADR 0009 decision 14, A10)', () => {
  let teardown: BrowserProjectTeardown
  let order: string[]

  beforeEach(() => {
    vi.clearAllMocks()
    teardown = new BrowserProjectTeardown()
    order = []
  })

  function recordAll(): void {
    // Registered in reverse to show the stage, not the registration, decides the order
    teardown.onStage('closeViews', (scope) => void order.push(`closeViews:${at(scope)}`))
    teardown.onStage('abortCaptureWrites', async (scope) => {
      await Promise.resolve()
      order.push(`abortCaptureWrites:${at(scope)}`)
    })
    teardown.onStage('endPick', (scope) => void order.push(`endPick:${at(scope)}`))
  }

  it('ends pick, then aborts capture writes, then closes views', async () => {
    recordAll()
    await teardown.run('/old')
    expect(order).toEqual(['endPick:/old', 'abortCaptureWrites:/old', 'closeViews:/old'])
  })

  it('waits for an async step before the next stage', async () => {
    let release!: () => void
    teardown.onStage('abortCaptureWrites', () => new Promise<void>((resolve) => (release = resolve)))
    teardown.onStage('closeViews', () => void order.push('closeViews'))
    const run = teardown.run('/old')
    await Promise.resolve()
    expect(order).toEqual([])
    release()
    await run
    expect(order).toEqual(['closeViews'])
  })

  it('runs the same three stages, in the same order, for a closing window', async () => {
    recordAll()
    await teardown.runForWindow(7)
    expect(order).toEqual(['endPick:window:7', 'abortCaptureWrites:window:7', 'closeViews:window:7'])
  })

  it('queues a window teardown behind a project teardown already running', async () => {
    recordAll()
    await Promise.all([teardown.run('/old'), teardown.runForWindow(3)])
    expect(order).toEqual([
      'endPick:/old',
      'abortCaptureWrites:/old',
      'closeViews:/old',
      'endPick:window:3',
      'abortCaptureWrites:window:3',
      'closeViews:window:3'
    ])
  })

  it('logs a failing step and still runs the rest', async () => {
    teardown.onStage('endPick', () => {
      throw new Error('pick gone')
    })
    teardown.onStage('abortCaptureWrites', () => Promise.reject(new Error('write gone')))
    teardown.onStage('closeViews', () => void order.push('closeViews'))
    await teardown.run('/old')
    expect(order).toEqual(['closeViews'])
    expect(mockLogger.error).toHaveBeenCalledTimes(2)
    expect(mockLogger.error).toHaveBeenCalledWith('Browser teardown step failed', expect.any(Error), { stage: 'endPick' })
  })

  it('runs teardowns one at a time, in order', async () => {
    teardown.onStage('endPick', async (scope) => {
      order.push(`start:${at(scope)}`)
      await Promise.resolve()
      order.push(`end:${at(scope)}`)
    })
    await Promise.all([teardown.run('/a'), teardown.run('/b')])
    expect(order).toEqual(['start:/a', 'end:/a', 'start:/b', 'end:/b'])
  })

  it('stops calling a removed step', async () => {
    const off = teardown.onStage('endPick', () => void order.push('x'))
    off()
    await teardown.run('/old')
    expect(order).toEqual([])
  })

  describe('following the project session', () => {
    it('tears down the old project on a switch and on a close, never on an open', async () => {
      const store = new ProjectSessionStore()
      recordAll()
      teardown.attach(store)
      store.commit(snap('/a'))
      store.commit(snap('/b'))
      store.commit(null)
      await teardown.run('/flush')
      expect(order.filter((e) => e.startsWith('endPick'))).toEqual(['endPick:/a', 'endPick:/b', 'endPick:/flush'])
    })

    it('stops following after unsubscribing', async () => {
      const store = new ProjectSessionStore()
      recordAll()
      const off = teardown.attach(store)
      store.commit(snap('/a'))
      off()
      store.commit(null)
      await teardown.run('/flush')
      expect(order.filter((e) => e.startsWith('endPick'))).toEqual(['endPick:/flush'])
    })
  })

  describe('tabInScope', () => {
    const tab = { projectRoot: '/Projects/A', caseSensitive: false, windowId: 4 }
    it('matches a project by path, with the tab\'s case rule, and a window by id', () => {
      expect(tabInScope({ kind: 'project', projectRoot: '/projects/a' }, tab)).toBe(true)
      expect(tabInScope({ kind: 'project', projectRoot: '/projects/a' }, { ...tab, caseSensitive: true })).toBe(false)
      expect(tabInScope({ kind: 'project', projectRoot: '/projects/b' }, tab)).toBe(false)
      expect(tabInScope({ kind: 'window', windowId: 4 }, tab)).toBe(true)
      expect(tabInScope({ kind: 'window', windowId: 5 }, tab)).toBe(false)
    })
  })

  describe('leavesProject', () => {
    it.each<[string, ReturnType<typeof snap> | null, ReturnType<typeof snap> | null, boolean]>([
      ['open', null, snap('/a'), false],
      ['nothing', null, null, false],
      ['close', snap('/a'), null, true],
      ['switch', snap('/a'), snap('/b'), true],
      ['same project', snap('/a'), snap('/a'), false],
      ['same project, other case on a case-insensitive volume', snap('/A', false), snap('/a', false), false],
      ['other case on a case-sensitive volume', snap('/A'), snap('/a'), true]
    ])('%s', (_name, prev, next, expected) => {
      const withGen = (s: ReturnType<typeof snap> | null): ProjectSessionSnapshot | null =>
        s === null ? null : { ...s, generation: 1 }
      expect(leavesProject(withGen(prev), withGen(next))).toBe(expected)
    })
  })
})
