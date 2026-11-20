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
 * The real panel, `useFileWatcher`, the freshness tracker (its deleted-state
 * probe) and `useAutoSave` run here; only the leaves jsdom cannot host are
 * replaced: Monaco (a textarea that answers `getEditor().getValue()` with what
 * was typed), the toolbar, the comment layer, the scroll sync and the export
 * handlers. The disk and the watch layer are the freshness core's fakes,
 * installed as the window's freshness environment (#478). The hook-level rules
 * are in `useFileWatcher.restore.test.ts`; this file proves the panel wires
 * them so the typed text survives.
 *
 * Fake timers drive every clock (autosave debounce, the delete confirmation
 * and the probe), so the order of "file back" and "autosave fires" is chosen
 * by the test, not raced.
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useImperativeHandle, useRef } from 'react'
import type { IDockviewPanelProps } from 'dockview'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { realClock } from '../../../../shared/clock'
import { FakeDisk } from '../../../../shared/freshness/__test__/fakeDisk'
import { FakeSource } from '../../../../shared/freshness/__test__/fakeSource'
import { DELETED_PROBE_BACKOFF, TIMING_PROFILES } from '../../../../shared/freshness/timingProfiles'
import { TEST_IDS } from '../../constants/testids'
import { setFreshnessEnvironmentForTests, setPausableSourceForTests } from '../../services/freshness/windowFreshness'
import { FRESHNESS_NOTICE_TEST_IDS } from '../FileConflictNotification/freshnessNoticeCopy'
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

/** The fake disk and watch layer, rebuilt per test. */
let disk: FakeDisk
let source: FakeSource
let restoreEnvironment: () => void = () => {}

/** The writes the save add-on made. */
const writes = (): Array<{ filePath: string; content: string }> => source.writeCalls

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

/** The deleted notice, if shown. */
const deletedNotice = (): HTMLElement | null => screen.queryByTestId(FRESHNESS_NOTICE_TEST_IDS.deleted)

/** The file goes from disk and main reports it; the panel shows the deleted state once the re-check confirms. */
async function deleteOnDisk(): Promise<void> {
  act(() => disk.remove(PATH))
  await advance(TIMING_PROFILES.editor.deleteConfirmMs + 100)
  expect(deletedNotice()).toBeInTheDocument()
}

/** The file is back (a branch switch): no event – the deleted state's probe finds it. */
function backOnDisk(content: string): void {
  disk.write(PATH, content, { silent: true })
}

const conflictBar = (): HTMLElement | null => screen.queryByTestId(TEST_IDS.FILE_CONFLICT_NOTIFICATION)

describe('MarkdownEditorPanel – typing in a deleted tab, then the file comes back (#450)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    disk = new FakeDisk(realClock)
    disk.write(PATH, ORIGINAL, { silent: true })
    source = new FakeSource(disk)
    let nextId = 0
    const restorePausable = setPausableSourceForTests(source)
    const restoreTrackers = setFreshnessEnvironmentForTests({
      source,
      clock: realClock,
      newId: () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, '0')}`,
      onCheck: () => () => {}
    })
    restoreEnvironment = () => {
      restoreTrackers()
      restorePausable()
    }
    mockShowToast.mockReset()
    ;(window as unknown as { api: unknown }).api = { file: {} }
  })

  afterEach(() => {
    restoreEnvironment()
    vi.useRealTimers()
  })

  it('keeps the typed text, offers the conflict choice and writes nothing over the returned file', async () => {
    const editor = await renderPanel()
    await deleteOnDisk()

    // Typed while deleted; the file comes back before autosave's 2 s are up
    await advance(500)
    fireEvent.change(editor, { target: { value: TYPED } })
    await advance(500)
    backOnDisk(FROM_OTHER_BRANCH)
    await advance(DELETED_PROBE_BACKOFF.maxMs - 1000)

    expect(deletedNotice()).not.toBeInTheDocument()
    expect(conflictBar()).toHaveTextContent('notes.md changed on disk')
    expect(editor.value).toBe(TYPED)

    // Long past the autosave debounce and its 30 s ceiling: the open choice
    // holds autosave back, so the other branch's file is not overwritten
    await advance(35_000)
    expect(writes()).toEqual([])
    expect(disk.content(PATH)).toBe(FROM_OTHER_BRANCH)
    expect(editor.value).toBe(TYPED)
    expect(conflictBar()).toBeInTheDocument()
  })

  it('does not autosave while the file is deleted, even past the debounce and its 30 s ceiling', async () => {
    const editor = await renderPanel()
    await deleteOnDisk()

    fireEvent.change(editor, { target: { value: TYPED } })
    await advance(35_000)

    expect(writes()).toEqual([])
    expect(disk.exists(PATH)).toBe(false)
    expect(deletedNotice()).toBeInTheDocument()
    expect(editor.value).toBe(TYPED)
  })

  it('never writes over a file that comes back just before autosave would fire (the branch-switch race)', async () => {
    const editor = await renderPanel()
    await deleteOnDisk()

    // Typed at the moment of deletion, so autosave's 2 s end before or with the
    // next probe; the file is back just before then
    fireEvent.change(editor, { target: { value: TYPED } })
    await advance(1_900)
    backOnDisk(FROM_OTHER_BRANCH)
    await advance(DELETED_PROBE_BACKOFF.maxMs)

    expect(writes()).toEqual([])
    expect(disk.content(PATH)).toBe(FROM_OTHER_BRANCH)
    expect(deletedNotice()).not.toBeInTheDocument()
    expect(conflictBar()).toHaveTextContent('notes.md changed on disk')
    expect(editor.value).toBe(TYPED)
  })

  it('"Keep My Version" then saves the typed text: the keystrokes reach the disk', async () => {
    const editor = await renderPanel()
    await deleteOnDisk()
    // Typed half-way to the next probe, so the probe – not autosave – comes first
    await advance(1_000)
    fireEvent.change(editor, { target: { value: TYPED } })
    backOnDisk(FROM_OTHER_BRANCH)
    await advance(DELETED_PROBE_BACKOFF.maxMs - 1_000)
    expect(conflictBar()).toBeInTheDocument()
    expect(writes()).toEqual([])

    fireEvent.click(screen.getByTestId(TEST_IDS.FILE_CONFLICT_BTN_KEEP))
    // Keep my version adopts the disk's stamp (one probe); autosave's 2 s start when the bar goes
    await advance(0)
    await advance(2_500)

    expect(writes()).toEqual([expect.objectContaining({ filePath: PATH, content: TYPED })])
    expect(disk.content(PATH)).toBe(TYPED)
    expect(editor.value).toBe(TYPED)
  })

  it('an unedited tab takes the returned file and leaves the deleted state on its own', async () => {
    const editor = await renderPanel()
    await deleteOnDisk()

    backOnDisk(FROM_OTHER_BRANCH)
    await advance(DELETED_PROBE_BACKOFF.maxMs)

    expect(deletedNotice()).not.toBeInTheDocument()
    expect(conflictBar()).not.toBeInTheDocument()
    expect(editor.value).toBe(FROM_OTHER_BRANCH)
    expect(writes()).toEqual([])
  })
})
