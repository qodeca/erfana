// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * mainFreshnessRegistry - the main process's side of the safety net (#478,
 * plan S17, decision 37): every main-side tracker (the HTML preview's page
 * and its sub-file pool, the comment watches) checks its file when an app
 * window gains focus, as each renderer tab does on its window's `focus`.
 *
 * One `browser-window-focus` listener for the whole process, installed with
 * the first tracker and removed with the last (like the renderer's
 * `windowFreshness`). A power resume reaches the same trackers through their
 * owner's `onCheck` (`FileWatcherService.checkInProcessOwners`), and a preview
 * shown again through `PreviewLiveView.setVisibility` – neither goes through
 * here, so nothing is checked twice.
 *
 * @module services/freshness/mainFreshnessRegistry
 */
import { app } from 'electron'
import { FreshnessRegistry, type Checkable } from '../../../shared/freshness/freshnessRegistry'
import type { CheckReason } from '../../../shared/freshness/freshnessTypes'
import { redactedLogError } from '../../utils/redactUserInput'
import { logger } from '../LoggingService'

/** Where window focus is heard; Electron's `app` in production. */
export interface FocusSource {
  on(event: 'browser-window-focus', listener: () => void): unknown
  removeListener(event: 'browser-window-focus', listener: () => void): unknown
}

const registry = new FreshnessRegistry()
let focusSource: FocusSource | null = null
let stopListening: (() => void) | null = null

/** No window focus to hear (a process without Electron's `app`, such as a suite's mocked Electron). */
const NO_FOCUS: FocusSource = { on: () => undefined, removeListener: () => undefined }

function source(): FocusSource {
  if (focusSource) return focusSource
  try {
    focusSource = app ?? NO_FOCUS
  } catch {
    // A mocked Electron without `app` throws on the access
    focusSource = NO_FOCUS
  }
  return focusSource
}

/** Ask every main tracker to check; a failing one is logged, the rest still check. */
export function checkMainTrackers(reason: CheckReason): void {
  try {
    registry.checkAll(reason)
  } catch (error) {
    logger.error('A main file check failed', redactedLogError(error))
  }
}

function listen(): () => void {
  const onFocus = (): void => checkMainTrackers('focus')
  const target = source()
  target.on('browser-window-focus', onFocus)
  return () => {
    target.removeListener('browser-window-focus', onFocus)
  }
}

/** Add a main tracker: it checks whenever an app window gains focus. Returns its removal. */
export function registerMainTracker(member: Checkable): () => void {
  const remove = registry.add(member)
  stopListening ??= listen()
  return () => {
    remove()
    if (registry.size === 0 && stopListening !== null) {
      stopListening()
      stopListening = null
    }
  }
}

/** Main trackers registered now (tests, diagnostics). */
export function mainTrackerCount(): number {
  return registry.size
}

/** Hear focus from `next` instead of Electron's `app` until the returned restore runs (tests only). */
export function setFocusSourceForTests(next: FocusSource): () => void {
  stopListening?.()
  stopListening = null
  const previous = focusSource
  focusSource = next
  if (registry.size > 0) stopListening = listen()
  return () => {
    stopListening?.()
    stopListening = null
    focusSource = previous
    if (registry.size > 0) stopListening = listen()
  }
}
