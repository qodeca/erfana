// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Shared harness for the `previewFrameEvents*.test.ts` files (issue #124,
 * WI-14). The suite is split by topic (docs/windows/contributing.md
 * § "Test-file split policy"); every part attaches the real frame events to a
 * fake contents that emits Electron 39's argument shapes, as spikes S4, S10 and
 * S11 saw them, over real page scopes with their real timers.
 *
 * Plain values and builders; there is no `vi.mock()` here.
 */
import { vi } from 'vitest'

import { createPreviewFailureLog } from '../PreviewFailureLog'
import type { PreviewWebContentsHandle } from '../PreviewSessionFactory'
import { attachPreviewFrameEvents } from '../previewFrameEvents'
import type { PreviewFrameLike } from '../previewFrameGuard'
import { createPageScopeHolder, createPreviewPageScope } from '../previewPageScope'

export const OWN_TOKEN = 'deadbeefdeadbeefdeadbeefdeadbeef'
export const OTHER_TOKEN = 'cafebabecafebabecafebabecafebabe'
export const own = (path: string): string => `erfana-preview://${OWN_TOKEN}${path}`
/** Chromium's `ERR_BLOCKED_BY_CLIENT`: the request filter's own cancel, listed by the filter. */
export const ERR_BLOCKED_BY_CLIENT = -20
export const ERR_ABORTED = -3
export const PID = 6

export interface TestFrame extends PreviewFrameLike {
  readonly routingId: number
}

export function makeView(options: { ownToken?: string; withLookup?: boolean } = {}) {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  const tree: unknown[] = []
  let subtreeReads = 0
  let nextId = 1
  const main = {
    frameTreeNodeId: nextId++,
    parent: null,
    get framesInSubtree(): readonly unknown[] {
      subtreeReads += 1
      return tree
    }
  }
  tree.push(main)
  const byRoutingId = new Map<number, TestFrame>()
  const contents = {
    mainFrame: main,
    on: (event: string, listener: (...args: unknown[]) => void) => {
      const set = listeners.get(event) ?? new Set()
      set.add(listener)
      listeners.set(event, set)
    },
    removeListener: (event: string, listener: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(listener)
    }
  } as unknown as Pick<PreviewWebContentsHandle, 'on' | 'removeListener' | 'mainFrame'>
  const emit = (event: string, ...args: unknown[]): void => {
    for (const listener of listeners.get(event) ?? []) {
      listener(...args)
    }
  }

  const failuresChanged = vi.fn()
  const hostBlocked = vi.fn()
  const holder = createPageScopeHolder(() =>
    createPreviewPageScope({
      panelId: 'panel-A',
      emit: { failuresChanged, hostBlocked },
      createFailureLog: (onEmit) => createPreviewFailureLog({ onEmit })
    })
  )
  const events = attachPreviewFrameEvents({
    panelId: 'panel-A',
    contents,
    pageScopes: holder,
    ownToken: options.ownToken ?? OWN_TOKEN,
    frameFromIds:
      options.withLookup === false
        ? undefined
        : (processId, routingId) => (processId === PID ? byRoutingId.get(routingId) : undefined),
    now: () => Date.now()
  })

  /** A frame created under `parent` (the page by default), counted into the tree first (S12). */
  const createFrame = (parent: PreviewFrameLike = main): TestFrame => {
    const id = nextId++
    const frame: TestFrame = { frameTreeNodeId: id, parent, routingId: 100 + id }
    byRoutingId.set(frame.routingId, frame)
    tree.push(frame)
    return frame
  }
  /** A chain of `depth` frames below the page; the deepest is returned. */
  const createChain = (depth: number): TestFrame => {
    let frame: PreviewFrameLike = main
    for (let level = 1; level <= depth; level += 1) {
      frame = createFrame(frame)
    }
    return frame as TestFrame
  }
  /** `will-frame-navigate` for a subframe; returns the event, for its `preventDefault`. */
  const navigate = (frame: PreviewFrameLike | null, url: string, isMainFrame = false) => {
    const event = { url, isMainFrame, isSameDocument: false, frame, preventDefault: vi.fn() }
    emit('will-frame-navigate', event)
    return event
  }
  const commitFrame = (frame: TestFrame, url = own('/child.html')): void => {
    emit('did-frame-navigate', {}, url, 200, 'OK', false, PID, frame.routingId)
  }
  const startSrcdoc = (frame: PreviewFrameLike | null): void => {
    emit('did-start-navigation', { url: 'about:srcdoc', isMainFrame: false, isSameDocument: false, frame })
  }
  const failFrame = (frame: TestFrame, code: number, url: string, isMainFrame = false): void => {
    emit('did-fail-provisional-load', {}, code, 'ERR', url, isMainFrame, PID, frame.routingId)
  }
  /** The page on screen's entries, as the badge would list them. */
  const entries = (): { type: string; resourceUrlOrHost: string }[] =>
    holder
      .committed()
      .failures()
      .map(({ type, resourceUrlOrHost }) => ({ type, resourceUrlOrHost }))
  const listenerCount = (): number =>
    [...listeners.values()].reduce((count, set) => count + set.size, 0)

  return {
    main,
    holder,
    events,
    emit,
    hostBlocked,
    createFrame,
    createChain,
    navigate,
    commitFrame,
    startSrcdoc,
    failFrame,
    entries,
    listenerCount,
    subtreeReads: () => subtreeReads,
    forget: (frame: TestFrame) => byRoutingId.delete(frame.routingId)
  }
}
