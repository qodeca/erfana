// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The HTML Preview's draft and key store, which gives a new comment its words
 * (spec 024 024-FR-004, 024-AC-004).
 *
 * The shared save flow (`commentSaveFlow.ts`) writes a draft's anchor as main
 * built it. An `add` may name the words the window ended with; {@link withWords}
 * holds them for exactly the synchronous claim the flow makes at its start,
 * and the claimed draft's anchor gains `sel` only when the words are a valid
 * `anchor.sel` found once in the text the draft was built with
 * (`verifiedSel`). Anything else saves the comment on the whole element, as
 * v0.23.1 does.
 */
import type { CommentSaveRequest, CommentSaveResult } from '../../../../shared/ipc/preview-comment-schema'
import { CommentKeyStore, type CommentBinding, type KeyLookup } from '../../comments/commentKeyStore'
import type { CommentDraft } from './commentDraftBuilder'
import { verifiedSel, type PickWords } from './commentWordsCore'

/** The store, with the words of the save being claimed. */
export class CommentDraftKeys extends CommentKeyStore<CommentDraft> {
  private pending: { readonly token: string; readonly sel: NonNullable<PickWords['sel']> } | null = null

  /**
   * Run `save` – the save flow – with `request`'s words held for its claim.
   * The flow claims the draft before its first `await`, so the words are
   * dropped again before anything else can run.
   */
  withWords(request: CommentSaveRequest, save: (request: CommentSaveRequest) => Promise<CommentSaveResult>): Promise<CommentSaveResult> {
    if (request.op !== 'add' || request.sel === undefined) return save(request)
    this.pending = { token: request.draftToken, sel: request.sel }
    try {
      return save(request)
    } finally {
      this.pending = null
    }
  }

  override claimDraft(token: string, binding: CommentBinding): KeyLookup<CommentDraft> {
    const claim = super.claimDraft(token, binding)
    const pending = this.pending
    if (!claim.ok || pending === null || pending.token !== token) return claim
    const sel = verifiedSel(claim.value.wordsText, pending.sel)
    return sel === undefined ? claim : { ok: true, value: { ...claim.value, anchor: { ...claim.value.anchor, sel } } }
  }
}
