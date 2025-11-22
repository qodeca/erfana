/**
 * Tabs Module
 *
 * Chrome-style dynamic tab components for DockviewReact:
 * - EditorTab: Custom tab with dirty indicator, close button, and context menu
 * - useTabContextMenu: Hook for context menu items
 * - tabOperations: Utility functions for tab management
 */

export { EditorTab } from './EditorTab'
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
