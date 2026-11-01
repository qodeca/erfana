// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The stepper's keys in a renderer-hosted preview's panel (comments-v2 C-13;
 * spec 024 024-NFR-006, differences table § 3 "the stepper and its keys";
 * I-25: a reviewer working down the drawer steps from there too).
 *
 * Alt+F9 / Alt+Shift+F9 anywhere in the panel step the open window – the
 * Markdown window is not modal, so it may be open while focus is elsewhere –
 * or, with none open, open the window on the next (previous) thread in the
 * drawer's current filter and bring its target into view
 * (`commentStepKeys.ts`). With nothing to step to, it says so (K-26).
 *
 * The host hands the panel's keys in (`onPanelKey`): the root's own keydown and
 * dockview's group element. Neither fires for another tab's panel, so the
 * active-panel rule of src/renderer/CLAUDE.md holds by construction. It runs in
 * any mode, as the window's own keys do. A key the window took is
 * `defaultPrevented` by then, and is left alone.
 *
 * @module components/Comments/overlay/useHostStepKeys
 */
import { commentStepFromDomEvent } from '../../../../../shared/commentStepKey'
import type { ThreadPlacement } from '../../../../../shared/ipc/file-comment-schema'
import type { CommentFileView } from '../../../../../shared/ipc/comment-common-schema'
import { useLatestRef } from '../../../hooks/useLatestRef'
import { drawerFilterOf } from '../commentDrawerFilter'
import { takePreviewStep, useForgetPanelStepsOnClose } from '../commentStepKeys'
import type { PreviewCommentAdapter } from './previewAdapter'

/** The slice of a key press the keys read: a React event and a native one both fit. */
export type HostStepKey = Pick<KeyboardEvent, 'code' | 'altKey' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'defaultPrevented' | 'preventDefault'>

/** Options for {@link useHostStepKeys}. */
export interface HostStepKeysOptions {
  /** The host is live (comments on, the preview shown). */
  readonly live: boolean
  readonly adapter: PreviewCommentAdapter
  /** The listed file, or `null` before the first list. */
  readonly file: CommentFileView | null
  readonly placements: readonly ThreadPlacement[]
  /** The panel's drawer `id`: steps stay within its current filter. */
  readonly drawerId: string
  /** Open the window on these threads (the host's `openThreads`). */
  readonly openThreads: (threadKeys: readonly string[], anchor: HTMLElement | null) => void
  /** The one reveal step, for the thread a step reached. */
  readonly reveal: (threadKey: string) => void
  readonly announce: (text: string) => void
}

/** One key press in the panel: `true` when it was a step key. */
function takeStepKey(event: HostStepKey, options: HostStepKeysOptions): boolean {
  const step = commentStepFromDomEvent(event)
  const { live, adapter, file, placements, drawerId, openThreads, announce, reveal } = options
  if (step === null || !live || event.defaultPrevented) return false
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
        reveal(threadKey)
        openThreads([threadKey], target)
      }
    },
    step
  )
  return true
}

/**
 * The step keys of one panel.
 *
 * @param options - {@link HostStepKeysOptions}
 * @returns Takes a key press from the panel; `true` when it was a step key.
 */
export function useHostStepKeys(options: HostStepKeysOptions): (event: HostStepKey) => boolean {
  const latest = useLatestRef(options)
  useForgetPanelStepsOnClose(options.drawerId)
  return event => takeStepKey(event, latest.current)
}
