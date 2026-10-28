// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the uncontrolled-editor value sync: the minimal-edit diff and the
 * echo / in-sync / outside-change decision, against a plain fake model.
 *
 * @see monacoValueSync.ts
 */

import { describe, it, expect, vi } from 'vitest'
import type * as monaco from 'monaco-editor'
import {
  computeMinimalEdit,
  createEditorValueSync,
  MAX_PENDING_EMITS,
  MIN_PENDING_CHARS,
  PENDING_CHARS_PER_DOCUMENT,
  type ValueSyncEditor,
  type ValueSyncModel
} from './monacoValueSync'

/** Offset → 1-based position, the way Monaco's model computes it for `\n` text. */
function positionAt(text: string, offset: number): { lineNumber: number; column: number } {
  const before = text.slice(0, offset)
  const lines = before.split('\n')
  return { lineNumber: lines.length, column: lines[lines.length - 1].length + 1 }
}

function offsetAt(text: string, lineNumber: number, column: number): number {
  const lines = text.split('\n')
  let offset = 0
  for (let i = 0; i < lineNumber - 1; i++) offset += lines[i].length + 1
  return offset + column - 1
}

const SELECTIONS = [{ selectionStartLineNumber: 1 }] as unknown as monaco.Selection[]

function fakeEditor(initial: string) {
  let text = initial
  const model = {
    getValue: vi.fn(() => text),
    setValue: vi.fn((next: string) => {
      text = next
    }),
    getPositionAt: vi.fn((offset: number) => positionAt(text, offset)),
    pushStackElement: vi.fn(),
    pushEditOperations: vi.fn(
      (_before: unknown, ops: { range: monaco.IRange; text: string | null }[]) => {
        for (const op of ops) {
          const start = offsetAt(text, op.range.startLineNumber, op.range.startColumn)
          const end = offsetAt(text, op.range.endLineNumber, op.range.endColumn)
          text = text.slice(0, start) + (op.text ?? '') + text.slice(end)
        }
        return null
      }
    )
  }
  const editor: ValueSyncEditor = {
    getModel: () => model as unknown as ValueSyncModel,
    getSelections: () => SELECTIONS
  }
  return { editor, model, text: () => text, type: (next: string) => (text = next) }
}

describe('computeMinimalEdit', () => {
  it('returns null for equal text', () => {
    expect(computeMinimalEdit('same', 'same')).toBeNull()
  })

  it('trims the common prefix and suffix of a replacement', () => {
    expect(computeMinimalEdit('abcdef', 'abXYef')).toEqual({ start: 2, end: 4, text: 'XY' })
  })

  it('describes a pure insertion as an empty span', () => {
    expect(computeMinimalEdit('ac', 'abc')).toEqual({ start: 1, end: 1, text: 'b' })
  })

  it('describes a pure deletion as empty text', () => {
    expect(computeMinimalEdit('abc', 'ac')).toEqual({ start: 1, end: 2, text: '' })
  })

  it('handles a repeated character without the prefix and suffix overlapping', () => {
    const edit = computeMinimalEdit('aa', 'aaa')!
    expect(edit.start).toBeLessThanOrEqual(edit.end)
    expect('aa'.slice(0, edit.start) + edit.text + 'aa'.slice(edit.end)).toBe('aaa')
  })

  it('handles empty documents on either side', () => {
    expect(computeMinimalEdit('', 'new')).toEqual({ start: 0, end: 0, text: 'new' })
    expect(computeMinimalEdit('old', '')).toEqual({ start: 0, end: 3, text: '' })
  })

  it('never cuts a \\r\\n pair', () => {
    // A naive diff would start between \r and \n
    const edit = computeMinimalEdit('a\r\nb', 'a\rXb')!
    expect(edit.start).toBe(1)
    const end = computeMinimalEdit('a\r\nb', 'aY\r\nb')!
    expect('a\r\nb'.slice(0, end.start) + end.text + 'a\r\nb'.slice(end.end)).toBe('aY\r\nb')
    // A span that would end between \r and \n is widened over both
    const tail = computeMinimalEdit('a\r\nb', 'a\r\r\nb')!
    expect(tail).toEqual({ start: 1, end: 3, text: '\r\r\n' })
  })

  it('never cuts a surrogate pair', () => {
    // Two emoji sharing a high surrogate: a naive diff would start mid-pair
    const current = 'a\u{1F600}b'
    const next = 'a\u{1F601}b'
    const edit = computeMinimalEdit(current, next)!
    expect(edit.start).toBe(1)
    expect(edit.end).toBe(3)
    expect(edit.text).toBe('\u{1F601}')
  })
})

describe('createEditorValueSync', () => {
  it('treats a value the editor emitted as an echo, even when the buffer is ahead', () => {
    // The data-loss race: keys "a" and "b" both reach Monaco before React
    // renders "a". The stale "a" must not be written back over "ab".
    const fake = fakeEditor('')
    const sync = createEditorValueSync()
    fake.type('a')
    sync.recordEmit('a')
    fake.type('ab')
    sync.recordEmit('ab')

    expect(sync.reconcile(fake.editor, 'a')).toBe('echo')
    expect(fake.text()).toBe('ab')
    expect(sync.reconcile(fake.editor, 'ab')).toBe('echo')
    expect(fake.text()).toBe('ab')
    expect(fake.model.pushEditOperations).not.toHaveBeenCalled()
    expect(fake.model.setValue).not.toHaveBeenCalled()
  })

  it('prunes to the first copy of a repeated emit, so the emits after it stay echoes', () => {
    const fake = fakeEditor('x')
    const sync = createEditorValueSync()
    for (const v of ['xa', 'x', 'xb']) {
      fake.type(v)
      sync.recordEmit(v)
    }
    // React renders the first "xa", then "x", then "xb": all three are echoes
    expect(sync.reconcile(fake.editor, 'xa')).toBe('echo')
    expect(sync.reconcile(fake.editor, 'x')).toBe('echo')
    expect(sync.reconcile(fake.editor, 'xb')).toBe('echo')
    expect(fake.text()).toBe('xb')
  })

  it('does nothing for a value the buffer already holds', () => {
    const fake = fakeEditor('same')
    const sync = createEditorValueSync()
    expect(sync.reconcile(fake.editor, 'same')).toBe('in-sync')
    expect(fake.model.pushEditOperations).not.toHaveBeenCalled()
  })

  it('applies an outside change as one minimal, undoable edit that keeps the selections', () => {
    const fake = fakeEditor('line 1\nline 2\nline 3\n')
    const sync = createEditorValueSync()

    expect(sync.reconcile(fake.editor, 'line 1\nline 2\nline 3\nfrom disk\n')).toBe('applied')
    expect(fake.text()).toBe('line 1\nline 2\nline 3\nfrom disk\n')

    // Only the appended tail is touched, so a cursor on line 1 is untouched
    const [before, ops] = fake.model.pushEditOperations.mock.calls[0]
    expect(before).toBe(SELECTIONS)
    expect(ops).toEqual([
      {
        range: { startLineNumber: 4, startColumn: 1, endLineNumber: 4, endColumn: 1 },
        text: 'from disk\n'
      }
    ])
    // Its own undo step: a stack element on both sides
    expect(fake.model.pushStackElement).toHaveBeenCalledTimes(2)
    expect(fake.model.setValue).not.toHaveBeenCalled()
  })

  it('reports applying only while the outside change is written', () => {
    const fake = fakeEditor('old')
    const sync = createEditorValueSync()
    const seen: boolean[] = []
    fake.model.pushEditOperations.mockImplementationOnce(() => {
      seen.push(sync.isApplying())
      return null
    })
    sync.reconcile(fake.editor, 'new')
    expect(seen).toEqual([true])
    expect(sync.isApplying()).toBe(false)
  })

  it('clears the applying flag even when the model throws', () => {
    const fake = fakeEditor('old')
    const sync = createEditorValueSync()
    fake.model.pushEditOperations.mockImplementationOnce(() => {
      throw new Error('disposed')
    })
    expect(() => sync.reconcile(fake.editor, 'new')).toThrow('disposed')
    expect(sync.isApplying()).toBe(false)
  })

  it('forgets older emits after an outside change, so a later re-render of one is applied', () => {
    // Key "k" typed, then a reload lands before React rendered the key
    const fake = fakeEditor('base')
    const sync = createEditorValueSync()
    fake.type('basek')
    sync.recordEmit('basek')
    expect(sync.reconcile(fake.editor, 'disk')).toBe('applied')
    expect(fake.text()).toBe('disk')
    // If React then settles on "basek", the editor follows React
    expect(sync.reconcile(fake.editor, 'basek')).toBe('applied')
    expect(fake.text()).toBe('basek')
  })

  it('reports a missing model and leaves the queue alone', () => {
    const sync = createEditorValueSync()
    sync.recordEmit('typed')
    const noModel: ValueSyncEditor = { getModel: () => null, getSelections: () => null }
    expect(sync.reconcile(noModel, 'other')).toBe('no-model')
    expect(sync.reconcile(noModel, 'typed')).toBe('echo')
  })

  it('caps the remembered emits', () => {
    const fake = fakeEditor('')
    const sync = createEditorValueSync()
    for (let i = 0; i <= MAX_PENDING_EMITS; i++) sync.recordEmit(`v${i}`)
    fake.type(`v${MAX_PENDING_EMITS}`)
    // The oldest fell off: it now reads as an outside change
    expect(sync.reconcile(fake.editor, 'v0')).toBe('applied')
  })

  it('confirm forgets emits that cancelled out, so a later disk text equal to one is applied', () => {
    // Type "x" then Backspace before React renders: `value` never changes,
    // reconcile never runs, and "basex" would stay remembered
    const fake = fakeEditor('base')
    const sync = createEditorValueSync()
    fake.type('basex')
    sync.recordEmit('basex')
    fake.type('base')
    sync.recordEmit('base')

    // The next commit shows exactly the buffer
    sync.confirm(fake.editor, 'base')

    // Another tool writes "basex" to disk: it must reach the buffer, not be
    // taken for an echo (the next save would write "base" over it)
    expect(sync.reconcile(fake.editor, 'basex')).toBe('applied')
    expect(fake.text()).toBe('basex')
  })

  it('confirm keeps the emits while the buffer is ahead of the rendered value', () => {
    const fake = fakeEditor('')
    const sync = createEditorValueSync()
    fake.type('a')
    sync.recordEmit('a')
    fake.type('ab')
    sync.recordEmit('ab')
    sync.confirm(fake.editor, 'a')
    expect(sync.reconcile(fake.editor, 'ab')).toBe('echo')
    expect(fake.model.pushEditOperations).not.toHaveBeenCalled()
  })

  it('caps the remembered emits by characters, dropping the oldest first', () => {
    const fake = fakeEditor('')
    const sync = createEditorValueSync()
    const docLength = MIN_PENDING_CHARS // budget = PENDING_CHARS_PER_DOCUMENT x this
    const copies = PENDING_CHARS_PER_DOCUMENT + 2
    const emits = Array.from({ length: copies }, (_, i) => String(i % 10).repeat(docLength))
    for (const e of emits) sync.recordEmit(e)
    fake.type(emits[copies - 1])

    // The two oldest no longer fit the budget: they read as outside changes
    expect(sync.reconcile(fake.editor, emits[0])).toBe('applied')
    fake.type(emits[copies - 1])
    const fresh = createEditorValueSync()
    for (const e of emits) fresh.recordEmit(e)
    expect(fresh.reconcile(fake.editor, emits[2])).toBe('echo')
    expect(fresh.reconcile(fake.editor, emits[copies - 1])).toBe('echo')
  })

  it('resetTo replaces the buffer without an undo entry and forgets emits', () => {
    const fake = fakeEditor('created from an older value')
    const sync = createEditorValueSync()
    sync.recordEmit('stale')
    sync.resetTo(fake.editor, 'latest')
    expect(fake.model.setValue).toHaveBeenCalledWith('latest')
    expect(fake.model.pushEditOperations).not.toHaveBeenCalled()
    expect(sync.reconcile(fake.editor, 'stale')).toBe('applied')
  })

  it('resetTo skips an editor that already holds the value', () => {
    const fake = fakeEditor('latest')
    const sync = createEditorValueSync()
    sync.resetTo(fake.editor, 'latest')
    sync.resetTo({ getModel: () => null, getSelections: () => null }, 'x')
    expect(fake.model.setValue).not.toHaveBeenCalled()
  })
})
