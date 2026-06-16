// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for pure Monaco clipboard command logic.
 *
 * Covers the primary bug surface (design §5/§10): single-fire copy/cut/paste,
 * empty-selection no-op, read-only guard, cut-deletes-only-on-success, and
 * paste-on-empty-clipboard no-op. Deps are mocked with `vi.fn()`; the async
 * clipboard primitives use `mockResolvedValue`.
 *
 * @see docs/design/issue-203-clipboard-service.md §5, §10
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  clipboardCopy,
  clipboardCut,
  clipboardPaste,
  computePasteEndPosition,
  buildMonacoClipboardDeps,
  type MonacoClipboardDeps,
  type MonacoRangeLike
} from './monacoClipboardCommands'

const SELECTION: MonacoRangeLike = {
  startLineNumber: 1,
  startColumn: 1,
  endLineNumber: 1,
  endColumn: 6
}

interface MockDeps extends MonacoClipboardDeps {
  getSelection: ReturnType<typeof vi.fn>
  isSelectionEmpty: ReturnType<typeof vi.fn>
  getValueInRange: ReturnType<typeof vi.fn>
  executeEdits: ReturnType<typeof vi.fn>
  isReadOnly: ReturnType<typeof vi.fn>
  clipboard: {
    readText: ReturnType<typeof vi.fn>
    writeText: ReturnType<typeof vi.fn>
  }
}

function createDeps(overrides: Partial<MockDeps> = {}): MockDeps {
  return {
    getSelection: vi.fn(() => SELECTION),
    isSelectionEmpty: vi.fn(() => false),
    getValueInRange: vi.fn(() => 'hello'),
    executeEdits: vi.fn(),
    isReadOnly: vi.fn(() => false),
    clipboard: {
      readText: vi.fn().mockResolvedValue(''),
      writeText: vi.fn().mockResolvedValue(true)
    },
    ...overrides
  }
}

describe('monacoClipboardCommands', () => {
  let deps: MockDeps

  beforeEach(() => {
    vi.clearAllMocks()
    deps = createDeps()
  })

  describe('clipboardCopy', () => {
    it('writes the selection text once', async () => {
      await clipboardCopy(deps)

      expect(deps.getValueInRange).toHaveBeenCalledWith(SELECTION)
      expect(deps.clipboard.writeText).toHaveBeenCalledTimes(1)
      expect(deps.clipboard.writeText).toHaveBeenCalledWith('hello')
    })

    it('does not mutate the document', async () => {
      await clipboardCopy(deps)
      expect(deps.executeEdits).not.toHaveBeenCalled()
    })

    it('is a no-op when there is no selection', async () => {
      deps.getSelection.mockReturnValue(null)

      await clipboardCopy(deps)

      expect(deps.clipboard.writeText).not.toHaveBeenCalled()
    })

    it('is a no-op when the selection is empty', async () => {
      deps.isSelectionEmpty.mockReturnValue(true)

      await clipboardCopy(deps)

      expect(deps.clipboard.writeText).not.toHaveBeenCalled()
    })
  })

  describe('clipboardCut', () => {
    it('writes then deletes when write succeeds', async () => {
      deps.clipboard.writeText.mockResolvedValue(true)

      await clipboardCut(deps)

      expect(deps.clipboard.writeText).toHaveBeenCalledTimes(1)
      expect(deps.clipboard.writeText).toHaveBeenCalledWith('hello')
      expect(deps.executeEdits).toHaveBeenCalledTimes(1)
      expect(deps.executeEdits).toHaveBeenCalledWith(SELECTION, '')
    })

    it('does NOT delete when write fails', async () => {
      deps.clipboard.writeText.mockResolvedValue(false)

      await clipboardCut(deps)

      expect(deps.clipboard.writeText).toHaveBeenCalledTimes(1)
      expect(deps.executeEdits).not.toHaveBeenCalled()
    })

    it('is a no-op when the selection is empty', async () => {
      deps.isSelectionEmpty.mockReturnValue(true)

      await clipboardCut(deps)

      expect(deps.clipboard.writeText).not.toHaveBeenCalled()
      expect(deps.executeEdits).not.toHaveBeenCalled()
    })

    it('is a no-op when there is no selection', async () => {
      deps.getSelection.mockReturnValue(null)

      await clipboardCut(deps)

      expect(deps.clipboard.writeText).not.toHaveBeenCalled()
      expect(deps.executeEdits).not.toHaveBeenCalled()
    })

    it('is a no-op when the editor is read-only', async () => {
      deps.isReadOnly.mockReturnValue(true)

      await clipboardCut(deps)

      expect(deps.clipboard.writeText).not.toHaveBeenCalled()
      expect(deps.executeEdits).not.toHaveBeenCalled()
    })
  })

  describe('clipboardPaste', () => {
    it('inserts clipboard text once via executeEdits', async () => {
      deps.clipboard.readText.mockResolvedValue('pasted')

      await clipboardPaste(deps)

      expect(deps.clipboard.readText).toHaveBeenCalledTimes(1)
      expect(deps.executeEdits).toHaveBeenCalledTimes(1)
      expect(deps.executeEdits).toHaveBeenCalledWith(SELECTION, 'pasted')
    })

    it('is a no-op when the editor is read-only', async () => {
      deps.isReadOnly.mockReturnValue(true)

      await clipboardPaste(deps)

      expect(deps.clipboard.readText).not.toHaveBeenCalled()
      expect(deps.executeEdits).not.toHaveBeenCalled()
    })

    it('does not insert when the clipboard is empty', async () => {
      deps.clipboard.readText.mockResolvedValue('')

      await clipboardPaste(deps)

      expect(deps.clipboard.readText).toHaveBeenCalledTimes(1)
      expect(deps.executeEdits).not.toHaveBeenCalled()
    })

    it('is a no-op when there is no selection — and does not read the clipboard', async () => {
      deps.clipboard.readText.mockResolvedValue('pasted')
      deps.getSelection.mockReturnValue(null)

      await clipboardPaste(deps)

      // Read-order lock: with no insertion target, the clipboard is never read
      // (avoids a wasted IPC round-trip on the no-op path).
      expect(deps.clipboard.readText).not.toHaveBeenCalled()
      expect(deps.executeEdits).not.toHaveBeenCalled()
    })
  })

  describe('computePasteEndPosition', () => {
    it('advances the column for a single-line paste', () => {
      // Start at line 3, column 5; insert "abc" (3 chars) → column 8, same line.
      expect(computePasteEndPosition(3, 5, 'abc')).toEqual({ lineNumber: 3, column: 8 })
    })

    it('lands on the last line for a multi-line paste', () => {
      // "ab\ncde" inserts 1 newline; trailing line "cde" has 3 chars → col 4.
      expect(computePasteEndPosition(2, 1, 'ab\ncde')).toEqual({ lineNumber: 3, column: 4 })
    })

    it("places the caret at column 1 of the new line for text ending in '\\n'", () => {
      // "abc\n" → 1 newline, empty trailing line → line+1, column 1.
      expect(computePasteEndPosition(1, 1, 'abc\n')).toEqual({ lineNumber: 2, column: 1 })
    })

    it('handles text whose final line is empty after multiple newlines', () => {
      // "a\nb\n" → 2 newlines, empty trailing line → line+2, column 1.
      expect(computePasteEndPosition(5, 3, 'a\nb\n')).toEqual({ lineNumber: 7, column: 1 })
    })

    it('returns the start position unchanged for an empty string', () => {
      expect(computePasteEndPosition(4, 9, '')).toEqual({ lineNumber: 4, column: 9 })
    })

    it('handles CRLF line endings (the \\r stays on the preceding line)', () => {
      // 'a\r\nb': one '\n' → 1 line break. The trailing line after the final '\n'
      // is just 'b' (1 char) → column 2. The '\r' is counted before the newline,
      // so it does not affect the trailing-line column (Monaco models CRLF as a
      // single EOL, and xterm/the model own EOL normalization).
      expect(computePasteEndPosition(1, 1, 'a\r\nb')).toEqual({ lineNumber: 2, column: 2 })
    })
  })

  describe('buildMonacoClipboardDeps', () => {
    /** Minimal fakes for the monaco namespace pieces the adapter uses. */
    const fakeMonaco = {
      Range: {
        lift: (r: MonacoRangeLike) => ({
          isEmpty: () =>
            r.startLineNumber === r.endLineNumber && r.startColumn === r.endColumn
        })
      },
      Selection: class {
        constructor(
          public startLineNumber: number,
          public startColumn: number,
          public endLineNumber: number,
          public endColumn: number
        ) {}
      },
      editor: { EditorOption: { readOnly: 91 } }
    } as unknown as typeof import('monaco-editor')

    function makeEditor(opts: { readOnly?: boolean; value?: string } = {}) {
      const executeEdits = vi.fn()
      const editor = {
        getSelection: vi.fn(() => SELECTION),
        getModel: () => ({ getValueInRange: vi.fn(() => opts.value ?? 'hello') }),
        getOption: vi.fn(() => opts.readOnly ?? false),
        executeEdits
      }
      return { editor, executeEdits }
    }

    it('reports selection emptiness via Range.lift', () => {
      const { editor } = makeEditor()
      const deps = buildMonacoClipboardDeps(
        editor as never,
        fakeMonaco,
        { readText: vi.fn(), writeText: vi.fn() }
      )

      expect(deps.isSelectionEmpty(SELECTION)).toBe(false)
      expect(
        deps.isSelectionEmpty({
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: 1,
          endColumn: 1
        })
      ).toBe(true)
    })

    it('reads read-only from the editor option', () => {
      const { editor } = makeEditor({ readOnly: true })
      const deps = buildMonacoClipboardDeps(
        editor as never,
        fakeMonaco,
        { readText: vi.fn(), writeText: vi.fn() }
      )

      expect(deps.isReadOnly()).toBe(true)
    })

    it('executeEdits supplies a deterministic endCursorState from computePasteEndPosition', () => {
      const { editor, executeEdits } = makeEditor()
      const deps = buildMonacoClipboardDeps(
        editor as never,
        fakeMonaco,
        { readText: vi.fn(), writeText: vi.fn() }
      )

      const range: MonacoRangeLike = {
        startLineNumber: 2,
        startColumn: 1,
        endLineNumber: 2,
        endColumn: 1
      }
      deps.executeEdits(range, 'ab\ncde')

      expect(executeEdits).toHaveBeenCalledTimes(1)
      const [source, edits, cursorStates] = executeEdits.mock.calls[0]
      expect(source).toBe('erfana-clipboard')
      expect(edits).toEqual([{ range, text: 'ab\ncde' }])
      // computePasteEndPosition(2, 1, 'ab\ncde') → line 3, column 4.
      expect(cursorStates[0]).toMatchObject({
        startLineNumber: 3,
        startColumn: 4,
        endLineNumber: 3,
        endColumn: 4
      })
    })

    it('defaults the clipboard to the textClipboard singleton when omitted', () => {
      const { editor } = makeEditor()
      const deps = buildMonacoClipboardDeps(editor as never, fakeMonaco)

      expect(typeof deps.clipboard.readText).toBe('function')
      expect(typeof deps.clipboard.writeText).toBe('function')
    })
  })
})
