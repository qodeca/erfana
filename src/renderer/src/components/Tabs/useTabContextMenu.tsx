// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * useTabContextMenu Hook
 *
 * Provides context menu items for editor tabs:
 * - Close: Close the current tab
 * - Close Others: Close all tabs except current
 * - Close All: Close all editor tabs
 *
 * All operations handle dirty file confirmation via the dialog system.
 */

import { useMemo, useCallback } from 'react'
import { X, XCircle, Trash2 } from 'lucide-react'
import { useProjectStore } from '../../stores/useProjectStore'
import { useDialog } from '../Dialog'
import type { ContextMenuItem } from '../ContextMenu/ContextMenu'
import {
  getOtherPanelIds,
  getEditorPanelIds,
  getDirtyPanels,
  closePanels,
  closePanel,
  buildDirtyFilesMessage,
  isPanelDirty,
  getFilenameFromPanelId
} from './tabOperations'

/**
 * Hook to generate context menu items for editor tabs
 *
 * @param panelId - The ID of the panel that was right-clicked
 * @param onMenuClose - Callback to close the context menu after action
 * @returns Array of context menu items
 */
export function useTabContextMenu(panelId: string, onMenuClose: () => void): ContextMenuItem[] {
  const { showConfirm } = useDialog()
  const dockviewApi = useProjectStore((state) => state.dockviewApi)

  /**
   * Close the current tab with dirty confirmation
   */
  const handleClose = useCallback(async () => {
    onMenuClose()

    if (!dockviewApi) return

    const isDirty = isPanelDirty(panelId)
    if (isDirty) {
      const filename = getFilenameFromPanelId(panelId)
      const confirmed = await showConfirm({
        title: 'Unsaved Changes',
        message: `File "${filename}" has unsaved changes. Close anyway?`,
        confirmLabel: 'Close Without Saving',
        danger: true
      })

      if (!confirmed) return
    }

    closePanel(dockviewApi, panelId)
  }, [dockviewApi, panelId, showConfirm, onMenuClose])

  /**
   * Close all tabs except the current one with dirty confirmation
   */
  const handleCloseOthers = useCallback(async () => {
    onMenuClose()

    if (!dockviewApi) return

    const otherPanelIds = getOtherPanelIds(dockviewApi, panelId)
    if (otherPanelIds.length === 0) return

    const dirtyPanels = getDirtyPanels(otherPanelIds)
    if (dirtyPanels.length > 0) {
      const message = buildDirtyFilesMessage(dirtyPanels)
      const confirmed = await showConfirm({
        title: 'Unsaved Changes',
        message,
        confirmLabel: 'Close Without Saving',
        danger: true
      })

      if (!confirmed) return
    }

    closePanels(dockviewApi, otherPanelIds)
  }, [dockviewApi, panelId, showConfirm, onMenuClose])

  /**
   * Close all editor tabs with dirty confirmation
   */
  const handleCloseAll = useCallback(async () => {
    onMenuClose()

    if (!dockviewApi) return

    const allPanelIds = getEditorPanelIds(dockviewApi)
    if (allPanelIds.length === 0) return

    const dirtyPanels = getDirtyPanels(allPanelIds)
    if (dirtyPanels.length > 0) {
      const message = buildDirtyFilesMessage(dirtyPanels)
      const confirmed = await showConfirm({
        title: 'Unsaved Changes',
        message,
        confirmLabel: 'Close All Without Saving',
        danger: true
      })

      if (!confirmed) return
    }

    closePanels(dockviewApi, allPanelIds)
  }, [dockviewApi, showConfirm, onMenuClose])

  // Build context menu items
  const items = useMemo((): ContextMenuItem[] => {
    const otherCount = dockviewApi ? getOtherPanelIds(dockviewApi, panelId).length : 0
    const allCount = dockviewApi ? getEditorPanelIds(dockviewApi).length : 0

    return [
      {
        label: 'Close',
        icon: <X size={14} />,
        action: handleClose
      },
      {
        label: 'Close Others',
        icon: <XCircle size={14} />,
        action: handleCloseOthers,
        disabled: otherCount === 0
      },
      {
        label: '',
        action: () => {},
        separator: true
      },
      {
        label: 'Close All',
        icon: <Trash2 size={14} />,
        action: handleCloseAll,
        danger: allCount > 1
      }
    ]
  }, [dockviewApi, panelId, handleClose, handleCloseOthers, handleCloseAll])

  return items
}
