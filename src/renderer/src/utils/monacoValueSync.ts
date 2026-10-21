// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Monaco value sync – keeps an uncontrolled Monaco editor in step with the
 * document text React holds, without ever undoing the user's typing.
 *
 * Why this exists: `@monaco-editor/react` in controlled mode (`value=`)
 * compares the prop with `editor.getValue()` in a passive effect and, if they
 * differ, replaces the whole buffer. A keystroke that lands between React's
 * commit and that effect makes the prop one key behind the buffer, so the
 * "sync" restores the older text: the key is lost and the cursor jumps to the
 * end. Under main-thread load this dropped about half of a typed burst.
 *
 * The editor is therefore mounted uncontrolled (`defaultValue`) and this
 * module decides, for each new `value` prop, whether it is:
 * - **our own echo** – a value the editor emitted through `onChange` that
 *   React has now rendered. It may be behind the buffer (more keys arrived
 *   since); it is never written back.
 * - **already in the buffer** – nothing to do.
 * - **an outside change** – a reload from disk, an accepted external change,
 *   a conflict "Reload". Applied as one minimal edit with
 *   `model.pushEditOperations`, so the undo stack survives (the change is its
 *   own undo step) and cursors outside the changed span stay where they are.
 *
 * The module holds no React state and no `monaco-editor` value import, so it
 * is unit-testable with a plain fake model.
 *
 * @see ../components/Editor/MonacoMarkdownEditor.tsx
 */

import type * as monaco from 'monaco-editor'

/**
 * Upper bound on remembered emits. Every emit is normally confirmed by the
 * next React commit, so the queue holds one or two entries; the cap only
 * stops a pathological case (emits with no commit at all) from growing
 * without bound. Each entry is the full document text.
 */
export const MAX_PENDING_EMITS = 64

/**
 * One contiguous replacement that turns `current` into `next`.
 * Offsets are UTF-16 indexes into `current`.
 */
export interface MinimalEdit {
  /** First changed offset in `current` (inclusive) */
  start: number
  /** End of the changed span in `current` (exclusive) */
  end: number
  /** Replacement text for `current.slice(start, end)` */
  text: string
}

const CR = 13
const LF = 10

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}

/**
 * Smallest single replacement (common prefix and suffix trimmed) that turns
 * `current` into `next`.
 *
 * The boundaries never split a surrogate pair or a `\r\n` pair: Monaco
 * positions cannot address the middle of either, so an edit cut there would
 * land one character off.
 *
 * @param current - Text the editor holds now
 * @param next - Text it should hold
 * @returns The edit, or `null` when the strings are equal
 *
 * @example
 * ```ts
 * computeMinimalEdit('abc', 'aXc') // { start: 1, end: 2, text: 'X' }
 * computeMinimalEdit('abc', 'abc') // null
 * ```
 */
export function computeMinimalEdit(current: string, next: string): MinimalEdit | null {
  if (current === next) return null

  const limit = Math.min(current.length, next.length)
  let start = 0
  while (start < limit && current.charCodeAt(start) === next.charCodeAt(start)) start++

  let endCurrent = current.length
  let endNext = next.length
  while (
    endCurrent > start &&
    endNext > start &&
    current.charCodeAt(endCurrent - 1) === next.charCodeAt(endNext - 1)
  ) {
    endCurrent--
    endNext--
  }

  // Widen outwards off a split pair. The prefix and suffix are common to both
  // strings, so moving a boundary into them keeps the two in step.
  while (
    start > 0 &&
    (isHighSurrogate(current.charCodeAt(start - 1)) || current.charCodeAt(start - 1) === CR)
  ) {
    start--
  }
  while (
    endCurrent < current.length &&
    (isLowSurrogate(current.charCodeAt(endCurrent)) ||
      (current.charCodeAt(endCurrent) === LF && current.charCodeAt(endCurrent - 1) === CR))
  ) {
    endCurrent++
    endNext++
  }

  return { start, end: endCurrent, text: next.slice(start, endNext) }
}

/** The slice of a Monaco text model the sync needs. */
export type ValueSyncModel = Pick<
  monaco.editor.ITextModel,
  'getValue' | 'setValue' | 'getPositionAt' | 'pushStackElement' | 'pushEditOperations'
>

/** The slice of a Monaco editor the sync needs. */
export interface ValueSyncEditor {
  getModel(): ValueSyncModel | null
  getSelections(): monaco.Selection[] | null
}

/** What {@link EditorValueSync.reconcile} did with a new `value`. */
export type ReconcileResult =
  /** The value was emitted by the editor itself; the buffer is left alone */
  | 'echo'
  /** The buffer already holds the value */
  | 'in-sync'
  /** The value came from outside and was applied as an edit */
  | 'applied'
  /** The editor has no model (disposed or not yet attached) */
  | 'no-model'

/**
 * Per-editor sync state. Create one per mounted Monaco editor.
 */
export interface EditorValueSync {
  /**
   * Record a value the editor is about to emit through `onChange`.
   * Call it for every user-originated content change, before notifying React.
   */
  recordEmit(value: string): void
  /**
   * True while {@link reconcile} or {@link resetTo} is writing to the model.
   * The content-change listener must not emit then: React already holds the
   * value, and an emit would mark a freshly reloaded file as modified.
   */
  isApplying(): boolean
  /**
   * Bring the editor in line with a new `value` prop, unless that value is
   * the editor's own (possibly older) echo.
   *
   * Call it synchronously in the commit (`useLayoutEffect`), and only when the
   * prop changed: a commit that re-renders an unchanged, older value while a
   * newer emit is still on its way to React is not an outside change.
   */
  reconcile(editor: ValueSyncEditor, value: string): ReconcileResult
  /**
   * Replace the buffer with `value` (no undo entry) and forget every emit.
   * For a freshly mounted editor whose model was created from an older value.
   */
  resetTo(editor: ValueSyncEditor, value: string): void
}

/**
 * Create the sync state for one Monaco editor.
 *
 * @returns A fresh {@link EditorValueSync}
 *
 * @example
 * ```ts
 * const sync = createEditorValueSync()
 * editor.onDidChangeModelContent(() => {
 *   if (sync.isApplying()) return
 *   const text = editor.getValue()
 *   sync.recordEmit(text)
 *   onChange(text)
 * })
 * // in useLayoutEffect(() => …, [value]):
 * sync.reconcile(editor, value)
 * ```
 */
export function createEditorValueSync(): EditorValueSync {
  // Emitted values React has not rendered yet, oldest first.
  const pending: string[] = []
  let applying = false

  const write = (fn: () => void): void => {
    applying = true
    try {
      fn()
    } finally {
      applying = false
    }
  }

  return {
    recordEmit(value) {
      pending.push(value)
      if (pending.length > MAX_PENDING_EMITS) pending.shift()
    },

    isApplying: () => applying,

    reconcile(editor, value) {
      // First match, not last: the same text can be emitted twice (type, then
      // delete). Pruning to a later copy would drop the emits in between, and
      // when React rendered one of those it would look like an outside change.
      const echoAt = pending.indexOf(value)
      if (echoAt !== -1) {
        pending.splice(0, echoAt + 1)
        return 'echo'
      }

      const model = editor.getModel()
      if (!model) return 'no-model'

      const current = model.getValue()
      const edit = computeMinimalEdit(current, value)
      pending.length = 0
      if (!edit) return 'in-sync'

      const start = model.getPositionAt(edit.start)
      const end = model.getPositionAt(edit.end)
      write(() => {
        // Stack elements on both sides make the outside change one undo step
        // of its own, never merged into the user's typing before or after it.
        model.pushStackElement()
        model.pushEditOperations(
          editor.getSelections(),
          [
            {
              range: {
                startLineNumber: start.lineNumber,
                startColumn: start.column,
                endLineNumber: end.lineNumber,
                endColumn: end.column
              },
              text: edit.text
            }
          ],
          // null: leave the cursors where the model's own tracking puts them
          () => null
        )
        model.pushStackElement()
      })
      return 'applied'
    },

    resetTo(editor, value) {
      pending.length = 0
      const model = editor.getModel()
      if (!model || model.getValue() === value) return
      write(() => model.setValue(value))
    }
  }
}
