// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One place that decides which panel a file opens in.
 *
 * Before this module the project tree, the terminal and the editor each built
 * their own panel id and picked their own component, and only the tree knew
 * about images – so clicking `logo.png` in a terminal link opened Monaco on a
 * binary file.
 *
 * Lives in `utils/` (not `services/`) because that is where the rest of the
 * panel plumbing lives: `panelUtils.ts`, `panelManager.factory.ts`,
 * `panelHandlerRegistry.ts`. It is deliberately **not** registered with
 * `panelHandlerRegistry` – that registry routes IPC-driven panel actions, not
 * user-initiated file opens.
 *
 * @module openFileInPanel
 * @see Issue #70 - preview tabs show stale content when the file changes
 */

import type { DockviewApi, IDockviewPanel } from 'dockview'

import { getBasename, sanitizeFilePath } from './fileUtils'
import { isImageFile } from './imageUtils'
import { logger } from './logger'
import { useProjectStore } from '../stores/useProjectStore'

/** Options for {@link openFileInPanel}. */
export interface OpenFileInPanelOptions {
  /** Extra params merged into the panel params (e.g. `initialLine`, `initialColumn`). */
  params?: Record<string, unknown>
  /**
   * Whether to move keyboard focus to the panel's group when an already-open
   * panel is reused.
   *
   * `true` matches the project tree: clicking a file is a deliberate "take me
   * there". The terminal passes `false`, because a file-link click there must
   * not yank focus out of the terminal the user is typing in.
   *
   * @default true
   */
  focusOnReuse?: boolean
}

/**
 * Assembles a panel id from an already-computed image verdict.
 *
 * The only place in the renderer that concatenates a panel-id prefix. Both
 * {@link getFilePanelId} and {@link openFileInPanel} route through it, so the
 * id they produce for one path is identical by construction rather than by a
 * test noticing that the two copies still agree (QG-6 finding M8).
 *
 * Takes `isImage` rather than re-deriving it, which is what lets
 * `openFileInPanel` call `isImageFile` exactly once per open and use that one
 * answer for the id, the component and the tab component together.
 *
 * @param isImage - Whether the file opens in the image viewer
 * @param filePath - Absolute path to the file
 * @returns `image-…` or `editor-…` followed by the sanitized path
 */
function buildPanelId(isImage: boolean, filePath: string): string {
  return `${isImage ? 'image' : 'editor'}-${sanitizeFilePath(filePath)}`
}

/**
 * Builds the dockview panel id for a file.
 *
 * The id prefix and the panel component are derived from the **same**
 * `isImageFile` call inside {@link openFileInPanel}, so they can never
 * disagree; this export exists for call sites that need the id alone (checking
 * whether a panel is already open, closing a panel after a rename).
 *
 * Panel identity is per **path string**: `sanitizeFilePath` hashes the raw
 * path, so `/proj/Icon.svg` and `/proj/icon.svg` are two panels even on a
 * case-insensitive volume. Harmless – the watcher keys by path too, and watches
 * are subscriber-counted.
 *
 * @param filePath - Absolute path to the file
 * @returns `image-…` for image files, `editor-…` otherwise
 *
 * @example
 * ```ts
 * getFilePanelId('/proj/logo.PNG')  // 'image-<hash>'
 * getFilePanelId('/proj/notes.md')  // 'editor-<hash>'
 * ```
 */
export function getFilePanelId(filePath: string): string {
  return buildPanelId(isImageFile(filePath), filePath)
}

/**
 * Opens a file in the right panel type, reusing an existing tab when there is one.
 *
 * Images open in the image viewer; everything else opens in the Markdown
 * editor. Newly created panels are registered with the project store so they
 * are cleaned up on a project switch.
 *
 * Callers keep their own tails: this function does not toast, does not scroll
 * to an anchor, and does not decide what "not ready" should look like.
 *
 * @param dockviewApi - The editor-area dockview API, or `undefined` before it is ready
 * @param filePath - Absolute path to the file to open
 * @param options - Params to forward and focus behaviour on reuse
 * @returns The opened or reused panel, or `undefined` when the API was not ready
 *
 * @example Project tree – activate and take focus
 * ```ts
 * openFileInPanel(dockviewApi, filePath)
 * ```
 *
 * @example Terminal link – activate without stealing focus
 * ```ts
 * const panel = openFileInPanel(dockviewApi, filePath, {
 *   focusOnReuse: false,
 *   params: { initialLine: line, initialColumn: column }
 * })
 * if (!panel) showWarningToast('Editor not ready', 'Cannot open file')
 * ```
 */
export function openFileInPanel(
  dockviewApi: DockviewApi | undefined,
  filePath: string,
  options: OpenFileInPanelOptions = {}
): IDockviewPanel | undefined {
  const { params = {}, focusOnReuse = true } = options

  if (!dockviewApi) {
    logger.warn('Cannot open file: dockview API not ready', { filePath })
    return undefined
  }

  // Computed once: the id prefix, the component and the tab component all
  // derive from this single answer, so they cannot drift apart.
  const isImage = isImageFile(filePath)
  const panelId = buildPanelId(isImage, filePath)

  const existing = dockviewApi.getPanel(panelId)
  if (existing) {
    existing.api.setActive()
    if (focusOnReuse) existing.group.focus()
    logger.info('Activated existing panel', { filePath, panelId })
    return existing
  }

  const panel = dockviewApi.addPanel({
    id: panelId,
    component: isImage ? 'imageViewer' : 'editor',
    title: getBasename(filePath) || 'Untitled',
    tabComponent: isImage ? 'imageTab' : 'editorTab',
    params: { filePath, panelId, ...params }
  })

  // Track the panel so a project switch can close it.
  useProjectStore.getState().registerEditorPanel(panelId)

  panel.api.setActive()
  panel.group.focus()
  logger.info('Opened new panel', { filePath, panelId })

  return panel
}
