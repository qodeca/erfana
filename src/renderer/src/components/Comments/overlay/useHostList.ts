// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The comment list of a renderer-hosted preview: read through the source on
 * show, on a file change and after a write, newest answer wins (the store's
 * generations) – with what main said about the read besides the list.
 *
 * @module components/Comments/overlay/useHostList
 */
import { useCallback, useEffect, useState } from 'react'
import type { CommentRefusalReason } from '../../../../../shared/ipc/comment-common-schema'
import type { ThreadPlacement } from '../../../../../shared/ipc/file-comment-schema'
import { useLatestRef } from '../../../hooks/useLatestRef'
import { usePreviewCommentStore } from '../../../stores/usePreviewCommentStore'
import type { CommentOverlayHostOptions } from './hostTypes'

/**
 * Refusals that say something about the file, so no new read can change them
 * (F-05). Every other failure may pass by itself and stays F-07, whose Try
 * again lives in the drawer: a disabled count would lock the way to it.
 */
const LASTING_REFUSALS: ReadonlySet<CommentRefusalReason> = new Set<CommentRefusalReason>([
  'not-absolute',
  'outside-project',
  'excluded',
  'not-html',
  'kind-mismatch',
  'alternate-stream',
  'short-name',
  'link'
])

/** What {@link useHostList} hands the host. */
export interface HostList {
  readonly refreshList: () => Promise<void>
  readonly placements: readonly ThreadPlacement[]
  /** Main said comments are off in Settings (a race with another window's switch): nothing listed, no new comment. */
  readonly off: boolean
  /** Main refused the read for a reason no new read can change. */
  readonly unreadable: boolean
}

/**
 * Reads one host's list.
 *
 * @param options - The host's options; `live` is whether its comments show now.
 * @returns {@link HostList}
 */
export function useHostList(options: CommentOverlayHostOptions, live: boolean): HostList {
  const { panelId, filePath, enabled, source, bufferText } = options
  const store = usePreviewCommentStore
  const [placements, setPlacements] = useState<readonly ThreadPlacement[]>([])
  const [off, setOff] = useState(false)
  const [unreadable, setUnreadable] = useState(false)
  const optionsRef = useLatestRef(options)

  const refreshList = useCallback(async () => {
    const generation = store.getState().beginList(panelId)
    const result = await optionsRef.current.source.list(optionsRef.current.bufferText)
    const turnedOff = !result.ok && result.reason === 'comments-off'
    const stored = store
      .getState()
      .finishList(
        panelId,
        generation,
        result.ok ? { ok: true, files: [result.file] } : turnedOff ? { ok: true, files: [] } : { ok: false, code: result.code }
      )
    if (!stored) return
    setPlacements(result.ok ? result.placements : [])
    setOff(turnedOff)
    setUnreadable(!result.ok && result.reason !== undefined && LASTING_REFUSALS.has(result.reason))
  }, [panelId, store, optionsRef])

  useEffect(() => {
    if (live) void refreshList()
  }, [live, filePath, bufferText, refreshList])

  useEffect(() => {
    if (!enabled) return undefined
    return source.onChanged(() => {
      if (optionsRef.current.shown) void refreshList()
    })
  }, [enabled, source, refreshList, optionsRef])

  return { refreshList, placements, off, unreadable }
}
