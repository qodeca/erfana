/**
 * Test ID Constants for UI Testing
 *
 * Centralized `data-testid` attribute values for automated UI testing.
 * These constants ensure consistent, compile-time checked testid usage
 * across the entire application.
 *
 * @see BRS-011 - Automated UI testing compatibility
 * @see docs/testing/e2e-testing.md - Testing documentation
 *
 * @example Static testid usage
 * ```tsx
 * import { TEST_IDS } from '@/constants/testids';
 *
 * <button data-testid={TEST_IDS.ACTIVITY_BAR_BTN_FILES}>
 *   Files
 * </button>
 * ```
 *
 * @example Dynamic testid usage (for file paths)
 * ```tsx
 * import { TEST_IDS, getDynamicTestId } from '@/constants/testids';
 *
 * <div data-testid={getDynamicTestId(TEST_IDS.PROJECT_TREE_NODE, filePath)}>
 *   {fileName}
 * </div>
 * ```
 */

/**
 * All static test ID values organized by component.
 *
 * Naming convention: `{component}-{element}-{identifier?}`
 * - Component prefix matches component name (kebab-case)
 * - Buttons use `-btn-` short form
 * - All values are lowercase with hyphens
 *
 * NOTE: Component counts in comments (e.g., "// Activity Bar (5)") are validated
 * by automated tests in testids.test.ts. If a count comment becomes stale, the
 * tests will fail and prompt an update.
 */
export const TEST_IDS = {
  // =========================================================================
  // Activity Bar (5)
  // =========================================================================

  /** Activity bar container */
  ACTIVITY_BAR: 'activity-bar',
  /** Files panel toggle button */
  ACTIVITY_BAR_BTN_FILES: 'activity-bar-btn-files',
  /** Terminal panel toggle button */
  ACTIVITY_BAR_BTN_TERMINAL: 'activity-bar-btn-terminal',
  /** Settings overlay toggle button */
  ACTIVITY_BAR_BTN_SETTINGS: 'activity-bar-btn-settings',
  /** Theme toggle button */
  ACTIVITY_BAR_BTN_THEME: 'activity-bar-btn-theme',

  // =========================================================================
  // Project Tree (8)
  // =========================================================================

  /** Project tree container */
  PROJECT_TREE: 'project-tree',
  /** Empty state when no project is open */
  PROJECT_TREE_EMPTY: 'project-tree-empty',
  /** Open project button */
  PROJECT_TREE_BTN_OPEN: 'project-tree-btn-open',
  /** Close project button */
  PROJECT_TREE_BTN_CLOSE: 'project-tree-btn-close',
  /** New file button */
  PROJECT_TREE_BTN_NEW_FILE: 'project-tree-btn-new-file',
  /** New folder button */
  PROJECT_TREE_BTN_NEW_FOLDER: 'project-tree-btn-new-folder',
  /** Tree node (file or folder) - use with getDynamicTestId */
  PROJECT_TREE_NODE: 'project-tree-node',
  /** Tree node expand/collapse toggle - use with getDynamicTestId */
  PROJECT_TREE_TOGGLE: 'project-tree-toggle',

  // =========================================================================
  // Git Status Bar (4)
  // =========================================================================

  /** Git status bar container */
  GIT_STATUS_BAR: 'git-status-bar',
  /** Current branch name display */
  GIT_BRANCH_NAME: 'git-branch-name',
  /** Modified/staged/untracked file counts */
  GIT_STATUS_COUNTS: 'git-status-counts',
  /** Sync status indicator */
  GIT_SYNC_INDICATOR: 'git-sync-indicator',

  // =========================================================================
  // Terminal Panel (6)
  // =========================================================================

  /** Terminal panel container */
  TERMINAL_PANEL: 'terminal-panel',
  /** Terminal xterm.js instance wrapper */
  TERMINAL_INSTANCE: 'terminal-instance',
  /** Scroll to bottom button */
  TERMINAL_BTN_SCROLL: 'terminal-btn-scroll',
  /** Restart terminal button */
  TERMINAL_BTN_RESTART: 'terminal-btn-restart',
  /** Scroll lock toggle button */
  TERMINAL_BTN_LOCK: 'terminal-btn-lock',
  /** Terminal status indicator */
  TERMINAL_STATUS: 'terminal-status',

  // =========================================================================
  // Editor Content Layout (5)
  // =========================================================================

  /** Editor content container (includes editor and preview) */
  EDITOR_CONTENT: 'editor-content',
  /** Editor pane wrapper (left side in split view) */
  EDITOR_PANE: 'editor-pane',
  /** Preview pane wrapper (right side in split view) */
  PREVIEW_PANE: 'preview-pane',
  /** Monaco editor wrapper */
  EDITOR_MONACO: 'editor-monaco',
  /** Markdown preview container */
  EDITOR_PREVIEW: 'editor-preview',

  // =========================================================================
  // Dialogs - Base (3)
  // =========================================================================

  /** Dialog backdrop overlay */
  DIALOG_OVERLAY: 'dialog-overlay',
  /** Dialog container (the modal box) */
  DIALOG_CONTAINER: 'dialog-container',
  /** Dialog title text */
  DIALOG_TITLE: 'dialog-title',

  // =========================================================================
  // Dialogs - Confirm (4)
  // =========================================================================

  /** Confirm dialog container */
  DIALOG_CONFIRM: 'dialog-confirm',
  /** Confirm dialog message text */
  DIALOG_CONFIRM_MESSAGE: 'dialog-confirm-message',
  /** Confirm action button (positive action) */
  DIALOG_BTN_CONFIRM: 'dialog-btn-confirm',
  /** Cancel action button */
  DIALOG_BTN_CANCEL: 'dialog-btn-cancel',

  // =========================================================================
  // Dialogs - Alert (3)
  // =========================================================================

  /** Alert dialog container */
  DIALOG_ALERT: 'dialog-alert',
  /** Alert dialog message text */
  DIALOG_ALERT_MESSAGE: 'dialog-alert-message',
  /** OK/dismiss button */
  DIALOG_BTN_OK: 'dialog-btn-ok',

  // =========================================================================
  // Dialogs - Prompt (4)
  // =========================================================================

  /** Prompt dialog container */
  DIALOG_PROMPT: 'dialog-prompt',
  /** Prompt dialog message text */
  DIALOG_PROMPT_MESSAGE: 'dialog-prompt-message',
  /** Text input field */
  DIALOG_PROMPT_INPUT: 'dialog-prompt-input',
  /** Dropdown select (e.g., diagram type) */
  DIALOG_PROMPT_DROPDOWN: 'dialog-prompt-dropdown',

  // =========================================================================
  // Dialogs - File Picker (5)
  // =========================================================================

  /** File picker dialog container */
  FILE_PICKER: 'file-picker',
  /** File list container */
  FILE_PICKER_LIST: 'file-picker-list',
  /** File list item - use with getDynamicTestId */
  FILE_PICKER_ITEM: 'file-picker-item',
  /** Select file button */
  FILE_PICKER_BTN_SELECT: 'file-picker-btn-select',
  /** Cancel button */
  FILE_PICKER_BTN_CANCEL: 'file-picker-btn-cancel',

  // =========================================================================
  // Context Menu - Base (2)
  // =========================================================================

  /** Context menu container */
  CONTEXT_MENU: 'context-menu',
  /** Context menu separator line */
  CONTEXT_MENU_SEPARATOR: 'context-menu-separator',

  // =========================================================================
  // Context Menu - Terminal (3)
  // =========================================================================

  /** Terminal context menu container */
  CONTEXT_MENU_TERMINAL: 'context-menu-terminal',
  /** Copy action menu item */
  CONTEXT_MENU_ITEM_COPY: 'context-menu-item-copy',
  /** Paste action menu item */
  CONTEXT_MENU_ITEM_PASTE: 'context-menu-item-paste',

  // =========================================================================
  // Context Menu - Editor/Preview (7)
  // =========================================================================

  /** Editor context menu container */
  CONTEXT_MENU_EDITOR: 'context-menu-editor',
  /** Preview context menu container */
  CONTEXT_MENU_PREVIEW: 'context-menu-preview',
  /** Elaborate prompt action */
  CONTEXT_MENU_ITEM_ELABORATE: 'context-menu-item-elaborate',
  /** Modify prompt action */
  CONTEXT_MENU_ITEM_MODIFY: 'context-menu-item-modify',
  /** Ask prompt action */
  CONTEXT_MENU_ITEM_ASK: 'context-menu-item-ask',
  /** Visualize prompt action */
  CONTEXT_MENU_ITEM_VISUALIZE: 'context-menu-item-visualize',
  /** Cut action (editor) */
  CONTEXT_MENU_ITEM_CUT: 'context-menu-item-cut',

  // =========================================================================
  // Diagram Viewer (5)
  // =========================================================================

  /** Full-screen diagram viewer overlay */
  DIAGRAM_VIEWER: 'diagram-viewer',
  /** Close viewer button */
  DIAGRAM_VIEWER_BTN_CLOSE: 'diagram-viewer-btn-close',
  /** Diagram content container */
  DIAGRAM_VIEWER_CONTENT: 'diagram-viewer-content',
  /** Rendered SVG element wrapper */
  DIAGRAM_VIEWER_SVG: 'diagram-viewer-svg',
  /** Open chat button */
  DIAGRAM_VIEWER_BTN_CHAT: 'diagram-viewer-btn-chat',

  // =========================================================================
  // Chat Bubble (15)
  // =========================================================================

  /** Chat bubble container */
  CHAT_BUBBLE: 'chat-bubble',
  /** Open chat panel button */
  CHAT_BUBBLE_BTN_OPEN: 'chat-bubble-btn-open',
  /** Chat panel container */
  CHAT_PANEL: 'chat-panel',
  /** Chat input textarea */
  CHAT_TEXTAREA: 'chat-textarea',
  /** Send message button */
  CHAT_BTN_SEND: 'chat-btn-send',
  /** Zoom in button */
  CHAT_BTN_ZOOM_IN: 'chat-btn-zoom-in',
  /** Zoom out button */
  CHAT_BTN_ZOOM_OUT: 'chat-btn-zoom-out',
  /** Fit to screen button */
  CHAT_BTN_FIT: 'chat-btn-fit',
  /** Reset zoom button */
  CHAT_BTN_RESET: 'chat-btn-reset',
  /**
   * Direction change button prefix - use with direction suffix.
   * Pattern: `${CHAT_DIRECTION_BTN}-${direction}` (e.g., 'chat-direction-btn-TB', 'chat-direction-btn-LR')
   */
  CHAT_DIRECTION_BTN: 'chat-direction-btn',
  /** Scroll to bottom button */
  CHAT_BTN_SCROLL_BOTTOM: 'chat-btn-scroll-bottom',
  /** Restart diagram button */
  CHAT_BTN_RESTART: 'chat-btn-restart',
  /** Scroll lock toggle */
  CHAT_BTN_SCROLL_LOCK: 'chat-btn-scroll-lock',
  /** Current zoom level indicator */
  CHAT_ZOOM_INDICATOR: 'chat-zoom-indicator',
  /** Character count display */
  CHAT_CHARACTER_COUNT: 'chat-character-count',

  // =========================================================================
  // Mermaid Toolbar (4)
  // =========================================================================

  /** Mermaid diagram toolbar container */
  MERMAID_TOOLBAR: 'mermaid-toolbar',
  /** Direction toggle button */
  MERMAID_DIRECTION_BTN: 'mermaid-direction-btn',
  /** Expand to full-screen button */
  MERMAID_BTN_EXPAND: 'mermaid-btn-expand',
  /** Direction options button group */
  MERMAID_DIRECTIONS_GROUP: 'mermaid-directions-group',

  // =========================================================================
  // Editor Tabs (6)
  // =========================================================================

  /** Tab bar container (Dockview-managed, may not be directly accessible) */
  TAB_BAR: 'tab-bar',
  /** Tab item - use with getDynamicTestId */
  TAB_ITEM: 'tab-item',
  /** Tab close button - use with getDynamicTestId */
  TAB_CLOSE: 'tab-close',
  /** Tab label text - use with getDynamicTestId */
  TAB_LABEL: 'tab-label',
  /** Unsaved changes indicator - use with getDynamicTestId */
  TAB_DIRTY: 'tab-dirty',
  /** Active tab marker - use with getDynamicTestId on active tab */
  TAB_ACTIVE: 'tab-active',

  // =========================================================================
  // Search Bar (8)
  // =========================================================================

  /** Search bar container */
  SEARCH_BAR: 'search-bar',
  /** Search input field */
  SEARCH_BAR_INPUT: 'search-bar-input',
  /** Case sensitivity toggle */
  SEARCH_BAR_TOGGLE_CASE: 'search-bar-toggle-case',
  /** Whole word toggle */
  SEARCH_BAR_TOGGLE_WORD: 'search-bar-toggle-word',
  /** Previous match button */
  SEARCH_BAR_BTN_PREV: 'search-bar-btn-prev',
  /** Next match button */
  SEARCH_BAR_BTN_NEXT: 'search-bar-btn-next',
  /** Close search button */
  SEARCH_BAR_BTN_CLOSE: 'search-bar-btn-close',
  /** Match count display (e.g., "3 of 10") */
  SEARCH_BAR_COUNT: 'search-bar-count',

  // =========================================================================
  // Toast Notification (4)
  // =========================================================================

  /** Toast notifications container */
  TOAST_CONTAINER: 'toast-container',
  /** Individual toast notification */
  TOAST: 'toast',
  /** Toast message text */
  TOAST_MESSAGE: 'toast-message',
  /** Toast dismiss button */
  TOAST_BTN_DISMISS: 'toast-btn-dismiss',

  // =========================================================================
  // Settings Overlay (10)
  // =========================================================================

  /** Settings overlay container */
  SETTINGS_OVERLAY: 'settings-overlay',
  /** Close settings button */
  SETTINGS_BTN_CLOSE: 'settings-btn-close',
  /** Editor settings section */
  SETTINGS_SECTION_EDITOR: 'settings-section-editor',
  /** Git settings section */
  SETTINGS_SECTION_GIT: 'settings-section-git',
  /** Logging settings section */
  SETTINGS_SECTION_LOGGING: 'settings-section-logging',
  /** Preserve line breaks toggle */
  SETTINGS_TOGGLE_LINE_BREAKS: 'settings-toggle-line-breaks',
  /** Git polling toggle */
  SETTINGS_TOGGLE_POLLING: 'settings-toggle-polling',
  /** Polling interval select */
  SETTINGS_SELECT_POLLING_INTERVAL: 'settings-select-polling-interval',
  /** Log level select */
  SETTINGS_SELECT_LOG_LEVEL: 'settings-select-log-level',
  /** Settings content container */
  SETTINGS_CONTAINER: 'settings-container',

  // =========================================================================
  // Document Stats Bar (6)
  // =========================================================================

  /** Document stats bar container */
  DOCUMENT_STATS_BAR: 'document-stats-bar',
  /** Word count display */
  STATS_WORDS: 'stats-words',
  /** Character count display */
  STATS_CHARACTERS: 'stats-characters',
  /** Line count display */
  STATS_LINES: 'stats-lines',
  /** Estimated reading time */
  STATS_READING_TIME: 'stats-reading-time',
  /** Selected text stats */
  STATS_SELECTION: 'stats-selection',

  // =========================================================================
  // Markdown Toolbar (20)
  // =========================================================================

  /** Markdown toolbar container */
  MARKDOWN_TOOLBAR: 'markdown-toolbar',
  /** Bold formatting button */
  TOOLBAR_BTN_BOLD: 'toolbar-btn-bold',
  /** Italic formatting button */
  TOOLBAR_BTN_ITALIC: 'toolbar-btn-italic',
  /** Strikethrough formatting button */
  TOOLBAR_BTN_STRIKETHROUGH: 'toolbar-btn-strikethrough',
  /** Inline code formatting button */
  TOOLBAR_BTN_CODE: 'toolbar-btn-code',
  /** Insert link button */
  TOOLBAR_BTN_LINK: 'toolbar-btn-link',
  /** Insert image button */
  TOOLBAR_BTN_IMAGE: 'toolbar-btn-image',
  /** Heading level button */
  TOOLBAR_BTN_HEADING: 'toolbar-btn-heading',
  /** Unordered list button */
  TOOLBAR_BTN_LIST: 'toolbar-btn-list',
  /** Ordered list button */
  TOOLBAR_BTN_LIST_ORDERED: 'toolbar-btn-list-ordered',
  /** Open search button */
  TOOLBAR_BTN_SEARCH: 'toolbar-btn-search',
  /** Unsaved changes indicator */
  MODIFIED_INDICATOR: 'modified-indicator',
  /** Autosave status indicator */
  AUTOSAVE_INDICATOR: 'autosave-indicator',
  /** External file change indicator */
  RELOAD_INDICATOR: 'reload-indicator',
  /** Editor-only view mode button */
  VIEW_MODE_BTN_EDITOR: 'view-mode-btn-editor',
  /** Horizontal split view mode button */
  VIEW_MODE_BTN_SPLIT_HORIZONTAL: 'view-mode-btn-split-horizontal',
  /** Vertical split view mode button */
  VIEW_MODE_BTN_SPLIT: 'view-mode-btn-split',
  /** Preview-only view mode button */
  VIEW_MODE_BTN_PREVIEW: 'view-mode-btn-preview',
  /** Export to PDF button */
  TOOLBAR_BTN_EXPORT_PDF: 'toolbar-btn-export-pdf',
  /** Export to DOCX button */
  TOOLBAR_BTN_EXPORT_DOCX: 'toolbar-btn-export-docx'
} as const

/**
 * Type representing any valid test ID value.
 * Useful for type-safe test ID parameters.
 *
 * @example
 * ```typescript
 * function getElement(testId: TestId): HTMLElement | null {
 *   return document.querySelector(`[data-testid="${testId}"]`);
 * }
 * ```
 */
export type TestId = (typeof TEST_IDS)[keyof typeof TEST_IDS]

/**
 * Generates a deterministic 8-character hash from a file path.
 *
 * Uses the djb2 algorithm for fast, synchronous hashing. This is preferred
 * over crypto APIs for browser-side test IDs because:
 * - Synchronous (no async/await in render)
 * - Deterministic across sessions
 * - Fast computation for large file trees
 * - 8 hex chars = 32 bits = collision-resistant for typical project sizes
 *
 * @param path - The file path to hash (relative or absolute)
 * @returns 8-character lowercase hexadecimal string
 *
 * @example
 * ```typescript
 * getPathHash('src/main/index.ts')  // e.g., 'a1b2c3d4'
 * getPathHash('')                    // '00001505' (hash of empty string)
 * ```
 */
export function getPathHash(path: string): string {
  // djb2 hash algorithm: hash(i) = hash(i-1) * 33 + c
  // Initial value 5381 chosen for good distribution properties
  let hash = 5381

  for (let i = 0; i < path.length; i++) {
    // Equivalent to: hash = hash * 33 + charCode
    // Using bit shift: (hash << 5) + hash = hash * 32 + hash = hash * 33
    hash = (hash << 5) + hash + path.charCodeAt(i)
    // Keep within 32-bit integer range
    hash = hash >>> 0
  }

  // Convert to 8-character hex string, padded with zeros
  return hash.toString(16).padStart(8, '0')
}

/**
 * Generates a dynamic test ID by combining a prefix with a path hash.
 *
 * Use this for elements that represent dynamic content like file nodes,
 * tabs, or list items where the identity is tied to a file path.
 *
 * @param prefix - Base test ID (should be from TEST_IDS)
 * @param path - File path to generate hash from
 * @returns Combined test ID in format `{prefix}-{hash}`
 *
 * @example
 * ```typescript
 * import { TEST_IDS, getDynamicTestId } from '@/constants/testids';
 *
 * // For a tree node representing 'src/main/index.ts'
 * const testId = getDynamicTestId(TEST_IDS.PROJECT_TREE_NODE, 'src/main/index.ts');
 * // Result: 'project-tree-node-a1b2c3d4'
 *
 * // In JSX:
 * <div data-testid={getDynamicTestId(TEST_IDS.TAB_ITEM, filePath)}>
 *   {fileName}
 * </div>
 * ```
 */
export function getDynamicTestId(prefix: TestId, path: string): string {
  return `${prefix}-${getPathHash(path)}`
}
