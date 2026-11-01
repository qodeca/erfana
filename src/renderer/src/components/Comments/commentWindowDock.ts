// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comments – the docked window's dock for the thread shown now (C-18). Kept
 * apart from `CommentWindow` only because of the 500-line ratchet.
 *
 * @module components/Comments/commentWindowDock
 */
import { useMemo } from 'react'
import type { CommentDock } from './CommentWindowShell'
import type { NounSource } from './commentWindowTypes'

/** What a host hands the window: `anchor` takes the thread shown, `null` for a new comment. */
export type WindowDock = Omit<CommentDock, 'anchor' | 'label'> & { readonly anchor: (threadKey: string | null) => HTMLElement | null }

/**
 * The dock, memoized so placement does not re-run every render.
 *
 * @param dock - The host's dock.
 * @param threadKey - The thread shown, `null` for a new comment.
 * @param target - The target, for the edge tab's noun.
 * @param line - The target's line.
 * @param noun - The preview's noun.
 * @returns The shell's dock, or `undefined` for a modal window.
 */
export function useDock(
  dock: WindowDock | undefined,
  threadKey: string | null,
  target: NounSource,
  line: number,
  noun: (target: NounSource) => string
): CommentDock | undefined {
  const name = noun(target)
  return useMemo(
    () =>
      dock === undefined
        ? undefined
        : {
            anchor: () => dock.anchor(threadKey),
            ...(dock.column === undefined ? {} : { column: dock.column }),
            ...(dock.preview === undefined ? {} : { preview: dock.preview }),
            label: { noun: name, line }
          },
    [dock, threadKey, name, line]
  )
}
