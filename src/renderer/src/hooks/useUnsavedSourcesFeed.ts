// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – tells main which HTML files this window holds
 * unsaved editor changes for (docs/designs/html-preview-comments.md
 * decision 13, §7.8; `preview:commentSetUnsavedSources`).
 *
 * Main refuses a comment write into any of them with `COMMENT_UNSAVED_SOURCE`
 * and marks a new draft `unsavedSource: true`. The renderer is the only side
 * that knows about unsaved buffers, so it reports them: every change of
 * `useProjectStore.dirtyPanelIds` maps the dirty editor tabs to their
 * `params.filePath` (absolute, project space – never parsed from the panel
 * id), keeps the `.html` / `.htm` ones, and sends the list when it differs
 * from the last one sent.
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
import { isHtmlFile } from '../utils/fileUtils'
import {
  COMMENT_PATH_MAX_CHARS,
  COMMENT_UNSAVED_SOURCES_MAX
} from '../../../shared/ipc/preview-comment-schema'

/**
 * The absolute paths of the HTML files the dirty tabs show, sorted and
 * de-duplicated, capped at main's limit.
 *
 * @param dockviewApi - The editor-area dockview API.
 * @param dirtyIds - The dirty editor panel ids.
 * @returns The list to send.
 */
export function unsavedHtmlSources(
  dockviewApi: Pick<DockviewApi, 'getPanel'> | null,
  dirtyIds: ReadonlySet<string>
): string[] {
  if (!dockviewApi) return []
  const paths = new Set<string>()
  for (const id of dirtyIds) {
    const value = (dockviewApi.getPanel(id)?.params as { filePath?: unknown } | undefined)?.filePath
    // A path over main's cap would get the whole request refused; it cannot
    // be a file main previews either, so it is left out.
    if (typeof value === 'string' && value.length <= COMMENT_PATH_MAX_CHARS && isHtmlFile(value))
      paths.add(value)
  }
  return [...paths].sort().slice(0, COMMENT_UNSAVED_SOURCES_MAX)
}

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
  // The last list sent, joined – `null` before the first send, so an empty
  // list is still sent once when there was something before (a reload of the
  // renderer leaves main with the old list).
  const lastSent = useRef<string | null>(null)

  useEffect(() => {
    if (!commentGateway.available()) return
    const paths = unsavedHtmlSources(dockviewApi, dirtyIds)
    const key = paths.join('\n')
    if (key === lastSent.current) return
    lastSent.current = key
    void commentGateway.setUnsavedSources(paths)
  }, [dockviewApi, dirtyIds])
}
