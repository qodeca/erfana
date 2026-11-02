// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comments, every preview – tells main which commentable files this window
 * holds unsaved editor changes for (docs/designs/comments/html-preview-comments.md
 * decision 13, §7.8; spec 024 024-FR-026, architecture note 001 § 8 C6;
 * `preview:commentSetUnsavedSources`). Part of the shared comment base.
 *
 * Main refuses a comment write into any of them with `COMMENT_UNSAVED_SOURCE`
 * – the `file-comment:*` family whichever window holds the edits, and again
 * right before the rename. The renderer is the only side that knows about
 * unsaved buffers, so it reports them: every change of
 * `useProjectStore.dirtyPanelIds` maps the dirty editor tabs to their
 * `params.filePath` (absolute, project space – never parsed from the panel
 * id), keeps every commentable one (`COMMENTABLE_EXTENSIONS`, which a main
 * test holds to the registered kinds), and sends the list when it differs from
 * the one main has. It runs while either preview's comments are on.
 *
 * A list main did not take (the invoke failed, or main refused it) does not
 * count as sent (review finding L4): it goes again
 * {@link UNSAVED_SOURCES_RETRY_MS} later, {@link UNSAVED_SOURCES_ATTEMPTS}
 * tries in all, and after that on the next change of the dirty tabs – even one
 * that leaves the same list. A newer list supersedes an older one's retries.
 *
 * Mount ONCE per window (`EditorAreaSplitPanel`): the list is the window's,
 * and a second mount would race the first with the same request.
 *
 * @module hooks/useUnsavedSourcesFeed
 */
import { useEffect, useRef } from 'react'
import type { DockviewApi } from 'dockview'
import { useProjectStore } from '../stores/useProjectStore'
import { commentGateway } from '../services/preview/commentGateway'
import { useGlobalSettingsStore } from '../stores/useGlobalSettingsStore'
import { isCommentableFileName } from '../../../shared/comments/commentableExtensions'
import { isAnyPreviewCommentsEnabled } from '../../../shared/ipc/global-settings-schema'
import {
  COMMENT_PATH_MAX_CHARS,
  COMMENT_UNSAVED_SOURCES_MAX
} from '../../../shared/ipc/preview-comment-schema'

/**
 * The absolute paths of the commentable files the dirty tabs show, sorted and
 * de-duplicated, capped at main's limit.
 *
 * @param dockviewApi - The editor-area dockview API.
 * @param dirtyIds - The dirty editor panel ids.
 * @returns The list to send.
 */
export function unsavedCommentSources(
  dockviewApi: Pick<DockviewApi, 'getPanel'> | null,
  dirtyIds: ReadonlySet<string>
): string[] {
  if (!dockviewApi) return []
  const paths = new Set<string>()
  for (const id of dirtyIds) {
    const value = (dockviewApi.getPanel(id)?.params as { filePath?: unknown } | undefined)?.filePath
    // A path over main's cap would get the whole request refused; it cannot
    // be a file main previews either, so it is left out.
    if (typeof value === 'string' && value.length <= COMMENT_PATH_MAX_CHARS && isCommentableFileName(value))
      paths.add(value)
  }
  return [...paths].sort().slice(0, COMMENT_UNSAVED_SOURCES_MAX)
}

/** A list main did not take is sent again after this long… */
export const UNSAVED_SOURCES_RETRY_MS = 1_000
/** …this many tries in all, before it waits for the next change. */
export const UNSAVED_SOURCES_ATTEMPTS = 3

/**
 * Keeps main's unsaved-sources list in step with this window's dirty tabs.
 *
 * @example
 * ```tsx
 * function EditorAreaSplitPanel() {
 *   useUnsavedSourcesFeed()
 *   …
 * }
 * ```
 */
export function useUnsavedSourcesFeed(): void {
  const dockviewApi = useProjectStore(s => s.dockviewApi)
  const dirtyIds = useProjectStore(s => s.dirtyPanelIds)
  // Settings not read yet count as on: reporting too much never blocks a save that should land.
  const enabled = useGlobalSettingsStore(s => s.settings === null || isAnyPreviewCommentsEnabled(s.settings))
  // The list main has or is being sent, joined. `null` before the first send,
  // so an empty list is still sent once when there was something before (a
  // reload of the renderer leaves main with the old list) – and again once a
  // list is given up on, so the next change sends whatever it holds.
  const current = useRef<string | null>(null)
  const retry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      clearTimeout(retry.current)
    }
  }, [])

  useEffect(() => {
    if (!commentGateway.available()) return
    if (!enabled) {
      // Both previews' comments are off: nothing can be written. Sent afresh when one turns on.
      current.current = null
      clearTimeout(retry.current)
      return
    }
    const paths = unsavedCommentSources(dockviewApi, dirtyIds)
    const key = paths.join('\n')
    if (key === current.current) return
    current.current = key
    clearTimeout(retry.current)
    const send = (attempt: number): void => {
      // The gateway never rejects: a failed invoke answers `{ ok: false }`.
      void commentGateway.setUnsavedSources(paths).then(ack => {
        if (ack.ok || !alive.current || current.current !== key) return
        if (attempt >= UNSAVED_SOURCES_ATTEMPTS) {
          current.current = null
          return
        }
        retry.current = setTimeout(() => send(attempt + 1), UNSAVED_SOURCES_RETRY_MS)
      })
    }
    send(1)
  }, [dockviewApi, dirtyIds, enabled])
}
