// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests that {@link MonacoMarkdownEditor} is uncontrolled: it mounts from
 * `defaultValue`, never hands the wrapper a `value`, never writes its own
 * (possibly stale) echo back into the buffer, and applies genuine outside
 * changes as one undoable model edit without emitting `onChange`.
 *
 * The real `monaco-editor` value import does not resolve in the renderer test
 * env, so `@monaco-editor/react` is replaced by a component that builds a
 * small fake editor over a string buffer and mounts it when the test says so
 * (the real wrapper mounts asynchronously, after Monaco loads).
 *
 * @see MonacoMarkdownEditor.tsx
 * @see ../../utils/monacoValueSync.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { createRef, useEffect, useRef } from 'react'

interface FakeRange {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

/** A fake Monaco editor + model over one string. Edits fire content listeners. */
function createFakeEditor(initial: string) {
  let text = initial
  let readOnly = false
  let disposed = false
  let selection: FakeRange = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }
  const contentListeners: Array<() => void> = []
  const selectionListeners: Array<(e: { selection: FakeRange }) => void> = []
  // Text before each undoable change, newest last
  const undoStack: string[] = []

  const offsetAt = (line: number, column: number): number => {
    const lines = text.split('\n')
    let offset = 0
    for (let i = 0; i < line - 1; i++) offset += lines[i].length + 1
    return offset + column - 1
  }
  const fire = (): void => contentListeners.forEach((l) => l())
  const applyOps = (ops: Array<{ range: FakeRange; text: string | null }>): void => {
    undoStack.push(text)
    for (const op of ops) {
      const start = offsetAt(op.range.startLineNumber, op.range.startColumn)
      const end = offsetAt(op.range.endLineNumber, op.range.endColumn)
      text = text.slice(0, start) + (op.text ?? '') + text.slice(end)
    }
    fire()
  }

  const model = {
    getValue: () => text,
    setValue: vi.fn((next: string) => {
      text = next
      undoStack.length = 0
      fire()
    }),
    getPositionAt: (offset: number) => {
      const lines = text.slice(0, offset).split('\n')
      return { lineNumber: lines.length, column: lines[lines.length - 1].length + 1 }
    },
    getFullModelRange: (): FakeRange => {
      const lines = text.split('\n')
      return {
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: lines.length,
        endColumn: lines[lines.length - 1].length + 1
      }
    },
    getValueInRange: (r: FakeRange) =>
      text.slice(offsetAt(r.startLineNumber, r.startColumn), offsetAt(r.endLineNumber, r.endColumn)),
    pushStackElement: vi.fn(),
    pushEditOperations: vi.fn((_before: unknown, ops: Array<{ range: FakeRange; text: string | null }>) => {
      applyOps(ops)
      return null
    }),
    /** Monaco's model undo: restores the previous text and fires a change */
    undo: () => {
      const previous = undoStack.pop()
      if (previous === undefined) return
      text = previous
      fire()
    }
  }

  const editor = {
    model,
    /** Simulate the user typing: replace the buffer and fire a change */
    userTypes: (next: string) => {
      undoStack.push(text)
      text = next
      fire()
    },
    isDisposed: () => disposed,
    isReadOnly: () => readOnly,
    getModel: () => (disposed ? null : model),
    getValue: () => (disposed ? '' : text),
    getSelection: () => ({ ...selection, isEmpty: () => false }),
    getSelections: () => [selection],
    setSelection: vi.fn((r: FakeRange) => {
      selection = r
    }),
    setValue: vi.fn(),
    executeEdits: vi.fn((_source: string, ops: Array<{ range: FakeRange; text: string }>) => {
      // Monaco refuses editor-level edits in a read-only editor
      if (readOnly) return false
      applyOps(ops)
      return true
    }),
    onDidChangeModelContent: (listener: () => void) => {
      contentListeners.push(listener)
      return { dispose: () => contentListeners.splice(contentListeners.indexOf(listener), 1) }
    },
    onDidChangeCursorSelection: (listener: (e: { selection: FakeRange }) => void) => {
      selectionListeners.push(listener)
      return { dispose: () => {} }
    },
    /** Simulate the user selecting a range */
    userSelects: (r: FakeRange) => {
      selection = r
      selectionListeners.forEach((l) => l({ selection: r }))
    },
    onContextMenu: () => ({ dispose: () => {} }),
    addCommand: () => null,
    updateOptions: (opts: { readOnly?: boolean }) => {
      if (opts.readOnly !== undefined) readOnly = opts.readOnly
    },
    setSelectionTo: (r: FakeRange) => {
      selection = r
    },
    dispose: () => {
      disposed = true
    }
  }
  return editor
}

type FakeEditor = ReturnType<typeof createFakeEditor>

interface MockEditorProps {
  defaultValue?: string
  value?: string
  onChange?: unknown
  onMount?: (editor: FakeEditor, monaco: unknown) => void
}

const harness = vi.hoisted(() => ({
  /** Props of every render of the mocked wrapper */
  renders: [] as Array<Record<string, unknown>>,
  /** Mount callbacks of wrapper instances not yet mounted, oldest first */
  pendingMounts: [] as Array<() => void>,
  editors: [] as unknown[]
}))

vi.mock('@monaco-editor/react', () => ({
  default: function MockEditor(props: MockEditorProps) {
    // The real wrapper keeps only the first onMount. It creates the model when
    // Monaco finishes loading, which can be several renders after the text
    // first arrived; using the first render's text makes that gap visible.
    const onMountRef = useRef(props.onMount)
    const onChangeRef = useRef(props.onChange)
    onChangeRef.current = props.onChange
    const initialText = useRef(props.defaultValue ?? props.value ?? '')
    const editorRef = useRef<FakeEditor | null>(null)
    const silent = useRef(false)
    harness.renders.push(props as Record<string, unknown>)
    useEffect(() => {
      let created = false
      const mount = (): void => {
        if (created) return
        created = true
        const editor = createFakeEditor(initialText.current)
        editorRef.current = editor
        harness.editors.push(editor)
        // Controlled mode's onChange subscription, as the wrapper wires it
        editor.onDidChangeModelContent(() => {
          if (!silent.current && typeof onChangeRef.current === 'function') {
            ;(onChangeRef.current as (v: string) => void)(editor.getValue())
          }
        })
        onMountRef.current?.(editor, {
          KeyMod: { CtrlCmd: 2048, Shift: 1024 },
          KeyCode: { KeyB: 32, KeyI: 39, KeyK: 41, KeyF: 36, KeyG: 37 }
        })
      }
      harness.pendingMounts.push(mount)
      return () => {
        created = true
        editorRef.current?.dispose()
      }
    }, [])
    // Controlled mode's sync, as @monaco-editor/react 4.7 does it: in a
    // passive effect, replace the whole buffer when `value` differs. Present
    // so that these tests fail against a controlled editor, not just pass
    // against an uncontrolled one.
    useEffect(() => {
      const editor = editorRef.current
      if (!editor || props.value === undefined) return
      if (editor.isReadOnly()) {
        // The wrapper's read-only branch: setValue, and onChange is not muted
        editor.model.setValue(props.value)
      } else if (props.value !== editor.getValue()) {
        silent.current = true
        editor.executeEdits('', [{ range: editor.model.getFullModelRange(), text: props.value }])
        silent.current = false
      }
    }, [props.value])
    return <div data-testid="mock-monaco" />
  },
  loader: { config: vi.fn() }
}))

vi.mock('../../utils/monacoLanguageServices', () => ({
  disableWorkerLanguageServices: vi.fn()
}))

vi.mock('../../utils/monacoClipboardCommands', () => ({
  registerClipboardActions: vi.fn()
}))

vi.mock('monaco-editor', () => ({}))

import { MonacoMarkdownEditor, type MonacoEditorHandle } from './MonacoMarkdownEditor'

/** Mount every wrapper instance waiting for Monaco, as the real loader would. */
function mountPending(): void {
  act(() => {
    while (harness.pendingMounts.length) harness.pendingMounts.shift()!()
  })
}

function lastEditor(): FakeEditor {
  return harness.editors[harness.editors.length - 1] as FakeEditor
}

const PATH = '/proj/notes.md'

function setup(initial: string, filePath: string = PATH) {
  const onChange = vi.fn()
  const ref = createRef<MonacoEditorHandle>()
  const utils = render(
    <MonacoMarkdownEditor ref={ref} value={initial} onChange={onChange} filePath={filePath} />
  )
  const rerender = (value: string, path: string = filePath): void =>
    utils.rerender(<MonacoMarkdownEditor ref={ref} value={value} onChange={onChange} filePath={path} />)
  return { onChange, ref, rerender }
}

beforeEach(() => {
  harness.renders.length = 0
  harness.pendingMounts.length = 0
  harness.editors.length = 0
})

afterEach(() => cleanup())

describe('MonacoMarkdownEditor – uncontrolled buffer', () => {
  it('mounts from defaultValue and never passes a controlled value', () => {
    const { rerender } = setup('# Notes\n')
    mountPending()
    rerender('# Notes\nmore\n')

    expect(harness.renders.length).toBeGreaterThan(1)
    for (const props of harness.renders) {
      expect(props).not.toHaveProperty('value')
      expect(props).not.toHaveProperty('onChange')
    }
    expect(harness.renders[0].defaultValue).toBe('# Notes\n')
    expect(lastEditor().getValue()).toBe('# Notes\nmore\n')
  })

  it('keeps keys typed before React rendered the previous one (the data-loss race)', () => {
    const { onChange, rerender } = setup('')
    mountPending()
    const editor = lastEditor()

    // Two keys reach Monaco before React commits the first
    editor.userTypes('a')
    editor.userTypes('ab')
    expect(onChange.mock.calls.map((c) => c[0])).toEqual(['a', 'ab'])

    // React now commits "a": the controlled wrapper wrote it back here and
    // the "b" vanished. It must be left alone.
    rerender('a')
    expect(editor.getValue()).toBe('ab')
    rerender('ab')
    expect(editor.getValue()).toBe('ab')
    expect(editor.model.pushEditOperations).not.toHaveBeenCalled()
    expect(editor.model.setValue).not.toHaveBeenCalled()
    expect(editor.executeEdits).not.toHaveBeenCalled()
  })

  it('keeps a key typed between a commit and the next one', () => {
    const { rerender } = setup('base')
    mountPending()
    const editor = lastEditor()

    editor.userTypes('base1')
    rerender('base1')
    // Key 2 lands after commit 1; commit 2 carries it, commit 1 is not replayed
    editor.userTypes('base12')
    rerender('base12')
    expect(editor.getValue()).toBe('base12')
    expect(editor.model.pushEditOperations).not.toHaveBeenCalled()
  })

  it('applies a reload from disk as one undoable edit, without onChange, keeping the selection', () => {
    const { onChange, rerender } = setup('alpha\nbeta\n')
    mountPending()
    const editor = lastEditor()
    const selection = { startLineNumber: 1, startColumn: 2, endLineNumber: 1, endColumn: 2 }
    editor.setSelectionTo(selection)

    rerender('alpha\nbeta\nfrom disk\n')

    expect(editor.getValue()).toBe('alpha\nbeta\nfrom disk\n')
    expect(onChange).not.toHaveBeenCalled()
    expect(editor.model.setValue).not.toHaveBeenCalled()
    const [before, ops] = editor.model.pushEditOperations.mock.calls[0]
    expect(before).toEqual([selection])
    // Only the new tail is touched, so the cursor on line 1 is not moved
    expect(ops[0].range).toEqual({ startLineNumber: 3, startColumn: 1, endLineNumber: 3, endColumn: 1 })
    expect(editor.setSelection).not.toHaveBeenCalled()
    expect(editor.model.pushStackElement).toHaveBeenCalledTimes(2)

    // Undo brings the pre-reload text back, as a user edit
    act(() => editor.model.undo())
    expect(editor.getValue()).toBe('alpha\nbeta\n')
    expect(onChange).toHaveBeenLastCalledWith('alpha\nbeta\n')
  })

  it('applies an outside change while the editor is read-only (autosave hold)', () => {
    const { onChange, rerender } = setup('held')
    mountPending()
    const editor = lastEditor()
    editor.updateOptions({ readOnly: true })

    rerender('reloaded while held')

    expect(editor.getValue()).toBe('reloaded while held')
    expect(onChange).not.toHaveBeenCalled()
    expect(editor.executeEdits).not.toHaveBeenCalled()
  })

  it('treats a toolbar format action as a user edit, and its echo as no change', () => {
    const { onChange, ref, rerender } = setup('word')
    mountPending()
    const editor = lastEditor()
    editor.setSelectionTo({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 5 })

    act(() => ref.current!.formatBold())

    expect(editor.getValue()).toBe('**word**')
    expect(onChange).toHaveBeenLastCalledWith('**word**')
    rerender('**word**')
    expect(editor.model.pushEditOperations).not.toHaveBeenCalled()
  })

  it('treats undo and redo as user edits whose echoes change nothing', () => {
    const { onChange, rerender } = setup('one')
    mountPending()
    const editor = lastEditor()

    editor.userTypes('one two')
    act(() => editor.model.undo())
    expect(onChange.mock.calls.map((c) => c[0])).toEqual(['one two', 'one'])

    rerender('one two')
    rerender('one')
    expect(editor.getValue()).toBe('one')
    expect(editor.model.pushEditOperations).not.toHaveBeenCalled()
  })

  it('catches up on text that changed while Monaco was loading, without onChange', () => {
    const { onChange, rerender } = setup('loading…')
    rerender('loaded from disk')
    // The model is created from the first defaultValue (see the mock), then
    // brought up to date at mount with no undo entry.
    mountPending()
    const editor = lastEditor()

    expect(editor.getValue()).toBe('loaded from disk')
    expect(editor.model.setValue).toHaveBeenCalledWith('loaded from disk')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('mounts a fresh editor for a different file and never edits the old one', () => {
    const { ref, rerender } = setup('first file', '/proj/a.md')
    mountPending()
    const first = lastEditor()

    rerender('second file', '/proj/b.md')
    // Until the new editor mounts there is no editor: a save in this gap
    // falls back to the React copy instead of reading a disposed buffer as ''
    expect(ref.current!.getEditor()).toBeNull()
    expect(first.model.pushEditOperations).not.toHaveBeenCalled()

    mountPending()
    const second = lastEditor()
    expect(second).not.toBe(first)
    expect(second.getValue()).toBe('second file')
    expect(ref.current!.getEditor()).toBe(second)
    expect(first.isDisposed()).toBe(true)
  })

  it('applies a disk change equal to an emit that was cancelled out before React rendered', () => {
    const { onChange, rerender } = setup('base')
    mountPending()
    const editor = lastEditor()

    // "x" then Backspace, both before React renders: `value` stays "base"
    editor.userTypes('basex')
    editor.userTypes('base')
    expect(onChange).toHaveBeenCalledTimes(2)
    rerender('base')

    // Another tool writes "basex": it must reach the buffer
    rerender('basex')
    expect(editor.getValue()).toBe('basex')
    expect(editor.model.pushEditOperations).toHaveBeenCalledTimes(1)
  })

  it('drops what the old editor reports after a path change, before it is disposed', () => {
    const { onChange, rerender } = setup('first file', '/proj/a.md')
    mountPending()
    const first = lastEditor()

    rerender('second file', '/proj/b.md')
    // The old editor is detached but its disposal is still pending
    act(() => first.userTypes('first file, late key'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('reports selections to the latest onSelectionChange, not the one from the first render', () => {
    const first = vi.fn()
    const latest = vi.fn()
    const utils = render(<MonacoMarkdownEditor value="hello" onChange={vi.fn()} onSelectionChange={first} />)
    mountPending()
    utils.rerender(<MonacoMarkdownEditor value="hello" onChange={vi.fn()} onSelectionChange={latest} />)

    lastEditor().userSelects({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 3 })
    expect(latest).toHaveBeenCalledWith('he')
    expect(first).not.toHaveBeenCalled()
  })

  it('reports edits to the latest onChange', () => {
    const first = vi.fn()
    const latest = vi.fn()
    const utils = render(<MonacoMarkdownEditor value="a" onChange={first} />)
    mountPending()
    utils.rerender(<MonacoMarkdownEditor value="a" onChange={latest} />)
    act(() => lastEditor().userTypes('ab'))
    expect(latest).toHaveBeenCalledWith('ab')
    expect(first).not.toHaveBeenCalled()
  })

  it('ignores value changes before the editor has mounted', () => {
    const { rerender } = setup('a')
    rerender('b')
    rerender('c')
    expect(harness.editors).toHaveLength(0)
  })
})
