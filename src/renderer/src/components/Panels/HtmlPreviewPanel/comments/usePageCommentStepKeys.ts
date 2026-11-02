// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – the stepper's keys while focus is in the page
 * (comments-v2 C-13; spec 024 024-NFR-006, 024-AC-029).
 *
 * The page is another process: its Alt+F9 / Alt+Shift+F9 never reach
 * Erfana's DOM. Main matches them in the page's `before-input-event` – only
 * while comments are on for the view – and forwards them as `comment-next` /
 * `comment-previous` on `preview:forwardedShortcut`, after handing native
 * focus back to Erfana's window, which the comment window is about to take
 * (`previewInputForward.ts`, `previewHostFocus.ts`). Nothing in the page's
 * preload changes.
 *
 * This hook, for THIS panel only, opens the window on the next (previous)
 * thread in the drawer's current filter (`commentStepKeys.ts`). The list is
 * read first when the tab has not read it yet. The panel's chrome – toolbar and
 * drawer – hands its own presses to the function it returns (I-25).
 *
 * @module HtmlPreviewPanel/comments/usePageCommentStepKeys
 */
import { useCallback, useEffect } from 'react'
import type { CommentStep } from '../../../../../../shared/commentStepKey'
import { previewGateway } from '../../../../services/previewGateway'
import { usePreviewCommentStore } from '../../../../stores/usePreviewCommentStore'
import { useLatestRef } from '../../../../hooks/useLatestRef'
import { HTML_WORDS } from '../../../Comments/commentCopyWords'
import { drawerFilterOf } from '../../../Comments/commentDrawerFilter'
import { takePreviewStep, useForgetPanelStepsOnClose, type StepTarget } from '../../../Comments/commentStepKeys'

/** The forwarded keys of the pair, and the step each is. */
const STEP_KEYS: Readonly<Record<string, CommentStep>> = { 'comment-next': 'next', 'comment-previous': 'previous' }

/** Options for {@link usePageCommentStepKeys}. */
export interface PageCommentStepKeysOptions {
  readonly panelId: string
  /** Comments are on and the tab is shown. */
  readonly live: boolean
  /** The panel's drawer `id`: steps stay within its current filter. */
  readonly drawerId: string
  /** Read the list (when the tab has not read it yet). */
  readonly readList: () => Promise<void>
  /** Open the thread's window; `chrome` when the press came from the panel's chrome, not the page. */
  readonly open: (target: StepTarget, chrome: boolean) => void
  readonly announce: (text: string) => void
}

/** One step, the list read first when the tab has not read it yet. `latest`: the read is awaited. */
function takeStep(panelId: string, latest: { readonly current: PageCommentStepKeysOptions }, step: CommentStep, chrome: boolean): void {
  const files = () => usePreviewCommentStore.getState().panels.get(panelId)?.list.files ?? []
  const go = (): void => {
    const { drawerId, open, announce } = latest.current
    takePreviewStep({ panelKey: drawerId, files, filter: drawerFilterOf(drawerId), open: target => open(target, chrome), announce, noun: HTML_WORDS.noun }, step)
  }
  if (usePreviewCommentStore.getState().panels.get(panelId)?.list.status === 'ready') go()
  else void latest.current.readList().then(go)
}

/**
 * Route the page's forwarded step keys to this panel's comments.
 *
 * @param options - {@link PageCommentStepKeysOptions}
 * @returns Takes a step pressed in the panel's chrome.
 */
export function usePageCommentStepKeys(options: PageCommentStepKeysOptions): (step: CommentStep) => void {
  const latest = useLatestRef(options)
  const { panelId, live } = options
  useForgetPanelStepsOnClose(options.drawerId)
  const take = useCallback((step: CommentStep, chrome: boolean) => takeStep(panelId, latest, step, chrome), [panelId, latest])
  useEffect(() => {
    if (!live) return undefined
    return previewGateway.onForwardedShortcut(payload => {
      const step = STEP_KEYS[payload.key]
      if (payload.panelId === panelId && step !== undefined) take(step, false)
    })
  }, [live, panelId, take])
  return useCallback((step: CommentStep) => take(step, true), [take])
}
