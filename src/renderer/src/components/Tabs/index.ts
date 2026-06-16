// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tabs Module
 *
 * Chrome-style dynamic tab components for DockviewReact:
 * - EditorTab: Custom tab with dirty indicator, close button, and context menu
 * - ImageTab: Simple tab for image viewer panels (read-only, no dirty state)
 * - useTabContextMenu: Hook for context menu items
 * - tabOperations: Utility functions for tab management
 */

export { EditorTab } from './EditorTab'
export { ImageTab } from './ImageTab'
export { useTabContextMenu } from './useTabContextMenu'
export {
  getEditorPanelIds,
  getOtherPanelIds,
  getDirtyPanels,
  isPanelDirty,
  closePanel,
  closePanels,
  getFilenameFromPanelId,
  buildDirtyFilesMessage
} from './tabOperations'
