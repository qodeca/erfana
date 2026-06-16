// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tab Operations
 *
 * Utility functions for tab management in DockviewReact:
 * - closeTab: Close a single tab with dirty file confirmation
 * - closeOtherTabs: Close all tabs except the specified one
 * - closeAllTabs: Close all editor tabs
 *
 * All operations handle dirty file confirmation via the dialog system.
 */

import type { DockviewApi } from 'dockview'
import { useProjectStore } from '../../stores/useProjectStore'
import { getBasename } from '../../utils/fileUtils'

/**
 * Get all editor panel IDs from dockview API
 * Excludes the welcome placeholder panel
 */
export function getEditorPanelIds(api: DockviewApi): string[] {
  const panels = api.panels
  return panels
    .filter((panel) => panel.id !== '_center-placeholder')
    .map((panel) => panel.id)
}

/**
 * Check if a panel has unsaved changes
 */
export function isPanelDirty(panelId: string): boolean {
  return useProjectStore.getState().dirtyPanelIds.has(panelId)
}

/**
 * Get dirty panels from a list of panel IDs
 */
export function getDirtyPanels(panelIds: string[]): string[] {
  const dirtyPanelIds = useProjectStore.getState().dirtyPanelIds
  return panelIds.filter((id) => dirtyPanelIds.has(id))
}

/**
 * Close a single panel by ID
 * Does NOT handle dirty confirmation - caller should handle it
 */
export function closePanel(api: DockviewApi, panelId: string): void {
  const panel = api.getPanel(panelId)
  if (panel) {
    // Clear dirty state before closing
    useProjectStore.getState().setEditorDirty(panelId, false)
    panel.api.close()
  }
}

/**
 * Close multiple panels by IDs
 * Does NOT handle dirty confirmation - caller should handle it
 */
export function closePanels(api: DockviewApi, panelIds: string[]): void {
  for (const panelId of panelIds) {
    closePanel(api, panelId)
  }
}

/**
 * Get panels to close for "Close Others" operation
 */
export function getOtherPanelIds(api: DockviewApi, currentPanelId: string): string[] {
  return getEditorPanelIds(api).filter((id) => id !== currentPanelId)
}

/**
 * Extract filename from panel ID
 * Panel IDs are formatted as "editor-<sanitized-path>"
 */
export function getFilenameFromPanelId(panelId: string): string {
  // Try to get from panel params first
  const api = useProjectStore.getState().dockviewApi
  if (api) {
    const panel = api.getPanel(panelId)
    if (panel) {
      const params = panel.params as { filePath?: string } | undefined
      if (params?.filePath) {
        return getBasename(params.filePath) || 'Untitled'
      }
    }
  }

  // Fallback: extract from panel ID
  const match = panelId.match(/^editor-(.+)$/)
  if (match) {
    const path = match[1]
    return path.split('-').pop() || 'Untitled'
  }

  return 'Untitled'
}

/**
 * Build confirmation message for closing multiple dirty files
 */
export function buildDirtyFilesMessage(dirtyPanelIds: string[]): string {
  const count = dirtyPanelIds.length
  if (count === 0) return ''

  if (count === 1) {
    const filename = getFilenameFromPanelId(dirtyPanelIds[0])
    return `File "${filename}" has unsaved changes. Close anyway?`
  }

  const filenames = dirtyPanelIds.map(getFilenameFromPanelId).join(', ')
  return `${count} files have unsaved changes: ${filenames}. Close anyway?`
}
