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
 * @see Issue #74 - HTML preview with CSS and JavaScript execution
 */

import type { DockviewApi, DockviewPanelRenderer, IDockviewPanel } from 'dockview'

import type { FilePanelKind } from '../../../shared/ipc/preview-types'
import { getBasename, sanitizeFilePath } from './fileUtils'
import { isImageFile } from './imageUtils'
import { logger } from './logger'
import { useProjectStore } from '../stores/useProjectStore'

export type { FilePanelKind }

/**
 * Static description of how each {@link FilePanelKind} maps onto a dockview
 * panel: the id prefix, the component renderer, the tab component and the
 * default rendering mode.
 *
 * The `preview` row is the reason `renderer` exists on {@link OpenFileInPanelOptions}:
 * the running preview is a native `WebContentsView` whose DOM placeholder must
 * stay mounted on a tab switch. Dockview's default `onlyWhenVisible` renderer
 * removes the element when the tab goes inactive, which would fire the
 * placeholder's `ResizeObserver` at 0×0, collapse the native view and leave the
 * `'inactive-tab'` hide path dead code (design §5(a), finding X12). So preview
 * panels default to `renderer: 'always'`.
 */
const PANEL_KIND_DESCRIPTORS: Record<
  FilePanelKind,
  {
    /** Panel-id prefix, e.g. `editor` → `editor-<hash>`. */
    idPrefix: string
    /** Dockview component renderer id registered by `EditorAreaSplitPanel`. */
    component: string
    /** Dockview tab component id registered by `EditorAreaSplitPanel`. */
    tabComponent: string
    /** Rendering mode; `undefined` falls back to dockview's `onlyWhenVisible`. */
    renderer?: DockviewPanelRenderer
  }
> = {
  editor: { idPrefix: 'editor', component: 'editor', tabComponent: 'editorTab' },
  image: { idPrefix: 'image', component: 'imageViewer', tabComponent: 'imageTab' },
  // NOTE: `htmlPreview` / `htmlPreviewTab` are registered by
  // `EditorAreaSplitPanel` (issue #74, work item 80). Keep these two ids in
  // sync with that registration or a `.html` file opens on an unknown component.
  preview: {
    idPrefix: 'preview',
    component: 'htmlPreview',
    tabComponent: 'htmlPreviewTab',
    renderer: 'always'
  }
}

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
  /**
   * The kind of panel to open.
   *
   * When omitted the kind is derived synchronously from the extension –
   * `image` for image files, `editor` for everything else. It is **never**
   * `preview` by derivation: a `.html` file only opens as a running preview
   * once {@link resolvePanelKind} has awaited the async eligibility check, and
   * that resolver passes `kind: 'preview'` here explicitly.
   */
  kind?: FilePanelKind
  /**
   * Overrides the panel's rendering mode. When omitted the default for the
   * resolved {@link FilePanelKind} is used (`always` for `preview`, dockview's
   * `onlyWhenVisible` otherwise).
   */
  renderer?: DockviewPanelRenderer
}

/**
 * Assembles a panel id from an already-resolved {@link FilePanelKind}.
 *
 * The only place in the renderer that concatenates a panel-id prefix. Both
 * {@link getFilePanelId} and {@link openFileInPanel} route through it, so the
 * id they produce for one path is identical by construction rather than by a
 * test noticing that the two copies still agree (QG-6 finding M8).
 *
 * Takes the `kind` rather than re-deriving it, which is what lets
 * `openFileInPanel` decide the kind once and use that one answer for the id,
 * the component and the tab component together.
 *
 * @param kind - The resolved panel kind.
 * @param filePath - Absolute path to the file.
 * @returns `preview-…` / `image-…` / `editor-…` followed by the sanitized path.
 */
function buildPanelId(kind: FilePanelKind, filePath: string): string {
  return `${PANEL_KIND_DESCRIPTORS[kind].idPrefix}-${sanitizeFilePath(filePath)}`
}

/**
 * Builds the dockview panel id for a file, choosing between the image viewer
 * and the editor purely from the extension.
 *
 * **This function is deliberately kind-free** – it never returns a `preview-`
 * id. Both of its call sites (a rename close-out and a markdown/doc export
 * output path) pass paths that open as source or in the image viewer, never as
 * a running preview, so a `.html` path reaching here would open as `editor-`,
 * which is exactly what those call sites want. Any `.html` "lossiness" is
 * therefore unreachable; do not add a kind-aware overload for it.
 *
 * Panel identity is per **path string**: `sanitizeFilePath` hashes the raw
 * path, so `/proj/Icon.svg` and `/proj/icon.svg` are two panels even on a
 * case-insensitive volume. Harmless – the watcher keys by path too, and watches
 * are subscriber-counted.
 *
 * @param filePath - Absolute path to the file.
 * @returns `image-…` for image files, `editor-…` otherwise.
 *
 * @example
 * ```ts
 * getFilePanelId('/proj/logo.PNG')  // 'image-<hash>'
 * getFilePanelId('/proj/notes.md')  // 'editor-<hash>'
 * ```
 */
export function getFilePanelId(filePath: string): string {
  return buildPanelId(isImageFile(filePath) ? 'image' : 'editor', filePath)
}

/**
 * Opens a file in the right panel type, reusing an existing tab when there is one.
 *
 * Without a `kind` option the routing is synchronous: images open in the image
 * viewer, everything else in the Markdown editor. To open a `.html` file as a
 * running preview, callers first await {@link resolvePanelKind} (which performs
 * the async eligibility check) and pass the resolved `kind: 'preview'` here.
 * Newly created panels are registered with the project store so they are
 * cleaned up on a project switch.
 *
 * Callers keep their own tails: this function does not toast, does not scroll
 * to an anchor, and does not decide what "not ready" should look like.
 *
 * @param dockviewApi - The editor-area dockview API, or `undefined` before it is ready.
 * @param filePath - Absolute path to the file to open.
 * @param options - Kind, rendering mode, params to forward and focus behaviour on reuse.
 * @returns The opened or reused panel, or `undefined` when the API was not ready.
 *
 * @example Project tree – activate and take focus
 * ```ts
 * openFileInPanel(dockviewApi, filePath)
 * ```
 *
 * @example Running HTML preview – native view kept alive across tab switches
 * ```ts
 * openFileInPanel(dockviewApi, filePath, { kind: 'preview', renderer: 'always' })
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
  const { params = {}, focusOnReuse = true, kind: kindOption, renderer } = options

  if (!dockviewApi) {
    logger.warn('Cannot open file: dockview API not ready', { filePath })
    return undefined
  }

  // Resolve the kind once. When the caller supplied one (the async preview
  // path, or an explicit "Open as source") we trust it; otherwise derive
  // image-vs-editor from the extension – `isImageFile` runs at most once, so
  // the id prefix, the component and the tab component cannot drift apart.
  const kind: FilePanelKind = kindOption ?? (isImageFile(filePath) ? 'image' : 'editor')
  const descriptor = PANEL_KIND_DESCRIPTORS[kind]
  const panelId = buildPanelId(kind, filePath)

  const existing = dockviewApi.getPanel(panelId)
  if (existing) {
    existing.api.setActive()
    if (focusOnReuse) existing.group.focus()
    logger.info('Activated existing panel', { filePath, panelId })
    return existing
  }

  const panel = dockviewApi.addPanel({
    id: panelId,
    component: descriptor.component,
    title: getBasename(filePath) || 'Untitled',
    tabComponent: descriptor.tabComponent,
    // Preview panels default to `always` so the native view's placeholder is
    // never unmounted on a tab switch (§5(a) X12); an explicit override wins.
    renderer: renderer ?? descriptor.renderer,
    params: { filePath, panelId, ...params }
  })

  // Track the panel so a project switch can close it.
  useProjectStore.getState().registerEditorPanel(panelId)

  panel.api.setActive()
  panel.group.focus()
  logger.info('Opened new panel', { filePath, panelId })

  return panel
}
