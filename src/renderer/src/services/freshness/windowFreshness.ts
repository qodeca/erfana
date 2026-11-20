// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * Everything the renderer's trackers share in one window (#478, plan S12,
 * decision 37): the source, the clock, the id maker, and one registry that a
 * window `focus` and main's `file-watch:check` (power resume – G8) reach every
 * tracker through. One listener of each per window, not one per tab: they are
 * installed with the first tracker and removed with the last.
 *
 * The save port is not part of it: only the editor adapter may pause a watch
 * or write (decision 7, F17), through {@link pausableFreshnessSource}; a
 * read-only adapter cannot reach it, even by type.
 *
 * Tests swap the whole environment with {@link setFreshnessEnvironmentForTests}
 * (a fake source, a fake clock), and the save port with
 * {@link setPausableSourceForTests}, so a hook test never touches `window.api`.
 *
 * @module services/freshness/windowFreshness
 */
import { realClock, type Clock } from '../../../../shared/clock'
import { FreshnessRegistry, type Checkable } from '../../../../shared/freshness/freshnessRegistry'
import type { FreshnessSource, PausableSource } from '../../../../shared/freshness/freshnessTypes'
import { fileWatchGateway } from '../fileWatchGateway'
import { logger } from '../../utils/logger'
import { createIpcFreshnessSource, createPausableIpcSource } from './ipcFreshnessSource'

/** What a renderer tracker is built from. */
export interface FreshnessEnvironment {
  readonly source: FreshnessSource
  readonly clock: Clock
  readonly newId: () => string
  /** Main's "check every tracker" broadcast; returns the unsubscribe. */
  readonly onCheck: (listener: () => void) => () => void
}

function ipcEnvironment(): FreshnessEnvironment {
  return {
    source: createIpcFreshnessSource(),
    clock: realClock,
    newId: () => crypto.randomUUID(),
    onCheck: (listener) => fileWatchGateway.onCheck(() => listener())
  }
}

let environment: FreshnessEnvironment | null = null
let pausable: PausableSource | null = null
const registry = new FreshnessRegistry()
let stopListening: (() => void) | null = null

/** The window's freshness environment (the IPC one unless a test installed another). */
export function freshnessEnvironment(): FreshnessEnvironment {
  environment ??= ipcEnvironment()
  return environment
}

/** Install `next` until the returned restore runs (tests only). */
export function setFreshnessEnvironmentForTests(next: FreshnessEnvironment): () => void {
  const previous = environment
  stopListening?.()
  stopListening = null
  environment = next
  return () => {
    stopListening?.()
    stopListening = null
    environment = previous
  }
}

/** The editor's save port (pause, resume, the checked write) over the window's source. */
export function pausableFreshnessSource(): PausableSource {
  pausable ??= createPausableIpcSource(freshnessEnvironment().source)
  return pausable
}

/** Install `next` as the save port until the returned restore runs (tests only). */
export function setPausableSourceForTests(next: PausableSource): () => void {
  const previous = pausable
  pausable = next
  return () => {
    pausable = previous
  }
}

function checkAll(reason: 'focus' | 'resume'): void {
  try {
    registry.checkAll(reason)
  } catch (error) {
    logger.error('A file check failed', error instanceof Error ? error : undefined, { reason })
  }
}

function listen(): () => void {
  const onFocus = (): void => checkAll('focus')
  window.addEventListener('focus', onFocus)
  const stopCheck = freshnessEnvironment().onCheck(() => checkAll('resume'))
  return () => {
    window.removeEventListener('focus', onFocus)
    stopCheck()
  }
}

/**
 * Add a tracker to the window's registry: it checks on window focus and on a
 * power resume. Returns its removal.
 */
export function registerTracker(tracker: Checkable): () => void {
  const remove = registry.add(tracker)
  stopListening ??= listen()
  return () => {
    remove()
    if (registry.size === 0 && stopListening !== null) {
      stopListening()
      stopListening = null
    }
  }
}
