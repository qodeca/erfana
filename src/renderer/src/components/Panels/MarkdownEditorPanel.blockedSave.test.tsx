// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * {@link MarkdownEditorPanel} – no save writes over content the tab cannot
 * show (#478 F1, QG-8 C1).
 *
 * When the file on disk becomes too large or binary, the tab keeps its last
 * good read, read-only. Autosave already stops; Cmd+S and a save by id (the
 * project-switch flush, a preview move) must stop too, or the stale buffer
 * replaces the file. The save by id reports the tab as conflicted, so a flush
 * skips it instead of counting it failed.
 *
 * The real panel, `useFileWatcher` and the tracker run; Monaco and the other
 * jsdom-hostile leaves are stand-ins, as in `MarkdownEditorPanel.deletedRecover.test.tsx`.
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useImperativeHandle, useRef } from 'react'
import type { IDockviewPanelProps } from 'dockview'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { realClock } from '../../../../shared/clock'
import type { ContentUnavailableReason } from '../../../../shared/freshness/freshnessTypes'
import { FakeDisk } from '../../../../shared/freshness/__test__/fakeDisk'
import { FakeSource } from '../../../../shared/freshness/__test__/fakeSource'
import { editorSaveRegistry } from '../../services/editorSaveRegistry'
import { setFreshnessEnvironmentForTests, setPausableSourceForTests } from '../../services/freshness/windowFreshness'
import { FRESHNESS_NOTICE_TEST_IDS } from '../FileConflictNotification/freshnessNoticeCopy'
import type { EditorContentLayoutProps } from './EditorContentLayout'
import { MarkdownEditorPanel } from './MarkdownEditorPanel'

vi.mock('monaco-editor', () => ({}))

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
  useMarkdownComments: () => ({ tools: null, band: null, overlay: null, prefetch: () => {}, panelKeys: {} })
}))

vi.mock('../Toast/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../Dialog', () => ({ useDialog: () => ({ showConfirm: vi.fn() }) }))

const PANEL_ID = 'editor-notes'
const PATH = '/project/docs/notes.md'
const ORIGINAL = '# Notes\n\nOriginal body.\n'
const TYPED = '# Notes\n\nOriginal body, edited.\n'
const ON_DISK = '\u0000\u0001 now a blob nobody may overwrite'

let disk: FakeDisk
let source: FakeSource
let restoreEnvironment: () => void = () => {}

function panelProps(): IDockviewPanelProps<{ filePath?: string; panelId?: string }> {
  const api = {
    id: PANEL_ID,
    isActive: true,
    isVisible: true,
    setTitle: vi.fn(),
    close: vi.fn(),
    onDidActiveChange: () => ({ dispose: () => {} }),
    onDidVisibilityChange: () => ({ dispose: () => {} })
  }
  return { api, params: { filePath: PATH, panelId: PANEL_ID } } as unknown as IDockviewPanelProps<{
    filePath?: string
    panelId?: string
  }>
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

/** The panel with an edited, unsaved buffer, whose file then turns into content it cannot show. */
async function renderBlocked(reason: Exclude<ContentUnavailableReason, 'unreadable'>): Promise<HTMLTextAreaElement> {
  render(<MarkdownEditorPanel {...panelProps()} />)
  await advance(0)
  const editor = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Editor' })
  fireEvent.change(editor, { target: { value: TYPED } })
  act(() => {
    disk.block(PATH, reason)
    disk.write(PATH, ON_DISK)
  })
  await advance(500) // under autosave's 2 s: the read decides first
  expect(screen.getByTestId(FRESHNESS_NOTICE_TEST_IDS.unavailable)).toBeInTheDocument()
  return editor
}

describe('MarkdownEditorPanel – a save never writes over content it cannot show (#478 C1)', () => {
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
    ;(window as unknown as { api: unknown }).api = { file: {} }
  })

  afterEach(() => {
    restoreEnvironment()
    vi.useRealTimers()
  })

  it.each(['too-large', 'binary'] as const)('Cmd/Ctrl+S on a %s file writes nothing', async (reason) => {
    await renderBlocked(reason)

    fireEvent.keyDown(window, { key: 's', ctrlKey: true, metaKey: true })
    await advance(100)

    expect(source.writeCalls).toEqual([])
    expect(disk.content(PATH)).toBe(ON_DISK)
  })

  it('a save by id (the project-switch flush) writes nothing and reports the tab as conflicted', async () => {
    await renderBlocked('too-large')

    expect(editorSaveRegistry.hasConflict(PANEL_ID)).toBe(true)
    let saved: boolean | undefined
    await act(async () => {
      saved = await editorSaveRegistry.save(PANEL_ID)
    })

    expect(saved).toBe(false)
    expect(source.writeCalls).toEqual([])
    expect(disk.content(PATH)).toBe(ON_DISK)
  })

  it('autosave stays off too, past its 30 s ceiling', async () => {
    await renderBlocked('binary')
    await advance(35_000)

    expect(source.writeCalls).toEqual([])
    expect(disk.content(PATH)).toBe(ON_DISK)
  })
})
