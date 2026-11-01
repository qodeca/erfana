// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The drawer's bulk actions, in both previews (spec 024 024-FR-028, plan step
 * 13). The steps are the same whichever action runs: the person opens the
 * review from the drawer's button, reads the list, and confirms – nothing else
 * reaches `onBulk`: no menu, key or file content starts one. The list is
 * derived from main's list on every render, so what is confirmed is what is
 * shown, and a re-list that empties it ends the review.
 *
 * A resolve writes the reader's name, so it stops at the identity step first
 * (024-FR-022); Cancel there goes back to the review. Focus goes to Cancel
 * when the review opens, and back to the drawer when it ends.
 *
 * @module components/Comments/useDrawerBulk
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CommentBulkChange, CommentBulkRequest, CommentBulkResult } from '../../../../shared/ipc/comment-common-schema'
import type { CommentIdentitySettings } from '../../../../shared/ipc/global-settings-schema'
import { useCommentDirtyGuard } from '../../hooks/useCommentDirtyGuard'
import type { CommentListState } from '../../stores/usePreviewCommentStore'
import { bulkFiles, bulkItems, bulkOutcome, type BulkItem, type BulkOutcome } from './commentBulk'
import { MD_SURFACE_COPY } from './commentCopyWords'
import type { DrawerFilter } from './commentRows'
import type { IdentityFormData } from './commentSchemas'
import { useCommentWords } from './commentWords'
import { identityMissing } from './useIdentityGate'

/** What a host gives the drawer's bulk actions. */
export interface DrawerBulkHost {
  /** Run one action: one write per file, in main. */
  readonly run: (request: Omit<CommentBulkRequest, 'panelId'>) => Promise<CommentBulkResult>
  readonly identity: CommentIdentitySettings | null
  readonly onSaveIdentity: (identity: IdentityFormData) => Promise<boolean>
}

/** What the bar and the review read. */
export interface DrawerBulk {
  /** The action this filter offers, or `null`. */
  readonly offered: CommentBulkChange | null
  /** Why it is held back: the unsaved-edits sentence. */
  readonly paused: string | null
  readonly review: { readonly change: CommentBulkChange; readonly items: readonly BulkItem[]; readonly askName: boolean } | null
  readonly busy: boolean
  readonly outcome: BulkOutcome | null
  readonly identity: CommentIdentitySettings | null
  readonly actionRef: React.RefObject<HTMLButtonElement>
  readonly cancelRef: React.RefObject<HTMLButtonElement>
  open(change: CommentBulkChange): void
  cancel(): void
  confirm(): void
  saveIdentity(identity: IdentityFormData): Promise<boolean>
}

const FILTER_ACTION: Readonly<Partial<Record<DrawerFilter, CommentBulkChange>>> = { open: 'resolve', resolved: 'deleteResolved' }

/**
 * @param list - The drawer's list.
 * @param filter - The drawer's filter: Open offers the resolve, Resolved the delete.
 * @param host - The host's half; none: no bulk action.
 * @param relist - Read the list again after a run.
 * @param focusHome - Takes focus when the action's button is gone after a run.
 * @returns {@link DrawerBulk}
 */
export function useDrawerBulk(list: CommentListState, filter: DrawerFilter, host: DrawerBulkHost | undefined, relist: () => void, focusHome: () => void): DrawerBulk {
  const words = useCommentWords()
  const [step, setStep] = useState<{ readonly change: CommentBulkChange; readonly askName: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<BulkOutcome | null>(null)
  const actionRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const files = useMemo(() => (list.status === 'ready' ? list.files : []), [list])
  const first = files[0] ?? null
  const guard = useCommentDirtyGuard(first?.filePath ?? null)
  const paused = guard.state === 'clean' ? null : MD_SURFACE_COPY.paused(first?.displayPath ?? '')

  const change = FILTER_ACTION[filter]
  const offeredItems = useMemo(() => (change === undefined ? [] : bulkItems(files, change, words)), [files, change, words])
  const offered = host !== undefined && change !== undefined && offeredItems.length > 0 ? change : null

  const reviewItems = useMemo(() => (step === null ? [] : bulkItems(files, step.change, words)), [files, step, words])
  const review = step !== null && reviewItems.length > 0 && paused === null ? { ...step, items: reviewItems } : null

  const reviewing = review !== null && !review.askName
  useEffect(() => {
    if (reviewing) cancelRef.current?.focus()
  }, [reviewing])

  const backToDrawer = (): void => {
    setStep(null)
    // The list comes back in the next render; the action's button may go with the comments.
    requestAnimationFrame(() => {
      if (actionRef.current === null) focusHome()
      else actionRef.current.focus()
    })
  }

  const run = async (): Promise<void> => {
    if (review === null || host === undefined) return
    setBusy(true)
    const { items, change: running } = review
    const result = await host.run({ change: running, files: bulkFiles(items) })
    setBusy(false)
    setOutcome(bulkOutcome(running, items.length, result, items, words))
    backToDrawer()
    relist()
  }

  return {
    offered,
    paused: offered === null ? null : paused,
    review,
    busy,
    outcome,
    identity: host?.identity ?? null,
    actionRef,
    cancelRef,
    open: next => {
      setOutcome(null)
      setStep({ change: next, askName: false })
    },
    cancel: () => {
      if (busy) return
      if (step?.askName === true) setStep({ ...step, askName: false })
      else backToDrawer()
    },
    confirm: () => {
      if (busy || review === null) return
      if (review.change === 'resolve' && identityMissing(host?.identity ?? null)) setStep({ change: review.change, askName: true })
      else void run()
    },
    saveIdentity: async identity => {
      const saved = (await host?.onSaveIdentity(identity)) ?? false
      if (saved) await run()
      return saved
    }
  }
}
