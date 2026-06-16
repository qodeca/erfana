// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pure Monaco clipboard command logic (copy / cut / paste).
 *
 * Extracted as framework-agnostic functions taking an injected `deps` object so
 * the decision logic is unit-testable without a real Monaco editor (mirrors
 * `terminalClipboard.logic.ts`). The editor-side adapter (MonacoMarkdownEditor)
 * supplies the concrete `deps` built from the live editor + the central
 * `textClipboard` service.
 *
 * Clipboard *semantics* (empty selection on copy/cut, empty clipboard on paste,
 * read-only guard) live here, per-surface by design. Transport errors are
 * owned by the `textClipboard` service (retry-once + debounced toast + log) —
 * these functions never toast or log.
 *
 * Cursor concerns stay in the adapter: the `executeEdits` implementation passed
 * in MUST supply Monaco's `endCursorState` for a deterministic post-edit cursor
 * position; these pure functions only describe the range + replacement text.
 *
 * @see Issue #203 - Central text-clipboard service
 * @see docs/design/issue-203-clipboard-service.md §5 (Monaco override strategy)
 */

import type * as monaco from 'monaco-editor'
import { textClipboard } from '../services/textClipboard'

/** Minimal Monaco range shape the command logic needs. */
export interface MonacoRangeLike {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

/** A 1-based Monaco caret position. */
export interface PasteEndPosition {
  lineNumber: number
  column: number
}

/**
 * Compute the deterministic caret position at the end of inserted `text`,
 * given the 1-based start position of the edit.
 *
 * Monaco positions are 1-based: column 1 is before the first character.
 * - Single-line insert: caret stays on `startLineNumber`, advanced by the
 *   text length.
 * - Multi-line insert: caret lands on the last inserted line; its column is
 *   `1 + (length of the text after the final newline)`. Text ending in `\n`
 *   therefore leaves the caret at column 1 of the new trailing line.
 *
 * @param startLineNumber - 1-based line where the edit begins
 * @param startColumn - 1-based column where the edit begins
 * @param text - inserted text
 * @returns the 1-based caret position after the inserted text
 */
export function computePasteEndPosition(
  startLineNumber: number,
  startColumn: number,
  text: string
): PasteEndPosition {
  const lastNewlineIndex = text.lastIndexOf('\n')
  if (lastNewlineIndex === -1) {
    // Single-line: advance the column by the inserted length.
    return { lineNumber: startLineNumber, column: startColumn + text.length }
  }

  const newlineCount = text.length - text.replaceAll('\n', '').length
  // Characters after the final newline form the trailing line's prefix. Strip
  // any '\r' first: Monaco models a CRLF as a single EOL, so a stray '\r' on the
  // trailing line must not inflate the caret column.
  const trailingLength = text.slice(lastNewlineIndex + 1).replace(/\r/g, '').length
  return {
    lineNumber: startLineNumber + newlineCount,
    // Column 1 is before the first char, so the caret is at 1 + prefix length.
    column: trailingLength + 1
  }
}

/**
 * Injected dependencies for the clipboard commands.
 *
 * Kept to the minimal, framework-agnostic shape needed so the logic is testable
 * with `vi.fn()` mocks and no real editor.
 */
export interface MonacoClipboardDeps {
  /** Current editor selection, or `null` when unavailable. */
  getSelection(): MonacoRangeLike | null
  /** Whether the given selection is empty (collapsed / no text). */
  isSelectionEmpty(selection: MonacoRangeLike): boolean
  /** Text contained in the given selection range. */
  getValueInRange(selection: MonacoRangeLike): string
  /** Replace `range` with `text` (adapter supplies `endCursorState`). */
  executeEdits(range: MonacoRangeLike, text: string): void
  /** Whether the editor is read-only (paste/cut must be no-ops). */
  isReadOnly(): boolean
  /** Central clipboard primitives (the `textClipboard` service). */
  clipboard: {
    readText(): Promise<string>
    writeText(text: string): Promise<boolean>
  }
}

/**
 * Copy the current selection to the clipboard.
 *
 * No-op when there is no selection or the selection is empty. Selection is
 * left in place (the model is not mutated).
 */
export async function clipboardCopy(deps: MonacoClipboardDeps): Promise<void> {
  const selection = deps.getSelection()
  if (!selection || deps.isSelectionEmpty(selection)) return

  await deps.clipboard.writeText(deps.getValueInRange(selection))
}

/**
 * Cut the current selection: copy to clipboard, then delete on success.
 *
 * No-op when there is no/empty selection or the editor is read-only. The
 * selection is deleted ONLY when the clipboard write succeeds (`writeText`
 * resolves `true`), so a failed copy never loses text.
 */
export async function clipboardCut(deps: MonacoClipboardDeps): Promise<void> {
  if (deps.isReadOnly()) return

  const selection = deps.getSelection()
  if (!selection || deps.isSelectionEmpty(selection)) return

  const copied = await deps.clipboard.writeText(deps.getValueInRange(selection))
  if (!copied) return

  deps.executeEdits(selection, '')
}

/**
 * Paste clipboard text at the current cursor / over the current selection.
 *
 * No-op when the editor is read-only, no selection is available, or the
 * clipboard is empty.
 */
export async function clipboardPaste(deps: MonacoClipboardDeps): Promise<void> {
  if (deps.isReadOnly()) return

  // Resolve the target selection BEFORE touching the clipboard: with no place to
  // insert, reading is a wasted IPC round-trip (the read result would be
  // discarded). Checking selection first keeps the read off the no-op path.
  const selection = deps.getSelection()
  if (!selection) return

  const text = await deps.clipboard.readText()
  if (!text) return

  deps.executeEdits(selection, text)
}

/**
 * Build the injected clipboard deps for the pure command logic from a live
 * Monaco editor + the Monaco namespace.
 *
 * Shared by BOTH the keybinding path (MonacoMarkdownEditor `addAction`) and the
 * context-menu path (`useEditorContextMenu`) so the two cannot diverge — the
 * write-guards-delete cut invariant and the deterministic post-edit caret both
 * live here. The `executeEdits` adapter supplies Monaco's `endCursorState`
 * (computed by {@link computePasteEndPosition}) so the caret lands
 * deterministically after the inserted text (design §5).
 *
 * @param editor - the live Monaco editor instance
 * @param monacoApi - the Monaco namespace (`Range`, `Selection`, `EditorOption`)
 * @param clipboard - the central clipboard primitives (defaults to the
 *   {@link textClipboard} singleton; injectable for tests)
 */
export function buildMonacoClipboardDeps(
  editor: monaco.editor.ICodeEditor,
  monacoApi: typeof monaco,
  clipboard: MonacoClipboardDeps['clipboard'] = textClipboard
): MonacoClipboardDeps {
  return {
    getSelection: () => editor.getSelection(),
    isSelectionEmpty: (selection) => monacoApi.Range.lift(selection).isEmpty(),
    getValueInRange: (selection) => editor.getModel()?.getValueInRange(selection) ?? '',
    // No read-only re-check here on purpose: the pure commands (`clipboardPaste`
    // / `clipboardCut`) own the read-only guard via `isReadOnly()` before any
    // mutating call reaches this adapter. Re-checking here would double-guard
    // for no added safety.
    executeEdits: (range, text) => {
      const end = computePasteEndPosition(range.startLineNumber, range.startColumn, text)
      editor.executeEdits(
        'erfana-clipboard',
        [{ range, text }],
        [new monacoApi.Selection(end.lineNumber, end.column, end.lineNumber, end.column)]
      )
    },
    isReadOnly: () => editor.getOption(monacoApi.editor.EditorOption.readOnly),
    clipboard
  }
}

/**
 * Register the Copy/Cut/Paste `addAction`s on a Monaco editor.
 *
 * Extracted from MonacoMarkdownEditor so the registration (ids, chords, and the
 * delegation to the pure commands) is unit-testable without mounting the editor
 * or importing `monaco-editor` as a value.
 *
 * `addAction` is used to own the Cmd/Ctrl+C/X/V chord and suppress Monaco's
 * built-in (browser-clipboard) actions — NOT for the context menu (the custom
 * EditorContextMenu replaces it via `contextmenu:false`), so no
 * `contextMenuGroupId`/`contextMenuOrder` are set.
 *
 * @param editor - the live Monaco editor (must support `addAction`)
 * @param monacoApi - the Monaco namespace (`KeyMod`, `KeyCode`)
 */
export function registerClipboardActions(
  editor: monaco.editor.IStandaloneCodeEditor,
  monacoApi: typeof monaco
): void {
  editor.addAction({
    id: 'erfana.clipboardCopy',
    label: 'Copy',
    keybindings: [monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyC],
    run: (ed) => clipboardCopy(buildMonacoClipboardDeps(ed, monacoApi))
  })

  editor.addAction({
    id: 'erfana.clipboardCut',
    label: 'Cut',
    keybindings: [monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyX],
    run: (ed) => clipboardCut(buildMonacoClipboardDeps(ed, monacoApi))
  })

  editor.addAction({
    id: 'erfana.clipboardPaste',
    label: 'Paste',
    keybindings: [monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyV],
    run: (ed) => clipboardPaste(buildMonacoClipboardDeps(ed, monacoApi))
  })
}
