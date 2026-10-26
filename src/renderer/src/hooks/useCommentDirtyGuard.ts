// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – the unsaved-editor guard of decision 13
 * (docs/designs/html-preview-comments.md §7.8; R-007, R-024).
 *
 * If the HTML file a comment goes into is also open in an "Open as source"
 * editor tab with unsaved changes, a comment write and the editor's next save
 * would overwrite each other. So the comment window blocks Save and offers:
 *
 * - **Go to tab** – always;
 * - **Save {file}** – only when the tab is NOT in the "changed on disk"
 *   conflict state: saving then would overwrite the outside edit, so that
 *   variant offers Go to tab only (the `previewTabMove.ts` conflict rule).
 *
 * The banner clears itself the moment the tab is clean – whoever saved it,
 * autosave included – and says "Saved. You can add your comment now."
 *
 * Tabs are matched with `findEditorTabsShowing`, by the PROJECT-SPACE path
 * main returns (`CommentFileView.filePath`), and their dirtiness is
 * `useProjectStore.dirtyPanelIds`. Main enforces the same rule from the list
 * {@link useUnsavedSourcesFeed} sends it, so a race between this check and
 * the write is still refused there (`COMMENT_UNSAVED_SOURCE`).
 *
 * Limitation (design §7.8): a tab in ANOTHER window is not seen; the disk
 * re-hash at save still prevents a stale overwrite.
 *
 * @module hooks/useCommentDirtyGuard
 */
import { useCallback, useMemo, useState } from 'react'
import { useProjectStore } from '../stores/useProjectStore'
import { editorSaveRegistry } from '../services/editorSaveRegistry'
import { findEditorTabsShowing } from '../utils/openFileInPanel'

/** Monaco's focusable input, in either of its input modes. */
const MONACO_INPUT = '.monaco-editor .native-edit-context, .monaco-editor textarea'

/** What the guard knows about the file's editor tabs. */
export interface CommentDirtyGuard {
  /** `'dirty'` – unsaved edits; `'conflict'` – unsaved AND changed on disk; else `'clean'`. */
  readonly state: 'clean' | 'dirty' | 'conflict'
  /** The tab was dirty while the window was open and is clean now. */
  readonly justSaved: boolean
  /**
   * How the tab became clean, once {@link CommentDirtyGuard.justSaved}:
   * `'saved'` when the guard's own {@link CommentDirtyGuard.save} wrote it,
   * `'clean'` otherwise (Cmd+S, autosave, or "Don't save" discarding the
   * changes – the guard cannot tell those apart, so the window words it
   * neutrally). `null` while there is nothing to report.
   */
  readonly cleared: 'saved' | 'clean' | null
  /**
   * Activate the dirty tab and, a frame later, focus its editor. Close any
   * modal comment window FIRST: its focus trap would pull focus back.
   */
  readonly goToTab: () => void
  /** Save the dirty tab; `false` when it did not save. Never offered in the conflict state. */
  readonly save: () => Promise<boolean>
  /**
   * Hold the autosave of every editor tab showing the file for the length of
   * a comment write, so a keystroke-triggered save cannot land mid-write.
   * Returns the release.
   */
  readonly holdForWrite: () => () => void
}

/**
 * Watches the editor tabs that show `filePath`.
 *
 * @param filePath - Absolute, project-space path of the HTML file; `null` for none.
 * @returns The guard's state and actions.
 *
 * @example
 * ```tsx
 * const guard = useCommentDirtyGuard(file.filePath)
 * const blocked = guard.state !== 'clean'
 * ```
 */
export function useCommentDirtyGuard(filePath: string | null): CommentDirtyGuard {
  const dockviewApi = useProjectStore(s => s.dockviewApi)
  const dirtyIds = useProjectStore(s => s.dirtyPanelIds)

  const tabIds = useMemo(() => {
    if (!dockviewApi || !filePath) return [] as string[]
    return findEditorTabsShowing(dockviewApi, filePath).map(panel => panel.id)
    // `dirtyIds` is a dependency on purpose: a tab opened while the window is
    // open marks itself dirty through it, and the panel list has no store.
  }, [dockviewApi, filePath, dirtyIds]) // eslint-disable-line react-hooks/exhaustive-deps

  const dirtyId = tabIds.find(id => dirtyIds.has(id)) ?? null
  const state: CommentDirtyGuard['state'] =
    dirtyId === null ? 'clean' : editorSaveRegistry.hasConflict(dirtyId) ? 'conflict' : 'dirty'

  // "Was dirty, is clean now": the banner turns into its success line.
  // Recorded while rendering (React's "adjust state on a change" pattern),
  // not in an effect, so the banner flips in the same commit.
  const [seenDirty, setSeenDirty] = useState(false)
  if (state !== 'clean' && !seenDirty) setSeenDirty(true)
  const justSaved = seenDirty && state === 'clean'
  // Set before our own save starts – the tab can turn clean before the
  // promise settles – and cleared again when that save did not land.
  const [savedByUs, setSavedByUs] = useState(false)
  const cleared = justSaved ? (savedByUs ? 'saved' : 'clean') : null

  const goToTab = useCallback(() => {
    if (!dockviewApi || dirtyId === null) return
    const panel = dockviewApi.getPanel(dirtyId)
    if (!panel) return
    panel.api.setActive()
    // A frame later, so a comment window closed by the same click has
    // unmounted and its focus restore has run – and then one task more,
    // because activating a tab focuses its panel element on a zero timeout
    // (EditorAreaSplitPanel). Only then does the editor itself take focus
    // (Monaco's input – the EditContext element Monaco uses in Chromium, or
    // its textarea where it falls back), not just the panel.
    requestAnimationFrame(() => {
      setTimeout(() => {
        const input = panel.group?.element?.querySelector<HTMLElement>(MONACO_INPUT)
        if (input) input.focus()
        else panel.group?.focus?.()
      }, 0)
    })
  }, [dockviewApi, dirtyId])

  const save = useCallback(async () => {
    if (dirtyId === null || editorSaveRegistry.hasConflict(dirtyId)) return false
    setSavedByUs(true)
    const ok = await editorSaveRegistry.save(dirtyId)
    if (!ok) setSavedByUs(false)
    return ok
  }, [dirtyId])

  const holdForWrite = useCallback(() => {
    const releases = tabIds.map(id => editorSaveRegistry.holdAutosave(id))
    return () => releases.forEach(release => release())
  }, [tabIds])

  return { state, justSaved, cleared, goToTab, save, holdForWrite }
}
