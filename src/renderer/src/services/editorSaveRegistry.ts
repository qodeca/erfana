// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Save an editor tab by its panel id (issue #124, part 3 §3.6).
 *
 * Saving lives inside `MarkdownEditorPanel.handleSave`, which reads the Monaco
 * buffer and runs the autosave guards (#124 autosave work). Nothing outside the
 * panel could reach it, but the preview move coordinator must save ANOTHER
 * tab's buffer when the user answers "Save" in the unsaved-changes prompt. Each
 * mounted editor therefore registers two functions here under its panel id –
 * through {@link useEditorSaveRegistration} – and the coordinator calls them by
 * id. The save itself is the panel's own `handleSave`, so every guard it runs
 * (echo detection, the post-save dirty re-check) applies unchanged.
 *
 * The coordinator also HOLDS a dirty tab's autosave while it asks, so "Don't
 * save" is not overtaken by the 2 s autosave writing the edits anyway.
 *
 * FAIL-SAFE BY DESIGN. An id with no entry saves nothing and answers `false`,
 * and so does a save that throws: the coordinator reads `false` as "the save
 * failed" and abandons the move, so the edits stay in their tab. Answering
 * `true` for a tab that could not be reached would let the coordinator close
 * it and drop the edits.
 *
 * @module editorSaveRegistry
 * @see docs/design/design-issue-124-part3.md §3.6 "Saving an editor tab by its id"
 */

/** What one mounted editor tab offers the registry. */
export interface EditorSaveEntry {
  /**
   * Write the tab's buffer to disk.
   *
   * @returns `true` when the write succeeded, `false` when it did not
   */
  save(): Promise<boolean>
  /**
   * Whether the tab is in its "changed on disk" conflict state, where a save
   * would overwrite a newer file and must not be offered.
   *
   * @returns `true` while the conflict notice is showing
   */
  hasConflict(): boolean
  /**
   * Pause the tab's autosave: cancel its pending timers, so a write the user
   * has not agreed to cannot land while the unsaved-changes prompt is open.
   *
   * @returns A release that re-arms the autosave debounce, so no edit is left
   *   unsaved once the prompt ends without closing the tab
   */
  holdAutosave(): () => void
}

const entries = new Map<string, EditorSaveEntry>()

/**
 * One tab's outstanding autosave holds. Two moves can prompt about the same
 * dirty tab at once, so holds are counted: the entry is held on the first and
 * released only when the last one ends, or the first answer would re-arm
 * autosave while the other prompt is still open.
 */
interface HoldRecord {
  /** The entry that was held, so a re-registered tab is never released by an old handle */
  entry: EditorSaveEntry
  /** Handles not yet released */
  count: number
  /** The entry's own release, run when `count` returns to 0 */
  release: () => void
}

const holds = new Map<string, HoldRecord>()

/**
 * The editor save registry: register on mount, save or query by panel id.
 *
 * @example
 * ```ts
 * // In the editor panel (through useEditorSaveRegistration):
 * const unregister = editorSaveRegistry.register(panelId, { save, hasConflict, holdAutosave })
 *
 * // In the move coordinator:
 * if (!editorSaveRegistry.hasConflict(id) && (await editorSaveRegistry.save(id))) {
 *   // the buffer is on disk; the tab can close
 * }
 * ```
 */
export const editorSaveRegistry = {
  /**
   * Register a tab's save functions, replacing any earlier entry for the id.
   *
   * @param panelId - The editor tab's dockview panel id
   * @param entry - Its save and conflict functions
   * @returns An unregister function. It removes only THIS entry, so a late
   *   cleanup from an unmounted instance cannot remove the entry a remounted
   *   instance of the same tab has just registered.
   */
  register(panelId: string, entry: EditorSaveEntry): () => void {
    entries.set(panelId, entry)
    return () => {
      if (entries.get(panelId) === entry) entries.delete(panelId)
      // Drop the count with the entry: its outstanding handles then do nothing.
      if (holds.get(panelId)?.entry === entry) holds.delete(panelId)
    }
  },

  /**
   * Save the tab's buffer.
   *
   * @param panelId - The editor tab's dockview panel id
   * @returns `true` only when a registered tab reports a successful write;
   *   `false` when no tab is registered under the id or its save throws
   */
  async save(panelId: string): Promise<boolean> {
    const entry = entries.get(panelId)
    if (!entry) return false
    try {
      return (await entry.save()) === true
    } catch {
      // The panel logs its own write failures; a throw here only means "not
      // saved", which the caller turns into the toast and an abandoned move.
      return false
    }
  },

  /**
   * Whether the tab is in its "changed on disk" conflict state.
   *
   * @param panelId - The editor tab's dockview panel id
   * @returns `false` for an unknown id or a query that throws
   */
  hasConflict(panelId: string): boolean {
    try {
      return entries.get(panelId)?.hasConflict() === true
    } catch {
      return false
    }
  },

  /**
   * Pause the tab's autosave until the returned release is called.
   *
   * @param panelId - The editor tab's dockview panel id
   * @returns A release. Holds are counted per panel id: the entry is held on
   *   the first call and its release runs only when every handle has been
   *   released. Each handle is idempotent and never throws, and it calls
   *   through only while the same entry is still registered, so a tab that has
   *   closed never re-arms a timer that would write it. An unknown id or a hold
   *   that throws gives a release that does nothing.
   *
   * @example
   * ```ts
   * const release = editorSaveRegistry.holdAutosave('editor-b')
   * const answer = await prompt(request)
   * if (answer === 'cancel') release()
   * ```
   */
  holdAutosave(panelId: string): () => void {
    const entry = entries.get(panelId)
    if (!entry) return () => {}
    let hold = holds.get(panelId)
    // A record left by an entry that has since been replaced belongs to a tab
    // instance that no longer exists; the new entry starts uncounted.
    if (!hold || hold.entry !== entry) {
      let release: () => void
      try {
        release = entry.holdAutosave()
      } catch {
        return () => {}
      }
      hold = { entry, count: 0, release }
      holds.set(panelId, hold)
    }
    const record = hold
    record.count += 1
    let released = false
    return () => {
      if (released) return
      released = true
      // The record is gone or replaced once the entry unregistered (or a new
      // entry took the id), so a closed tab's timer is never re-armed.
      if (holds.get(panelId) !== record) return
      record.count -= 1
      if (record.count > 0) return
      holds.delete(panelId)
      if (entries.get(panelId) !== record.entry) return
      try {
        record.release()
      } catch {
        // A release that throws leaves the debounce unarmed; the next keystroke
        // or the panel's modified-state effect arms it again.
      }
    }
  },

  /**
   * Whether a tab is registered under the id.
   *
   * @param panelId - The editor tab's dockview panel id
   * @returns `true` while a mounted editor holds the id
   */
  has(panelId: string): boolean {
    return entries.has(panelId)
  },

  /** Forget every entry. For tests and hard teardown. */
  reset(): void {
    entries.clear()
    holds.clear()
  }
}
