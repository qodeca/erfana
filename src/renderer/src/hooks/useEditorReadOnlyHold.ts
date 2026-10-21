// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Read-only hold for a panel's Monaco editor that survives an editor remount.
 *
 * During an autosave hold (a project switch or the unsaved-changes prompt,
 * see `editorSaveRegistry.holdAutosave`) the editor is made read-only so
 * nothing new can be typed between a flush and the end of the hold. Setting
 * the option on the current editor alone is not enough: switching the view
 * mode remounts the editor, and the new one starts editable. This hook keeps
 * the hold in a ref and re-applies it to every editor that mounts while it is
 * active.
 *
 * @module hooks/useEditorReadOnlyHold
 */

import { useCallback, useMemo, useRef } from 'react'

/** The slice of a Monaco editor the hold needs. */
export interface ReadOnlyCapableEditor {
  updateOptions(options: { readOnly: boolean }): void
}

/** What {@link useEditorReadOnlyHold} returns. */
export interface EditorReadOnlyHold {
  /**
   * Make the editor read-only until the returned release is called.
   * Holds are counted; the editor turns editable when the last one ends.
   * Calling a release twice has no further effect.
   */
  hold(): () => void
  /** Call from the editor's mount callback: re-applies an active hold. */
  applyToMountedEditor(editor: ReadOnlyCapableEditor): void
}

/**
 * Keep a panel's editor read-only across remounts while a hold is active.
 *
 * @param getEditor - Returns the currently mounted editor, if any. Read once,
 *   so it must look the editor up through a ref rather than close over it.
 * @returns The hold API
 *
 * @example
 * ```tsx
 * const readOnlyHold = useEditorReadOnlyHold(() => editorRef.current?.getEditor())
 * const release = readOnlyHold.hold()     // editor (and any remount) read-only
 * const onEditorMount = (editor) => readOnlyHold.applyToMountedEditor(editor)
 * release()                               // editable again
 * ```
 */
export function useEditorReadOnlyHold(
  getEditor: () => ReadOnlyCapableEditor | null | undefined
): EditorReadOnlyHold {
  const holdsRef = useRef(0)
  // Captured once: the getter is expected to read refs (as the panel's does),
  // so the first one stays correct for the panel's lifetime.
  const getEditorRef = useRef(getEditor)

  const hold = useCallback((): (() => void) => {
    holdsRef.current += 1
    getEditorRef.current()?.updateOptions?.({ readOnly: true })
    let released = false
    return () => {
      if (released) return
      released = true
      holdsRef.current = Math.max(0, holdsRef.current - 1)
      if (holdsRef.current === 0) getEditorRef.current()?.updateOptions?.({ readOnly: false })
    }
  }, [])

  const applyToMountedEditor = useCallback((editor: ReadOnlyCapableEditor): void => {
    if (holdsRef.current > 0) editor.updateOptions({ readOnly: true })
  }, [])

  // Stable identity, so callbacks that list the hold as a dependency do not change
  return useMemo(() => ({ hold, applyToMountedEditor }), [hold, applyToMountedEditor])
}
