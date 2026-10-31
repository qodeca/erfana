// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comments – the carried draft: typed text that travels to the next
 * new-comment window in the same panel (comments-v2 C-14.1; spec 024 state
 * table W-01, W-02, W-07).
 *
 * A draft whose target moved cannot be saved where it was picked. "Pick
 * again" (and "Comment on the whole {parent}") put its text here; the next
 * new-comment window in the panel takes it – when it has no text of its own –
 * and says "Your text from the last comment is here." One slot per panel,
 * kept with the session's other drafts (`commentDrafts`) and never written
 * anywhere; a later carry replaces an earlier one.
 *
 * @module components/Comments/commentCarriedDrafts
 */
import { commentDrafts } from '../../stores/usePreviewCommentStore'

/** The slot's key among the session drafts: no element or thread draft key starts with it. */
const slotOf = (panelId: string): string => ['carried', panelId].join('|')

/** The per-panel carried-draft slot. */
export const carriedDrafts = {
  /** Keep `text` for the panel's next new-comment window; blank text clears the slot. */
  put(panelId: string, text: string): void {
    commentDrafts.set(slotOf(panelId), text.trim() === '' ? '' : text)
  },
  /** The panel's carried text, without taking it, or `null`. */
  peek(panelId: string): string | null {
    const text = commentDrafts.get(slotOf(panelId))
    return text === '' ? null : text
  },
  /** The text was taken (or passed over) by the next window. */
  clear(panelId: string): void {
    commentDrafts.clear(slotOf(panelId))
  }
} as const
