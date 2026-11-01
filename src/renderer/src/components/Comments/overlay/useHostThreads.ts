// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * How a renderer-hosted preview opens its thread window
 * (`useCommentOverlayHost.ts`), and the target that window stands on.
 *
 * From the preview – an icon, an underline or a pick – the window stands on its
 * target, and text carried by Pick again goes to a new comment there instead
 * (I-23). A drawer row or a step key was not opened on one: "New comment" there
 * finds the thread's target itself (`hostWindow.ts` `newTargetOf`).
 *
 * @module components/Comments/overlay/useHostThreads
 */
import { useCallback, useState } from 'react'
import { usePreviewCommentStore } from '../../../stores/usePreviewCommentStore'
import { useLatestRef } from '../../../hooks/useLatestRef'
import { carriedDrafts } from '../commentCarriedDrafts'
import type { CommentWindowRequest } from '../commentWindowTypes'
import { threadsWindowRequest } from './hostDrawer'
import type { PreviewCommentAdapter } from './previewAdapter'

const NONE: readonly string[] = []

/** Options for {@link useHostThreads}. */
interface HostThreadsOptions {
  readonly panelId: string
  readonly adapter: PreviewCommentAdapter
  /** The pane the window is placed in. */
  readonly area: HTMLElement | null
  /** The window opens: the menu goes, and the request is shown. */
  readonly onRequest: (request: CommentWindowRequest) => void
  /** Open the new-comment window on a target. */
  readonly openNew: (target: HTMLElement) => void
}

/** What {@link useHostThreads} gives the host. */
interface HostThreads {
  /** The target the open thread window stands on, or `null`. */
  readonly onTarget: HTMLElement | null
  /** Open the window from the preview. */
  readonly openThreads: (threadKeys: readonly string[], anchor: HTMLElement | null, opener?: 'page' | 'drawer', blockKeys?: readonly string[]) => void
  /** Open it from a step key: the thread's target comes into view, but the window was not opened on it. */
  readonly openStepped: (threadKeys: readonly string[], anchor: HTMLElement | null) => void
  /** Open it from a drawer row, on a thread or on a damaged or newer-format block. */
  readonly openRow: (threadKeys: readonly string[], blockKeys: readonly string[]) => void
}

/**
 * The thread window's ways in.
 *
 * @param options - {@link HostThreadsOptions}
 * @returns {@link HostThreads}
 */
export function useHostThreads(options: HostThreadsOptions): HostThreads {
  const { panelId, adapter } = options
  const [onTarget, setOnTarget] = useState<HTMLElement | null>(null)
  const latest = useLatestRef(options)
  const store = usePreviewCommentStore

  const show = useCallback(
    (threadKeys: readonly string[], anchor: HTMLElement | null, opener: 'page' | 'drawer', blockKeys: readonly string[], target: HTMLElement | null, outsideMode = false) => {
      const listed = store.getState().panels.get(panelId)?.list
      const file = listed?.files[0]
      if (file === undefined) return
      setOnTarget(target)
      latest.current.onRequest(threadsWindowRequest(file, panelId, listed?.generation ?? 0, { threadKeys, blockKeys, anchor, area: latest.current.area, opener, outsideMode }))
    },
    [store, panelId, latest]
  )

  const openThreads = useCallback<HostThreads['openThreads']>(
    (threadKeys, anchor, opener = 'page', blockKeys = NONE) => {
      // A ghost's anchor is the ghost itself: its target is gone (C-05).
      const target = opener === 'page' && anchor !== null && adapter.targetAt(anchor) === anchor && adapter.canComment(anchor).ok ? anchor : null
      const mode = store.getState().panels.get(panelId)?.mode === true
      if (target !== null && carriedDrafts.pickTakesText(panelId, mode)) latest.current.openNew(target)
      else show(threadKeys, anchor, opener, blockKeys, target, opener === 'page' && !mode)
    },
    [adapter, store, panelId, latest, show]
  )
  const openStepped = useCallback<HostThreads['openStepped']>((threadKeys, anchor) => show(threadKeys, anchor, 'page', NONE, null), [show])
  const openRow = useCallback<HostThreads['openRow']>((threadKeys, blockKeys) => show(threadKeys, null, 'drawer', blockKeys, null), [show])

  return { onTarget, openThreads, openStepped, openRow }
}
