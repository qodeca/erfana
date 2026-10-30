// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * What the renderer's comment overlay host hands the comment window beyond
 * the request itself (`useCommentOverlayHost.ts`; comments-v2 C-13, C-14.2,
 * C-18, C-19.3; state table W-07, W-08). Kept apart from the host only
 * because of the 500-line ratchet.
 *
 * - **The dock** (C-18): what the non-modal window follows – the thread's
 *   target, or the picked target of a new comment – the text column it sits
 *   beside, and the preview scroller F6 hands focus to.
 * - **The new request's extras**: the parent that can hold a comment
 *   ("Comment on the whole {parent}", W-07) and a refusal the pick already
 *   knows (a generated START/END region, W-08).
 * - **The draft keep-alive** (C-14.2 "drafts never silently expire"): main
 *   gives a draft ten minutes from its mint (`commentKeyStore.ts`
 *   `DRAFT_TTL_MS`). While a new-comment window is open, the host mints a
 *   fresh draft every {@link DRAFT_REFRESH_MS} and saves with the newest one;
 *   a refresh missed while the machine slept is made up right before the
 *   save. The window keeps the token it opened with (its typed-text key);
 *   only the save swaps it. A draft carries no target – the pick travels
 *   with the save – so a fresh one stands in for the old one exactly.
 *
 * @module components/Comments/overlay/hostWindow
 */
import { useCallback, useEffect, useRef } from 'react'
import { useLatestRef } from '../../../hooks/useLatestRef'
import type { FileCommentOpenDraftResult, ThreadPlacement } from '../../../../../shared/ipc/file-comment-schema'
import type { CommentDock } from '../CommentWindowShell'
import type { PreviewCommentAdapter } from './previewAdapter'

/**
 * How often an open new-comment window's draft is renewed: well inside main's
 * ten-minute `DRAFT_TTL_MS`, so one late timer never lets it lapse.
 */
export const DRAFT_REFRESH_MS = 4 * 60 * 1000

/** The dock a renderer-hosted window takes (`CommentWindowProps.dock`). */
export type HostDock = Omit<CommentDock, 'anchor' | 'label'> & { readonly anchor: (threadKey: string | null) => HTMLElement | null }

/**
 * The element a listed thread is attached to now, or `null`.
 *
 * @param threadKey - The thread.
 * @param placements - Where main placed the listed threads.
 * @param adapter - The preview's adapter.
 * @returns The rendered target.
 */
export function threadTarget(threadKey: string, placements: readonly ThreadPlacement[], adapter: PreviewCommentAdapter): HTMLElement | null {
  const placement = placements.find(p => p.threadKey === threadKey)
  return placement === undefined ? null : adapter.attach(placement)
}

/**
 * `el` when it has a layout box, else `null`. A target that is not drawn –
 * `display: none`, inside a closed `<details>`, a pane not laid out – is no
 * anchor: the dock falls back to the request's point instead of folding the
 * window to an edge tab that would scroll to nothing (C-18).
 *
 * @param el - A rendered target, or `null`.
 * @returns The target, when it is drawn.
 */
export function drawn(el: HTMLElement | null): HTMLElement | null {
  return el !== null && el.getClientRects().length > 0 ? el : null
}

/**
 * The extras of a new-comment request on `target` (W-07, W-08).
 *
 * @param target - The picked target.
 * @param adapter - The preview's adapter.
 * @returns `parentTag` when a parent can hold a comment; `refused` when the pick already knows none can be written.
 */
export function newRequestExtras(
  target: HTMLElement,
  adapter: PreviewCommentAdapter
): { readonly parentTag?: string; readonly refused?: 'generated-region' } {
  const parent = adapter.parentOf(target)
  const parentTag = parent !== null && adapter.canComment(parent).ok ? adapter.tagOf(parent) : undefined
  const refused = adapter.refusalOf?.(target) === 'generated-region' ? ('generated-region' as const) : undefined
  return { ...(parentTag === undefined ? {} : { parentTag }), ...(refused === undefined ? {} : { refused }) }
}

/** One open window's draft: the token it opened with, the newest one, and when that was minted. */
interface LiveDraft {
  readonly opened: string
  token: string
  at: number
}

/**
 * Keeps the open new-comment window's draft alive (module comment, C-14.2).
 *
 * @param opened - The open window's draft token, or `null` when no new-comment window is open.
 * @param openDraft - Mints a fresh draft for this panel's file.
 * @param now - Injected clock (tests).
 * @returns The token to save `opened` with: the newest draft, renewed first when the last renewal is stale.
 */
export function useDraftKeepAlive(
  opened: string | null,
  openDraft: () => Promise<FileCommentOpenDraftResult>,
  now: () => number = () => Date.now()
): (token: string) => Promise<string> {
  const live = useRef<LiveDraft | null>(null)
  const mint = useLatestRef(openDraft)
  const clock = useLatestRef(now)

  const renew = useCallback(async (draft: LiveDraft): Promise<void> => {
    const answer = await mint.current()
    // A refused renewal keeps the current token: if it lapses, the save says so and offers Pick again (C-14.1).
    if (answer.ok && live.current === draft) {
      draft.token = answer.draftToken
      draft.at = clock.current()
    }
  }, [mint, clock])

  useEffect(() => {
    if (opened === null) {
      live.current = null
      return undefined
    }
    const draft: LiveDraft = { opened, token: opened, at: clock.current() }
    live.current = draft
    const timer = setInterval(() => void renew(draft), DRAFT_REFRESH_MS)
    return () => {
      clearInterval(timer)
      if (live.current === draft) live.current = null
    }
  }, [opened, renew, clock])

  return useCallback(
    async (token: string): Promise<string> => {
      const draft = live.current
      if (draft === null || draft.opened !== token) return token
      if (clock.current() - draft.at >= DRAFT_REFRESH_MS) await renew(draft)
      return draft.token
    },
    [renew, clock]
  )
}
