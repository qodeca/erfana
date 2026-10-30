// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The types of the renderer's comment overlay host (`useCommentOverlayHost.ts`,
 * which re-exports them): its source, its options and what it hands the
 * preview. Kept apart from the hook only because of the 500-line ratchet.
 *
 * @module components/Comments/overlay/hostTypes
 */
import type {
  FileCommentListResult,
  FileCommentOpenDraftResult,
  FileCommentSaveRequest,
  FileCommentSaveResult,
  ThreadPlacement
} from '../../../../../shared/ipc/file-comment-schema'
import type { CommentFileView } from '../../../../../shared/ipc/comment-common-schema'
import type { ContextMenuItem } from '../../ContextMenu/ContextMenu'
import type { CommentDrawerProps } from '../CommentDrawer'
import type { CommentToolbarToolsProps } from '../CommentToolbarTools'
import type { CommentWindowProps } from '../CommentWindow'
import type { PreviewCommentAdapter } from './previewAdapter'
import type { SelectionButton } from './useSelectionComments'

/** One file's comments as the host reads and writes them (`fileCommentGateway`, bound to a panel and a file). */
export interface RendererCommentSource {
  readonly list: (bufferText?: string) => Promise<FileCommentListResult>
  readonly openDraft: () => Promise<FileCommentOpenDraftResult>
  readonly save: (request: FileCommentSaveRequest) => Promise<FileCommentSaveResult>
  /** Called when main says the file changed on disk; returns the unsubscribe. */
  readonly onChanged: (callback: () => void) => () => void
}

/** Options for `useCommentOverlayHost`. */
export interface CommentOverlayHostOptions {
  readonly panelId: string
  readonly filePath: string
  /** Comments are on for this preview (Settings, bridge, file kind). Off: nothing at all. */
  readonly enabled: boolean
  /** The preview is shown where comments live (Markdown: preview-only view, tab visible). */
  readonly shown: boolean
  /** This panel is the active one: the mode shortcut is its own (src/renderer/CLAUDE.md). */
  readonly activePanel: boolean
  readonly adapter: PreviewCommentAdapter
  readonly source: RendererCommentSource
  /** The scrolling element of the preview: pointer, keys and scroll are read there. */
  readonly scroller: HTMLElement | null
  /** The pane the overlay covers: its box is the overlay's and the window's area. */
  readonly area: HTMLElement | null
  /** The scroller's accessible name while live (C-08.1). */
  readonly scrollerLabel: string
  /** Why comments are paused (unsaved editor edits, F-02/F-03), or `null`. */
  readonly paused: string | null
  /** The editor's text while it differs from the file: listed for display only (C-09). */
  readonly bufferText?: string
  readonly onOpenInSource: (line: number) => void
}

/** The open menu: where, about what, and its comment items. */
export interface HostMenu {
  readonly x: number
  readonly y: number
  readonly label: string
  readonly items: ContextMenuItem[]
  readonly mode: boolean
  /** `null` only in comment mode, for a right-click off every target (`targetlessMenu`). */
  readonly target: HTMLElement | null
  /** The selected text, when the menu is about a selection (the prompt items and Copy selection read it). */
  readonly selectedText?: string
}

/** Everything the preview draws for comments. */
export interface CommentOverlayHost {
  readonly enabled: boolean
  readonly shown: boolean
  readonly mode: boolean
  readonly showIcons: boolean
  readonly toolbar: CommentToolbarToolsProps
  readonly drawer: CommentDrawerProps | null
  readonly menu: HostMenu | null
  readonly closeMenu: () => void
  readonly window: CommentWindowProps | null
  readonly polite: string
  readonly assertive: string
  /** The target under the pointer or picked by key in comment mode. */
  readonly outlined: HTMLElement | null
  readonly placements: readonly ThreadPlacement[]
  readonly file: CommentFileView | null
  /** Open the thread window on these threads, and the damaged blocks of a warning icon (an icon, S-07). */
  readonly openThreads: (
    threadKeys: readonly string[],
    anchor: HTMLElement | null,
    opener?: 'page' | 'drawer',
    blockKeys?: readonly string[]
  ) => void
  readonly scrollTick: number
  /** The Comment button over a selection (C-16), while it shows, and what it does. */
  readonly selectionButton: SelectionButton | null
  readonly onSelectionButton: () => void
  /** The key the layer registers its marks under; clicks are hit-tested against it (C-17). */
  readonly markOwner: string
  /** The threads of the open window: their words wear the active mark (R-01). */
  readonly activeThreads: readonly string[]
}
