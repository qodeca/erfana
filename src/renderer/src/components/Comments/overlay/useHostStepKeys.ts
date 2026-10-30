// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The stepper's keys while focus is in a renderer-hosted preview (comments-v2
 * C-13: "Keys while focus is in the window or preview"; spec 024 024-NFR-006,
 * differences table § 3 "the stepper and its keys").
 *
 * Alt+F9 / Alt+Shift+F9 on the preview's scroller step the open window – the
 * Markdown window is not modal, so it may be open while focus is in the
 * preview – or, with none open, open the window on the next (previous)
 * thread in the drawer's current filter and bring its target into view
 * (`commentStepKeys.ts`).
 *
 * The listener is the scroller's own, not the `window`'s: a key reaches it
 * only while focus is inside this panel's preview, so another tab's preview
 * never answers it (the active-panel rule of src/renderer/CLAUDE.md holds by
 * construction). It runs in any mode, as the window's own keys do.
 *
 * @module components/Comments/overlay/useHostStepKeys
 */
import { useEffect } from 'react'
import { commentStepFromDomEvent } from '../../../../../shared/commentStepKey'
import type { ThreadPlacement } from '../../../../../shared/ipc/file-comment-schema'
import type { CommentFileView } from '../../../../../shared/ipc/comment-common-schema'
import { useLatestRef } from '../../../hooks/useLatestRef'
import { drawerFilterOf } from '../commentDrawerFilter'
import { takePreviewStep, useForgetPanelStepsOnClose } from '../commentStepKeys'
import type { PreviewCommentAdapter } from './previewAdapter'

/** Options for {@link useHostStepKeys}. */
export interface HostStepKeysOptions {
  /** The host is live (comments on, the preview shown). */
  readonly live: boolean
  readonly scroller: HTMLElement | null
  readonly adapter: PreviewCommentAdapter
  /** The listed file, or `null` before the first list. */
  readonly file: CommentFileView | null
  readonly placements: readonly ThreadPlacement[]
  /** The panel's drawer `id`: steps stay within its current filter. */
  readonly drawerId: string
  /** Open the window on these threads (the host's `openThreads`). */
  readonly openThreads: (threadKeys: readonly string[], anchor: HTMLElement | null) => void
  readonly announce: (text: string) => void
}

/**
 * Wire the step keys on the preview's scroller.
 *
 * @param options - {@link HostStepKeysOptions}
 */
export function useHostStepKeys(options: HostStepKeysOptions): void {
  const latest = useLatestRef(options)
  const { live, scroller } = options
  useForgetPanelStepsOnClose(options.drawerId)
  useEffect(() => {
    if (!live || scroller === null) return undefined
    const onKeyDown = (event: KeyboardEvent): void => {
      const step = commentStepFromDomEvent(event)
      if (step === null) return
      const { adapter, file, placements, drawerId, openThreads, announce } = latest.current
      event.preventDefault()
      takePreviewStep(
        {
          panelKey: drawerId,
          files: () => (file === null ? [] : [file]),
          filter: drawerFilterOf(drawerId),
          noun: adapter.words.noun,
          announce,
          open: ({ threadKey }) => {
            const placement = placements.find(p => p.threadKey === threadKey)
            const target = placement === undefined ? null : adapter.attach(placement)
            target?.scrollIntoView({ block: 'center' })
            openThreads([threadKey], target)
          }
        },
        step
      )
    }
    scroller.addEventListener('keydown', onKeyDown)
    return () => scroller.removeEventListener('keydown', onKeyDown)
  }, [live, scroller, latest])
}
