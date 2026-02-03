# E2E Selector Catalog

Complete catalog of all `data-testid` attributes available for E2E testing.

**Related documentation**:
- [E2E Testing Guide](./e2e-testing.md) - Main E2E documentation
- [Test ID constants](../../src/renderer/src/constants/testids.ts) - Source code
- Spec #011 (archived) – Specification

---

## Activity bar (5 testids)

| Testid | Element | Type |
|--------|---------|------|
| `activity-bar` | Container | static |
| `activity-bar-btn-files` | Files panel button | static |
| `activity-bar-btn-terminal` | Terminal panel button | static |
| `activity-bar-btn-settings` | Settings button | static |
| `activity-bar-btn-theme` | Theme toggle | static |

---

## Project tree (8 testids)

| Testid | Element | Type |
|--------|---------|------|
| `project-tree` | Container | static |
| `project-tree-empty` | Empty state | static |
| `project-tree-btn-open` | Open folder button | static |
| `project-tree-btn-close` | Close project button | static |
| `project-tree-btn-new-file` | New file button | static |
| `project-tree-btn-new-folder` | New folder button | static |
| `project-tree-node-{hash}` | Tree node | dynamic |
| `project-tree-toggle-{hash}` | Folder toggle | dynamic |

**Dynamic testid example**:
```typescript
import { getDynamicTestId, TEST_IDS } from '@/constants/testids'

// For file 'src/main/index.ts'
const testId = getDynamicTestId(TEST_IDS.PROJECT_TREE_NODE, 'src/main/index.ts')
// Result: 'project-tree-node-a1b2c3d4' (hash varies by path)
```

---

## Git status bar (4 testids)

| Testid | Element | Type |
|--------|---------|------|
| `git-status-bar` | Container | static |
| `git-branch-name` | Branch name | static |
| `git-status-counts` | Status counts | static |
| `git-sync-indicator` | Sync indicator | static |

---

## Terminal panel (6 testids)

| Testid | Element | Type |
|--------|---------|------|
| `terminal-panel` | Container | static |
| `terminal-instance` | xterm.js wrapper | static |
| `terminal-btn-scroll` | Scroll to bottom | static |
| `terminal-btn-restart` | Restart terminal | static |
| `terminal-btn-lock` | Scroll lock toggle | static |
| `terminal-status` | Status indicator | static |

---

## Editor (5 testids)

| Testid | Element | Type |
|--------|---------|------|
| `editor-content` | Content layout container | static |
| `editor-pane` | Editor pane wrapper | static |
| `preview-pane` | Preview pane wrapper | static |
| `editor-monaco` | Monaco editor wrapper | static |
| `editor-preview` | Markdown preview wrapper | static |

---

## Markdown toolbar (20 testids)

| Testid | Element | Type |
|--------|---------|------|
| `markdown-toolbar` | Container | static |
| `toolbar-btn-bold` | Bold button | static |
| `toolbar-btn-italic` | Italic button | static |
| `toolbar-btn-strikethrough` | Strikethrough button | static |
| `toolbar-btn-code` | Code button | static |
| `toolbar-btn-link` | Link button | static |
| `toolbar-btn-image` | Image button | static |
| `toolbar-btn-heading` | Heading button | static |
| `toolbar-btn-list` | Bullet list button | static |
| `toolbar-btn-list-ordered` | Numbered list button | static |
| `toolbar-btn-search` | Search button | static |
| `view-mode-btn-editor` | Editor only mode | static |
| `view-mode-btn-split` | Vertical split mode | static |
| `view-mode-btn-split-horizontal` | Horizontal split mode | static |
| `view-mode-btn-preview` | Preview only mode | static |
| `toolbar-btn-export-pdf` | Export PDF button | static |
| `toolbar-btn-export-docx` | Export DOCX button | static |
| `modified-indicator` | Unsaved changes indicator | static |
| `autosave-indicator` | Autosave indicator | static |
| `reload-indicator` | External changes indicator | static |

---

## Dialogs - Base (3 testids)

| Testid | Element | Type |
|--------|---------|------|
| `dialog-overlay` | Backdrop overlay | static |
| `dialog-container` | Dialog box | static |
| `dialog-title` | Dialog title | static |

---

## Dialogs - Confirm (4 testids)

| Testid | Element | Type |
|--------|---------|------|
| `dialog-confirm` | Confirm dialog | static |
| `dialog-confirm-message` | Confirm message | static |
| `dialog-btn-confirm` | Confirm button | static |
| `dialog-btn-cancel` | Cancel button | static |

---

## Dialogs - Alert (3 testids)

| Testid | Element | Type |
|--------|---------|------|
| `dialog-alert` | Alert dialog | static |
| `dialog-alert-message` | Alert message | static |
| `dialog-btn-ok` | OK button | static |

---

## Dialogs - Prompt (4 testids)

| Testid | Element | Type |
|--------|---------|------|
| `dialog-prompt` | Prompt dialog | static |
| `dialog-prompt-message` | Prompt message | static |
| `dialog-prompt-input` | Prompt input | static |
| `dialog-prompt-dropdown` | Prompt dropdown | static |

---

## File picker (5 testids)

| Testid | Element | Type |
|--------|---------|------|
| `file-picker` | File picker dialog | static |
| `file-picker-list` | File list | static |
| `file-picker-item-{hash}` | File item | dynamic |
| `file-picker-btn-select` | Select button | static |
| `file-picker-btn-cancel` | Cancel button | static |

---

## Context menus (12 testids)

| Testid | Element | Type |
|--------|---------|------|
| `context-menu` | Base menu container | static |
| `context-menu-separator` | Menu separator | static |
| `context-menu-terminal` | Terminal menu | static |
| `context-menu-editor` | Editor menu | static |
| `context-menu-preview` | Preview menu | static |
| `context-menu-item-copy` | Copy item | static |
| `context-menu-item-paste` | Paste item | static |
| `context-menu-item-cut` | Cut item | static |
| `context-menu-item-elaborate` | Elaborate prompt | static |
| `context-menu-item-modify` | Modify prompt | static |
| `context-menu-item-ask` | Ask prompt | static |
| `context-menu-item-visualize` | Visualize prompt | static |

---

## Diagram viewer (5 testids)

| Testid | Element | Type |
|--------|---------|------|
| `diagram-viewer` | Fullscreen overlay | static |
| `diagram-viewer-btn-close` | Close button | static |
| `diagram-viewer-content` | Content wrapper | static |
| `diagram-viewer-svg` | SVG container | static |
| `diagram-viewer-btn-chat` | Chat trigger | static |

---

## Chat bubble (15 testids)

| Testid | Element | Type |
|--------|---------|------|
| `chat-bubble` | Container | static |
| `chat-bubble-btn-open` | FAB open button | static |
| `chat-panel` | Chat panel | static |
| `chat-textarea` | Input textarea | static |
| `chat-btn-send` | Send button | static |
| `chat-btn-zoom-in` | Zoom in | static |
| `chat-btn-zoom-out` | Zoom out | static |
| `chat-btn-fit` | Fit to view | static |
| `chat-btn-reset` | Reset zoom | static |
| `chat-direction-btn-{dir}` | Direction (TB/BT/LR/RL) | dynamic |
| `chat-btn-scroll-bottom` | Scroll to bottom | static |
| `chat-btn-restart` | Restart terminal | static |
| `chat-btn-scroll-lock` | Scroll lock | static |
| `chat-zoom-indicator` | Zoom level display | static |
| `chat-character-count` | Character counter | static |

---

## Mermaid toolbar (4 testids)

| Testid | Element | Type |
|--------|---------|------|
| `mermaid-toolbar` | Container | static |
| `mermaid-directions-group` | Direction buttons group | static |
| `mermaid-direction-btn-{dir}` | Direction (TB/BT/LR/RL) | dynamic |
| `mermaid-btn-expand` | Expand to fullscreen | static |

---

## Tabs (5 testids)

| Testid | Element | Type |
|--------|---------|------|
| `tab-bar` | Tab bar container | static |
| `tab-item-{hash}` | Tab item | dynamic |
| `tab-label-{hash}` | Tab label | dynamic |
| `tab-close-{hash}` | Tab close button | dynamic |
| `tab-dirty-{hash}` | Unsaved indicator | dynamic |

---

## Search bar (8 testids)

| Testid | Element | Type |
|--------|---------|------|
| `search-bar` | Container | static |
| `search-bar-input` | Search input | static |
| `search-bar-toggle-case` | Case sensitive toggle | static |
| `search-bar-toggle-word` | Whole word toggle | static |
| `search-bar-btn-prev` | Previous match | static |
| `search-bar-btn-next` | Next match | static |
| `search-bar-btn-close` | Close search | static |
| `search-bar-count` | Match count display | static |

---

## Toast notifications (4 testids)

| Testid | Element | Type |
|--------|---------|------|
| `toast-container` | Toast container | static |
| `toast-{type}` | Toast by type (success/error/warning/info) | dynamic |
| `toast-message` | Toast message | static |
| `toast-btn-dismiss` | Dismiss button | static |

---

## Settings overlay (10 testids)

| Testid | Element | Type |
|--------|---------|------|
| `settings-overlay` | Overlay container | static |
| `settings-container` | Inner container | static |
| `settings-btn-close` | Close button | static |
| `settings-section-editor` | Editor settings section | static |
| `settings-section-git` | Git settings section | static |
| `settings-section-logging` | Logging section | static |
| `settings-toggle-line-breaks` | Line breaks toggle | static |
| `settings-toggle-polling` | Git polling toggle | static |
| `settings-select-polling-interval` | Polling interval select | static |
| `settings-select-log-level` | Log level select | static |

---

## Document stats bar (6 testids)

| Testid | Element | Type |
|--------|---------|------|
| `document-stats-bar` | Container | static |
| `stats-words` | Word count | static |
| `stats-characters` | Character count | static |
| `stats-lines` | Line count | static |
| `stats-reading-time` | Reading time | static |
| `stats-selection` | Selection stats | static |
