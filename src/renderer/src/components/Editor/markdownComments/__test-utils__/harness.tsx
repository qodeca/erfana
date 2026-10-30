// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Test harness for Markdown Preview comments (spec 024 commit 13): the real
 * preview, the real host and the real shared components, with the
 * `window.api.fileComments` bridge replaced by mocks and the panel reduced to
 * what `useMarkdownComments` needs.
 */
import { useState } from 'react'
import { vi, type Mock } from 'vitest'
import type { CommentFileView, CommentThreadView } from '../../../../../../shared/ipc/comment-common-schema'
import type { ThreadPlacement } from '../../../../../../shared/ipc/file-comment-schema'
import type { CommentIdentitySettings } from '../../../../../../shared/ipc/global-settings-schema'
import { useGlobalSettingsStore } from '../../../../stores/useGlobalSettingsStore'
import { usePreviewCommentStore, commentDrafts } from '../../../../stores/usePreviewCommentStore'
import { useProjectStore } from '../../../../stores/useProjectStore'
import { globalSettings } from '../../../../test-utils/globalSettings'
import { DialogProvider } from '../../../Dialog'
import { ToastProvider } from '../../../Toast/ToastContext'
import { MarkdownPreview } from '../../MarkdownPreview'
import type { ViewMode } from '../../MarkdownEditorPanel/types'
import { useMarkdownComments } from '../useMarkdownComments'

export const PANEL_ID = 'editor-notes'
export const FILE_PATH = '/project/notes.md'
export const DRAFT_TOKEN = '0123456789abcdef0123456789abcdef'
export const RAW_HASH = 'a'.repeat(64)

/** The mocked `window.api.fileComments`. */
export interface FileCommentsMock {
  list: Mock
  openDraft: Mock
  save: Mock
  onChanged: Mock
  /** Fire `file-comment:changed` for the harness panel. */
  emitChanged: () => void
}

/** One open thread on the block that starts on `line` with `tag`. */
export function thread(key: string, line: number, tag: string, patch: Partial<CommentThreadView> = {}): CommentThreadView {
  return {
    threadKey: key,
    rawHash: RAW_HASH,
    status: 'open',
    line,
    tag,
    classes: [],
    attached: true,
    notVisible: false,
    messages: [{ id: 'm1', by: { name: 'Ada' }, at: '2026-10-29T10:00:00Z', text: `Comment ${key}` }],
    ...patch
  }
}

/** The file view main answers with. */
export function fileView(threads: CommentThreadView[] = [], patch: Partial<CommentFileView> = {}): CommentFileView {
  return {
    fileKey: 'file-key',
    displayPath: 'notes.md',
    filePath: FILE_PATH,
    frame: false,
    writable: true,
    threads,
    damaged: [],
    newer: [],
    ...patch
  }
}

/** Install the bridges the preview and the host call; returns the comment bridge's mocks. */
export function installApi(file: CommentFileView = fileView(), placements: ThreadPlacement[] = []): FileCommentsMock {
  const listeners = new Set<(payload: unknown) => void>()
  const mock = {
    list: vi.fn(async () => ({ ok: true, file, placements })),
    openDraft: vi.fn(async () => ({ ok: true, draftToken: DRAFT_TOKEN })),
    save: vi.fn(async () => ({ ok: true, threadKey: 'new-thread' })),
    onChanged: vi.fn((callback: (payload: unknown) => void) => {
      listeners.add(callback)
      return () => listeners.delete(callback)
    })
  }
  window.api = {
    file: {
      getProjectPath: vi.fn().mockResolvedValue('/project'),
      getStats: vi.fn().mockRejectedValue(new Error('ENOENT'))
    },
    fileComments: mock
  } as unknown as typeof window.api
  return {
    ...mock,
    emitChanged: () => listeners.forEach(listener => listener({ panelId: PANEL_ID, filePath: FILE_PATH, stamp: 1 }))
  }
}

/** Settings with both previews' comments on and the given identity. */
export function setSettings(identity: CommentIdentitySettings = { authorName: 'Ada', identityNoticeSeen: true }, markdownOn = true): void {
  useGlobalSettingsStore.setState({
    settings: globalSettings({
      comments: identity,
      editor: { ...globalSettings().editor, preserveLineBreaks: false },
      markdownPreview: { comments: { enabled: markdownOn } }
    }),
    isLoading: false,
    error: null,
    isInitialized: true,
    wasCorruptionRecovered: false,
    updateCommentIdentity: vi.fn(async (next: CommentIdentitySettings) => {
      useGlobalSettingsStore.setState(s => ({ settings: s.settings ? { ...s.settings, comments: next } : s.settings }))
      return true
    })
  })
}

/** Forget every store the host writes to. */
export function resetStores(): void {
  usePreviewCommentStore.getState().reset()
  commentDrafts.reset()
  useProjectStore.setState({ dirtyPanelIds: new Set<string>(), dockviewApi: null })
}

/** Props for {@link Harness}. */
export interface HarnessProps {
  readonly content: string
  readonly viewMode?: ViewMode
  readonly onViewMode?: (mode: ViewMode) => void
  /** The panel's re-read after a comment save (`MarkdownEditorPanel` passes its reload). */
  readonly onFileWritten?: () => void
}

/** The panel, reduced: tools, band, and the pane with the preview and the overlay. */
export function Harness({ content, viewMode = 'preview', onViewMode = () => {}, onFileWritten }: HarnessProps): React.JSX.Element {
  const [editorRef] = useState(() => ({ current: null }))
  const comments = useMarkdownComments({
    panelId: PANEL_ID,
    filePath: FILE_PATH,
    content,
    viewMode,
    setViewMode: onViewMode,
    editorRef,
    isActivePanel: true,
    isVisible: true,
    ...(onFileWritten === undefined ? {} : { onFileWritten })
  })
  return (
    <ToastProvider>
      <DialogProvider>
      <div className="markdown-toolbar" role="toolbar" aria-label="Markdown formatting" data-testid="harness-toolbar">
        {comments.tools}
      </div>
      {comments.band}
      {viewMode !== 'editor' && (
        <div className="preview-pane" data-testid="harness-pane">
          <MarkdownPreview content={content} filePath={FILE_PATH} />
          {viewMode === 'preview' && comments.overlay}
        </div>
      )}
      </DialogProvider>
    </ToastProvider>
  )
}
