// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * useEditorSaveRegistration hook (issue #124, part 3 §3.6).
 *
 * Puts an editor tab's save function and conflict flag into the
 * {@link editorSaveRegistry} under its panel id, for as long as the panel is
 * mounted, so the preview move coordinator can save the tab by id.
 *
 * The registry entry forwards to the LATEST `save`, `hasConflict` and
 * `holdAutosave` the panel rendered with, through a ref: `handleSave` is
 * rebuilt whenever the file changes, and re-registering on every rebuild would
 * open a window with no entry at all.
 *
 * @module useEditorSaveRegistration
 */
import { useEffect } from 'react'

import { editorSaveRegistry } from '../services/editorSaveRegistry'
import { useLatestRef } from './useLatestRef'

/**
 * Registers an editor tab for save-by-id while it is mounted.
 *
 * @param panelId - The tab's dockview panel id; nothing is registered while it
 *   is `undefined`
 * @param save - Writes the buffer; resolves `true` on success, `false` on failure
 * @param hasConflict - The tab is in its "changed on disk" conflict state
 * @param holdAutosave - Cancels the tab's pending autosave and returns a
 *   release that re-arms it (see `EditorSaveEntry.holdAutosave`)
 * @param whenSaveSettled - Resolves once a save in flight has finished (see
 *   `EditorSaveEntry.whenSaveSettled`); optional
 *
 * @example
 * ```tsx
 * useEditorSaveRegistration(panelIdRef.current, () => handleSave(false), externalChangeDetected, () => {
 *   cancelAutoSave()
 *   return () => signalChange()
 * })
 * ```
 */
export function useEditorSaveRegistration(
  panelId: string | undefined,
  save: () => Promise<boolean>,
  hasConflict: boolean,
  holdAutosave: () => () => void,
  whenSaveSettled?: () => Promise<void>
): void {
  const latest = useLatestRef({ save, hasConflict, holdAutosave, whenSaveSettled })

  useEffect(() => {
    if (!panelId) return undefined
    return editorSaveRegistry.register(panelId, {
      save: () => latest.current.save(),
      hasConflict: () => latest.current.hasConflict,
      holdAutosave: () => latest.current.holdAutosave(),
      whenSaveSettled: () => latest.current.whenSaveSettled?.() ?? Promise.resolve()
    })
  }, [panelId, latest])
}
