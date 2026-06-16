# E2E selector catalog

All `data-testid` attributes available for E2E testing – **225 testids** across 33 sections.

**Related documentation**:
- [E2E Testing Guide](./e2e-testing.md) – Main E2E documentation
- [Test ID constants](../../src/renderer/src/constants/testids.ts) – Source of truth
- Spec #011 (archived) – Specification

> **Counts are validated** by automated tests in `testids.test.ts`. If a section count becomes stale, tests fail.

---

## Activity bar (4 testids)

| Testid | Element | Type |
|--------|---------|------|
| `activity-bar` | Container | static |
| `activity-bar-btn-files` | Files panel button | static |
| `activity-bar-btn-terminal` | Terminal panel button | static |
| `activity-bar-btn-settings` | Settings button | static |

---

## Project tree (15 testids)

| Testid | Element | Type |
|--------|---------|------|
| `project-tree` | Container | static |
| `project-tree-empty` | Empty state | static |
| `project-tree-btn-open` | Open folder button | static |
| `project-tree-btn-close` | Close project button | static |
| `project-tree-btn-new-file` | New file button | static |
| `project-tree-btn-new-folder` | New folder button | static |
| `project-tree-btn-refresh` | Refresh tree button | static |
| `project-tree-node-{hash}` | Tree node | dynamic |
| `project-tree-toggle-{hash}` | Folder toggle | dynamic |
| `project-tree-node-file-{hash}` | File node | dynamic |
| `project-tree-node-folder-{hash}` | Folder node | dynamic |
| `project-tree-drag-overlay` | Drag ghost element | static |
| `project-tree-error` | Error state container | static |
| `project-tree-loading` | Loading spinner | static |
| `project-tree-drop-target-{hash}` | Folder drop target | dynamic |

**Dynamic testid example**:
```typescript
import { getDynamicTestId, TEST_IDS } from '@/constants/testids'

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

## Terminal panel (13 testids)

| Testid | Element | Type |
|--------|---------|------|
| `terminal-panel` | Container | static |
| `terminal-instance` | xterm.js wrapper | static |
| `terminal-btn-scroll` | Scroll to bottom | static |
| `terminal-btn-restart` | Restart terminal | static |
| `terminal-btn-lock` | Scroll lock toggle | static |
| `terminal-drop-zone` | Drag-drop file path zone | static |
| `terminal-status-checking` | Status: checking availability | static |
| `terminal-status-unavailable` | Status: node-pty missing | static |
| `terminal-status-error` | Status: error occurred | static |
| `terminal-btn-capture-screen` | Full screen capture (macOS) | static |
| `terminal-btn-capture-window` | Window capture (macOS) | static |
| `terminal-btn-capture-area` | Area capture (macOS) | static |
| `terminal-btn-camera` | Camera photo capture | static |

---

## UI blocker (1 testid)

| Testid | Element | Type |
|--------|---------|------|
| `ui-blocker` | Overlay | static |

---

## Editor error boundary (1 testid)

| Testid | Element | Type |
|--------|---------|------|
| `editor-error-boundary` | Fallback container | static |

---

## File conflict notification (4 testids)

| Testid | Element | Type |
|--------|---------|------|
| `file-conflict-notification` | Container | static |
| `file-conflict-btn-reload` | Reload from disk | static |
| `file-conflict-btn-keep` | Keep local version | static |
| `file-conflict-btn-dismiss` | Dismiss notification | static |

---

## Editor content layout (5 testids)

| Testid | Element | Type |
|--------|---------|------|
| `editor-content` | Content container | static |
| `editor-pane` | Editor pane wrapper | static |
| `preview-pane` | Preview pane wrapper | static |
| `editor-monaco` | Monaco editor wrapper | static |
| `editor-preview` | Markdown preview container | static |

---

## Camera dialog (8 testids)

| Testid | Element | Type |
|--------|---------|------|
| `camera-dialog` | Dialog container | static |
| `camera-device-select` | Device selector dropdown | static |
| `camera-preview` | Video preview element | static |
| `camera-btn-capture` | Capture photo button | static |
| `camera-btn-cancel` | Cancel button | static |
| `camera-btn-refresh` | Refresh devices (on error) | static |
| `camera-error` | Error message area | static |
| `camera-shutter` | Shutter animation overlay | static |

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

## Dialogs – base (3 testids)

| Testid | Element | Type |
|--------|---------|------|
| `dialog-overlay` | Backdrop overlay | static |
| `dialog-container` | Dialog box | static |
| `dialog-title` | Dialog title | static |

---

## Dialogs – external drop (6 testids)

| Testid | Element | Type |
|--------|---------|------|
| `external-drop-overlay` | Drop overlay (OS file drag) | static |
| `external-drop-dialog` | Dialog container | static |
| `external-drop-move-button` | Move files button | static |
| `external-drop-copy-button` | Copy files button | static |
| `external-drop-import-button` | Import files button | static |
| `external-drop-cancel-button` | Cancel button | static |

---

## Dialogs – conflict (4 testids)

| Testid | Element | Type |
|--------|---------|------|
| `conflict-dialog` | Dialog container | static |
| `conflict-replace-button` | Replace existing file | static |
| `conflict-keep-both-button` | Keep both files | static |
| `conflict-cancel-button` | Cancel/skip | static |

---

## Dialogs – confirm (4 testids)

| Testid | Element | Type |
|--------|---------|------|
| `dialog-confirm` | Confirm dialog | static |
| `dialog-confirm-message` | Confirm message | static |
| `dialog-btn-confirm` | Confirm button | static |
| `dialog-btn-cancel` | Cancel button | static |

---

## Dialogs – alert (3 testids)

| Testid | Element | Type |
|--------|---------|------|
| `dialog-alert` | Alert dialog | static |
| `dialog-alert-message` | Alert message | static |
| `dialog-btn-ok` | OK button | static |

---

## Dialogs – prompt (4 testids)

| Testid | Element | Type |
|--------|---------|------|
| `dialog-prompt` | Prompt dialog | static |
| `dialog-prompt-message` | Prompt message | static |
| `dialog-prompt-input` | Text input | static |
| `dialog-prompt-dropdown` | Dropdown select | static |

---

## Dialogs – file picker (5 testids)

| Testid | Element | Type |
|--------|---------|------|
| `file-picker` | File picker dialog | static |
| `file-picker-list` | File list | static |
| `file-picker-item-{hash}` | File item | dynamic |
| `file-picker-btn-select` | Select button | static |
| `file-picker-btn-cancel` | Cancel button | static |

---

## Context menu – base (2 testids)

| Testid | Element | Type |
|--------|---------|------|
| `context-menu` | Base menu container | static |
| `context-menu-separator` | Menu separator | static |

---

## Context menu – terminal (3 testids)

| Testid | Element | Type |
|--------|---------|------|
| `context-menu-terminal` | Terminal menu | static |
| `context-menu-item-copy` | Copy item | static |
| `context-menu-item-paste` | Paste item | static |

---

## Context menu – editor/preview (7 testids)

| Testid | Element | Type |
|--------|---------|------|
| `context-menu-editor` | Editor menu | static |
| `context-menu-preview` | Preview menu | static |
| `context-menu-item-explain` | Explain prompt | static |
| `context-menu-item-modify` | Modify prompt | static |
| `context-menu-item-ask` | Ask prompt | static |
| `context-menu-item-visualize` | Visualize prompt | static |
| `context-menu-item-cut` | Cut item (editor) | static |

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

## Image viewer panel (12 testids)

| Testid | Element | Type |
|--------|---------|------|
| `image-viewer-panel` | Panel container | static |
| `image-viewer-content` | Content area | static |
| `image-viewer-image` | Image element | static |
| `image-viewer-toolbar` | Toolbar | static |
| `image-viewer-btn-zoom-in` | Zoom in | static |
| `image-viewer-btn-zoom-out` | Zoom out | static |
| `image-viewer-zoom-level` | Zoom level (click to reset) | static |
| `image-viewer-btn-fit` | Fit to view | static |
| `image-viewer-btn-fullscreen` | Enter full screen | static |
| `image-viewer-btn-close` | Close full screen | static |
| `image-viewer-fullscreen` | Full screen overlay | static |
| `image-viewer-fullscreen-content` | Full screen content area | static |

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
| `chat-btn-restart` | Restart diagram | static |
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

## Editor tabs (6 testids)

| Testid | Element | Type |
|--------|---------|------|
| `tab-bar` | Tab bar container | static |
| `tab-item-{hash}` | Tab item | dynamic |
| `tab-label-{hash}` | Tab label | dynamic |
| `tab-close-{hash}` | Tab close button | dynamic |
| `tab-dirty-{hash}` | Unsaved indicator | dynamic |
| `tab-active-{hash}` | Active tab marker | dynamic |

---

## Image tabs (3 testids)

| Testid | Element | Type |
|--------|---------|------|
| `image-tab-item-{hash}` | Image tab item | dynamic |
| `image-tab-label-{hash}` | Image tab label | dynamic |
| `image-tab-close-{hash}` | Image tab close button | dynamic |

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
| `toast` | Individual toast | static |
| `toast-message` | Toast message | static |
| `toast-btn-dismiss` | Dismiss button | static |

---

## Settings overlay (20 testids)

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
| `settings-logs-folder-path` | Logs folder path display | static |
| `settings-btn-open-logs` | Open logs folder button | static |
| `settings-section-transcription` | Transcription settings section | static |
| `settings-select-transcription-backend` | Backend selector | static |
| `settings-input-api-key` | API key input | static |
| `settings-btn-clear-api-key` | Clear API key button | static |
| `settings-select-whisper-model` | Whisper model select | static |
| `settings-btn-whisper-model` | Whisper model download/status | static |
| `settings-whisper-model-status` | Whisper model status text | static |
| `settings-whisper-download-error` | Whisper download error | static |

---

## Document import dialog (12 testids)

| Testid | Element | Type |
|--------|---------|------|
| `doc-import-dialog` | Dialog container | static |
| `doc-import-file-info` | File info display area | static |
| `doc-import-ocr-toggle` | OCR toggle checkbox | static |
| `doc-import-language-select` | OCR language select dropdown | static |
| `doc-import-screenshots-toggle` | Screenshots toggle checkbox | static |
| `doc-import-dpi-select` | DPI select dropdown | static |
| `doc-import-btn-start` | Start import button | static |
| `doc-import-btn-cancel` | Cancel button | static |
| `doc-import-btn-retry` | Retry button (on error) | static |
| `doc-import-btn-done` | Done button (on success) | static |
| `doc-import-progress` | Progress section container | static |
| `doc-import-phase-text` | Phase text display | static |

---

## Transcription dialog (10 testids)

| Testid | Element | Type |
|--------|---------|------|
| `transcription-dialog` | Dialog container | static |
| `transcription-language-select` | Language dropdown | static |
| `transcription-btn-start` | Start transcription | static |
| `transcription-btn-retry` | Retry (on error) | static |
| `transcription-btn-cancel` | Cancel button | static |
| `transcription-progress-bar` | Progress bar | static |
| `transcription-progress-text` | Progress percentage | static |
| `transcription-phase-text` | Phase description | static |
| `transcription-error` | Error message | static |
| `transcription-btn-done` | Done button (success state) | static |

---

## Welcome panel (4 testids)

| Testid | Element | Type |
|--------|---------|------|
| `welcome-btn-import` | Import file button | static |
| `welcome-recent-projects` | Recent projects list | static |
| `welcome-recent-project-{hash}` | Recent project item | dynamic |
| `welcome-recent-project-btn-remove-{hash}` | Remove recent project | dynamic |

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
