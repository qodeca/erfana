# E2E selector catalog

All `data-testid` attributes available for E2E testing – **351 testids** across 38 sections (counted against `testids.ts` and `commentTestids.ts` on 2026-10-29).

**Related documentation**:
- [E2E Testing Guide](./e2e-testing.md) – Main E2E documentation
- [Test ID constants](../../src/renderer/src/constants/testids.ts) – Source of truth
- Spec #011 (archived) – Specification

> **Scope of the automated check**: `testids.test.ts` asserts per-section counts against `testids.ts` – it validates the **source of truth, not this page**. Nothing fails when a table here drifts, so add the row by hand whenever you add a testid.
>
> **How the sections are grouped**: each heading's count is the number of constants in that group, matching the per-group `toHaveLength` assertions in `testids.test.ts`, which select constants by key prefix (`TERMINAL_`, `SCREEN_PERMISSION`, `TOAST` and so on). Two groups differ from the block layout of `testids.ts`: the screen permission dialog ids sit inside its `// Terminal Panel` block but are counted as their own group here, and the comment ids come from `commentTestids.ts`. The `// Name (N)` banner comments in `testids.ts` are not checked by any test, and six of them lag the real counts: Project Tree (16, really 17), Terminal Panel (14, really 18 with the screen permission ids), Dialogs - File Picker (5, really 6), Toast Notification (6, really 8), Settings Overlay (27, really 33) and HTML Preview Comments in `commentTestids.ts` (76, really 77).

---

## Activity bar (4 testids)

| Testid | Element | Type |
|--------|---------|------|
| `activity-bar` | Container | static |
| `activity-bar-btn-files` | Files panel button | static |
| `activity-bar-btn-terminal` | Terminal panel button | static |
| `activity-bar-btn-settings` | Settings button | static |

---

## Project tree (17 testids)

| Testid | Element | Type |
|--------|---------|------|
| `project-tree` | Container | static |
| `project-tree-empty` | Empty state | static |
| `project-tree-btn-open` | Open folder button | static |
| `project-tree-btn-close` | Close project button | static |
| `project-tree-btn-new-file` | New file button | static |
| `project-tree-btn-new-folder` | New folder button | static |
| `project-tree-btn-import` | Import file button | static |
| `project-tree-btn-refresh` | Refresh tree button | static |
| `project-tree-node-{hash}` | Tree node | dynamic |
| `project-tree-toggle-{hash}` | Folder toggle | dynamic |
| `project-tree-node-file-{hash}` | File node | dynamic |
| `project-tree-node-folder-{hash}` | Folder node | dynamic |
| `project-tree-drag-overlay` | Drag ghost element | static |
| `project-tree-error` | Error state container | static |
| `project-tree-loading` | Loading spinner | static |
| `project-tree-drop-target-{hash}` | Folder drop target | dynamic |
| `project-tree-placeholder-{hash}` | "Loading…" or "Could not read this folder" line under an expanded folder whose contents are read on expand (#320) | dynamic |

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

## Terminal panel (14 testids)

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
| `terminal-btn-capture-screen` | Full screen capture (macOS + Windows) | static |
| `terminal-btn-capture-window` | Window capture (macOS + Windows) | static |
| `terminal-btn-capture-area` | Area capture (macOS + Windows) | static |
| `terminal-btn-camera` | Camera photo capture | static |
| `terminal-btn-expand` | Expand/restore terminal to cover the editor area | static |

---

## Screen permission dialog (4 testids)

Advisory macOS Screen Recording permission prompt. It appears **after** the OS denies a capture and never blocks one – see [`ScreenPermissionDialog.tsx`](../../src/renderer/src/components/Dialog/ScreenPermissionDialog.tsx).

| Testid | Element | Type |
|--------|---------|------|
| `screen-permission-dialog` | Screen-recording permission dialog container | static |
| `screen-permission-btn-open-settings` | Opens the macOS Screen Recording privacy pane | static |
| `screen-permission-btn-relaunch` | Relaunches the app so a fresh grant takes effect | static |
| `screen-permission-btn-close` | Dismisses the dialog | static |

---

## Claude status bar (3 testids)

Per-terminal Claude Code context meter (macOS + Windows). Present only while `claude` is running in that panel.

| Testid | Element | Type |
|--------|---------|------|
| `claude-status-bar` | Status bar container | static |
| `claude-status-badge` | Context-window size badge chip ("200k" / "1M") | static |
| `claude-status-fill` | Progress meter fill element (width = percent) | static |

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

## Root error boundary (7 testids)

Full-window crash recovery screen (issue #60). Action buttons are capability-gated – each one renders only when its bridge method is callable, and none render in degraded mode – see [`RootErrorFallback.tsx`](../../src/renderer/src/components/RootErrorBoundary/RootErrorFallback.tsx).

| Testid | Element | Type |
|--------|---------|------|
| `root-error-boundary` | Fallback container (`role="alertdialog"`, focused on mount) | static |
| `root-error-details-toggle` | Show/hide error details disclosure button | static |
| `root-error-details` | Error details region (`role="region"`, `hidden` while collapsed) | static |
| `root-error-btn-copy` | Copy error details button (needs the clipboard bridge) | static |
| `root-error-btn-logs` | Open logs folder button (needs the logging bridge) | static |
| `root-error-btn-restart` | Restart Erfana button (needs the system bridge) | static |
| `root-error-status` | Live region (`role="status"`) carrying every transient message | static |

---

## Panel error boundary (1 testid)

| Testid | Element | Type |
|--------|---------|------|
| `panel-error-boundary` | Panel-scoped fallback container (message + Reload button) | static |

---

## File conflict notification (4 testids)

| Testid | Element | Type |
|--------|---------|------|
| `file-conflict-notification` | Container | static |
| `file-conflict-btn-reload` | Reload from disk | static |
| `file-conflict-btn-keep` | Keep local version | static |
| `file-conflict-btn-dismiss` | Dismiss notification | static |

---

## Editor content layout (6 testids)

| Testid | Element | Type |
|--------|---------|------|
| `editor-area` | Editor area wrapper – the center dockview region; collapses when the terminal is maximized | static |
| `editor-content` | Content container | static |
| `editor-pane` | Editor pane wrapper | static |
| `preview-pane` | Preview pane wrapper | static |
| `editor-monaco` | Monaco editor wrapper | static |
| `editor-preview` | Markdown preview container | static |

---

## Camera dialog (10 testids)

| Testid | Element | Type |
|--------|---------|------|
| `camera-dialog` | Dialog container | static |
| `camera-device-select` | Device selector dropdown | static |
| `camera-preview` | Video preview element | static |
| `camera-preview-wrapper` | 16:9 aspect-ratio wrapper around the preview | static |
| `camera-mirror-toggle` | Mirror-preview checkbox (disabled until the preview is live) | static |
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

## Dialogs – file picker (6 testids)

| Testid | Element | Type |
|--------|---------|------|
| `file-picker` | File picker dialog | static |
| `file-picker-list` | File list | static |
| `file-picker-item-{hash}` | File item | dynamic |
| `file-picker-btn-select` | Select button | static |
| `file-picker-btn-cancel` | Cancel button | static |
| `file-picker-incomplete` | Note that the project is too large to list in full, so other files of this name may be missing (#320) | static |

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

## Image viewer panel (20 testids)

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
| `image-viewer-status` | Refresh status slot (`role="status"`, `data-state=idle\|reloading\|unavailable`) | dynamic |
| `image-viewer-deleted-banner` | Deleted / auto-refresh-unavailable banner (`data-variant=deleted\|unavailable`) | conditional |
| `image-viewer-btn-reload` | Reload from disk (inside the banner) | conditional |
| `image-viewer-btn-export-png` | Export the image as PNG (#73) | static |
| `image-viewer-btn-export-pdf` | Export the image as PDF (#73) | static |
| `image-viewer-btn-copy` | Copy the image to the clipboard (#73) | static |
| `image-viewer-export-status` | Polite export live region (`role="status"`), visually hidden; carries busy and success sentences (#73) | dynamic |
| `image-viewer-export-alert` | Assertive export live region (`role="alert"`), visually hidden; carries failures, which the `aria-modal` full-screen overlay would otherwise hide from a screen reader (#73) | dynamic |

> **Ancestor scoping is mandatory in this section.** The panel toolbar and the full-screen overlay toolbar both render the zoom, full-screen, export and copy ids, and the two export live regions are rendered into whichever surface is on top. A bare `getByTestId` therefore resolves to two nodes for the buttons; scope by `image-viewer-panel` or `image-viewer-fullscreen` first, as `e2e/pages/image-viewer.page.ts` does.

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

## Toast notifications (8 testids)

| Testid | Element | Type |
|--------|---------|------|
| `toast-container` | Toast container | static |
| `toast` | Individual toast | static |
| `toast-message` | Toast message | static |
| `toast-btn-dismiss` | Dismiss button | static |
| `toast-btn-action` | Action button (present only on a toast carrying an action; such a toast never auto-dismisses) | static |
| `toast-live-polite` | Persistent visually-hidden polite live region (info/success/warning) | static |
| `toast-live-alert` | Persistent visually-hidden alert live region (errors) | static |
| `toast-count` | Repeat count ("×3") on a toast that merged identical repeats | static |

---

## Settings overlay (33 testids)

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
| `settings-section-html-preview` | HTML preview settings section | static |
| `settings-toggle-html-preview` | HTML preview enabled toggle | static |
| `settings-api-key-error` | API key error message | static |
| `settings-btn-whisper-cancel` | Cancel button shown while the Whisper binary or model downloads | static |
| `settings-whisper-download-live` | Always-mounted, visually hidden status region announcing download progress | static |
| `settings-whisper-download-alert` | Always-mounted, visually hidden alert region announcing a failed download | static |
| `settings-section-terminal` | Terminal settings section (lens review [23]) | static |
| `settings-select-screen-reader-mode` | Terminal screen-reader mode select: Auto / On / Off | static |
| `settings-screen-reader-status` | What Auto currently detects (screen reader reported or not) | static |
| `settings-section-import-tools` | Import tools section (#250) | static |
| `settings-import-tool-status` | One format row's status; the row carries `data-format` and `data-state` | static |
| `settings-btn-import-tools-recheck` | "Check again" button (#250) | static |
| `settings-import-tools-live` | Polite live region announcing the outcome of "Check again" | static |

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

## Welcome panel (6 testids)

| Testid | Element | Type |
|--------|---------|------|
| `welcome-btn-open` | Open/Change project button | static |
| `welcome-btn-import` | Import file button | static |
| `welcome-recent-projects` | Recent projects list | static |
| `welcome-recent-project-{hash}` | Recent project item | dynamic |
| `welcome-recent-project-btn-remove-{hash}` | Remove recent project | dynamic |
| `welcome-recent-project-btn-open-{hash}` | Keyboard "open" button of a recent project row | dynamic |

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

---

## HTML Preview comments (77 testids)

Constants: `TEST_IDS.COMMENT_*` (defined in `src/renderer/src/constants/commentTestids.ts`, spread into `TEST_IDS`). Rows, messages, threads and tags repeat – scope them with a parent locator (`drawer.getByTestId(…)`, `.nth(i)`).

**Toolbar**

| Testid | Element | Type |
|--------|---------|------|
| `preview-band-comment-mode` | Comment mode toggle in the preview toolbar | static |
| `preview-band-comments` | Comments list button (opens the drawer) in the preview toolbar | static |
| `preview-band-comment-icons` | Show comment icons toggle in the preview toolbar | static |

**Element menu and live regions**

| Testid | Element | Type |
|--------|---------|------|
| `comment-context-menu` | The element menu (right-click in comment mode) | static |
| `comment-menu-add` | Element menu: Add comment | static |
| `comment-announce` | The tab's polite live region | static |
| `comment-alert` | The tab's assertive live region | static |

**Comment window**

| Testid | Element | Type |
|--------|---------|------|
| `comment-window` | The comment window (data-view: identity / new / threads) | static |
| `comment-window-title` | Window title (takes focus in the threads view) | static |
| `comment-window-close` | Close (x) in the window head | static |
| `comment-window-alert` | The window's own assertive live region | static |
| `comment-window-read-error` | Couldn't read comments – the list failed | static |
| `comment-window-retry` | Try again after a failed list read | static |
| `comment-close` | Close in the window foot | static |
| `comment-save-error` | Banner for a refused (or still pending) write | static |

**Identity**

| Testid | Element | Type |
|--------|---------|------|
| `comment-identity-name` | Identity step: name field | static |
| `comment-identity-email` | Identity step: email field | static |
| `comment-identity-continue` | Identity step: Continue | static |
| `comment-identity-cancel` | Identity step: Cancel | static |
| `comment-identity-error` | Identity step: always-mounted save-error line | static |
| `comment-identity-line` | "Commenting as …" line under the comment field | static |
| `comment-identity-change` | Change, next to "Commenting as …" | static |
| `comment-identity-edit-name` | Inline identity editor: name field | static |
| `comment-identity-edit-email` | Inline identity editor: email field | static |

**New comment**

| Testid | Element | Type |
|--------|---------|------|
| `comment-new-field` | New comment text field | static |
| `comment-save` | Save the new comment | static |
| `comment-cancel` | Cancel the new comment (text kept) | static |
| `comment-unsaved-banner` | Unsaved-source banner (Save blocked) | static |
| `comment-unsaved-save` | Unsaved-source banner: Save {file} | static |
| `comment-unsaved-go-to-tab` | Unsaved-source banner: Go to tab | static |
| `comment-unsaved-cleared` | The banner after the source tab became clean | static |

**Threads**

| Testid | Element | Type |
|--------|---------|------|
| `comment-thread` | An open thread | static |
| `comment-resolved-thread` | A resolved thread, folded | static |
| `comment-message` | One message | static |
| `comment-message-text` | A message's text | static |
| `comment-message-actions` | A message's … (actions) button | static |
| `comment-edit-field` | Edit field of a message | static |
| `comment-edit-save` | Save changes to a message | static |
| `comment-edit-cancel` | Cancel an edit | static |
| `comment-delete-confirm` | Confirm deleting a comment or thread | static |
| `comment-delete-cancel` | Cancel a delete | static |
| `comment-reply-field` | Reply field | static |
| `comment-reply` | Reply button | static |
| `comment-resolve` | Resolve a thread | static |
| `comment-reopen` | Re-open a resolved thread | static |
| `comment-new-on-element` | New comment on the pin's element | static |
| `comment-open-in-source` | Open in source (window foot) | static |
| `comment-read-only` | Read-only file banner | static |
| `comment-not-visible` | Not-visible-now banner | static |
| `comment-not-found` | Element-not-found banner | static |
| `comment-not-found-quote` | The lost element's stored quote | static |
| `comment-damaged` | A damaged block | static |
| `comment-damaged-raw` | A damaged block's raw text | static |
| `comment-delete-block` | Delete block… | static |
| `comment-delete-block-confirm` | Confirm deleting a damaged block | static |
| `comment-newer` | A newer-format block | static |
| `comment-control-token` | A visible token for an invisible control character | static |

**Drawer**

| Testid | Element | Type |
|--------|---------|------|
| `comment-drawer` | The comments drawer | static |
| `comment-drawer-close` | Close the drawer | static |
| `comment-filter-open` | Filter: Open | static |
| `comment-filter-resolved` | Filter: Resolved | static |
| `comment-filter-attention` | Filter: Needs attention | static |
| `comment-drawer-show-icons` | Show comment icons checkbox | static |
| `comment-drawer-list` | The row list | static |
| `comment-drawer-row` | A row | static |
| `comment-drawer-row-main` | A row's main action (Show on page / Open in source) | static |
| `comment-drawer-row-open` | A row's Open (the comment window) | static |
| `comment-drawer-tag` | A tag on a row | static |
| `comment-drawer-error` | List read error with Try again | static |
| `comment-drawer-unread` | Note that main left files out of the list (its file count or byte budget) | static |

**Settings**

| Testid | Element | Type |
|--------|---------|------|
| `settings-section-comments` | Settings › Comments section | static |
| `settings-toggle-html-comments` | Feature flag: Comments in HTML preview | static |
| `settings-comment-name` | Your name | static |
| `settings-comment-email` | Your email | static |
| `settings-comment-notice` | Visibility notice | static |
| `settings-comment-alert` | Assertive region for blur-save errors | static |
