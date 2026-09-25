<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Feature inventory for the user guide (#138) – draft

This is the checklist the guide is reviewed against. Every row names the reference page that must
cover it. When the guide is built, the file moves to `docs/user-guide/feature-inventory.md` and the
last column becomes a real link to the section (acceptance criterion 1).

**How it was built** (2026-09-25):

- Sources read: `docs/features/README.md`, `docs/keyboard-shortcuts.md`, `docs/settings.md`,
  `docs/html-preview/README.md`, `docs/prompts/README.md`, `docs/terminal/README.md`, and
  `specs/registry.json`.
- Code swept: `src/renderer/src/` and `src/main/`.
- Checked in code: every setting, every context menu, `src/main/menu.ts`, every keyboard handler,
  every dialog, and every panel toolbar.

**Out of scope, on purpose:** the spec registry has only one kind of user-facing entry – `draft`
specs for work not yet shipped. Those are the graph engine (004–008), multi-CLI prompt optimisation
(013) and Google Drive links (020), and the guide leaves them out. The two shipped registry specs,
media transcription (009) and LiteParse import (021), are covered below. Most shipped features are
tracked as GitHub issues, not specs.

Platforms: **M** macOS, **W** Windows. Erfana ships for macOS and Windows only, so "all" means both.
Source paths are relative to `src/renderer/src/` (**R/**), `src/main/` (**M/**) or `src/shared/`
(**S/**).

## App, windows and projects

| ID | Feature | Platforms | Source | Guide section |
|---|---|---|---|---|
| APP-01 | Welcome screen: version, "Open a project folder to start editing", Open / Change project | all | R/components/Panels/WelcomePanel.tsx | reference/the-erfana-window |
| APP-02 | Recent projects: up to 5, open, remove from list | all | WelcomePanel.tsx, S/constants.ts | how-to/open-a-project |
| APP-03 | Home tab | all | R/components/Panels/WelcomeTab.tsx | reference/the-erfana-window |
| APP-04 | Open, change and close a project (project panel header) | all | R/components/ProjectTree/ProjectTree.tsx | how-to/open-a-project |
| APP-05 | Terminal opens when a project loads; stays closed if the user closes it | all | R/hooks/useAutoOpenTerminal.ts | reference/terminal |
| APP-06 | Left activity bar: Project, Settings (the Search button is disabled, "coming soon", and not documented) | all | R/components/ActivityBar/activityBarConfig.ts | reference/the-erfana-window |
| APP-07 | Right activity bar: Terminal (hidden without a project) | all | activityBarConfig.ts | reference/the-erfana-window |
| APP-08 | New Window: a separate instance; a project already open elsewhere focuses that window | all | M/utils/spawnNewInstance.ts, M/services/ProjectLockService.ts | how-to/work-in-several-windows |
| APP-09 | Dock menu New Window | M | M/index.ts | how-to/work-in-several-windows |
| APP-10 | Jump-list New Window | W | M/index.ts | reference/windows-differences |
| APP-11 | Quit confirmation (unsaved changes and/or busy terminal) | all | R/hooks/useQuitHandler.ts, R/utils/quitHelpers.ts | how-to/work-in-several-windows |
| APP-12 | Autosave: 2 s after typing stops, at least every 30 s; not a setting | all | R/components/Panels/MarkdownEditorPanel.tsx | reference/files-erfana-keeps |
| APP-13 | File changed on disk: Reload from Disk / Keep My Version | all | R/components/FileConflictNotification/ | how-to/edit-and-preview-markdown |
| APP-14 | Crash screen: Restart Erfana, Open logs folder, error details, copy | all | R/components/RootErrorBoundary/RootErrorFallback.tsx | reference/troubleshooting |
| APP-15 | Panel "unavailable" state after a panel error | all | PanelErrorBoundary | reference/troubleshooting |
| APP-16 | Logs in `~/.erfana/logs/`, kept 7 days; Open from Settings | all | M/services/LoggingService.ts | reference/files-erfana-keeps |
| APP-17 | Tabs: close, middle-click close, unsaved marker, "(deleted)" | all | R/components/Tabs/ | reference/the-erfana-window |
| APP-18 | No auto-update: new versions come from GitHub Releases | all | (no updater in M/) | reference/files-erfana-keeps |

## Project tree

| ID | Feature | Platforms | Source | Guide section |
|---|---|---|---|---|
| TREE-01 | Toolbar: New markdown file, New folder, Import, Refresh | all | ProjectTree.tsx | reference/project-tree |
| TREE-02 | Filter: All Files / Markdown Only | all | R/components/Panels/ProjectPanel.tsx | how-to/organise-project-files |
| TREE-03 | Git badges on files and folders | all | ProjectTree/GitStatusBadge.tsx | reference/project-tree |
| TREE-04 | Git status bar: branch, "Clean", detached HEAD, 10,000-file cap | all | ProjectTree/GitStatusBar.tsx | reference/project-tree |
| TREE-05 | Sensitive-file and symlink icons | all | ProjectTreeNode.tsx | reference/project-tree |
| TREE-06 | Drag to move between folders | all | R/hooks/useDragDropTree.ts | how-to/organise-project-files |
| TREE-07 | Drop from Finder/Explorer: Move / Copy / Import | all | Dialog/DropModeDialog.tsx | how-to/organise-project-files |
| TREE-08 | Name clash: Skip / Keep both / Replace | all | Dialog/ConflictDialog.tsx | how-to/organise-project-files |
| TREE-09 | Cut / copy / paste files | all | ProjectTree.tsx | how-to/organise-project-files |
| TREE-10 | Folder right-click menu (Cut, Copy, Paste, New File, New Folder, Rename, Import…, Delete, Reveal) | all | ProjectTree/context-menu/strategies.tsx, commands.tsx | reference/menus |
| TREE-11 | File right-click menu; HTML files add Open as source, Open in default browser | all | same | reference/menus |
| TREE-12 | Reveal in Finder / Reveal in File Explorer | all (label per OS) | commands.tsx | reference/project-tree |
| TREE-13 | Delete confirmation ("cannot be undone") | all | commands.tsx | how-to/organise-project-files |
| TREE-14 | Mouse only: no keyboard navigation of the tree yet (#88) | all | docs/keyboard-shortcuts.md | reference/project-tree |
| TREE-15 | Hidden patterns and watcher ignore list (per-project settings) | all | S/ipc/project-settings-schema.ts | reference/settings |

## Editor

| ID | Feature | Platforms | Source | Guide section |
|---|---|---|---|---|
| ED-01 | Monaco editor: F1 command palette, multi-cursor, standard commands | all | R/components/Editor/MonacoMarkdownEditor.tsx | reference/editor |
| ED-02 | View modes: Editor Only, Split Horizontal, Split Vertical, Preview Only; new tabs open in Preview | all | MarkdownToolbar.tsx | how-to/edit-and-preview-markdown |
| ED-03 | Formatting toolbar: Bold, Italic, Strikethrough, Inline Code, Link, Image, Heading 1, lists, Find | all | MarkdownToolbar.tsx | reference/editor |
| ED-04 | Find bar: next/previous, case sensitive, whole word | all | R/components/Search/SearchBar.tsx | how-to/edit-and-preview-markdown |
| ED-05 | Statistics bar: words, characters, lines, reading time, selection | all | R/components/Panels/DocumentStatsBar.tsx | reference/editor |
| ED-06 | Editor right-click menu: prompt templates, Cut, Copy, Paste | all | R/components/ContextMenu/EditorContextMenu.tsx | reference/menus |
| ED-07 | Scroll sync between editor and preview | all | hooks/useScrollSync.ts | reference/editor |
| ED-08 | Unsaved-changes prompt on closing a tab | all | Dialog/UnsavedChangesDialog.tsx | how-to/edit-and-preview-markdown |

## Markdown preview and Mermaid

| ID | Feature | Platforms | Source | Guide section |
|---|---|---|---|---|
| PV-01 | GitHub-style Markdown, safe raw HTML | all | R/components/Editor/MarkdownPreview.tsx | reference/markdown-preview |
| PV-02 | Frontmatter shown as a table | all | FrontmatterTable.tsx | reference/markdown-preview |
| PV-03 | Preserve line breaks option | all | Settings | reference/settings |
| PV-04 | Links: anchors, project files inside the app, external links to the OS, unsafe links blocked | all | MarkdownPreview.tsx | reference/markdown-preview |
| PV-05 | Preview right-click menu: prompt templates, Copy | all | ContextMenu/PreviewContextMenu.tsx | reference/menus |
| MM-01 | Mermaid diagrams with a toolbar: direction buttons, View fullscreen | all | MermaidToolbar.tsx | how-to/work-with-mermaid-diagrams |
| MM-02 | Mermaid error box with "Report this error to Claude Code" | all | MermaidDiagram.tsx | how-to/work-with-mermaid-diagrams |
| MM-03 | Full-screen diagram viewer: zoom, fit, reset, directions | all | Editor/DiagramViewer/DiagramViewer.tsx | how-to/work-with-mermaid-diagrams |
| MM-04 | Diagram chat ("Edit diagram"), send with Cmd/Ctrl+Enter | all | Editor/DiagramViewer/ChatBubble.tsx | how-to/work-with-mermaid-diagrams |

## Image viewer

| ID | Feature | Platforms | Source | Guide section |
|---|---|---|---|---|
| IMG-01 | Formats: PNG, JPEG, GIF, WebP, SVG, BMP, ICO | all | S/ipc/image-formats.ts | reference/image-viewer |
| IMG-02 | Info: dimensions, size, format, last updated | all | ImageViewerToolbar.tsx | reference/image-viewer |
| IMG-03 | Zoom, fit, full screen | all | same | how-to/view-and-export-images |
| IMG-04 | Export as PNG, as PDF, copy to clipboard | all | ImageViewerExportControls.tsx | how-to/view-and-export-images |
| IMG-05 | Live refresh, "Reloaded from disk"; deleted-file banner with Reload; 100-file watch cap | all | ImageViewerPanel.tsx, ImageViewerBanner.tsx | how-to/view-and-export-images |
| IMG-06 | Mouse and keys: wheel, drag, double-click, + = - 0 F arrows Esc | all | imageViewer.logic.ts | reference/keyboard-shortcuts |
| IMG-07 | Image paths clicked in the terminal open in the viewer | all | useTerminalFileLinks.ts | reference/terminal |

## HTML preview

| ID | Feature | Platforms | Source | Guide section |
|---|---|---|---|---|
| HP-01 | Live page with CSS and JavaScript; 3 run at once, others freeze to a still | all | M/services/preview/, docs/html-preview/README.md | how-to/preview-an-html-page |
| HP-02 | Files in node_modules, dist, out, coverage, .git or gitignored open as source | all | same | reference/html-preview |
| HP-03 | Toolbar: Back, Open links in this tab, Find, permission chip, Open in default browser, Export to PDF | all | HtmlPreviewPanel/components/ | reference/html-preview |
| HP-04 | Remote-host permission: Allow → Confirm; saved per project; cannot be removed in the app (#86) | all | PreviewBandRow.tsx, PreviewBandConfirm.tsx | how-to/preview-an-html-page |
| HP-05 | Preview issues list (script errors, blocked hosts, links, frames) | all | PreviewFailureBadge.tsx | reference/html-preview |
| HP-06 | Links in place or new tab; 50-entry history; external links ask first | all | docs/html-preview/README.md | how-to/preview-an-html-page |
| HP-07 | Frames from the same project, 3 levels, 50 per page | all | same | reference/html-preview |
| HP-08 | Auto-refresh: CSS in place, HTML/JS reload; 16 watched files per preview | all | same | reference/html-preview |
| HP-09 | Page zoom (View menu, Cmd/Ctrl + / - / 0) | all | M/menu.ts | reference/html-preview |
| HP-10 | Stopped preview with Reload | all | PreviewFallback.tsx | reference/troubleshooting |
| HP-11 | Keyboard into and out of the page (Enter/Space, Esc); Back/Forward keys | all (keys differ) | S/previewNavKeys.ts | reference/keyboard-shortcuts |
| HP-12 | Off-switch: **Run HTML files** setting | all | Settings/sections/HtmlPreviewSection.tsx | reference/settings |

## Terminal

| ID | Feature | Platforms | Source | Guide section |
|---|---|---|---|---|
| TERM-01 | Built-in terminal running your shell and any CLI agent; bundled Cascadia Mono font | all | R/components/Panels/TerminalPanel.tsx | how-to/run-an-agent-in-the-terminal |
| TERM-02 | Header buttons: scroll to bottom, restart, lock scroll, maximise | all | TerminalPanel.tsx | reference/terminal |
| TERM-03 | Screen / window / area capture; path pasted into the terminal | M, W | M/services/screenshot/ | how-to/send-a-screenshot-or-photo-to-the-agent |
| TERM-04 | macOS Screen Recording permission dialog: Close / Relaunch Erfana / Open Screen Recording settings | M | Dialog/ScreenPermissionDialog.tsx | how-to/send-a-screenshot-or-photo-to-the-agent |
| TERM-05 | Windows window picker, display picker, area overlay | W | Dialog/WindowPickerDialog.tsx, ScreenSelectDialog.tsx | reference/windows-differences |
| TERM-06 | Camera photo: camera picker, Mirror preview (per camera), JPEG path pasted | all | Dialog/CameraDialog.tsx | how-to/send-a-screenshot-or-photo-to-the-agent |
| TERM-07 | Clickable file paths (incl. `@path`, `:line-line`), picker when several match | all | R/hooks/useTerminalFileLinks.ts, Dialog/FilePickerDialog.tsx | reference/terminal |
| TERM-08 | Drop files to insert escaped paths | all | useTerminalDragDrop.ts | reference/terminal |
| TERM-09 | Right-click menu: Copy, Paste | all | ContextMenu/TerminalContextMenu.tsx | reference/menus |
| TERM-10 | "Terminal not available": Recheck, Copy fix command | all | TerminalStatusContent.tsx | reference/troubleshooting |
| TERM-11 | Clean agent environment: Claude Code runs as a top-level session | all | M/services/TerminalService.ts | how-erfana-works-with-agents |

## Claude Code status bar

| ID | Feature | Platforms | Source | Guide section |
|---|---|---|---|---|
| CC-01 | Context meter while `claude` runs: model, 200k/1M badge, %, coloured bar (under 30 %, 30–60 %, 60 %+) | M, W | TerminalPanel/components/ClaudeStatusBar.tsx | reference/claude-code-status-bar |
| CC-02 | Tooltip: exact tokens, "(inferred)" window | M, W | same | reference/claude-code-status-bar |
| CC-03 | Reads Claude Code's own transcripts only; never writes its config | M, W | M/services/claudeStatus/ | how-erfana-works-with-agents |
| CC-04 | Limits: capped 1M deployments are badged 1M (#48); on Windows it hides after `cd` before `claude` | M, W | docs/features/README.md #14 | reference/claude-code-status-bar |

## Prompt templates

| ID | Feature | Changes the file? | Source | Guide section |
|---|---|---|---|---|
| PT-01 | Explain (preview and editor) | no | R/prompts/templates/explain.md, editor-explain.md | reference/prompt-templates |
| PT-02 | Modify | **yes** | modify.md, editor-modify.md | reference/prompt-templates |
| PT-03 | Ask | no | ask.md, editor-ask.md | reference/prompt-templates |
| PT-04 | Visualize (22 diagram types) | **yes** | visualize.md, editor-visualize.md | reference/prompt-templates |
| PT-05 | Prompt (free text) | no | prompt.md, editor-prompt.md | reference/prompt-templates |
| PT-06 | Mermaid bug report | **yes** | mermaid-bug-report.md | reference/prompt-templates |
| PT-07 | Change Mermaid direction | **yes** | mermaid-change-direction.md | reference/prompt-templates |
| PT-08 | Diagram chat | **yes** | mermaid-chat.md | reference/prompt-templates |
| PT-09 | Organize import (runs after import and transcription) | to confirm while writing | organize-import.md | reference/prompt-templates |
| PT-10 | Templates are sent to the terminal and run at once | – | template frontmatter `autoExecute: true` | how-erfana-works-with-agents |

## Import, transcription, export

| ID | Feature | Platforms | Source | Guide section |
|---|---|---|---|---|
| IMP-01 | Import dialog: OCR on/off, 31 languages, page screenshots, DPI 72/150/300, first 100 pages; options kept for the session | all | R/components/DocumentImport/DocumentImportDialog.tsx | how-to/import-a-document |
| IMP-02 | Supported formats (LiteParse; the "50+" list to confirm while writing) | all | M/services import | reference/import-and-transcription |
| IMP-03 | LibreOffice / ImageMagick required dialogs | all | R/hooks/useImport.ts | how-to/import-a-document |
| IMP-04 | Large-file warning: Import anyway / Skip | all | useImport.ts | reference/import-and-transcription |
| IMP-05 | After import: file opens and the organize-import prompt runs | all | DocumentImportDialog.tsx | how-to/import-a-document |
| TR-01 | Transcription dialog: 31 languages incl. auto-detect, progress, retry | all | R/components/Transcription/TranscriptionDialog.tsx | how-to/transcribe-audio-or-video |
| TR-02 | Audio mp3 wav m4a ogg flac; video mp4 mov avi mkv webm flv wmv | all | S/constants.ts | reference/import-and-transcription |
| TR-03 | Backends: OpenAI API (audio leaves the machine) or local whisper.cpp (offline) | local: M, W x64 | Settings | how-to/transcribe-audio-or-video |
| TR-04 | Long recordings are split into chunks | all | docs/features/README.md #13 | reference/import-and-transcription |
| EX-01 | Markdown to PDF and Word; disabled in Editor Only | all | MarkdownToolbar.tsx, M/services/PdfService.ts | how-to/export-to-pdf-or-word |
| EX-02 | HTML page to PDF (toolbar or Cmd/Ctrl+S) | all | HtmlPreviewPanel | how-to/export-to-pdf-or-word |
| EX-03 | Image to PNG / PDF / clipboard | all | ImageViewerExportControls.tsx | how-to/view-and-export-images |

## Settings

| ID | Setting | Control and default | Guide section |
|---|---|---|---|
| SET-01 | Editor > Preserve line breaks | checkbox, off | reference/settings |
| SET-02 | Git status > Enable polling fallback | checkbox, on | reference/settings |
| SET-03 | Git status > Polling interval | 3/5/7/10 s, 5 s | reference/settings |
| SET-04 | Logging > Log level | Trace…Fatal, Info | reference/settings |
| SET-05 | Logging > Logs folder, Open | path + button | reference/settings |
| SET-06 | Transcription > Backend | OpenAI / Local, OpenAI | reference/settings |
| SET-07 | Transcription > OpenAI API key, Remove key | password field | reference/settings |
| SET-08 | Transcription > Whisper model | Tiny…Large, Base | reference/settings |
| SET-09 | Transcription > Model status, Download model | status + button | reference/settings |
| SET-10 | HTML preview > Run HTML files | checkbox, on | reference/settings |
| SET-11 | Per project `.erfana/settings.json`: `watcher.ignoreList`, `tree.hiddenPatterns` (extend/replace), `htmlPreview.allowlist.origins` | JSON file | reference/settings |
| SET-12 | Settings overlay: gear icon, Esc closes, no shortcut | – | reference/settings |

## Keyboard shortcuts

Every row goes into `reference/keyboard-shortcuts.md` with macOS and Windows columns.

| ID | Keys (macOS / Windows) | Action | Scope |
|---|---|---|---|
| KEY-01 | Cmd+B / Ctrl+B | Show or hide the Project sidebar (in the editor, Bold may win – to observe) | global |
| KEY-02 | Cmd+J / Ctrl+J | Show or hide the terminal | global |
| KEY-03 | Cmd+Shift+M / Ctrl+Shift+M | Maximise the terminal | global |
| KEY-04 | Cmd+Alt+R / Ctrl+Alt+R | Refresh the project tree | global |
| KEY-05 | Cmd+Shift+I / Ctrl+Shift+I | Import into the selected folder | tree |
| KEY-06 | Cmd+X/C/V / Ctrl+X/C/V | Cut, copy, paste files | tree |
| KEY-07 | Cmd+S / Ctrl+S | Save; in an HTML preview, export PDF | active tab |
| KEY-08 | Cmd+W / Ctrl+W | Close tab | active tab |
| KEY-09 | Cmd+F / Ctrl+F | Find | editor, preview, HTML page |
| KEY-10 | Cmd+G, Shift+Cmd+G / Ctrl+G, Shift+Ctrl+G | Next, previous match | editor |
| KEY-11 | Enter, Shift+Enter, Esc | Next, previous, close in the find bar | find bar |
| KEY-12 | Cmd+I, Cmd+K / Ctrl+I, Ctrl+K | Italic, insert link | editor |
| KEY-13 | Cmd+C/X/V / Ctrl+C/X/V | Copy, cut, paste text | editor |
| KEY-14 | F1, Cmd+/, Alt+↑/↓, Cmd+D, Alt+Click (Ctrl on Windows) | Monaco commands | editor |
| KEY-15 | Cmd+C; Ctrl+C with a selection / Ctrl+Shift+C, Ctrl+Shift+V | Terminal copy and paste (Ctrl+C without a selection interrupts) | terminal |
| KEY-16 | Cmd+[ / Cmd+] (macOS); Alt+← / Alt+→ (Windows) | HTML preview Back / Forward | HTML preview |
| KEY-17 | Enter or Space, then Esc | Into the HTML page and back out | HTML preview |
| KEY-18 | + = - 0 F arrows Esc | Image zoom, reset, fit, pan, leave full screen | image viewer |
| KEY-19 | + - 0 F | Diagram zoom, reset, fit | diagram viewer |
| KEY-20 | Cmd+Enter / Ctrl+Enter | Submit prompt dialog, send diagram chat | dialogs |
| KEY-21 | ↑ ↓ Enter Esc | File picker | file picker |
| KEY-22 | Esc | Close settings, dialogs, full screen | – |
| KEY-23 | Cmd+Shift+N / Ctrl+Shift+N | New Window | menu |
| KEY-24 | Cmd+0, Cmd+Plus, Cmd+- / Ctrl+… | Actual size, zoom in, zoom out | menu |
| KEY-25 | Cmd+M, Cmd+H, Cmd+Q (macOS); Alt+F4, F11 (Windows) | Window management | OS |

## Menus and dialogs

| ID | Feature | Platforms | Source | Guide section |
|---|---|---|---|---|
| MENU-01 | Erfana menu: About, Hide, Hide Others, Show All, Quit | M | M/menu.ts | reference/menus |
| MENU-02 | File: New Window; Quit (Windows) | all | M/menu.ts | reference/menus |
| MENU-03 | Edit: Undo, Redo, Cut, Copy, Paste, Select All | all | M/menu.ts | reference/menus |
| MENU-04 | View: Reload, Force Reload, Toggle DevTools, zoom, full screen | all | M/menu.ts | reference/menus |
| MENU-05 | Window: Minimize, Zoom, Bring All to Front (macOS) / Close (Windows) | all | M/menu.ts | reference/menus |
| MENU-06 | Tab right-click: Close, Close Others, Close All | all | R/components/Tabs/useTabContextMenu.tsx | reference/menus |
| MENU-07 | Text-box right-click in dialogs: Cut, Copy, Paste | all | ContextMenu/TextareaContextMenu.tsx | reference/menus |
| DLG-01 | New file, new folder, rename dialogs | all | Dialog/NewFileDialog.tsx, NewFolderDialog.tsx, RenameDialog.tsx | how-to/organise-project-files |
| DLG-02 | External link confirmation (native message box) | all | HTML preview | how-to/preview-an-html-page |

## Mismatches

Found while building the inventory. The guide documents what the **code** does. Items 1–8 are
filed as issues (leader, 2026-09-25) and are fixed there, not in #138: item 1 is
[#142](https://github.com/qodeca/erfana/issues/142), item 6 is
[#143](https://github.com/qodeca/erfana/issues/143), and items 2–5, 7 and 8 are
[#144](https://github.com/qodeca/erfana/issues/144). Item 9 is not an issue yet: a capture scene
observes it.

1. **Find bar keys** (#142). The tooltips say "Case sensitive (Alt+C)" and "Whole word (Alt+W)", but no
   handler exists for those keys (`R/components/Search/SearchBar.tsx`).
2. **Image viewer keys** (#144).
   - `docs/keyboard-shortcuts.md` lists `Home` for reset; the code handles `0` only.
   - `docs/features/README.md` #12 says F is full screen; in the code F is **Fit**, and there is no
     key to enter full screen.
3. **HTML preview setting label** (#144). `docs/settings.md` calls it "Enable HTML preview"; the app says
   **Run HTML files**.
4. **Screen permission buttons** (#144). The terminal docs say "Open settings" / "Relaunch"; the app says
   **Open Screen Recording settings** / **Relaunch Erfana** / **Close**.
5. **Tree right-click menu** (#144). The docs omit Import…, Reveal, Open as source and Open in default
   browser.
6. **Tooltips on Windows** (#143). They show ⌘ symbols ("Project (⌘B)") on Windows too.
7. **Auto-execute** (#144). `docs/prompts/README.md` mentions a review step "unless auto-execute enabled";
   every template has `autoExecute: true`.
8. **"Terminal-agent prompts"** (#144, first there: a live rule breach). `docs/features/README.md` #1 says "context menu with terminal-agent prompts", which breaks
   the no-built-in-AI rule. If #144 has not fixed it by then, the plan does.
9. **Cmd+B in the editor.** Whether it makes text bold or toggles the sidebar is unverified. A
   capture scene observes it, and the guide states what happens.
