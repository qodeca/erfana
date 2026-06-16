// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * EditorTab Component
 *
 * Chrome-style tab component for editor panels with:
 * - Dynamic sizing (min 50px, max 240px)
 * - Filename display with text truncation
 * - Dirty indicator (filled circle) for unsaved changes
 * - Close button with confirmation for dirty files
 * - Middle-click to close
 * - Context menu (Close, Close Others, Close All)
 * - Native tooltip showing filename and relative path
 */

import { useState, useCallback, MouseEvent } from 'react'
import { X } from 'lucide-react'
import { IDockviewPanelHeaderProps } from 'dockview'
import { useProjectStore } from '../../stores/useProjectStore'
import { useDialog } from '../Dialog'
import { ContextMenu } from '../ContextMenu/ContextMenu'
import { useTabContextMenu } from './useTabContextMenu'
import { useProjectManagementContext } from '../../context/ProjectManagementContext'
import { TEST_IDS, getDynamicTestId } from '../../constants/testids'
import { getBasename, getDisplayRelativePath } from '../../utils/fileUtils'
import './EditorTab.css'

interface EditorTabParams {
  filePath?: string
  panelId?: string
}

export function EditorTab(props: IDockviewPanelHeaderProps<EditorTabParams>) {
  const { api, params } = props
  const filePath = params?.filePath || ''
  const panelId = params?.panelId || api.id

  // Get dirty state from store using selector pattern for performance
  const isDirty = useProjectStore((state) => state.dirtyPanelIds.has(panelId))

  // Get project path for relative path calculation
  const { projectPath } = useProjectManagementContext()

  // Dialog for confirmation
  const { showConfirm } = useDialog()

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

  // Get context menu items
  const contextMenuItems = useTabContextMenu(panelId, () => setContextMenu(null))

  // Get filename and tooltip content with relative path
  const fileName = getBasename(filePath) || 'Untitled'
  const relativePath = getDisplayRelativePath(filePath, projectPath)
  const tooltipContent = `${fileName}\n${relativePath}`

  /**
   * Handle close with dirty file confirmation
   */
  const handleClose = useCallback(
    async (e?: MouseEvent) => {
      e?.stopPropagation()

      if (isDirty) {
        const confirmed = await showConfirm({
          title: 'Unsaved Changes',
          message: `File "${fileName}" has unsaved changes. Close anyway?`,
          confirmLabel: 'Close Without Saving',
          danger: true
        })

        if (!confirmed) return
      }

      // Mark as clean before closing to prevent stale state
      useProjectStore.getState().setEditorDirty(panelId, false)
      api.close()
    },
    [api, isDirty, fileName, panelId, showConfirm]
  )

  /**
   * Handle middle-click to close
   */
  const handleAuxClick = useCallback(
    (e: MouseEvent) => {
      if (e.button === 1) {
        // Middle mouse button
        e.preventDefault()
        handleClose()
      }
    },
    [handleClose]
  )

  /**
   * Handle context menu (right-click)
   */
  const handleContextMenu = useCallback((e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }, [])

  /**
   * Handle drag start - prevent default for tab component
   */
  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  return (
    <>
      <div
        className="editor-tab"
        title={tooltipContent}
        onAuxClick={handleAuxClick}
        onContextMenu={handleContextMenu}
        draggable={false}
        onDragStart={handleDragStart}
        onDrag={handleDragStart}
        data-testid={getDynamicTestId(TEST_IDS.TAB_ITEM, filePath)}
      >
        <span className="editor-tab-label" data-testid={getDynamicTestId(TEST_IDS.TAB_LABEL, filePath)}>
          {isDirty && (
            <span
              className="editor-tab-dirty-indicator"
              aria-label="Unsaved changes"
              data-testid={getDynamicTestId(TEST_IDS.TAB_DIRTY, filePath)}
            />
          )}
          <span className="editor-tab-filename">{fileName}</span>
        </span>

        <button
          className="editor-tab-close"
          onClick={handleClose}
          title="Close"
          aria-label={`Close ${fileName}`}
          data-testid={getDynamicTestId(TEST_IDS.TAB_CLOSE, filePath)}
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>

      {/* Context menu */}
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
