// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comments – the stepper's keys while focus is in the PREVIEW (comments-v2
 * C-13: "Keys while focus is in the window or preview: Alt+F9 next,
 * Alt+Shift+F9 previous"; spec 024 024-NFR-006).
 *
 * Inside the comment window the window's own key handler steps
 * (`CommentWindow`). From the preview a step goes:
 *
 * 1. to the panel's open window, when there is one that can step – the
 *    Markdown window is not modal, so focus can be in the preview while it is
 *    open ({@link stepOpenWindow});
 * 2. else to the host, which opens the window on the thread after (or
 *    before) the one a window of this panel showed last, in file order,
 *    within the drawer's current filter – or on the first (last) one when
 *    none was shown yet or it is gone ({@link stepTargetFrom}).
 *
 * The Markdown Preview reads the keys on its scroller; the HTML page's press
 * is matched by main (`previewInputForward.ts`) and forwarded as
 * `comment-next` / `comment-previous`.
 *
 * @module components/Comments/commentStepKeys
 */
import { useEffect } from 'react'
import type { CommentStep } from '../../../../shared/commentStepKey'
import type { CommentFileView } from '../../../../shared/ipc/comment-common-schema'
import type { DrawerFilter } from './commentRows'
import { WINDOW_COPY } from './commentWindowCopy'
import { inDrawerFilter, stepPosition } from './commentWindowStates'

/** An open window's answer to a step asked from outside it: `true` when it took the step. */
type WindowStep = (step: CommentStep) => boolean

const windows = new Map<string, WindowStep>()
const lastShown = new Map<string, string>()

/**
 * Ask the panel's open comment window to take a step.
 *
 * @param panelKey - The panel.
 * @param step - The direction.
 * @returns `true` when an open window stepped; `false` when none is open or it has nothing to step to.
 */
export function stepOpenWindow(panelKey: string, step: CommentStep): boolean {
  return windows.get(panelKey)?.(step) ?? false
}

/**
 * The comment window's side: take steps asked from the preview, and remember
 * the thread it shows, so the next key press from the preview goes on from it.
 *
 * @param panelKey - The window's panel.
 * @param shownThread - The thread the window shows now, if any.
 * @param onStep - Take a step; return whether one was taken.
 */
export function useWindowStepTarget(panelKey: string, shownThread: string | undefined, onStep: WindowStep): void {
  useEffect(() => {
    if (shownThread !== undefined) lastShown.set(panelKey, shownThread)
  }, [panelKey, shownThread])
  useEffect(() => {
    windows.set(panelKey, onStep)
    return () => {
      if (windows.get(panelKey) === onStep) windows.delete(panelKey)
    }
  }, [panelKey, onStep])
}

/** Where a step from the preview lands: the thread, and the file it is listed in. */
export interface StepTarget {
  readonly file: CommentFileView
  readonly threadKey: string
}

/**
 * The thread a step from the preview opens, with no window open.
 *
 * @param panelKey - The panel (its last shown thread is where the step starts).
 * @param files - The panel's listed files, in list order.
 * @param filter - The drawer's current filter (Open while the drawer is shut).
 * @param step - The direction.
 * @returns The target, or `null` when the filter holds no thread.
 */
export function stepTargetFrom(
  panelKey: string,
  files: readonly CommentFileView[],
  filter: DrawerFilter,
  step: CommentStep
): StepTarget | null {
  const from = lastShown.get(panelKey)
  const home = from === undefined ? undefined : files.find(file => file.threads.some(thread => thread.threadKey === from))
  if (from !== undefined && home !== undefined) {
    const at = stepPosition(home, [from], filter)
    const key = step === 'next' ? at?.next : at?.previous
    if (key !== null && key !== undefined) return { file: home, threadKey: key }
    // The only thread in the filter is the one shown last: it opens again.
    const self = home.threads.find(thread => thread.threadKey === from)
    if (self !== undefined && inDrawerFilter(self, filter)) return { file: home, threadKey: from }
  }
  const all = files.flatMap(file => file.threads.filter(thread => inDrawerFilter(thread, filter)).map(thread => ({ file, threadKey: thread.threadKey })))
  return (step === 'next' ? all[0] : all[all.length - 1]) ?? null
}

/** What a host gives {@link takePreviewStep}. */
export interface PreviewStepHost {
  /** The panel's key: its drawer `id`, which the panel's window is given too (one per panel). */
  readonly panelKey: string
  /** The panel's listed files now. */
  readonly files: () => readonly CommentFileView[]
  readonly filter: DrawerFilter
  /** Open the thread's window (and bring its target into view). */
  readonly open: (target: StepTarget) => void
  /** Say where the step landed ("Comment 3 of 12, on paragraph, line 42."). */
  readonly announce: (text: string) => void
  /** The target word of a tag in this preview. */
  readonly noun: (tag: string) => string
}

/**
 * A step key pressed while focus is in the preview (C-13): the open window
 * steps, else the host opens the window on the next (previous) thread.
 *
 * @param host - {@link PreviewStepHost}
 * @param step - The direction.
 * @returns `true` when something stepped or opened; `false` when the filter holds no thread.
 */
export function takePreviewStep(host: PreviewStepHost, step: CommentStep): boolean {
  if (stepOpenWindow(host.panelKey, step)) return true
  const target = stepTargetFrom(host.panelKey, host.files(), host.filter, step)
  if (target === null) return false
  host.open(target)
  const thread = target.file.threads.find(t => t.threadKey === target.threadKey)
  const at = stepPosition(target.file, [target.threadKey], host.filter)
  if (thread !== undefined && at !== null) host.announce(WINDOW_COPY.stepAnnounce(at.at, at.of, host.noun(thread.tag), thread.line))
  return true
}

/** Test helper: forget every window and every last shown thread. */
export function resetCommentStepKeys(): void {
  windows.clear()
  lastShown.clear()
}
