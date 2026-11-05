// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * {@link MarkdownEditorPanel} – no keystroke is lost when a deleted file comes
 * back (issue #450).
 *
 * A branch switch deletes an open file and puts it back with the other
 * branch's text. If the user typed in the tab meanwhile, the panel must keep
 * the buffer and offer the "file changed on disk" choice; it must never take
 * the disk's text silently, and autosave must not write the buffer over the
 * returned file while the choice is open.
 *
 * The real panel, `useFileWatcher`, the deleted-file probe and `useAutoSave`
 * run here; only the leaves jsdom cannot host are replaced: Monaco (a textarea
 * that answers `getEditor().getValue()` with what was typed), the toolbar, the
 * comment layer, the scroll sync and the export handlers. The hook-level rules
 * are in `useFileWatcher.restore.test.ts`; this file proves the panel wires
 * them so the typed text survives.
 *
 * Fake timers drive both 2 s clocks (autosave debounce and the probe), so the
 * order of "file back" and "autosave fires" is chosen by the test, not raced.
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useImperativeHandle, useRef } from 'react'
import type { IDockviewPanelProps } from 'dockview'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DELETED_FILE_PROBE_INTERVAL_MS } from '../../../../shared/deletedFileProbe'
import { TEST_IDS } from '../../constants/testids'
import type { EditorContentLayoutProps } from './EditorContentLayout'
import { MarkdownEditorPanel } from './MarkdownEditorPanel'

vi.mock('monaco-editor', () => ({}))

// Monaco does not run in jsdom: an uncontrolled-looking textarea stands in,
// with the one handle method the panel's save and take-back paths read.
vi.mock('./EditorContentLayout', () => ({
  EditorContentLayout: ({ currentFile, editorRef, onContentChange }: EditorContentLayoutProps) => {
    const textarea = useRef<HTMLTextAreaElement>(null)
    useImperativeHandle(editorRef, () => ({
      getEditor: () => ({ getValue: () => textarea.current?.value ?? '', deltaDecorations: () => [] }),
      setPositionAndReveal: () => {}
    }) as never)
    return (
      <textarea
        aria-label="Editor"
        ref={textarea}
        value={currentFile.content}
        onChange={(event) => onContentChange(event.target.value)}
      />
    )
  }
}))

vi.mock('../Editor/MarkdownEditorPanel/components', () => ({
  MarkdownToolbar: () => null,
  EditorErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

vi.mock('../Editor/MarkdownEditorPanel/hooks/useScrollSync', () => ({
  useScrollSync: () => ({
    isEditorReady: false,
    setIsEditorReady: () => {},
    rebuildScrollMap: () => {},
    handlePreviewRendered: () => {}
  })
}))

vi.mock('../Editor/MarkdownEditorPanel/hooks/useExportHandlers', () => ({
  useExportHandlers: () => ({
    isExportingPdf: false,
    isExportingDocx: false,
    handleExportPdf: () => {},
    handleExportDocx: () => {}
  })
}))

vi.mock('../Editor/markdownComments/useMarkdownComments', () => ({
  useMarkdownComments: () => ({
    tools: null,
    band: null,
    overlay: null,
    prefetch: () => {},
    panelKeys: {}
  })
}))

const mockShowToast = vi.fn()
vi.mock('../Toast/ToastContext', () => ({ useToast: () => ({ showToast: mockShowToast }) }))
vi.mock('../Dialog', () => ({ useDialog: () => ({ showConfirm: vi.fn() }) }))

const PATH = '/project/docs/notes.md'
const ORIGINAL = '# Notes\n\nOriginal body.\n'
const TYPED = '# Notes\n\nOriginal body.\n\nTyped while the file was gone.\n'
const FROM_OTHER_BRANCH = '# Notes\n\nFrom the other branch.\n'
const DELETED_BANNER = 'This file was deleted on disk. Save to restore it.'

type WatchCallback = (data: { filePath: string }) => void

let deletedListeners: WatchCallback[] = []

/** What the fake disk holds; `null` is "gone". */
let disk: string | null = ORIGINAL

const readFile = vi.fn(async ({ filePath }: { filePath: string }) => {
  if (filePath !== PATH || disk === null) throw new Error('ENOENT: no such file or directory')
  return disk
})
const getStats = vi.fn(async ({ filePath }: { filePath: string }) => {
  if (filePath !== PATH || disk === null) throw new Error('ENOENT: no such file or directory')
  return { size: disk.length }
})
const writeFile = vi.fn<(request: { filePath: string; content: string }) => Promise<void>>()

const fileWatch = {
  start: vi.fn(),
  stop: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  onFileChanged: vi.fn(() => () => {}),
  onFileDeleted: vi.fn((cb: WatchCallback) => {
    deletedListeners.push(cb)
    return () => {
      deletedListeners = deletedListeners.filter((l) => l !== cb)
    }
  }),
  onFileError: vi.fn(() => () => {})
}

function panelProps(): IDockviewPanelProps<{ filePath?: string; panelId?: string }> {
  const api = {
    id: 'editor-notes',
    isActive: true,
    isVisible: true,
    setTitle: vi.fn(),
    close: vi.fn(),
    onDidActiveChange: () => ({ dispose: () => {} }),
    onDidVisibilityChange: () => ({ dispose: () => {} })
  }
  return { api, params: { filePath: PATH, panelId: 'editor-notes' } } as unknown as IDockviewPanelProps<{
    filePath?: string
    panelId?: string
  }>
}

/** Lets `ms` of fake time pass and everything it started settle. */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

/** The panel with notes.md loaded in the stand-in editor. */
async function renderPanel(): Promise<HTMLTextAreaElement> {
  render(<MarkdownEditorPanel {...panelProps()} />)
  await advance(0)
  const editor = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Editor' })
  expect(editor.value).toBe(ORIGINAL)
  return editor
}

/** The file goes from disk and main reports it; the panel shows the deleted state. */
async function deleteOnDisk(): Promise<void> {
  disk = null
  act(() => {
    for (const listener of [...deletedListeners]) listener({ filePath: PATH })
  })
  await advance(0)
  expect(screen.getByText(DELETED_BANNER)).toBeInTheDocument()
}

const conflictBar = (): HTMLElement | null => screen.queryByTestId(TEST_IDS.FILE_CONFLICT_NOTIFICATION)

describe('MarkdownEditorPanel – typing in a deleted tab, then the file comes back (#450)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    disk = ORIGINAL
    deletedListeners = []
    mockShowToast.mockReset()
    readFile.mockClear()
    getStats.mockClear()
    writeFile.mockReset().mockImplementation(async ({ content }) => {
      disk = content
    })
    fileWatch.start.mockReset().mockResolvedValue({ success: true })
    fileWatch.stop.mockReset().mockResolvedValue({ success: true })
    fileWatch.pause.mockReset().mockResolvedValue({ success: true })
    fileWatch.resume.mockReset().mockResolvedValue({ success: true })
    ;(window as unknown as { api: unknown }).api = {
      file: { readFile, getStats, writeFile },
      fileWatch
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps the typed text, offers the conflict choice and writes nothing over the returned file', async () => {
    const editor = await renderPanel()
    await deleteOnDisk()

    // Typed while deleted; the file comes back before autosave's 2 s are up
    await advance(500)
    fireEvent.change(editor, { target: { value: TYPED } })
    await advance(500)
    disk = FROM_OTHER_BRANCH
    await advance(DELETED_FILE_PROBE_INTERVAL_MS - 1000)

    expect(screen.queryByText(DELETED_BANNER)).not.toBeInTheDocument()
    expect(conflictBar()).toHaveTextContent('notes.md changed on disk')
    expect(editor.value).toBe(TYPED)

    // Long past the autosave debounce and its 30 s ceiling: the open choice
    // holds autosave back, so the other branch's file is not overwritten
    await advance(35_000)
    expect(writeFile).not.toHaveBeenCalled()
    expect(disk).toBe(FROM_OTHER_BRANCH)
    expect(editor.value).toBe(TYPED)
    expect(conflictBar()).toBeInTheDocument()
  })

  it('keeps the typed text when an autosave failed first (the folder was gone too)', async () => {
    const editor = await renderPanel()
    await deleteOnDisk()
    // A branch switch that removed the whole folder: a save has nowhere to land
    writeFile.mockRejectedValue(new Error("ENOENT: no such file or directory, open '/project/docs/notes.md'"))

    fireEvent.change(editor, { target: { value: TYPED } })
    await advance(2_000)
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Save failed' }))
    expect(screen.getByText(DELETED_BANNER)).toBeInTheDocument()

    disk = FROM_OTHER_BRANCH
    await advance(DELETED_FILE_PROBE_INTERVAL_MS)

    expect(screen.queryByText(DELETED_BANNER)).not.toBeInTheDocument()
    expect(conflictBar()).toBeInTheDocument()
    expect(editor.value).toBe(TYPED)
    expect(disk).toBe(FROM_OTHER_BRANCH)
  })

  it('"Keep My Version" then saves the typed text: the keystrokes reach the disk', async () => {
    const editor = await renderPanel()
    await deleteOnDisk()
    // Typed half-way to the next probe, so the probe – not autosave – comes first
    await advance(1_000)
    fireEvent.change(editor, { target: { value: TYPED } })
    disk = FROM_OTHER_BRANCH
    await advance(DELETED_FILE_PROBE_INTERVAL_MS - 1_000)
    expect(conflictBar()).toBeInTheDocument()
    expect(writeFile).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId(TEST_IDS.FILE_CONFLICT_BTN_KEEP))
    await advance(2_000)

    expect(writeFile).toHaveBeenCalledWith(expect.objectContaining({ filePath: PATH, content: TYPED }))
    expect(disk).toBe(TYPED)
    expect(editor.value).toBe(TYPED)
  })

  it('an unedited tab takes the returned file and leaves the deleted state on its own', async () => {
    const editor = await renderPanel()
    await deleteOnDisk()

    disk = FROM_OTHER_BRANCH
    await advance(DELETED_FILE_PROBE_INTERVAL_MS)

    expect(screen.queryByText(DELETED_BANNER)).not.toBeInTheDocument()
    expect(conflictBar()).not.toBeInTheDocument()
    expect(editor.value).toBe(FROM_OTHER_BRANCH)
    expect(writeFile).not.toHaveBeenCalled()
  })
})
