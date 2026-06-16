// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ImageTab Component
 *
 * Simple tab header for image viewer panels in Dockview.
 * Displays an image icon, filename, and close button.
 *
 * Unlike EditorTab, ImageTab has no dirty indicator since images
 * are read-only and don't have unsaved changes.
 *
 * Features:
 * - Image icon to distinguish from editor tabs
 * - Filename display with text truncation
 * - Close button visible on hover
 * - Middle-click to close
 * - Context menu (Close, Close Others, Close All)
 * - Keyboard accessible
 *
 * @module ImageTab
 * @see Spec #015 - Image preview viewer specification
 * @see EditorTab for editor panel tab implementation
 */

import { useState, useCallback, MouseEvent } from 'react'
import { X, ImageIcon } from 'lucide-react'
import { IDockviewPanelHeaderProps } from 'dockview'
import { ContextMenu } from '../ContextMenu/ContextMenu'
import { useTabContextMenu } from './useTabContextMenu'
import { useProjectManagementContext } from '../../context/ProjectManagementContext'
import { TEST_IDS, getDynamicTestId } from '../../constants/testids'
import { getBasename, getDisplayRelativePath } from '../../utils/fileUtils'
import './ImageTab.css'

// ============================================================================
// Types
// ============================================================================

/**
 * Parameters passed to ImageTab via Dockview.
 */
interface ImageTabParams {
  /** Absolute path to the image file */
  filePath?: string
  /** Unique panel identifier */
  panelId?: string
}

// ============================================================================
// Component
// ============================================================================

/**
 * Tab header component for image viewer panels.
 *
 * M7: ARIA tab semantics (role="tab", aria-selected, tabindex) are handled by
 * Dockview's parent container which manages the tablist. This component only
 * renders the tab content, not the accessibility wrapper.
 *
 * @param props - Dockview panel header props with filePath in params
 * @returns Rendered image tab
 *
 * @example
 * ```tsx
 * // Registered in AppDockLayout tabComponents
 * const tabComponents = {
 *   imageTab: ImageTab,
 * };
 * ```
 */
export function ImageTab(props: IDockviewPanelHeaderProps<ImageTabParams>) {
  const { api, params } = props
  const filePath = params?.filePath || ''
  const panelId = params?.panelId || api.id

  // Get project path for relative path calculation
  const { projectPath } = useProjectManagementContext()

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

  // Get context menu items using shared hook
  const contextMenuItems = useTabContextMenu(panelId, () => setContextMenu(null))

  // Derived values
  const fileName = getBasename(filePath) || 'Image'
  const relativePath = getDisplayRelativePath(filePath, projectPath)
  const tooltipContent = `${fileName}\n${relativePath}`

  /**
   * Handle close button click.
   * No confirmation needed since images are read-only.
   */
  const handleClose = useCallback(
    (e?: MouseEvent) => {
      e?.stopPropagation()
      api.close()
    },
    [api]
  )

  /**
   * Handle middle-click to close.
   */
  const handleAuxClick = useCallback(
    (e: MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault()
        handleClose()
      }
    },
    [handleClose]
  )

  /**
   * Handle right-click context menu.
   */
  const handleContextMenu = useCallback((e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }, [])

  /**
   * Prevent drag start on tab.
   */
  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  return (
    <>
      <div
        className="image-tab"
        title={tooltipContent}
        onAuxClick={handleAuxClick}
        onContextMenu={handleContextMenu}
        draggable={false}
        onDragStart={handleDragStart}
        onDrag={handleDragStart}
        data-testid={getDynamicTestId(TEST_IDS.IMAGE_TAB_ITEM, filePath)}
      >
        {/* Image icon */}
        <span className="image-tab-icon" aria-hidden="true">
          <ImageIcon size={14} />
        </span>

        {/* Filename */}
        <span
          className="image-tab-label"
          data-testid={getDynamicTestId(TEST_IDS.IMAGE_TAB_LABEL, filePath)}
        >
          {fileName}
        </span>

        {/* Close button */}
        <button
          className="image-tab-close"
          onClick={handleClose}
          title="Close"
          aria-label={`Close ${fileName}`}
          data-testid={getDynamicTestId(TEST_IDS.IMAGE_TAB_CLOSE, filePath)}
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
