// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HtmlPreviewTab Component (Issue #74, work item 72).
 *
 * Tab header for the running HTML preview panel. Mirrors {@link ImageTab}:
 * an icon distinguishing it from editor/image tabs, the filename (from the
 * panel's live title so a "(deleted)" marker reaches a background tab), a
 * hover-revealed close button, middle-click close, a right-click context
 * menu and keyboard focus.
 *
 * Unlike EditorTab there is no dirty indicator — a preview is a rendered view
 * of a file on disk, never an unsaved buffer.
 *
 * @module HtmlPreviewTab
 * @see Issue #74 - HTML preview with CSS and JavaScript execution
 * @see ImageTab for the sibling read-only tab this mirrors
 */

import { useState, useCallback, useMemo, MouseEvent } from 'react'
import { X, Globe } from 'lucide-react'
import { IDockviewPanelHeaderProps } from 'dockview'
import { ContextMenu } from '../ContextMenu/ContextMenu'
import { useTabContextMenu } from './useTabContextMenu'
import { useTabTitle } from './useTabTitle'
import { useProjectManagementContext } from '../../context/ProjectManagementContext'
import { PreviewFailureBadge } from '../Panels/HtmlPreviewPanel/components'
import { summarizeFailures } from '../Panels/HtmlPreviewPanel/htmlPreview.logic'
import { usePreviewStore } from '../../stores/usePreviewStore'
import { getBasename, getDisplayRelativePath } from '../../utils/fileUtils'
import { DELETED_TAB_MARKER } from '../../utils/tabTitle'
import type { PreviewFailure } from '../../../../shared/ipc/preview-schema'
import './HtmlPreviewTab.css'

/** Stable empty failure list — a fresh `[]` per render would loop the store hook. */
const NO_FAILURES: PreviewFailure[] = []

/**
 * Parameters passed to {@link HtmlPreviewTab} via dockview.
 */
interface HtmlPreviewTabParams {
  /** Absolute path to the previewed `.html` file. */
  filePath?: string
  /** Unique panel identifier. */
  panelId?: string
}

/**
 * Tab header component for the running HTML preview panel.
 *
 * ARIA tab semantics (`role="tab"`, `aria-selected`, `tabindex`) are owned by
 * dockview's tablist container; this component renders the tab content only.
 *
 * @param props - Dockview panel header props with `filePath` in `params`.
 * @returns The rendered preview tab.
 *
 * @example
 * ```tsx
 * // Registered in EditorAreaSplitPanel tabComponents
 * const tabComponents = { htmlPreviewTab: HtmlPreviewTab }
 * ```
 */
export function HtmlPreviewTab(props: IDockviewPanelHeaderProps<HtmlPreviewTabParams>): JSX.Element {
  const { api, params } = props
  const filePath = params?.filePath || ''
  const panelId = params?.panelId || api.id

  const { projectPath } = useProjectManagementContext()

  // Subscribe to THIS panel's failure list from the preview store. The panel
  // itself is painted over by the native view, so the failure indicator lives
  // here — always-DOM tab chrome — instead (AC7/AC10/AC20, design §1.8). Select
  // the stored array reference (stable) and fall back outside the selector, so
  // `useSyncExternalStore` never sees a fresh `[]` and loops.
  const failures = usePreviewStore((s) => s.panels.get(panelId)?.failures) ?? NO_FAILURES
  const failureSummary = useMemo(() => summarizeFailures(failures), [failures])

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  // The same close items every tab gets, and nothing else.
  //
  // "Export as PDF" used to be prepended here, because the panel surface is
  // painted over by the native view and the tab was the only chrome that
  // survived (UX-003). The preview now has a toolbar of its own above the view,
  // which is where the markdown editor has always kept its export button — so
  // the affordance moved there and this menu went back to being the ordinary
  // one. An export hidden behind a right-click on a tab handle is an export
  // nobody finds.
  const contextMenuItems = useTabContextMenu(panelId, () => setContextMenu(null))

  // The label comes from the panel's live title, not the path, so the viewer's
  // "(deleted)" marker reaches the screen for a background tab (issue #70/#74).
  const fileName = getBasename(filePath) || 'Preview'
  const { label, isDeleted } = useTabTitle(api, fileName)
  const relativePath = getDisplayRelativePath(filePath, projectPath)
  const tooltipContent = isDeleted
    ? `${fileName} ${DELETED_TAB_MARKER}\n${relativePath}`
    : `${fileName}\n${relativePath}`

  /** Close the tab. No confirmation — a preview has no unsaved state. */
  const handleClose = useCallback(
    (e?: MouseEvent) => {
      e?.stopPropagation()
      api.close()
    },
    [api]
  )

  /** Middle-click closes the tab. */
  const handleAuxClick = useCallback(
    (e: MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault()
        handleClose()
      }
    },
    [handleClose]
  )

  /** Right-click opens the shared tab context menu. */
  const handleContextMenu = useCallback((e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }, [])

  /** Prevent native drag (dockview DnD is disabled; this belts-and-braces it). */
  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  return (
    <>
      <div
        className="html-preview-tab"
        title={tooltipContent}
        onAuxClick={handleAuxClick}
        onContextMenu={handleContextMenu}
        draggable={false}
        onDragStart={handleDragStart}
        onDrag={handleDragStart}
      >
        <span className="html-preview-tab-icon" aria-hidden="true">
          <Globe size={14} />
        </span>

        <span className="html-preview-tab-label">
          {label}
          {isDeleted && <span className="html-preview-tab-deleted"> {DELETED_TAB_MARKER}</span>}
        </span>

        <PreviewFailureBadge summary={failureSummary} />

        <button
          className="html-preview-tab-close"
          onClick={handleClose}
          title="Close"
          aria-label={`Close ${fileName}`}
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  )
}
