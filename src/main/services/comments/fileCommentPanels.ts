// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Which file each renderer-hosted preview panel has open, per window – how
 * main knows a file is open in a panel of the sender's window (spec 024
 * architecture note 001 § 8 C17).
 *
 * Main has no record of the renderer's editor panels, so the renderer's own
 * `file-comment:list` registers them: a list names a panel and a file, and
 * main – after confining the file – records "this window's panel P shows real
 * path R". `openDraft` and `save` are accepted only for a panel so recorded in
 * the SENDER's window, and only for that file. Listing another file in the
 * panel starts a new session: its drafts and keys are gone with the old file.
 *
 * Each panel owns a key store (`commentKeyStore.ts`): draft tokens and the
 * keys of its list, bound to the window, the panel and the session. Bounded:
 * at most {@link FILE_COMMENT_PANELS_PER_WINDOW_MAX} panels per window, the
 * least recently listed one forgotten first (and its watch released by the
 * service), and every panel of a window forgotten when the window closes.
 */
import type { CommentFileKind } from '../../../shared/comments/fileKind'
import { CommentKeyStore, type CommentBinding, type CommentKeyStoreDeps } from './commentKeyStore'

/** Panels one window may have recorded at once. */
export const FILE_COMMENT_PANELS_PER_WINDOW_MAX = 64

/** A draft as main keeps it behind its token: the file it was minted for. */
export interface FileCommentDraft {
  readonly realPath: string
}

/** One panel's open file. */
export interface FileCommentPanel {
  readonly binding: CommentBinding
  /** The confined real path – the key of locks, watches and the writer. */
  readonly realPath: string
  /** The file as the panel named it, resolved: the spelling the renderer's tabs use. */
  readonly requestedPath: string
  readonly kind: CommentFileKind
  readonly keys: CommentKeyStore<FileCommentDraft>
}

/** The record. */
export class FileCommentPanels {
  private readonly byWindow = new Map<number, Map<string, FileCommentPanel>>()
  private session = 0

  constructor(private readonly keyDeps: CommentKeyStoreDeps = {}) {}

  /**
   * Record that `panelId` of `windowId` shows `realPath`. The same file keeps
   * the panel's session and keys; another file starts a fresh one.
   *
   * @returns The panel, and every panel this replaced or pushed out (their watches go).
   */
  open(
    windowId: number,
    panelId: string,
    file: { readonly realPath: string; readonly requestedPath: string; readonly kind: CommentFileKind }
  ): { readonly panel: FileCommentPanel; readonly released: readonly FileCommentPanel[] } {
    const panels = this.byWindow.get(windowId) ?? new Map<string, FileCommentPanel>()
    this.byWindow.set(windowId, panels)
    const known = panels.get(panelId)
    panels.delete(panelId)
    if (known !== undefined && known.realPath === file.realPath && known.kind.id === file.kind.id) {
      panels.set(panelId, known)
      return { panel: known, released: [] }
    }
    this.session += 1
    const panel: FileCommentPanel = {
      binding: { windowId, panelId, session: this.session },
      ...file,
      keys: new CommentKeyStore<FileCommentDraft>(this.keyDeps)
    }
    panels.set(panelId, panel)
    const released = known === undefined ? [] : [known]
    for (const [oldestId, oldest] of panels) {
      if (panels.size <= FILE_COMMENT_PANELS_PER_WINDOW_MAX) break
      panels.delete(oldestId)
      released.push(oldest)
    }
    for (const gone of released) gone.keys.clear()
    return { panel, released }
  }

  /** The panel `panelId` of `windowId`, when it was recorded. */
  get(windowId: number, panelId: string): FileCommentPanel | undefined {
    return this.byWindow.get(windowId)?.get(panelId)
  }

  /** Every recorded panel showing `realPath`, in every window. */
  showing(realPath: string): FileCommentPanel[] {
    const found: FileCommentPanel[] = []
    for (const panels of this.byWindow.values()) {
      for (const panel of panels.values()) if (panel.realPath === realPath) found.push(panel)
    }
    return found
  }

  /** Forget one panel (its file's comments were turned off). @returns The panel forgotten, if it was recorded. */
  forget(windowId: number, panelId: string): FileCommentPanel | undefined {
    const panels = this.byWindow.get(windowId)
    const panel = panels?.get(panelId)
    if (panels === undefined || panel === undefined) return undefined
    panels.delete(panelId)
    panel.keys.clear()
    return panel
  }

  /** The window closed: forget its panels. @returns The panels forgotten. */
  forgetWindow(windowId: number): FileCommentPanel[] {
    const panels = [...(this.byWindow.get(windowId)?.values() ?? [])]
    this.byWindow.delete(windowId)
    for (const panel of panels) panel.keys.clear()
    return panels
  }

  /** Forget every panel (a project change). @returns The panels forgotten. */
  clear(): FileCommentPanel[] {
    return [...this.byWindow.keys()].flatMap(windowId => this.forgetWindow(windowId))
  }

  /** Panels recorded for `windowId`. */
  count(windowId: number): number {
    return this.byWindow.get(windowId)?.size ?? 0
  }
}
