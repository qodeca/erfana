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
 * PREVIEW TABS ARE FOUND BY THEIR PAGE, NOT THEIR ID (issue #124). A preview
 * tab can move to another page and keep its id, so `preview-<A>` may be showing
 * B. The "is this file already open" question for a preview is answered by
 * {@link findPreviewTabShowing}, which reads `params.filePath`; a new preview
 * whose usual id is still held by a tab that moved away gets a variant id. No
 * path is ever read back out of an id.
 *
 * @module openFileInPanel
 * @see Issue #70 - preview tabs show stale content when the file changes
 * @see Issue #74 - HTML preview with CSS and JavaScript execution
 */

import type { DockviewApi, DockviewPanelRenderer, IDockviewPanel } from 'dockview'

import type { FilePanelKind } from '../../../shared/ipc/preview-types'
import { getBasename, pathsEqual, sanitizeFilePath, stablePathDigest } from './fileUtils'
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
  /**
   * Extra params merged into the panel params (e.g. `initialLine`,
   * `initialColumn`, or a preview's `linkMode`). Applied to a NEW panel only: a
   * reused panel keeps its own, which is how a reused preview tab keeps its
   * link mode (part 3 §3.3).
   */
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
 * The id is bounded. `PanelIdSchema` (src/shared/ipc/preview-schema.ts) caps
 * a panel id at 256 and `sanitizeFilePath` is one character out per character
 * in, so a file 249 characters deep on Windows (250 on POSIX) used to refuse
 * to preview with `too_big, maximum: 256, path: ["panelId"]` in the log and
 * nothing on screen (Windows verification, 2026-09-03). Past
 * {@link PANEL_ID_PATH_BUDGET} the id keeps a readable head of the sanitized
 * path and pins identity with {@link stablePathDigest} of the WHOLE raw path;
 * under it the id is exactly what it always was, so nothing keyed on an
 * existing id moves. Every id stays under 200 characters.
 *
 * A `variant` above 0 appends `-v<n>` (issue #124): a preview tab that moved to
 * another page keeps the id it was minted with, so a new preview of that first
 * file needs a different one. The suffix counts against the budget, so a
 * variant id is shortened exactly when it would outgrow it. Variant 0 is the id
 * the path always had.
 *
 * @param kind - The resolved panel kind.
 * @param filePath - Absolute path to the file.
 * @param variant - Which variant of the id; `0` (the default) is the plain id.
 * @returns `preview-…` / `image-…` / `editor-…` followed by the sanitized path,
 *   shortened past the budget to a 150-character head plus a 16-character digest,
 *   then `-v<n>` for a variant above 0.
 */
function buildPanelId(kind: FilePanelKind, filePath: string, variant = 0): string {
  const prefix = PANEL_KIND_DESCRIPTORS[kind].idPrefix
  const sanitized = sanitizeFilePath(filePath)
  const suffix = variant > 0 ? `-v${variant}` : ''
  if (sanitized.length + suffix.length <= PANEL_ID_PATH_BUDGET) {
    return `${prefix}-${sanitized}${suffix}`
  }
  return `${prefix}-${sanitized.slice(0, PANEL_ID_PATH_KEEP)}-${stablePathDigest(filePath)}${suffix}`
}

/** Sanitized-path length above which {@link buildPanelId} shortens the id. */
const PANEL_ID_PATH_BUDGET = 180

/** How much of the sanitized path a shortened id keeps, for readability. */
const PANEL_ID_PATH_KEEP = 150

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
 * Panel identity is per **path string**: the id is the sanitized path (plus
 * a digest of the raw path once it passes the length budget, see
 * {@link buildPanelId}), so `/proj/Icon.svg` and `/proj/icon.svg` are two
 * panels even on a case-insensitive volume. Harmless – the watcher keys by
 * path too, and watches are subscriber-counted.
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
 * The path a panel shows, from its params – never from its id.
 *
 * @param panel - Any dockview panel.
 * @returns `params.filePath` when it is a string, otherwise `undefined`.
 */
function readFilePathParam(panel: IDockviewPanel): string | undefined {
  const value = (panel.params as { filePath?: unknown } | undefined)?.filePath
  return typeof value === 'string' ? value : undefined
}

/**
 * Finds the preview tab in this window that shows a file (issue #124, part 3 §3.4).
 *
 * Reads each preview panel's `params.filePath` – the page the tab shows now –
 * and never its id, because a tab that moved keeps the id it was minted with.
 * Paths compare with {@link pathsEqual}: separators normalised, case-folded on
 * Windows. Only panels on the preview component count; an editor tab showing
 * the same file is a different kind of tab.
 *
 * One dockview api per window, so other windows are never searched.
 *
 * @param dockviewApi - The editor-area dockview API.
 * @param filePath - Project-space path of the page.
 * @returns The first preview panel showing the file, or `undefined`.
 *
 * @example
 * ```ts
 * // After tab `preview-…-a-html` moved to b.html:
 * findPreviewTabShowing(api, '/proj/b.html')?.id  // 'preview-…-a-html'
 * findPreviewTabShowing(api, '/proj/a.html')      // undefined
 * ```
 */
export function findPreviewTabShowing(
  dockviewApi: Pick<DockviewApi, 'panels'>,
  filePath: string
): IDockviewPanel | undefined {
  const component = PANEL_KIND_DESCRIPTORS.preview.component
  return dockviewApi.panels.find(
    (panel) =>
      panel.view.contentComponent === component &&
      pathsEqual(readFilePathParam(panel), filePath)
  )
}

/**
 * Finds every editor tab in this window that shows a file (issue #124, part 3 §3.6).
 *
 * The editor-side twin of {@link findPreviewTabShowing}, with the same rules:
 * it reads `params.filePath`, never the id, compares with {@link pathsEqual},
 * and counts only panels on the editor component – a preview or an image tab of
 * the same file is a different kind of tab. Unlike previews, a file can be open
 * in more than one editor tab, so it returns them all.
 *
 * @param dockviewApi - The editor-area dockview API, or any panel pool.
 * @param filePath - Project-space path of the file.
 * @returns The editor panels showing the file, in dockview's order; empty when none.
 *
 * @example
 * ```ts
 * // Before a same-tab move to b.html: which editors would have to close?
 * findEditorTabsShowing(api, '/proj/b.html').map((panel) => panel.id)
 * ```
 */
export function findEditorTabsShowing(
  dockviewApi: Pick<DockviewApi, 'panels'>,
  filePath: string
): IDockviewPanel[] {
  const component = PANEL_KIND_DESCRIPTORS.editor.component
  return dockviewApi.panels.filter(
    (panel) =>
      panel.view.contentComponent === component &&
      pathsEqual(readFilePathParam(panel), filePath)
  )
}

/**
 * Mints the id for a NEW preview of a file: the smallest variant that no panel
 * in this window holds.
 *
 * Variant 0 is the id a preview of this path has always had; it is taken only
 * when a tab minted for this file has since moved to another page. Bounded: n
 * panels hold at most n ids, so one of the first n + 1 variants is free.
 *
 * @param dockviewApi - The editor-area dockview API.
 * @param filePath - Absolute path to the file.
 * @returns A preview panel id no panel in this window holds.
 */
function mintPreviewPanelId(dockviewApi: DockviewApi, filePath: string): string {
  const limit = dockviewApi.panels.length
  for (let variant = 0; variant < limit; variant++) {
    const id = buildPanelId('preview', filePath, variant)
    if (!dockviewApi.getPanel(id)) return id
  }
  return buildPanelId('preview', filePath, limit)
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
 * "An existing tab" means, for a preview, the tab that shows the file NOW
 * ({@link findPreviewTabShowing}); for an editor or an image, the panel with
 * the file's id.
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

  // One file, one preview tab – and the tab that shows it may carry another
  // file's id after a same-tab move, so previews are found by their page.
  const existing =
    kind === 'preview'
      ? findPreviewTabShowing(dockviewApi, filePath)
      : dockviewApi.getPanel(buildPanelId(kind, filePath))
  if (existing) {
    existing.api.setActive()
    if (focusOnReuse) existing.group.focus()
    logger.info('Activated existing panel', { filePath, panelId: existing.id })
    return existing
  }

  const panelId =
    kind === 'preview' ? mintPreviewPanelId(dockviewApi, filePath) : buildPanelId(kind, filePath)

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
