// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The HTML Preview's draft keep-alive (spec 024 C-14.2 "drafts never silently
 * expire"). Main gives a draft ten minutes (`commentKeyStore.ts`
 * `DRAFT_TTL_MS`). An HTML draft holds the element main read at the pick, so
 * unlike the Markdown host (`Comments/overlay/hostWindow.ts`), which mints a
 * fresh draft, this host keeps the same token alive: while a new-comment
 * window is open it asks main to renew it every {@link DRAFT_REFRESH_MS}, and
 * once more right before a Save when the last renewal is stale – a window left
 * open while the machine slept. Main renews a draft for at most a day from its
 * pick (`DRAFT_MAX_AGE_MS`); past that, or when a renewal is refused, the Save
 * says the draft expired and offers Pick again (C-14.1).
 *
 * @module components/Panels/HtmlPreviewPanel/comments/usePreviewDraftKeepAlive
 */
import { useCallback, useEffect, useRef } from 'react'
import type { CommentSaveRequest } from '../../../../../../shared/ipc/preview-comment-schema'
import { commentGateway } from '../../../../services/preview/commentGateway'
import { useLatestRef } from '../../../../hooks/useLatestRef'
import { DRAFT_REFRESH_MS } from '../../../Comments/overlay/hostWindow'

/** The open window's draft and when main last renewed it. */
interface KeptDraft {
  readonly token: string
  at: number
}

/**
 * Keeps the open new-comment window's draft alive (module comment).
 *
 * @param panelId - The preview tab.
 * @param token - The open new-comment window's draft token, or `null` when none is open.
 * @param now - Injected clock (tests).
 * @returns Called before a save: renews the save's draft first when its last renewal is stale.
 */
export function usePreviewDraftKeepAlive(
  panelId: string,
  token: string | null,
  now: () => number = () => Date.now()
): (save: CommentSaveRequest) => Promise<void> {
  const kept = useRef<KeptDraft | null>(null)
  const clock = useLatestRef(now)

  const renew = useCallback(
    async (draft: KeptDraft): Promise<void> => {
      // A refused renewal changes nothing here: the Save then says the draft expired (C-14.1).
      const answer = await commentGateway.keepDraft(panelId, draft.token)
      if (answer.ok) draft.at = clock.current()
    },
    [panelId, clock]
  )

  useEffect(() => {
    if (token === null) {
      kept.current = null
      return undefined
    }
    const draft: KeptDraft = { token, at: clock.current() }
    kept.current = draft
    const timer = setInterval(() => void renew(draft), DRAFT_REFRESH_MS)
    return () => {
      clearInterval(timer)
      if (kept.current === draft) kept.current = null
    }
  }, [token, renew, clock])

  return useCallback(
    async (save: CommentSaveRequest): Promise<void> => {
      const draft = kept.current
      if (save.op !== 'add' || draft === null || draft.token !== save.draftToken) return
      if (clock.current() - draft.at >= DRAFT_REFRESH_MS) await renew(draft)
    },
    [renew, clock]
  )
}
